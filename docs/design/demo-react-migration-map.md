# Demo ↔ React 迁移对照表

> 本文档是 demo 原型 → React 应用迁移的逐项比对记录。后续调整任一侧时,按此表逐项核对行为与视觉。
> **冻结基线**:demo 基线 commit `da1e34a`(logo 基线 `06ff9ba`);demo 目录自此不再改动。
> **比对方法**:`npm run dev` 与 `docs/demo/index.html` 并排,1200×800 与最小宽度、双主题、双语各走一遍。

## 状态图例

| 状态 | 含义 |
|---|---|
| ✅ 已完成 | 行为与视觉对齐 demo |
| 🔶 含差异 | 已实现,存在「已知差异清单」中的偏差 |
| ⏳ stub | 占位渲染,待后续阶段 |
| ❌ 不迁移 | 按决策不进应用 |

## 全局骨架

| 演示源 | React 落点 | 状态 | 备注 |
|---|---|---|---|
| `index.html` L19-62 侧边栏 | `layout/Sidebar.tsx` | 🔶 | AI 入口不迁移;Logo 用 v2 双主题组件(等效 logo-dark/light img 对);nav 图标 crontab 为 fa-regular(硬编码保留) |
| `index.html` L65-84 顶栏 | `layout/Topbar.tsx` | 🔶 | agents 导入/新建已接线;crontab 刷新仅 toast(demo 同);services 双钮 toast(demo 同) |
| `index.html` L1493 statusbar | `components/StatusBar.tsx` + `layout/AppShell.tsx` | ✅ | summary/items 含 `<strong>` 经字典 HTML 渲染(demo innerHTML 等价) |
| `index.html` L1499 toast | `components/ui/Toast.tsx` + `state/ui-store.ts` | ✅ | 单条 2600ms;明暗色值映射表逐字 |
| `js/modules.js` switchModule | `state/ui-store.ts` switchModule + `layout/ViewHost.tsx` | 🔶 | React 条件渲染替代 display 切换;设置页强制折叠侧边栏已移植 |
| `js/modules.js` syncSidebarLayout/toggleSidebarCollapse | `hooks/useSidebarLayout.ts` | 🔶 | 机制逐字节保留(CSS 变量 + 状态栏内联几何 + 三重同步);折叠 toast 保留 demo 硬编码中文;移动端分支照移但窗口 minWidth 700 > 680 断点,不可达 |

## 模块注册表(`js/config.js` MODULES → `lib/modules.ts`)

| 记录 | 状态 | 备注 |
|---|---|---|
| agents | ✅ | viewId/icon/breadcrumb/searchPlaceholderKey 对齐;statusbar → `lib/statusbars.ts` |
| crontab | ✅ | 同上 |
| services | ✅ | searchHandler 在 demo 亦仅 toast,如实移植 |
| settings | ✅ | 状态栏含版本/主题/语言/架构/GitHub |
| ai / login / plist / design | ❌ | AI 未迁移;login 为设置页 login pane;plist/design 静态说明页 |

## 视图 1:Launch Agents(`js/agents.js` → `modules/agents/AgentsView.tsx`)

| 项 | 演示行为 | React 落点 | 状态 |
|---|---|---|---|
| 过滤 chips | all/brew/user/system/daemon;brew=!!isBrew;user=scope&&​!isBrew | AgentsView useMemo | ✅ |
| 搜索 | label/tags/desc includes(小写;tags 分支未小写为 demo 原样) | 同上 | ✅ |
| 分组 | user(蓝 fa-user)/system(黄 fa-building)/daemon(红 fa-server) | GROUP_META | ✅ |
| invalid 横幅 | filter∈{all,user} 时展示;删除仅 toast | AgentsView | ✅ |
| 卡片 | agent-col-card 槽位(状态点/标签 slice(0,3)/brew 徽章/PID/uptime/exitCode 着色) | `components/cards/AgentCard.tsx` | ✅ |
| toggle | running→bootout(蓝)/else bootstrap(绿),toast 文案一致 | agents-store.toggle | ✅ |
| brew 操作 | 仅 toast,不改状态 | 同上 | ✅ |
| 编辑笔钮 | demo openEditFloat | → 抽屉(见抽屉节) | ✅ |
| nginx 双 brew 标签 | demo 数据原样(tags 含 brew + brewBadge) | — | ✅(忠实) |

## 视图 2:定时任务(`js/crontab.js` → `modules/cron/`)

