# 重构方案覆盖度复核报告：开源 LaunchManager vs BeCrafter Launcher

> 复核日期：2026-09-04｜复核范围：README/CHANGELOG/全部 Swift 源码/设计文档/tests 逐项比对 refactor-plan.md 与 ai-capability.md
> 结论先行：**主体功能已覆盖（22 项收敛），发现 10 项缺失或弱覆盖、13 项开源残缺点（新项目应修复）、9 项不确定待拍板**。修复后新项目可达到「对等并优于」。

## 一、缺失 / 弱覆盖（必须补进方案）

| # | 缺失项 | 开源实现（证据） | 原因 | 解决方案 | 落地阶段 |
|---|---|---|---|---|---|
| 1 | **目录监听自动刷新**（FSEvents 机制） | DirectoryWatcher.swift：监听 3 个 plist 目录，事件延迟 0.3s + 防抖 0.4s，主队列回调；模块开关联动停止；scenePhase 回前台刷新 | 方案只在设置 pane 提了开关（demo 视角），核心机制未入阶段 1 | Electron 用 `fs.watch`（递归）替代 FSEvents + 防抖 400ms + 前台恢复（`browser-window-focus`）触发刷新；设置可关 | 1 |
| 2 | **launchctl override 状态**（print-disabled） | LaunchctlService.disabledLabels（gui+system 两域）+ AgentRowView 橙点 + tooltip「已被系统禁用（launchctl override）」+「启用」按钮（`launchctl enable`） | 与 plist `Disabled` key 是**两个不同机制**；方案只提了 enable，漏了 override 检测与展示 | refresh 时合并两域 disabledLabels → `isDisabledByOverride`；卡片橙点 + 悬浮提示 + 启用按钮 | 1 |
| 3 | **侧边栏模块计数 badge** | SidebarView：agents badge = items+invalid，crontab badge = jobs 数 | demo 侧边栏无 badge（modals.js 里甚至有指向不存在元素的死选择器） | 侧边栏 nav 项加计数 badge（agents/cron/services），状态栏已有的计数保留 | 1/2/3 |
| 4 | **粘贴 XML 智能预填新建** | ContentView newAgentInitialXml：New 时读剪贴板，含 `<plist` 则预填 XML；模板 XML 兜底 | 方案矩阵没列新建机制细节 | 新建弹窗：剪贴板检测（含 `<plist`）→ 预填 XML/表单；否则空白模板 | 1 |
| 5 | **新建流程未被显式列项** | 工具栏 New = 按 scope 分组的菜单（user/global/daemon） | 方案只写了导入/克隆/删除 | 阶段 1 明确「新建（scope 选择 + 剪贴板预填 + 标签默认前缀 com.user. 可配）」 | 1 |
| 6 | **删除合并单次提权** | PlistService.delete：特权域 `bootout <domain> <plist>; rm <plist>` **单次 osascript**（v1.5 修的「两次密码框」bug） | 方案提权路径只泛泛提到，未固化此防呆细节 | 删除实现必须单命令合并（bootout+rm 一次授权）；用户域也先 bootout 再删 | 1 |
| 7 | **日志查看器机制细节** | LogViewerSheet：文件 tab 512KB 尾截断 + 「仅显示末尾 KB」提示 + 清空按钮；系统 tab `log show --predicate 'subsystem == "label" OR process == "label"'`（15 分钟窗口、2000 行上限后 terminate、惰性加载+手动刷新、**关键字过滤**、错误态文案） | 方案只说「文件 tail + log show」，机制粒度不足 | 按开源完整实现：512KB 截断/行数上限/terminate/关键字过滤；demo 的「级别过滤」保留为额外增强 | 1 |
| 8 | **Brew 未注册服务「注册并启动」** | AgentListView unregisteredSection + HomebrewServiceRowView「注册并启动」= `brew services start <formula>`（由 brew 自建 homebrew.mxcl plist） | 方案只写「未注册区」，未写动作机制 | 未注册区 = brew services 存在但无 launchd label 的服务行，动作按钮「注册并启动」 | 1 |
| 9 | **跨 Store 变更通知** | BrewNotifications `.brewServicesDidChange`：brew 变更后 Agents 自动刷新 | 多模块联动机制，方案未提 | 事件总线：brew 操作完成 → agents store 刷新；写入 `domains`/`stores` 约定 | 1-3 |
| 10 | **测试覆盖对齐基线** | LaunchManagerTests 约 80 用例：launchctl list/disabled 解析(5)、plist 往返/兼容性/删除/克隆/XMl 校验(14)、pending 状态机(3)、命令解析(4)、路径规范化 Unicode(5)、lsof 解析(6)、服务分类全家桶(30+)、crontab 解析往返(10)、brew JSON(3)、模块设置(2)、LaunchAgentDraft(1) | 方案只说「对齐开源用例」，应落成清单 | vitest 用例清单以开源测试函数名为索引（见附录清单），阶段 1-3 逐条对齐 | 1-3 |

