# AI 消息模型 ↔ pi 输出类型对照（缺口与适配清单）

> **结论先行：不是。** demo「AI 助手」页的消息组件是**按交互意图手写的 mock 模型**，不是从 pi 的类型定义推导出来的。
> 差的不是几个组件，而是**数据模型本身**：demo 把一条助手消息建模成「固定槽位的扁平对象」，pi 建模成「可任意混排的内容块数组」。
>
> **审计依据**：`@earendil-works/pi-coding-agent@0.84.4` 嵌套依赖下的 `pi-ai@0.84.4`（`dist/types.d.ts`）与 `pi-agent-core@0.84.4`（`dist/types.d.ts`）。逐条人工核对过类型定义，未跑代码。
> **审计对象**：`docs/demo/` 的 AI 页（应用侧 AI 页属阶段 4、尚未开始——**现在是改数据模型代价最低的时刻**）。
> **时点**：2026-09-22。

## 1. 最根本的差异：固定槽位 vs 内容块数组

**pi 侧**（`pi-ai/dist/types.d.ts`）：

```ts
interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCall)[];   // ← 三类块任意混排
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  deferred?: DeferredHandle;
  // api / provider / model / responseModel? / responseId? / diagnostics? / endTurn? / timestamp
}
```

一条助手消息里，文本与工具调用可以**交替多次**（先说一句 → 调工具 → 再补说明 → 再调工具）。流式协议也是**按块**走的，每个块各有独立的三段式，且每帧带 `contentIndex` 与整份 `partial`（`AssistantMessageEvent`）：

```
start
text_start / text_delta{delta} / text_end{content}          ← contentIndex
thinking_start / thinking_delta / thinking_end
toolcall_start / toolcall_delta / toolcall_end{toolCall}
done{reason, message} | error{reason, error}
```

**demo 侧**（`docs/demo/js/ai.js` `aiBotInnerHtml`）：

```js
bot 消息 = { thinking?, steps?, text?, cards?, suggest?, streaming? }
```

渲染顺序在函数里**写死**：`ai-bot-name` → `ai-thinking` → `ai-steps` → `ai-txt` → `cards` → `suggest`。它表达不了「工具中途插一段文字」，没有块边界概念，流式是整块 `innerHTML` 重写（`aiPatchBotMsg`）。

**这一条决定了后面所有缺口的性质**：不是「少画了几个组件」，而是「模型承载不了 pi 的输出形态」。

## 2. 缺口清单

### 2.1 完全缺失（pi 会吐，demo 无任何对应物）

| pi 类型 / 字段 | 语义 | 影响 |
|---|---|---|
| `ThinkingContent`（`thinking` / `thinkingSignature?` / **`redacted?`**） | 推理正文。`redacted=true` 时载荷被安全过滤器加密进 `thinkingSignature`，须**原样回传**以维持多轮连续性 | demo 只有一个三点转圈的「思考中」指示器，**不渲染推理内容**，也没有 redacted 形态的透传位 |
| `ImageContent`（`data` / `mimeType`） | 图片块。**用户输入（`UserMessage.content`）与工具结果（`ToolResultMessage.content`）都能带** | 完全无对应物；截图类工具结果无处显示 |
| `Usage`（`input/output/cacheRead/cacheWrite/cacheWrite1h?/reasoning?/totalTokens` + **`cost{input,output,cacheRead,cacheWrite,total}`**） | 用量与**费用**（含缓存读写、推理 token 细分） | 无展示位 |
| `StopReason` 7 态：`pending｜stop｜length｜toolUse｜error｜aborted｜deferred` | 终止原因 | demo 只有「运行中 / 已完成」两态；**`length`（截断）、`error`、`aborted`、`deferred` 都没有 UI** |
| `DeferredHandle`（`provider/modelId/api/id/expiresAt?/pollAfterMs?/data?`） | `deferred` 时挂起的异步批任务句柄（含过期时间与轮询间隔） | 无对应物 |
| `errorMessage?` / `diagnostics?`（`AssistantMessageDiagnostic[]`） | 消息级错误与诊断 | 对话级错误提示缺失 |
| `tool_execution_update{partialResult}`（`AgentEvent`） | 工具**执行中**的增量输出 | demo 只有执行完的整段结果（`it.out`） |
| `thinkingLevel`（`off｜minimal｜low｜medium｜high｜xhigh｜max`） | 推理档位（`AgentState.thinkingLevel`） | 无档位控制 |
| markdown 渲染 | pi **自己不渲染**，但其 TUI 语义色 `mdHeading/mdLink/mdCode/mdCodeBlock/mdQuote/mdListBullet` 说明正文普遍带 md | demo 正文是 `aiEsc` + `white-space:pre-wrap` 裸文本（全仓 0 处 marked/hljs）；**代码块、列表、表格、行内代码全部退化成原文** |

### 2.2 已覆盖但形态不同（要对齐字段与机制）