| 项 | 演示行为 | React 落点 | 状态 |
|---|---|---|---|
| 分组渲染 | `#cronGrid` > groupBlock(user 蓝/system 红);`.cron-cell` 嵌套 | `CronView.tsx` | ✅(hover 契约保留) |
| hover 详情 | 纯 CSS(`#cronGrid .cron-cell:hover .row-expand`);日志路径/复制/查看(log 开关联动禁用) | `CronCard.tsx` | ✅ |
| 内联编辑 | 互斥(activeCronEdit);预设 chips;表达式实时人话;5 字段+cmd+desc+日志开关;保存滚动定位 | CronCard | ✅ |
| parseCronExpr | 双语分支(demo 对 `0 * * * *` 渲染「每天 每小时 执行」、月份通配输出 `* 1日 0:00 执行` 等) | `lib/cron.ts` + 测试 | ✅(含 demo 原样怪癖) |
| toggle 启停 | 即时刷新 + toast | cron-store.setEnabled | ✅ |
| 删除 | system → 危险确认 + 提权;toast cronDeleted | CronCard.onDelete | ✅ |
| Cron 日志抽屉 | cronLogPath + 近 3 天 11 行模拟 | `CronLogDrawer.tsx` + `data/mock/mock-source.readLog` | ✅ |
| 新建 Cron | 预设/实时预览/5 字段/scope/log;system → 提权;unshift 顶部 | `NewCronModal.tsx` | ✅ |

## 视图 3:端口服务(`js/services.js` → `modules/services/ServicesView.tsx`)

| 项 | 演示行为 | React 落点 | 状态 |
|---|---|---|---|
| 分类管线 | ① Brew Resolver(brewServices 清单)② COMMAND 映射(node)③ 兜底 process | `lib/classify.ts` + 测试 | ✅ |
| 分组顺序 | node → brew → process | SVC_GROUP_ORDER | ✅ |
| 卡片 | svc-col-card(PID/addr:port/proto/uptime chips) | `components/cards/SvcCard.tsx` | ✅ |
| kill | 危险确认 → 仅 toast(不删数据,demo 原样) | ServicesView.onKill | ✅ |
| 搜索 | demo searchHandler 仅 toast(无真实过滤) | 同 demo | ✅(忠实) |

## Agent 抽屉(`js/drawer.js` → `modules/drawer/`)

| 项 | 演示行为 | React 落点 | 状态 |
|---|---|---|---|
| 头部 | efLabel/efScope(三 scope 中文文案)/状态 chip 色 | `AgentDrawer.tsx` | ✅ |
| ops bar 5 态 | draft/unloaded/stopped/ready/running 分支表(按钮文案/icon/类/禁用) | `lib/ops-bar.ts` deriveOpsBar + 测试 | ✅ |
| ops 动作 | load/enable/kickstart 状态机 + toast + 日志行;system/daemon 先提权;kickstart 600ms 追加 PID | `state/drawer-store.ts` opsAction | ✅ |
| 编辑 tab | 四折叠组(标识/执行/调度触发/I/O);触发卡网格;KeepAlive bool/dict;Args/Env/Watch 多值行;SCI 构建器(五列 + 每规则 preview + 快速预设) | `tabs/EditTab.tsx` + `MultiValueList.tsx` + `SciBuilder.tsx` | 🔶 |
| 状态 tab | stat 卡 + CPU/内存条 + 退出码/重启/启动时间 + 路径信息组 | `tabs/StatusTab.tsx` | ✅(数据共用 MOCK_DATA.drawer.status,demo 同) |
| 日志 tab | 初始 MOCK_DATA.drawer.logLines;4.5s 实时追加;级别 select(过滤为 React 增强,demo 的 select 无功能);清空(硬编码中文「日志已清空」)/导出/查看 toast | `tabs/LogTab.tsx` | 🔶 |
| XML tab | demo 轻量高亮编辑器 → **CodeMirror 6**(决策⑥);validate/copy/format/save 按钮语义(demo 仅 toast) | `tabs/XmlTab.tsx` + `components/XmlEditor.tsx` | 🔶 |
| 表单数据 | 全部卡片共用 MOCK_DATA.drawer 表单(populateDrawerDefaults 行为;per-agent 属阶段 1) | mock readForm | ✅(忠实) |
| 保存 | Label 重命名即重指 id;系统级提权;保存后脱草稿 + unloaded 态 | drawer-store.save | ✅ |
| 删除/克隆 | 危险确认(系统级附加「bootout + rm 一次授权」)+ 提权;'.copy' 去重循环 | drawer-store.remove/clone | ✅ |
| 草稿流 | 新建(scope)→ 列表顶插入 + 抽屉 isDraft(ops 全禁用「未保存草稿」)| Topbar.newWithScope + drawer-store.openDraft | ✅ |
| 导入 | 剪贴板含 plist 预填;parsePlistXml 提 Label/Program;label 去重循环;XML 带入 | `components/overlays/ImportModal.tsx` + `lib/plist.ts` | ✅ |
| SCI 聚合 preview | `ef_sciPlistPreview` 在 demo 中无对应元素(死代码) | 不移植 | ✅(记录) |

