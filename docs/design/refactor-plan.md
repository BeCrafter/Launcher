# BeCrafter Launcher 重构方案：基于 LaunchManager 的 TS+Electron 重写

> 状态：已批准（2026-09-04）｜范围：全量功能迁移 + 编辑体验重构 + AI 能力 + 双形态
> 关联：`docs/design/ai-capability.md`（AI 方案，本方案的阶段 4 按此落地）、`docs/design/refactor-gap-analysis.md`（覆盖度复核：10 项缺失、13 项开源残缺点、9 项不确定项及决策，2026-09-04）、`docs/demo/`（设计基准，非终态持续演进）

**覆盖度复核结论（2026-09-04）**：与开源逐项比对后确认——主体已覆盖，追加以下修订（详见 refactor-gap-analysis.md）：

- **阶段 1 追加**：目录监听自动刷新（fs.watch 替代 FSEvents，0.4s 防抖 + 回前台刷新；**监听/去抖/广播/前端重载链路已在 2026-09-10 设置后端完善中落地**，数据源接入仍属本阶段）；launchctl override 检测（gui+system 两域 print-disabled 合并，橙点 + 启用按钮）；侧边栏 agents/cron/services 计数 badge；新建流程（scope 选择 + 剪贴板 `<plist` 预填 + label 格式校验 + 同 scope 重名守卫）；删除单命令合并提权（bootout+rm 一次授权，修二次密码框）；删除用户域半状态防护（bootout 失败中止删除）；日志机制细节（512KB 尾截断 / 2000 行上限 terminate / 15m 窗口 / 关键字过滤）；brew 未注册服务「注册并启动」（brew services start）；跨 Store 事件总线（brew 变更 → agents 刷新）；无效 plist 的 XML 修复编辑（U6 已拍板）
- **阶段 2 追加**：cron 下次执行时间预测（U5 已拍板，纯函数 + vitest）
- **阶段 3 追加**：本地服务启停/重启（SIGTERM→SIGKILL 复用终止管线，docker 容器 start/stop，U2 已拍板）
- **阶段 1 新建弹窗内置最小模板库**（每 scope 3-5 个常用模板，U1 已拍板）
- **测试基线**：以开源约 80 个用例为索引（LaunchManagerTests.swift），vitest 逐条对齐落点
- 已会修复的开源残缺点：无命令超时（执行层统一超时 3/5/10s 可配；**ShellRunner 地基已在 2026-09-10 设置后端完善中落地**——`main/services/shell-runner.ts` 超时 SIGTERM→宽限 SIGKILL、值经 getter 注入、配单测；首个调用方 LaunchctlService 属阶段 1）、nsAppleScript 主线程阻塞（osascript 子进程异步）、表单 12 键限制、无 XML 高亮等
- 未排入（YAGNI 确认）：批量 load/unload（U7）；HTTP health probe/workspace 分组（U3/U4，后置）；服务模块 v2 其余 backlog；E2E Playwright 阶段 4 后评估（U8）

## Context

