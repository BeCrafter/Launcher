# 测试指南

仓库用 Vitest 5，测试分成两个 project：

| project | 环境 | 范围 | 命令 |
| --- | --- | --- | --- |
| `node` | node | `src/**/*.test.ts`、`scripts/**/*.test.mjs`、`packaging/**/*.test.mjs` | `npm run test:node` |
| `renderer` | jsdom | `src/renderer/src/**/*.test.tsx` | `npm run test:renderer` |

`npm test` 跑全部；单文件调试：

```bash
npx vitest run --project renderer src/renderer/src/modules/ai/AiCards.test.tsx
npx vitest --project renderer src/renderer/src/modules/ai/AiCards.test.tsx   # watch
```

命名规则只有一条：**渲染层组件测试用 `.test.tsx`，其余用 `.test.ts`**。后缀决定环境 —— 组件测试放在组件旁边即可，不需要 `@vitest-environment` 注释。

## 渲染层 setup 做了什么

`src/renderer/src/test/setup.ts` 在 `beforeEach` 里依次执行：

1. `installDomShims()`：补齐 jsdom 缺的 `matchMedia`、`PointerEvent`、`ResizeObserver`、`IntersectionObserver`、`scrollIntoView`、`clipboard`、`createObjectURL` 等；同时设置 `IS_REACT_ACT_ENVIRONMENT`。
2. `installLauncherStub()`：注入全新的 `window.launcher` 桩。
3. `resetRendererStores()`：用 Zustand 5 的 `getInitialState()` 重置全部 renderer store，恢复 `zh-CN`、清主题类名与 storage，并取消上一用例遗留的提权/危险确认 Promise。

`afterEach` 执行 RTL `cleanup()`、恢复真实定时器与 mock。

组件测试直接 `render(ui)`；仓库没有 Context Provider。需要特定设置（英文、主题）时：

```tsx
import { renderWithSettings } from '../../test/render'

renderWithSettings(<AiCard card={card} pendingToolCallId={null} />, { language: 'en-US' })
```

`setTestSettings`（`src/renderer/src/test/stores.ts`）走 `applyFromMain`，语言/主题同步生效且不经过 IPC；不要调用 `useSettingsStore.getState().set()`（它会调 `window.launcher.setSettings`）。

## window.launcher 桩

```tsx
import { installLauncherStub, mockLauncher, emitLauncherEvent } from '../../test/launcher-stub'
import { makeEngineState } from '../../test/fixtures'

installLauncherStub({ ai: { getState: vi.fn(async () => makeEngineState({ configured: false })) } })
const stub = mockLauncher()
expect(stub.ai.getState).toHaveBeenCalled()
emitLauncherEvent(IPC_EVENTS.aiRunEvent, payload) // 驱动 onEvent 订阅者
```

- 覆盖是**一层深合并**：只改 `ai.getState` 不会丢掉 `ai` 的其他默认方法。
- 未桩定的成员由 Proxy 兜底并同步抛错，信息形如 `[test] window.launcher.ai.mcpInfo 未桩定`。
- `dataSource()` 会缓存 repository 实例，但每个方法内部才读 `window.launcher`，所以每个用例换桩是安全的；不要在模块顶层缓存 `window.launcher` 的引用。
- 默认 `ai.respondApproval` 返回 `{ autoApprove: false }`，避免 await 之后写 store 触发 act 警告。

## 数据工厂

`src/renderer/src/test/fixtures.ts`：

`makeSettings` / `makeEngineState` / `makeSkill` / `makeUserMessage` / `makeAssistantMessage` / `makeToolResult` / `makeImageAttachment` / `makeTextAttachment` / `makeMention` / `makeSession` / `makeUsage` / `makeUpdateState`。

只构造数据、不碰 store。测试里用 `useAiStore.setState({ ... })` 播种，放在 `beforeEach` 或用例内 —— **不要放模块顶层**，会被 setup 的 `beforeEach` 冲掉。

## 已知边界

- **模块级 flag 不随 store 重置**：`ai-store.eventInited`、`ui-store.toastTimer`、`update-store.initialized/tickTimer`、`notes-store.saveTimer`、`bootstrap.booted`、`elevation` 内部请求。组件测试不要调用 `bootstrap()` / `useAiStore.init()` / `useUpdateStore.init()`；确需重跑初始化时用 `vi.resetModules()` + 动态 import。
- **fake timers**：用了 `vi.useFakeTimers()` 的用例，`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` 要一起给；`waitFor` + fake timers 容易互相等待，优先用 `fireEvent`。setup 的 `afterEach` 会恢复真实定时器。
- **clipboard**：`userEvent.setup()` 会替换 `navigator.clipboard`。断言复制行为时用 `vi.spyOn(navigator.clipboard, 'writeText')` + `fireEvent.click`。
- **portal**：弹层挂在 `document.body`，用 `screen` 查询；`cleanup()` 会一并移除。jsdom 的 `getBoundingClientRect()` 返回全 0 但非 null，弹层仍能挂载；要断言坐标时单独 `vi.spyOn(el, 'getBoundingClientRect')`。
- **pointer hover**：`userEvent.hover/unhover` 会合成 pointerover，能触发 React 的 `onPointerEnter/Leave`；setup 在 jsdom 缺少 `PointerEvent` 时用 `MouseEvent` 顶替。
- **CSS 定位**：jsdom 不计算布局。纯 CSS 的“必须固定在同一侧”这类约束，用 `import css from '../../styles/ai.css?raw'` 读源文件做契约断言（renderer project 已开 `css: true`，见 `AiMessages.test.tsx` 的多选勾选框用例）；真正的视觉位置仍需在应用里目测。
- **act**：直接 `element.focus()`、`window.dispatchEvent`、手动 resolve Promise 时用 `act()` 或 `await waitFor()` 包裹。
- **CodeMirror**：`AiComposerEditor` / `AiComposer` 依赖真实布局、选区与输入法，仍由隔离 E2E 覆盖；不要为了单测去 mock 整个编辑器。

## 相关文件

- `vitest.config.ts` —— 两个 project 与 alias
- `src/renderer/src/test/` —— `setup` / `dom` / `launcher-stub` / `stores` / `fixtures` / `render`
- `src/renderer/src/test/harness.test.tsx` —— 基建自检