## 模态与浮层

| 浮层 | 演示源 | React 落点 | 状态 |
|---|---|---|---|
| 提权授权 | elevationModal(含密码框) | `overlays/ElevationModal.tsx` + `lib/elevation.ts` | 🔶 密码框移除(预批准);缓存窗口 = settings.authCacheMin |
| 危险确认 | dangerModal | 同文件 DangerModal | ✅ confirmDangerous=false 自动通过 |
| Toast | #toast | ui-store + `ui/Toast.tsx` | ✅ |
| Agent 抽屉/Cron 日志抽屉 | edit-drawer-mask | `components/Modal.tsx`(受控 .open 契约) | ✅ |

## 设置页(`index.html` #view-settings + `js/settings.js` → `modules/settings/`)

六 pane 全迁移(`SettingsView.tsx` + `ThemeCards.tsx` + `SettingsBits.tsx`)。逐项接线:

| 设置项 | demo localStorage | config.json | 本轮 | 备注 |
|---|---|---|---|---|
| 主题三卡 | launcherTheme | theme | **真** | main `nativeTheme.themeSource` 唯一写者 → Dock 图标随主题、renderer prefers-color-scheme 自动正确 |
| 语言 | launcherLanguage | language | **真** | useT 全树重渲染(等价 applyLanguage) |
| 开机自启 | launcher_launchAtLogin | launchAtLogin | **真** | app.setLoginItemSettings(仅打包态;dev 静默跳过) |
| 菜单栏常驻 | launcher_menubarOnly | menubarOnly | **真** | 关窗 → hide |
| 显示菜单栏图标 | launcher_trayVisible | trayVisible | **真** | Tray 创建/销毁 |
| Dock 图标 | launcher_dockVisible | dockVisible | **真** | app.dock.show/hide |
| 菜单栏角标 | launcher_menubarBadge | menubarBadge | 仅持久化 | Tray badge 属阶段 5 |
| FSEvents | launcher_fseventsActive | fseventsActive | 仅持久化 | fs.watch 属阶段 1 |
| 命令超时 | launcher_cmdTimeout | cmdTimeout | 仅持久化 | ShellRunner 属阶段 1 |
| Cron 日志保留 | launcher_cronLogRetainDays | cronLogRetainDays | 仅持久化 | 阶段 2 |
| Label 前缀 | launcher_labelPrefix | labelPrefix | **真** | 新建草稿流程读取 |
| XML 缩进 | launcher_xmlIndent | xmlIndent | 仅持久化 | 格式化属阶段 1 |
| 授权缓存 | launcher_authCacheMin | authCacheMin | **真** | ELEVATION 缓存窗口 |
| 危险确认 | launcher_confirmDangerous | confirmDangerous | **真** | confirmDangerous.request |
| 侧边栏折叠 | launcherSidebarCollapsed | sidebarCollapsed | **真** | 乐观写 + 启动恢复 |

其他:检查更新 toast 序列(demo 800ms);重置 = IPC resetSettings(回默认值并落盘);版本号沿用 MOCK_DATA.meta(`v2.0.0 (Build 20250228)`,记差异)。

## 主题与样式

- 5 个 CSS 文件**逐字节移植**至 `styles/`(仅加头注释);`:root` 48 变量 + `body.light-theme` 40 覆写原样。
- **CSS 依赖 id 与嵌套(保真清单)**:`#agentList` `#cronList` `#svcList` `#cronGrid` `#cronFilterBar` `#agentFilterBar` `#svcFilterBar` `#sidebar` `#launchStatusBar` `#moduleStatusLeft/Right` `#topBreadcrumb` `#globalSearch` `#menuToggle` `#toast/#toastIcon/#toastMsg` `#editAgentFloat/#editDrawer` `#cronLogDrawer` `#newCronModal` `#importModal` `#elevationModal` `#dangerModal` `#efLabel/#efScope` `#opsStateChip/#opsStateDot/#opsStateLabel` `#opsBtnLoad/Enable/Kickstart` `#cronEdit_<id>` `#exp_cron_<id>` `#ef_logBody` `#cronLogBody`;嵌套契约:`#cronGrid > .cron-cell > (.cron-col-card + .row-expand + .cron-edit-expand)`(hover 展开)。
- **内联样式策略**:demo 262 处 index.html 内联 + JS 生成内联(`.sci-entry` 全内联)→ 逐条转 React style 对象,不做 CSS 化清理。
- CDN 替换:FontAwesome → `@fortawesome/fontawesome-free`(83 个类名字符串全保留,icons 测试兜底);Noto Sans/Serif SC → `@fontsource`(Serif SC 用于 .settings-title);Tailwind/Mermaid 不迁。