BeCrafter/Launcher 是基于开源项目 [Sean10000/LaunchManager](https://github.com/Sean10000/LaunchManager)（SwiftUI, MIT, v1.7.1, ~7.7k 行）的重构实现。动机：**解决编辑体验问题**（开源版表单只覆盖 12 键子集、XML 无高亮、多触发配置困难）+ **新增 AI 能力**。技术栈 TS + Electron，支持桌面 + 菜单栏双形态。

当前仓库状态：`docs/demo/` 高保真原型（含模块注册表 config.js、UI 原语 components.js、自检 check.mjs）+ `docs/design/ai-capability.md`（已批准的 AI 方案）。demo 非终态，后续会继续演进，实现时以 demo 当前版为视觉/交互基准。

**已确认决策**：① 提权沿用 osascript（非沙盒）② 单应用双形态（Dock+Tray，「菜单栏常驻」开关）③ 分阶段逐项迁移验证 ④ 暂不管分发/签名 ⑤ 渲染层 React 19 ⑥ 阶段 1 就上 CodeMirror 6（XML 高亮/行号，编辑体验卖点）。

**提权模态（demo ↔ 真机映射，2026-09 确认，勿遗忘）**：真实实现走 **macOS 系统原生授权框**——`osascript -e 'do shell script "<cmd>" with administrator privileges'`，由 SecurityAgent 弹密码框，**应用进程永不接触密码**（不进内存/日志/shell 历史，对齐开源 PrivilegeService）。demo 的 `elevationModal`（elevation.js）只是系统密码框的**前端模拟**（标题/命令展示/取消-128/缓存窗口语义一一对应）；落地时**去掉密码输入框**（系统框接管密码），应用层保留「执行前说明 + 待执行命令透明展示 + 危险确认」，osascript 返回 -128 → 主进程捕获 → 与 demo 一致反馈「已取消授权」；凭证缓存窗口（authCacheMin）为应用层逻辑，照常保留。阶段 1 手测以「AppleScript 密码框」为准（见「验证」节）。

## 双源对比结论（迁移矩阵）

### 收敛项：两边都有，直接迁（开源逻辑 + demo 交互）

| 功能 | 开源实现（LaunchManager） | demo 设计 | 迁移结论 |
|---|---|---|---|
| 3 范围扫描/分组/过滤/搜索 | AgentListView + AgentStore（launchctl list + print-disabled） | MODULES 注册表 + groupBlock 分组 + 5 过滤 chip | demo 交互为准，数据逻辑直迁 |
| launchctl 启停/启用 | LaunchctlService（现代 API：bootstrap/bootout/kickstart/enable） | drawer ops bar 4 态（loaded/enabled/running）+ 动词 toast/日志 | 开源逻辑 + demo UI |
| 无效 plist 内联展示/删除 | InvalidPlistRowView + PrivilegeService | invalid-plist 横幅 | 迁移（补删除确认） |
| Homebrew 服务合并 | BrewManagedSupport + 未注册区 + brew tag | brew filter chip + brew start/stop 按钮 | 开源全面实现 + demo 位置 |
| 日志查看 | LogViewerSheet（文件 tail 512KB cap / log show 2000 行止） | drawer 日志 tab（级别过滤/清空/导出） | demo 抽屉位置 + 开源实现 |
| Crontab 用户/系统 | CrontabService（crontab - / /etc/crontab 提权、注释保真 round-trip） | 行内编辑 + 预设 + 全局可读化 | **demo 行内编辑为准** + 开源保真策略 + 补「文件头部」面板（开源有、demo 无） |
| 端口服务发现 | ProcessDiscoveryService（lsof TCP LISTEN 3s 轮询） | services 视图 | 直迁开源 |
| 服务分类管线 | 8 个 Resolver + Docker 集成 + DevServiceFilter | 简化 type tags | 直迁开源（docker/colima/lima/project） |
| kill / 停容器 | ServiceTerminationService（SIGTERM→5s→SIGKILL）+ 确认框 | killSvc | 开源流程，确认框按 demo 样式 |
| 从服务生成 LA 草稿 | LaunchAgentDraft.from(service) | rocket 按钮 | 直迁 |
| 导入 plist / 粘贴 XML | ImportPlistSheet | importModal | 直迁 |
| 克隆 agent | CloneAgentSheet（.copy 后缀、重名守卫） | drawer footer Delete/Clone 按钮（**dpAction 未定义，死代码**） | 实现并修复 demo 缺陷 |
| 登录项指南 | LoginItemsGuideView | view-login | 直迁 |
| 服务自定义重命名 | ServiceNameStore（UserDefaults） | — | 迁移 |
| Unicode 路径规范 | FilePathNormalizer（octal-escape 解码、mojibake 修复） | — | 迁移（必需） |
| launchctl 错误友好化 | LaunchctlErrorFormatter | — | 迁移 |

### 增量项：demo-only，新建（重构核心价值）

1. **抽屉式编辑体验**（开源是 sheet + 分离日志查看器；demo 是右侧抽屉 4 tab 编辑/状态/日志/XML + 4 态操作栏）→ 以 demo 为准
2. **丰富表单字段**：SCI 多规则构建器（预设 chips + 每条规则人读 + plist 片段预览）、KeepAlive bool/dict 精细模式、ProcessType/Nice/ThrottleInterval/Disabled/UserName/Stdin/Debug、env/args/watch 多值行
3. **状态 tab**：pid/uptime/CPU/内存/exitCode/重启次数/启动时间/路径
4. **AI 助手 + MCP + 专家提示词** → 按 docs/design/ai-capability.md（pi-ai 引擎、ToolRegistry 单一来源、MCP stdio 只读默认、4 技能）
5. **桌面 + 菜单栏双形态**：Tray + badge（异常数）、「菜单栏常驻」开关、关窗不退出
6. **应用内深浅主题**（system/light/dark）+ **应用内语言切换**（zh/en，键一致性自检）
7. **设置页 9 pane**（常规/launchd 引擎/端口扫描/Plist 编辑器/权限安全/快捷键/备份/关于/登录项）——开源 ModuleSettings（模块开关）并入
8. **底部模块状态栏**：每模块展示驱动命令（`~/Library/LaunchAgents` / `crontab -l` / `lsof ...`）+ 监控指示

### 需解决的问题点（迁移中必须处理）

1. **表单↔XML 双向同步**：demo 只是文案声称，**以开源 EditAgentSheet 的真实现为准**（XML→form 反向解析失败时禁用表单并引导 XML 模式；form 保存拒绝不兼容 plist——formIncompatibilityReason 策略）
2. **Start/Stop 反馈**：开源 PendingOperation 状态机（pending 映射、行锁定、脉冲点、重复点击吞掉、stop 轮询 PID 消失后 SIGKILL）——demo 是模拟，必须迁状态机
3. **demo 死代码**：SCI 聚合预览 `#ef_sciPlistPreview` 元素缺失（设计意图明确，补上）；`dpAction` 未定义；`scanAiAgents`/`runWithAgent`/日志轮询为模拟 → 全部真实实现
4. **React 重写 components.js 原语**：agentCard/groupBlock/rowCard/statusDot/tagChip/actBtn/emptyState → React 组件，类名与 CSS 沿用 demo（视觉零变化）
5. **单实例 + 双形态状态共享**：Tray 与窗口共享主进程 store；开启「菜单栏常驻」时关窗仅隐藏
6. **沙盒必须关闭**（spawn launchctl/lsof/osascript 需要），entitlements 对齐开源非沙盒决策

## 架构

```
Launcher/（electron-vite + TS + React 19）
├── src/
│   ├── main/
│   │   ├── index.ts            # 窗口 + Tray 单实例双形态（菜单栏常驻开关）
│   │   ├── domains/            # 纯函数领域层（launchd/plist/brew/cron/process）——AI 工具与 MCP 共用
│   │   ├── services/           # 执行层：ShellRunner/osascript 提权/LaunchctlService/*Resolver/Docker
│   │   ├── stores/             # AgentStore/CronStore/ServiceStore（主进程唯一真相 + 状态机，对齐开源 Store 模式）
│   │   ├── ai/                 # registry/llm/agent/skills/prompts（ai-capability.md 落地）
│   │   ├── mcp/                # server.ts + stdio 传输（launcher-mcp 独立入口）
│   │   └── settings/           # 设置持久化（electron-store 或 JSON，暂替代 UserDefaults/localStorage）
│   ├── preload/                # contextBridge 白名单 IPC API
│   └── renderer/               # React 19
│       ├── components/         # 由 components.js 迁移：AgentCard/GroupBlock/RowCard/StatusDot/TagChip/ActBtn
│       ├── modules/            # Agents（抽屉 4 tab + CodeMirror）/ Cron / Services / Ai / Settings
│       ├── state/              # zustand：主进程快照投影 + IPC 事件订阅
│       └── styles/             # 沿用 docs/demo/css/*（拆分为模块）
├── docs/demo/                  # 设计原型（持续演进，视觉/交互基准）
├── docs/design/                # ai-capability.md + refactor-plan.md（本方案）
└── package.json
```

要点：
- **主进程 = 唯一事实来源**（对齐开源 Store 模式与 ai-capability.md 架构），renderer 通过 preload 白名单 IPC 读取 + 订阅变更
- **单测覆盖解析器**（launchctl list 解析、plist round-trip、crontab parser、lsof 解析——对齐开源 TDD 用例）
- **CodeMirror 6**：XML tab 编辑（高亮/行号/格式化），与表单双向同步
- 分发/签名暂不做；打包基建（electron-builder）留空，阶段 5 只预留

## 分阶段计划（每阶段交付可运行版本，逐项比对验收）

### 阶段 0 — 脚手架
electron-vite（React+TS）+ vitest + 目录骨架 + 单实例锁 + 空壳 Tray/窗口切换。验收：dev 起来有空窗口 + 菜单栏图标。

### 阶段 1 — Agents 模块端到端（最大阶段）
domains（launchctl list/print/print-disabled、plist CRUD/validate/解析）→ 扫描/分组/过滤/搜索/状态栏 → 抽屉编辑器：
- 编辑 tab：全字段表单（标识/执行/调度/Stdio 四区）+ SCI 构建器 + KeepAlive dict + CodeMirror XML 双向同步 + 不兼容拒绝策略（formManagedKeys 扩至 20+）
- ops bar：bootstrap/bootout/kickstart/enable + PendingOperation 状态机 + **override 橙点与启用按钮**（launchctl override 与 plist Disabled 双机制区分）
- 状态 tab / 日志 tab（文件 tail 512KB 截断 + log show 15m 窗口 2000 行上限 terminate + 关键字过滤，对齐开源机制）
- 新建（scope 选择 + 剪贴板 `<plist` 预填 + **内置最小模板库** + label 格式校验/同 scope 重名守卫）、导入、克隆、删除（**bootout+rm 单命令合并提权** + 用户域 bootout 失败防半状态）
- invalid plist 内联展示/删除/**XML 修复编辑**、brew 合并（含未注册服务「注册并启动」）
- **目录监听自动刷新**（fs.watch 0.4s 防抖 + 回前台刷新）+ 跨 Store 事件总线 + 侧边栏 badge
验收：与开源逐功能比对清单（含 512KB 日志截断、重复点击、错误格式化、提权路径、无效 plist、override），视觉对照 demo。

### 阶段 2 — Cron 模块
CrontabParser round-trip（注释/env 保真、引号感知切分）→ 行内编辑 + 预设 + 人读翻译 + **下次执行时间预测** + 文件头面板 + /etc/crontab 提权 + 侧边栏 badge。验收：文件往返一致（vitest + 手工），对齐开源 10 个 cron 用例。

### 阶段 3 — 端口服务
lsof 发现（Unicode 规范化）→ 8 Resolver 分类管线 + Docker → kill 确认/终止 + **本地服务启停/重启**（SIGTERM→SIGKILL 复用终止管线；docker 容器 start/stop）→ 重命名 → 生成 LA 草稿 → dev filter + 侧边栏 badge。验收：docker/colima 场景手工验证，对齐开源服务分类 30+ 用例。

### 阶段 4 — AI + MCP（按 docs/design/ai-capability.md 步骤 1-7）
domains 复用 → ToolRegistry（只读 9 工具）→ MCP stdio 挂载实测 → pi-ai LlmClient + 专家提示词 → pi-agent-core + skill-plist 校验闭环/skill-diag → 聊天 UI → 写操作确认与安全。验收：plutil 闭环、3 故障案例、Claude Code 挂载、范围约束。

### 阶段 5 — 双形态/设置/主题/收尾
菜单栏双形态（Tray badge、常驻开关、关窗隐藏）→ 9 设置 pane 落地 → 主题/语言切换 → 登录项指南/onboarding/更新检查（低优）→ 模块开关并入设置 → 打包配置预留。**注（2026-09-10）**：Tray badge（setTitle 计数）、真实版本号（app:info）、检查更新（GitHub Releases 四态）、打开系统设置跳转已在设置后端完善中提前接线；本阶段保留其扩展项（角标异常数、i18n 化 Tray 菜单等）。

## 交付物

1. 本方案（docs/design/refactor-plan.md）
2. 更新 CLAUDE.md：仓库现状段改为「TS+Electron 重构推进中，demo 为设计基准」、目录结构、运行方式（`npm run dev` / vitest / 自检）、迁移状态与阶段进度、指向本方案与 ai-capability.md

## 验证

- **每阶段验收清单**：与开源版同场景对照（同一台 mac 上跑两个 app 比对）+ demo 视觉对比截图
- **单测**（vitest）：解析器优先（launchctl list/print、plist 生成-解析 round-trip、crontab、lsof、classifier）——对齐开源 tests 覆盖
- **阶段 1 重点手测**：编辑体验全流程（新建 → 表单/XML 双向 → 保存重载 → 状态/日志 → 停止/启动反馈）；系统级提权路径（AppleScript 密码框）
- **阶段 4 复用**：ai-capability.md 验证清单（plutil 闭环 / 3 故障案例 / MCP 挂载 / 范围约束）

## 关键风险

- React 重写 UI 原语量大（视觉基准对照靠 demo CSS）
- CodeMirror 与表单同步的状态复杂度（XML 为权威源时表单降级策略）
- osascript 提权在 Electron 下的进程管理（密码框焦点、错误 -128 用户取消）
- 服务分类管线在无 docker/colima 环境下需静默降级（开源已处理，直迁）
