# 笔记编辑器端到端用例

这组用例驱动**构建后的 Electron 应用**（`out/`），用 CDP 模拟真实鼠标 / 键盘，
覆盖笔记编辑器所有用户可见交互。它是编辑器行为的验收来源：改交互就必须补/改用例，
规则写在仓库根 `CLAUDE.md`。

## 运行

```bash
npm run test:e2e:notes        # 构建 + 跑全部
npm run test:e2e:notes:only   # 已有 out/ 时只跑用例
npm run test:e2e:notes:list   # 列出用例
node e2e/notes/run.mjs --filter drag   # 按 id / 分组 / 标题 / 标签过滤
node e2e/notes/run.mjs --keep          # 保留临时 profile 与截图
```

成功时临时目录会被删掉，报告写到 `e2e/notes/.tmp/last-report.json`；
失败时自动保留 `e2e/notes/.tmp/run-*/`（含失败截图、`report.json`、应用日志）。

## 隔离方式

- 启动参数固定带 `--remote-debugging-port=<随机空闲端口>` 和三个
  `--disable-*background*`（否则窗口被遮挡时 rAF 停摆，贴边自动滚动测不出来）。
- 环境变量 `LAUNCHER_E2E_USER_DATA=<临时目录>`：userData、设置文件、笔记目录一起隔离。
  绝不读写真实 `~/.config/launcher/config.json` 或用户笔记。
- 每个用例开始前整篇替换正文并清掉标签筛选 / 搜索 / 视图模式，用例之间无顺序依赖。
- 跑的是 `out/` 构建产物，不启动 dev server，不影响用户正在运行的实例。

## 目录

```
e2e/notes/
  run.mjs              运行器（--list / --filter / --keep）
  manifest.mjs         用例清单与分组（新增分组要在这里注册）
  cases/               按交互域分组的用例
    basics.mjs         打开 / 编辑 / 自动保存 / 撤销 / 视图模式
    markdown.mjs       标题、行内标记、wikilink、标签、媒体、表格、mermaid
    toolbar.mjs        选区浮条、底部工具栏（标题/列表/引用/表格）
    block-ui.mjs       手柄、块菜单、折叠、列表样式、表格菜单、插入到下方
    input.mjs          输入自动化:补全、围栏、列表续行、缩进、列选择
    drag.mjs           自由拖拽、滚轮重算、贴边自动滚动、右侧大纲、折叠恢复
    picker.mjs         「移动到…」选择器
    keyboard.mjs       Alt+↑/↓、Shift+Alt+↑/↓
    meta.mjs           列表搜索、笔记标签、关联笔记、滚动同步
  lib/
    app.mjs            启动/关闭隔离实例、写夹具笔记
    cdp.mjs            CDP 客户端（求值/等待/鼠标/键盘/截图）
    ctx.mjs            页面操作封装（行定位、拖拽、大纲、浮条、保存等待）
    fixtures.mjs       共用正文夹具
    assert.mjs         结构化断言
```

## 覆盖矩阵（改动时对照）

| 交互 | 用例前缀 | 关键断言 |
| --- | --- | --- |
| 打开 / 保存 / 撤销 / 视图模式 | `basics/` | 正文、落盘内容、撤销重做、编辑/预览显隐 |
| Markdown 渲染 | `markdown/` | H1–H10、行内标记、wikilink、标签、任务项勾选（编辑/预览）、图片 lightbox、表格、mermaid、图表全屏查看 |
| 选区浮条 | `toolbar/bubble-*` | 动作集合、套标记、清除格式、代码块/行内代码降级 |
| 底部工具栏 | `toolbar/` | H10、多行列表、引用、3×3 表格 |
| 块手柄 / 菜单 / 折叠 | `block-ui/` | 手柄、8 个行操作、复制/删除/分隔线/H10、折叠展开、列表样式、表格设置、末尾加列、「插入到下方」新块独立成块、块菜单图表/嵌入 |
| 输入自动化 | `input/` | wikilink / 标签补全、反引号围栏自动配对与选区升级、列表续行、宽松任务归一、Tab 缩进、列选择 |
| 自由拖拽 | `drag/` | 落点线、目标标签、跨块换序、表格/流程图整块移动、Escape、嵌套限制、滚轮重算、贴边自动滚动 |
| 拖拽大纲 | `drag/outline-*` | 大纲条目、悬停跳转+锁定、移出解锁、文首/文末 |
| 折叠恢复 | `drag/fold-preserved` | 移动后折叠仍存在 |
| 「移动到…」 | `picker/` | 列表、搜索、回车、Escape、焦点回正文、嵌套提示、撤销 |
| 键盘移动 | `keyboard/` | 兄弟移动、跨节语义、整节移动、边界消费按键、光标跟随、表格/撤销 |
| 笔记元信息 | `meta/` | 搜索过滤、标签增删、关联选择器、滚动同步 |

## 新增用例

在对应 `cases/*.mjs` 里追加对象：

```js
{
  id: 'drag/my-scenario',          // 唯一，前缀=分组
  area: 'drag',
  title: '一句话描述用户看到的行为',
  tags: ['drag'],
  fixture: BASIC,                  // 省略时用默认夹具
  async run(ctx) {
    // ctx 提供 setCursor / selectRange / dragBlock / dragToOutline /
    // press / pressLetter / waitSaved / openMovePicker 等
  }
}
```

断言用 `lib/assert.mjs` 的 `ok / eq / includes / excludes`，失败信息会带期望与实际。
涉及异步渲染用 `ctx.cdp.waitFor(...)` 或 `ctx.waitForNode(...)` 轮询，不要写固定长 sleep。