## i18n

- 字典由 `scripts/port-demo-i18n.mjs` 生成(`i18n/dict.*.ts`,555 键全量,含未迁移域);**勿手改**。
- `t()`/`fmt()` 语义不变(缺键回退键名);组件统一 `useT()`,语言切换全树重渲染。
- demo `data-i18n` 静态属性机制无对应物 → 逐节点转 `t()` 调用点。

## Mock 数据层与接缝

- `data/ports.ts` 定义 DataSource/AgentRepository/CronRepository/ServiceRepository/LogStream;`data/index.ts` 工厂当前返回 mock;阶段 1-3 换 ipcDataSource 时组件/store 零改动。
- mock 状态就地修改 MOCK_DATA(与 demo 全局别名同模式);**list 返回浅拷贝**(zustand 引用变更触发重渲染)。
- 实时日志 = LogStream 订阅(4.5s 轮换 MOCK_DATA.liveLogs)。

## 已知差异清单(预批准/记录)

1. **提权模态无密码输入框**(refactor-plan 预批准;真机走 osascript 原生授权框)。
2. **XML 编辑器为 CodeMirror 6**(决策⑥),非 demo 轻量 textarea+高亮层;编辑器 chrome 有细微视觉差。
3. **字体 npm 内置** @fontsource(unicode-range 分片);无 CDN。
4. **minWidth 700** > demo 680px 移动断点 → 移动端侧边栏分支不可达(照移)。
5. **版本号沿用 mock 文案**(`Launcher v2.0.0 (Build 20250228)`);APP_VERSION 0.1.0 未接入设置页(阶段 5)。
6. **Tray 菜单/折叠 toast/清空日志**硬编码中文(demo 原样;阶段 5 随双形态接入 i18n)。
7. 日志 tab 级别 select 为**功能性过滤**(demo 的 select 无功能)——增强,视觉一致。
8. 抽屉 XML 原文/表单/状态为**全卡片共用 mock**(demo populateDrawerDefaults 原样)。
9. 窗口 `backgroundColor #0e0e17` + boot-splash 配色由 `#14141f` 调整为 `--bg`(无主题闪烁;差异轻微)。

## Demo 缺陷与死代码记录(不移植/如实移植)

- `sciRefreshPlistPreview` 目标元素不存在(死代码)→ 不移植聚合 preview。
- `rowCard`/`rowInfo`(components.js)**零调用** → 不移植。
- `refreshSettingsStatusBar` 定义两次(settings.js 胜出)→ React 由 store 派生,天然单份。
- `addCronEntryTo` 忽略参数;`ai.js` 部分函数无引用 → 属未迁移域,注明。
- 折叠 toast「侧边栏已折叠」等硬编码中文 → 如实移植(记差异 6)。
- demo 对 `0 * * * *` 的 cron 人话输出「每天 每小时 执行」等怪癖 → 如实移植并有测试锚定。

## 后续接线点(mock → 真实,对应 refactor-plan 阶段)

| 接缝方法/设置 | 真实实现 | 阶段 |
|---|---|---|
| AgentRepository.list/toggle/ops/save/remove/clone | launchctl list/print + LaunchctlService | 1 |
| readForm/readStatus/writeXml | per-agent plist 解析(plutil) | 1 |
| fseventsActive → fs.watch 自动刷新 | 阶段 1 |
| cmdTimeout → ShellRunner | 1 |
| xmlIndent → XML 格式化 | 1 |
| CronRepository.* | crontab 解析/写回 | 2 |
| cronLogRetainDays → 日志清理 | 2 |
| ServiceRepository.list/kill | lsof + kill 信号 | 3 |
| menubarBadge → Tray 角标 | 5 |
| APP_VERSION → 设置页/关于 | 5 |
| aiAgents/aiSkills(已生成在 mock) | AI 视图 | 4 |