## 二、开源残缺点（新项目应修复）——原因与方案

| # | 残缺点 | 原因（开源设计/代码证据） | 修复方案（新项目优于） |
|---|---|---|---|
| 1 | **ShellRunner 无命令超时** | ShellRunner.swift：`waitUntilExit()` 无限等待；brew/log show 卡死会挂起 store 操作和 UI | 执行层统一超时（默认 10s，设置页可配 3/5/10s——复用 demo 设置 pane），超时 kill + 错误文案 |
| 2 | **表单只覆盖 12 键**，复杂 plist 必须切 XML | PlistService.formManagedKeys 仅 12 键；多触发器/KeepAlive dict/非表单键 → 整表单禁用 | demo 扩展表单已覆盖（见下优势 #4/#6/#7），formManagedKeys 扩至 20+；仍不支持的键（Sockets/MachServices 等）走 XML 模式保留原策略 |
| 3 | **无 XML 高亮/行号/格式化** | EditAgentSheet XML 为普通 TextEditor；2026-07-04 spec 明确 YAGNI | CodeMirror 6（决策已定），高亮 + 行号 + 格式化按钮 |
| 4 | **Label 无格式校验、表单保存无重名守卫** | EditAgentSheet 只校验非空；同 label 保存直接覆盖（克隆/导入有守卫，表单无） | label 格式校验（非空 + 建议 reverse-DNS 格式校验 warn）+ 保存前同 scope 重名冲突阻止并提示 |
| 5 | **watchPaths 表单只能编辑第一个路径** | EditAgentSheet watchPath 单行 | demo 多值行 addWatchTo 已解决 |
| 6 | **删除用户域 job 时错误被吞** | PlistService.delete 非特权分支：`try? launchctl.bootout` 后照删文件——bootout 失败会留下「job 还加载但 plist 已删」的半状态 | bootout 失败时中止删除并提示（或确认残留）；删除后校验 |
| 7 | **nsAppleScript 只能主线程执行** | PrivilegeService NSAppleScript 必须 MainActor → 提权操作期间 UI 阻塞 | Electron child_process osascript 天然异步（优势：优于开源） |
| 8 | **cron 可读化只覆盖 5 种模式**，无下次执行预测 | CronScheduleDescriber 仅 5 模式；无 next-run | 可选增强：完整 5 字段可读化 + next-run 计算（见不确定项） |
| 9 | **服务模块无 start/stop/restart**，只能 kill | Services v1 范围「discover+identify+kill」；v2 backlog 未做 | 不确定项 #2，建议纳入 |
| 10 | **无模板库**（外链网站） | 2026-07-04 spec：模板库 YAGNI，改外链 launchmanager.dev/templates | 不确定项 #1，建议内置模板（编辑体验卖点） |
| 11 | **更新检查自研、无自动安装** | GitHubReleaseService + DMG 跳转 | 分发暂不做；P5 对齐开源实现，electron-updater 留待分发阶段定 |
| 12 | **纯轮询/扫描驱动**（服务 3s、cron/brew 手动刷新） | 无端到端事件驱动 | 可接受（开源已用 FSEvents 事件 + 轮询混合）；不强制改 |
| 13 | **无法编辑无效 plist** | InvalidPlistRowView 只能查看 + 删除 | 不确定项 #6，建议修复（XML 模式编辑） |

## 三、新项目方案已有优势（优于开源）