| pi | demo 现状 | 要对齐的点 |
|---|---|---|
| `ToolCall`（`id` / `name` / `arguments: Record<string,any>` / `thoughtSignature?` / `namespace?`） | `.ai-step` 的 `{ tool, args, status, ms, out }` | pi 用 **`id`** 配对调用与结果；demo 靠数组下标。`arguments` 是结构化对象，demo 的 `args` 是展示串 |
| `ToolResultMessage`（`content: (Text\|Image)[]` / `details?` / `usage?` / **`isError`** / `addedToolNames?`） | `out: [[级别, 文本], ...]` + `status:'warn'` | 结果也是**块数组且可含图片**；错误是 **`isError` 布尔**，不是 `warn` 级别字符串。`addedToolNames`（延迟加载工具在上线点）无对应 |
| `AgentTool.label`（`pi-agent-core:341`，注释即「Human-readable label for UI display」） | 直接用工具 id（`generate_plist`）当显示名 | pi 本来就给了人类可读名，demo 在造轮子 |
| `AgentEvent`（`agent_start/end`、`turn_start/end`、`message_start/update/end`、`tool_execution_start/update/end`） | `steps` 折叠块 ≈ `tool_execution_*` 的汇总视图 | `turn_start/end`（轮次边界）与 `partialResult` 无对应 |
| `AgentState`（`isStreaming` / `streamingMessage?` / `pendingToolCalls: ReadonlySet<string>` / `errorMessage?` / `thinkingLevel`） | demo 自建 `chatState` | pi 已经有一份可直接驱动 UI 的状态，接上比自建更省 |
| `Agent.steer` / `Agent.followUp` + `QueueMode` | 运行中按发送 = 停止生成 | **运行中插话**（不打断当前轮）与结束后追问队列都没有 |

### 2.3 pi 也没有的（不必补，别当缺口）

citation / 来源、非图片附件、plan / todo 列表、markdown 类型本身——`pi-ai` 的公开类型里**都没有**。正文的 markdown 渲染、引用展示这些完全归宿主（应用）自己决定。

## 3. 两处概念纠正

**① 审批不是「引擎吐出的内容」，是宿主拦下来的钩子。**
demo 的 `approve` 卡做成了 `cards[]` 里的一种 `kind`，这是概念错位。pi 侧的真实机制是 `beforeToolCall` 钩子（`pi-agent-core`）：

```ts
beforeToolCall?: (context, signal?) => Promise<BeforeToolCallResult | undefined>
interface BeforeToolCallResult { block?: boolean; reason?: string; terminate?: boolean }
```

即「宿主拦下某个 toolCall → 返回 `{block, reason}` → 自己渲染授权 UI」。对应到我们的实现：授权 UI 应由**工具调用管线**触发，而不是由消息内容里的一种卡片类型触发。`AgentEvent` 里**没有**审批事件——不要把 demo 的 `approve` 卡直接平移过去。

**② 领域卡片是合法的，但要挂在正确的层。**
`pi-agent-core` 的 `CustomAgentMessages` 是**明确留给宿主的空接口**：

```ts
export interface CustomAgentMessages {}                               // 宿主自行扩展
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

所以 demo 的 `report` / `cron` / `plist` 三张领域卡**不算偏离 pi**，它们正是该走这条扩展口。需要补的是**下面那层通用内容块**（text / thinking / image / toolCall / toolResult）——领域卡片应作为自定义消息类型挂在通用层之上，而不是取代它。

## 4. 附带发现：`pi-web-ui` 版本疑点

`docs/design/ai-capability.md` 里有「pi-web-ui 作现成聊天 UI 复用」的定位，但实测：

- npm 上 `@earendil-works/pi-web-ui` 停在 **0.75.3**，而核心三包是 **0.84.4**（差一整条版本线）
- 本地未安装，也不在 `pi-coding-agent` 的依赖里

**建议复核这条定位**：要么确认 0.75.3 与 0.84.4 的类型面兼容、要么放弃复用（应用侧本来就有 `LlmClient` 防腐层，自绘 UI 与自定模型是对齐 pi 类型面更稳的路径）。

## 5. 建议落地顺序

按「改模型代价」从低到高，也按「阻塞后续」从强到弱：

| 档 | 做什么 | 为什么先做 |
|---|---|---|
| **A. 定模型** | 把 demo（以及阶段 4 的应用侧）的消息模型从固定槽位改成**内容块数组**，先只承载已有的 text / toolCall / toolResult 三类，跑通块级流式（`contentIndex` + `partial`） | 这是所有其他缺口的地基；地基不定，后面每加一个类型都要再动一次模型 |
| **B. 补通用块** | `ThinkingContent`（含 redacted 透传）、`ImageContent`、`Usage`/cost、`StopReason` 7 态、`errorMessage`、markdown 渲染 | 都是「pi 一定会吐、现在必定丢信息」的项；markdown 单独一档是因为它影响正文的整个渲染路径 |
| **C. 对齐机制** | 审批改走 `beforeToolCall` 钩子；工具显示名改用 `AgentTool.label`；接 `AgentState` 而不是自建状态；工具结果改 `isError` + 块数组 | 改的是接线方式，不是 UI 形态，可独立于 B 做 |
| **D. 锦上添花** | `thinkingLevel` 档位、`deferred` 句柄 UI、`tool_execution_update` 增量输出、`steer`/`followUp` 运行中插话 | 依赖 pi 侧能力已接；不做不阻塞主流程 |

⚠ 注意 demo 是**冻结基线**（AI 页是唯一例外）。A 档会改动 `data.js` 的 `aiScenes` 结构 + `ai.js` 的整条渲染链，动静不小——建议先确认是否要在 demo 上做（原型验证），还是直接等阶段 4 在应用侧按新模型实现、demo 保持现状作为历史对照。**这条需要你定。**