1. **应用内主题切换**（system/light/dark + matchMedia）——开源仅跟随系统、无主题选项
2. **应用内语言切换**（zh/en + 键一致性自检）——开源跟随系统语言（v1.7.1 才修复 fallback bug）
3. **桌面 + 菜单栏双形态**（Tray + 异常 badge + 常驻开关）——开源明确非目标
4. **表单字段 12 → 20+**：ProcessType/Nice/ThrottleInterval/Disabled/UserName/Stdin/Debug/KeepAlive dict/多值 env-args-watchPaths
5. **抽屉式编辑**（状态/日志/编辑/XML 四 tab 一站完成）——开源是分离 sheet + 独立日志窗口
6. **SCI 图形化构建器**（5 字段多规则卡片 + 快速预设 + 每条人读 + plist 片段实时预览 + 聚合预览）——开源仅单触发三数字
7. **KeepAlive dict 精细模式**（Crashed/AfterInitialDemand/SuccessfulExit）——开源仅 Bool
8. **CodeMirror XML 编辑**（高亮/行号）
9. **AI + MCP + 专家提示词**（pi 引擎、ToolRegistry 单一来源、MCP stdio 只读默认、4 技能）——开源完全没有
10. **底部模块状态栏**（每模块驱动命令 + 监控指示 + 计数三态点）——开源无
11. **命令超时机制**（修源码残缺点 #1）
12. **osascript 异步化**（修源码残缺点 #7）
13. **设置页 9 pane**（常规/引擎/扫描/编辑器/安全/快捷键/备份/关于/登录项）——开源仅模块开关小弹窗
14. **删除前 double-confirm + 密码缓存时长可配**（demo 设置安全 pane）——开源无缓存控制
15. **导出配置备份**（demo 备份 pane）——开源无
16. **keybind 展示与实现**（⌥Space 切换窗口等）——开源仅菜单，无全局快捷键

## 四、不确定项（需拍板）

| # | 事项 | 建议 | 理由 |
|---|---|---|---|
| U1 | 内置 plist 模板库（vs 开源外链网站） | 建议做成最小内置模板（每 scope 3-5 个常用模板） | 编辑体验核心卖点；外链对终端用户不友好 |
| U2 | 本地服务 start/stop/restart（开源 v2 backlog） | 建议纳入阶段 3 | 只 kill 是体验窟窿；Electron 里进程管理不难 |
| U3 | HTTP health probe + 🟡 启动态 | 可后置（阶段 5 后备） | 价值中等，先不加 |
| U4 | workspace 分组 + 批量启停 | 可后置 | 与「对等」无关，属加分项 |
| U5 | cron next-run 预测 | 建议纳入阶段 2 | 开源「无预测」是已知短板，demo 人读翻译已确认价值 |
| U6 | 无效 plist 的 XML 编辑修复 | 建议纳入阶段 1 | 修开源残缺点 #13，成本低 |
| U7 | 批量 load/unload | 不值得（YAGNI 双源确认） | 低频场景 |
| U8 | E2E UI 测试（Playwright for Electron） | 建议 vitest 先行，E2E 阶段 4 后评估 | 阶段 1-3 以单测 + 手测对照为主 |
| U9 | demo 新建弹窗 vs 开源 scope 菜单（新建入口形态） | 以 demo 弹窗为准（含 scope 下拉） | demo 交互是设计基准 |

## 五、修订后的阶段要点（对 refactor-plan.md 的增量）

- **阶段 1 追加**：#1 目录监听、#2 override 检测与橙点、#3 agents sidebar badge、#4/#5 新建（scope+剪贴板预填+重名守卫+label 校验）、#6 删除单命令提权、#7 日志机制细节、#8 brew 注册并启动、#9 事件总线、残缺点 #6（删除半状态防护）、U6 无效 plist XML 编辑
- **阶段 2 追加**：#10 cron 测试清单、sidebar cron badge、U5（若拍板）
- **阶段 3 追加**：#10 服务测试清单、sidebar services badge、U2（若拍板）
- **测试基线**：以开源 80 用例为索引清单逐一在 vitest 落点（附各阶段）

附录（开源测试函数索引）见 /tmp/LaunchManager/LaunchManagerTests/LaunchManagerTests.swift（已核验 80+ 用例覆盖范围，逐条对齐）。
