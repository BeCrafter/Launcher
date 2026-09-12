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
| `index.html` L65-84 顶栏 | `layout/Topbar.tsx` | 🔶 | agents 导入/新建已接线;crontab 刷新 = 真实重读(2026-09-11);services 重新扫描/监听状态 = 真实(轮询暂停有会话语义) |
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
| Cron 日志抽屉 | cronLogPath + 近 3 天 11 行模拟 | `CronLogDrawer.tsx` + 真实 `readLog`(尾读任务日志文件) | 🔶(差异 12) |
| 新建 Cron | 预设/实时预览/5 字段/scope/log;system → 提权;unshift 顶部 | `NewCronModal.tsx`(2026-09-11 真实 crontab 写入) | 🔶(差异 12/19) |

## 视图 3:端口服务(`js/services.js` → `modules/services/ServicesView.tsx`)

| 项 | 演示行为 | React 落点 | 状态 |
|---|---|---|---|
| 分类管线 | ① Brew Resolver(brewServices 清单)② COMMAND 映射(node)③ 兜底 process | `lib/classify.ts` + 测试 | ✅ |
| 分组顺序 | node → brew → process | SVC_GROUP_ORDER | ✅ |
| 卡片 | svc-col-card(PID/addr:port/proto/uptime chips) | `components/cards/SvcCard.tsx` | ✅ |
| kill | 危险确认 → 真实终止(SIGTERM→5s→SIGKILL;他人进程 EPERM→提权引导);新增重启/容器启停 | ServicesView.onKill/onRestart | 🔶(差异 16) |
| 搜索 | demo searchHandler 仅 toast | 已接线(name/cmd/command/port/addr 过滤,差异 17) | 🔶 |

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
| XML 高亮映射 | demo 正则三类:`<...>` 整体青 / `<?...?>` 紫 / 注释 dim,正文 muted;textarea soft-wrap | CM HighlightStyle:tagName/angleBracket/attributeName/attributeValue→青、processingInstruction→紫、comment→dim、正文 muted(全部 CSS 变量输出,深浅主题自动切换,详见差异 32);lineWrapping 对齐;容器 host 补 flex:1 修正 demo CSS `.xml-editor-wrap{display:flex}` 对流内子元素的收缩;体验升级:`drawSelection()`(选区/光标走主题 wash+`--cyan`)与 `highlightActiveLine()`(当前行浅底) |
| 表单数据 | 全部卡片共用 MOCK_DATA.drawer 表单(populateDrawerDefaults 行为;per-agent 属阶段 1) | mock readForm | ✅(忠实) |
| 保存 | Label 重命名即重指 id;系统级提权;保存后脱草稿 + unloaded 态 | drawer-store.save | ✅ |
| 删除/克隆 | 危险确认(系统级附加「bootout + rm 一次授权」)+ 提权;'.copy' 去重循环 | drawer-store.remove/clone | ✅ |
| 草稿流 | 新建(scope)→ 列表顶插入 + 抽屉 isDraft(ops 全禁用「未保存草稿」)| Topbar.newWithScope + drawer-store.openDraft | 🔶(差异 32:草稿不占列表行) |
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
| 主题三卡 | launcherTheme | theme | **真** | main `nativeTheme.themeSource` 唯一写者(启动 + 每次变更都应用)→ 系统标题栏随主题、窗口底色取 demo --bg 深浅值、Dock 图标随动、renderer prefers-color-scheme 自动正确 |
| 语言 | launcherLanguage | language | **真** | useT 全树重渲染(等价 applyLanguage) |
| 开机自启 | launcher_launchAtLogin | launchAtLogin | **真** | app.setLoginItemSettings(仅打包态;dev 静默跳过) |
| 菜单栏常驻 | launcher_menubarOnly | menubarOnly | **真** | 关窗 → hide |
| 显示菜单栏图标 | launcher_trayVisible | trayVisible | **真** | Tray 创建/销毁 |
| Dock 图标 | launcher_dockVisible | dockVisible | **真** | app.dock.show/hide |
| 菜单栏角标 | launcher_menubarBadge | menubarBadge | **真** | renderer 上报运行中计数(`agents:badgeCount`,去重)→ main Tray `setTitle(数字)`;数据仍 mock,阶段 1 换源后 main 自算 |
| FSEvents | launcher_fseventsActive | fseventsActive | **真(链路)** | fs.watch 三个 launchd 目录(home/system Agents + Daemons)0.4s 去抖 → 广播 `agents:dirChanged` → agents 重载;mock 源下数据不变,阶段 1 换源即真实刷新 |
| 命令超时 | launcher_cmdTimeout | cmdTimeout | **真(地基)** | `main/services/shell-runner.ts` 落地(超时 SIGTERM→宽限 SIGKILL;值经 getter 注入 + 单测);运行时首个调用方属阶段 1 |
| Cron 日志保留 | launcher_cronLogRetainDays | cronLogRetainDays | **真** | 日志文件尾读/清理(`cleanupLogs`,list 节流 + 设置变更即时);卡片与抽屉保留期文案动态取该值 |
| Label 前缀 | launcher_labelPrefix | labelPrefix | **真** | 新建草稿流程读取 |
| XML 缩进 | launcher_xmlIndent | xmlIndent | **真** | XmlTab「格式化」= `formatPlistXml`(纯函数 + 单测);XmlEditor 经 Compartment 应用 indentUnit/tabSize;保存写盘仍属阶段 1 |
| 授权缓存 | launcher_authCacheMin | authCacheMin | **真** | ELEVATION 缓存窗口 |
| 危险确认 | launcher_confirmDangerous | confirmDangerous | **真** | confirmDangerous.request |
| 侧边栏折叠 | launcherSidebarCollapsed | sidebarCollapsed | **真** | 乐观写 + 启动恢复 |

其他:检查更新 = 真实 GitHub Releases API(main 侧 `services/update-check`,8s 超时,四态 upToDate/available/noRelease/error;仓库当前无 Release → noRelease,UI 文案经 i18n 生成脚本 EXTRA 键);重置 = IPC resetSettings(回默认值并落盘);版本号 = `app:info` 真实版本(`Launcher v0.1.0`,关于页/页脚/状态栏三处);「打开系统设置」= 真实跳转 macOS 登录项面板(`x-apple.systempreferences:`,main 侧 url-guard 白名单)。

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

- `data/ports.ts` 定义 DataSource/AgentRepository/CronRepository/ServiceRepository/LogStream;`data/index.ts` 为**混合工厂**(2026-09-11 起):agents/logs 仍为 mock(阶段 1/4),crons/services 走 `data/ipc/*` 真实后端;阶段 1 换 agents 时组件/store 零改动。
- mock 状态就地修改 MOCK_DATA(与 demo 全局别名同模式);**list 返回浅拷贝**(zustand 引用变更触发重渲染)。
- 实时日志 = LogStream 订阅(4.5s 轮换 MOCK_DATA.liveLogs)。

## 阶段 1 落地差异(2026-09-11 Launch Agents 真实后端)

21. Agents 数据源真实化(mock 数据源整体退场,`data/index.ts` 三域全 IPC);id = `<scope>:<label>`;desc = plist 首个 XML 注释(应用自有约定,往返保留);tags 不再由 mock 提供。
22. 表单 ⇄ plist 映射(argv 规范形态):`ProgramArguments = [可执行文件, ...args]`(launchd 以 [0] 为程序;E2E 实测单独写 `Program` + `-c` 参数会被当作程序名 → 127)。托管键之外的键 → `xmlFallback`(强制 XML 模式,开源守卫)。
23. 状态/指标:launchctl list(pid/退出码)+ print-disabled 并集(override→橙标 `已禁用`)+ ps(etime/%cpu/%mem/lstart)+ `launchctl print`(runs/state/工作目录)。开源版无 uptime/cpu/mem,此处为体验升级补全。
24. 日志 tab 真实化:文件源 stdout/stderr 尾读 512KB、tab 打开时 5s 自动跟随、清空=写空串(开源语义);系统源 `log show --predicate … --last 15m --style compact`、2000 行上限、手动刷新;新增「日志文件/系统日志」源切换与「刷新」按钮。
25. XML tab 真实化:载入 per-agent plist 原文;校验 = `plutil -lint`(与系统口径一致);保存 = 校验后写盘(提权作用域走系统授权);格式化沿用 `formatPlistXml`。无效 plist 横幅删除按钮真实化(危险确认 + 作用域按目录前缀判定 + 提权)。
26. ops 真实化:load/unload(bootstrap/bootout)、enable/disable(开关语义)、kickstart(已加载未运行时触发执行,runs+1);保存/删除/克隆全部真实;系统作用域走 osascript 提权(bootout+rm 合并一次授权);新草稿落盘发生在首次保存。
27. brew 合并升级:匹配顺序 = brew `services list --json` 的 **file 字段精确匹配**(前缀无关,最可靠)→ `homebrew.mxcl.` 前缀(开源原规则)→ Homebrew 安装路径推断公式名;**2026-09-11 核对**:本机 4 个 brew plist 的 Label 实测均为 `homebrew.mxcl.*`(文件名同),早前「本机为 `sh.brew.*`」的记录有误;操作路由 `brew services start/stop/restart`(root 服务提权);brew stop 会移除 plist → 动作后条目消失时容错返回修正状态。
28. 域映射修正(开源同款):`/Library/LaunchAgents`(systemAgent)属**用户 gui 域**,仅 `/Library/LaunchDaemons`(daemon)属 `system` 域(E2E 实测错映射会导致载入失败)。

29. **mock 死数据清理 + 孤儿服务定向复核(2026-09-11 收尾)**:`MOCK_DATA` 剔除 `agents`/`invalidPlists`/`liveLogs`/`drawer`/`aiAgents`/`aiSkills`(均零引用;生成脚本 delete 行注释注明可一行恢复),仅剩 `urls`——demo 假条目 `com.old.broken.plist`(「XML 解析失败」)随之消失,真实横幅只显示真文件。**孤儿复核**:列表刷新时对本会话消失的条目 + 上次已命中的孤儿做定向复核(逐个 `launchctl print`,path 须落在三管理目录且文件不存在),命中显示只读横幅「已加载但 plist 已不存在」(粘性,直到 bootout/重建后自动清空);辅助进程(print path 为 `(submitted)`/系统目录)天然被过滤,实测零误报。

30. **原生对话框接线(2026-09-11)**:编辑 tab「浏览可执行文件」→ `dialog.showOpenDialog`(选中路径写回表单);「撤销」→ 真实表单撤销栈(drawer-store `formHistory` 上限 50,栈空按钮禁用);日志 tab「导出」→ `dialog.showSaveDialog` + main 侧写文件(取消静默);「查看文件」→ 访达揭示该 agent 日志文件(`agents:revealLog`,路径解析在 agent-service;无文件返回 null → toast;系统日志源禁用该按钮);导入弹窗「选择 plist」→ 原生选文件并读入编辑器(≤1MB;粘贴导入原本即真实)。

31. **daemon/system 作用域状态修复 + 提权窗口语义核实(2026-09-11)**:实测**用户态 `launchctl list` 不含 system 域服务**(/Library/LaunchDaemons 守护进程全部缺失)→ 曾把运行中的 daemon 误判为「已停止/未加载」;现合并 `launchctl print system` 的服务表(`parseDomainServices`,17ms/次)按作用域取用,16 条 system/daemon 条目与 `launchctl print` 真值逐项一致(BSPrintMonitor 正确显示 running/PID 324)。**提权缓存窗口(authCacheMin)核实**:链路 = 设置页 → 配置 → `bootstrap` 注入 getter → `lib/elevation.ts`;窗口只管**应用侧说明窗**的免打扰(真实系统授权框由 macOS 控制、应用不缓存密码),`grant`(应用内点授权)/`noteSuccess`(真实提权成功)置热、`cancel` 不置热、设为 0 时**已热窗口立即失效**(本轮修复:窗口有效性同时受当前设置约束)+ 5 项单测覆盖。

32. **草稿流更正:新建/导入只开抽屉,保存后才进列表(2026-09-11,用户要求覆盖 demo 行为)**:demo `openAgentDraft` 把草稿 unshift 进列表(迁移版曾忠实移植,观感上「点了新建列表直接多一行」);现改为:`createDraft` 仅置选中 + 打开抽屉,main 侧 `listImpl` 不再合并 drafts、`readStatus`/`readLogs` 对草稿返回零值模型/空数组(抽屉状态/日志 tab 可正常打开,此前会 Promise.all 拒绝导致抽屉打不开),**保存落盘经 reload 后条目才出现**;重名去重修正为 `scope+label` 匹配(原比较 `a.id === label` 恒不命中);导入弹窗在 openFor 后补 `updateForm({program})` 保持预填(bordered XML 编辑器配色:token/caret/光标/选区/activeLine 全部走主题变量——深色 `#45cbe0`/浅色 `#1f9bb3`,选区与当前行用 wash;`drawSelection()` 接管光标渲染 → `.cm-cursor` 描边取 `--cyan`,浅色下不再出现深色残留)。

33. **非任务 plist 兼容 + 写入覆盖守卫(2026-09-11,用户要求)**:本机 `~/Library/LaunchAgents/com.google.keystone.{agent,xpcservice}.plist` 是 Google 写入的合法 plist(181B,内容仅 `<dict/>`),但**无 Label** —— `Label` 是 launchd 对任务的硬性要求(Apple: "This required key uniquely identifies the job"),launchd 自己忽略这类文件,此前我们却归入 `invalid` 横幅并把内部英文串 `missing string Label` 当原因露出(中文界面里的英文很易被误认成假数据)。现改为:**合法 plist 但缺 Label → 静默跳过**(`plist-service.readFile` 返回 null;既不计入 agents 也不计入 invalid;`read()` 公开入口仍视为不可读)。⚠ 与开源 `PlistService`(同一情形归 `invalid`,`parsePlist` 返回 nil)的**有意差异**——已按用户要求选择更贴近 launchd 语义。**配套覆盖守卫**(静默跳过使这些文件从 UI 消失、但文件仍在磁盘上,新建同名任务时 `write` 会原子覆盖):`assertOverwritable` —— 目标已存在时仅允许覆盖「非任务占位(缺 Label)」或「同名任务自身」,其余(他人任务、已存在但无法解析)一律拒绝并给出可读原因,避免新建/改名静默清掉别人的任务。5 项单测覆盖;实机验证 invalid 横幅 0 行、agents 仍 30 条、系统真实文件未改动。

34. **「已停用 → 卸载 → 加载」死循环修复 + disabled 分域(2026-09-12,用户报告)**:launchd 的 `disable` 是**独立于加载状态的持久覆盖位**(man launchctl:"Once a service is disabled, it cannot be loaded in the specified domain until it is once again enabled";跨重启持久),但 demo 的 ops-bar 状态表把 enable 与 loaded 绑定(`btnEnable.disabled = !s.loaded`;mock 时代 `load` 永远"成功",该假设从未被检验),移植后形成**死循环**:加载必失败(disabled 挡 bootstrap)、启用被前端拦截(`drawer-store` 的 `!loaded → toast.loadFirst`,而 loadFirst 建议的「先加载」恰是不可能的事)、立即运行被拦——三个按钮无一可用,且状态 chip 显示「未加载」掩盖了「已停用」事实(卡片「已禁用」chip 的 tooltip 还在指引用户去点抽屉「启用」)。修复:**① main 侧加载自愈** `loadWithSelfHeal`(disabledFor 命中 → 先 enable 再 bootstrap),`ops('load')` 与 `toggle` 未加载分支共用;**② renderer 状态表判定顺序改为先 `!enabled` 后 `!loaded`**(停用态不再被掩盖;enable 文案只看 `enabled`,与 loaded 正交;enableDisabled 非草稿恒 false);**③ 删除 enable 的 `!loaded` 前置拦截**,加载自愈发生时追加 toast 提示(新 EXTRA 键 `toast.selfHealEnabled`,明示「停用是持久状态」);**④ disabled 覆盖位按域分列**(`{gui, system}` 两集合,原先合并会让 system 域的停用误染用户级同名 agent;域映射 = `tableFor`/`domainOf` 同款:仅 daemon 属 system 域)。**⚠ 本条的第①③两点已被第 35 条的显式两步模型取代**(自愈决策经用户复审后撤销)。

35. **操作两轴模型定稿:载入/停止/移除 · 启用/停用 · 立即运行(2026-09-12,用户主导设计)**:launchd 管理是**两个正交轴 + 一条依赖**——域成员(`bootstrap`/`bootout`,仅本会话)× 默认加载(`enable`/`disable`,跨重启持久,存外部覆盖位;plist 的 `Disabled` 键只是默认值),唯一依赖 = **disable 阻塞 bootstrap**(顺序必须 enable→bootstrap);`bootstrap` ≠ 运行(注册后由 RunAtLoad/StartInterval/KeepAlive 等触发条件或 kickstart 决定),故按钮弃用「加载/卸载」改用开源同款「**载入/移除**」。**域成员按钮为上下文标签**(同一按钮):未载入→**载入** / 已载入运行中→**停止**(kill→轮询→SIGKILL→bootout,复用 toggle 优雅路径) / 已载入未运行→**移除**(仅 bootout)。**停用为严格语义(用户拍板)**:只改标志位、不停本次进程 → 新增显式双态 chip「运行中 · 已停用」(`drawer.state.runningDisabled`)。**顺序规则仅一条**:停用时「载入」置灰 + 提示(`drawer.hint.enableFirst`),即**显式两步**(启用→载入);上一轮的隐式自愈已删除(main `register` 守卫:停用/已载入均抛可读错误)。**立即运行**仅「已载入且未运行」可用(运行中 kickstart 无意义、未载入必失败);「立即运行/停止」不设独立按钮(停止由域成员按钮承担;KeepAlive 任务单独 kill 会被拉起)。**卡片对齐**:主按钮同款上下文标签(running→停止/loaded→立即运行/stopped→载入,停用且未载入时禁用+提示);`toggle` 链路补提权(system/daemon 此前必然权限失败);toast 去裸英文;**新增根级「更多」浮层菜单(应用新增 UI,超出 demo 冻结基线)**——启用/停用快捷入口(定点定位、Esc/外点关闭;⚠ 卡片内不可做下拉:`.agent-col-card` overflow:hidden + hover transform 会裁剪并错位 fixed 定位)。main 侧 `register`/`unregister` 内部函数收敛 toggle 与 ops(卡片与抽屉行为一致;`ops('unload')` 自适应:运行中先优雅停止)。E2E 全流程实测:载入→运行中→停用(**PID 不变**,严格语义)→停用态载入被守卫拒绝(可读报错)→启用解禁→停止(pid 空、launchctl.list=0)→抽屉 (T,F,T) 态 chip/按钮正确→更多菜单停用生效。**实测 launchctl 怪癖(排障须知)**:① disabled 服务的 bootstrap 报 `5: Input/output error`(与「未加载」的 bootout 报错同文案);② 只有 Label 无 Program/ProgramArguments 的 plist bootstrap 同样报 error 5(launchd 拒载无可执行体的任务,plutil -lint 仍 OK);③ ops 动作后 `print-disabled`/`launchctl.list` 有 ~2s 传播延迟;④ 测试清理后 override 库残留 `=> enabled` 中性条目(SIP 不可手删,无害)。

36. **Agent 操作交互定稿:意图层(2026-09-12,用户主导设计)**:前两轮都在 launchctl 的**概念层**打转(①「两轴模型 + 上下文标签」②「三个恒定开关」),用户实测后反馈「仍然偏技术维度、不容易让人意识到」。**判断:三个维度(域成员 `bootstrap`/`bootout` · 默认加载 `enable`/`disable` · 运行 `kickstart`/`kill`)是 launchd 的模型,不是用户的模型**;同类先例 = `brew services` 只有 `start`/`stop`/`run` 三个动词,登记与顺序由 brew 自己处理。**定稿:界面只留三个控件**——`启动/停止`(主)· `重启` · `开机自启`(开关);顺序逻辑**下沉到 main 的意图动作**(`start`/`stop`/`restart`/`enable`/`disable`/`runOnce`),UI 不再拼命令序列,**因此界面上不存在「因顺序而置灰」的按钮**——「必须先载入才能运行」这条约束对用户不可见。意图→命令映射:`启动` = `enable`(如需)→ `bootstrap`(如需)→ `kickstart`(如需);`停止` = 纯 `bootout`(不做 kill 前置;移出域即终止进程且不会被 KeepAlive 拉起);`重启` = 运行中 `kickstart -k` / 未载入走启动序列;`开机自启` = `enable`/`disable`(**只改覆盖位,不动当前运行状态**);`立即执行一次` 初版为「确保已载入后 kickstart」,但**实测四种状态下分别与「启动」完全重复 / 拒绝 / 无效果**(launchd 的 `disable` 阻塞载入,使『自启关闭时单独跑一次』无法实现)→ **用户确认后移除**(端到端:UI 按钮、卡片菜单项、IPC 联合类型、main 意图、i18n 键)。**联动表达**:状态 chip 用人话(`运行中`/`待运行`/`已停止`/`未保存草稿`)+ **未来时句**(「下次登录将自动启动」/「下次登录不再自动启动」/「等待触发条件,满足时会自动执行」);唯一真正矛盾的决定用**二选一询问**(停止一个开机自启的任务时 → 新增 `lib/choice.ts` + `ChoiceModal` 浮层:`[仅停止本次]`/`[停止并关闭自启]`)。**启动的连带副作用**:在已停用任务上启动会连开「开机自启」(launchd:`disable` 阻塞 `bootstrap`),以开关可见翻转 + toast 明示,不用报错表达。**配套收敛**:删除 `agents:toggle` 链路(卡片改用意图动作,消除历史上「两条停止路径语义不同」的漂移);提权/询问/toast 收敛到 `lib/agent-ops.ts`(抽屉与卡片共用一份,避免两处漂移——上一轮就是这么出的问题);「更多」菜单 = 开机自启项(**仅此一项**;菜单是卡片侧二级动作的落点,后续可扩展)。**布局与宽度(同日跟进)**:抽屉头部实测溢出 15px(scrollWidth 614 > clientWidth 599)、标题容器被 `flex-shrink:0` 的右侧组压成 0 宽 → **状态 chip 与 Agent 名称重叠**、关闭按钮被推出抽屉右边界裁掉。改法:未来时句从右侧移到**标题区第三行**(与 scope 副标题同族)+ 标题区 `min-width:0` 与省略号 + **抽屉 600 → 860px**(`app-chrome.css` 覆写,demo 基线为 600)。修后实测:头部无溢出(859=859)、五段控件**零重叠**、关闭按钮归位。**launchd 实测怪癖**:`kickstart -k` 的重启是异步的,且**频繁重启会被节流**——实测「从停用状态刚启动完就重启」会出现数秒的「已载入未运行」窗口,期间 `launchctl print` 甚至报"服务找不到";故渲染层在重启后做**非阻塞轮询刷新**(拿不到运行中即重试,最多 ~6s),避免 UI 停在「待运行」。前两轮方案均被本轮取代:①的「上下文标签」= 一个命令两个名字 + `kill` 无独立入口;②的「三恒定开关」= 换了名字的同一套技术概念。

## 阶段 2/3 落地差异(2026-09-11 定时任务/端口服务真实后端)

12. Cron 数据源真实化(mock 移除);卡片 hover 日志路径 = 后端 `job.logPath`;desc 来自**紧邻上方注释行**(通用约定);禁用 = `# [disabled] ` 前缀(应用自有标记);日志 = `( cmd ) >> ~/Library/Logs/BeCrafter-Launcher/cron/<id>.log 2>&1` 包裹;`readLog` 尾读 256KB/2000 行。`MOCK_DATA.crons/services/brewServices/cronPresets` 已从生成脚本剔除,预设迁至 `lib/cron-presets.ts`。
13. Cron 卡片/编辑预览/新建模态新增「下次执行」行(`shared/cron-next-run.ts`,vixie 语义含 dom/dow OR;U5 增强项)。
14. 新增 Cron 文件头面板(设计文档要求,开源有 demo 无):编辑首个任务前的注释/env 块,保存仅替换该区块。
15. `cron.log.retainHint` 换用动态 {D} 键(demo 冻结文案写死 3 天);`@daily` 等特殊入口新增专用描述文案(修复 demo 解析器只认 5 字段导致的「表达式格式错误」回退)。
16. 端口服务新增:重启按钮、Docker 分组与过滤 chip(fa-box 代 logo)、容器 start/stop/restart;TagChip 文字保持 3 桶,细分 kind(python/php/jvm/ruby/docker/dev)进 tooltip。
17. Topbar 刷新/重新扫描/监听状态真实接线(demo/迁移版此前仅 toast);Open = 系统浏览器打开 `http://127.0.0.1:<port>`,Copy = 真实剪贴板;**轮询仅服务页激活时进行**(离开停扫,已有数据冻结保留)。
18. 侧边栏计数角标:阶段 2/3 曾提前落地 cron/services 两项(内联样式),**2026-09-11 按用户要求移除**——侧边栏恢复 demo 基线(仅图标+文字);refactor-plan 阶段 1 追加的「counts badge」仍为待办,需要时再评估。
19. 提权真实化:osascript `with administrator privileges`(密码仅进系统原生框,应用不接触);`authCacheMin` 诚实语义 = 应用侧说明窗的免打扰窗口(与 macOS 约 5 分钟系统授权缓存对齐,弹不弹由系统决定);取消 `(-128)` → toast;`/etc` 下**新建**文件受 SIP 限制即使 root 也被拒(本机实测 EPERM)——系统级任务仅在 /etc/crontab 已存在时可用,读取不受限。**入口前置拦截(2026-09-11)**:`headers.system.exists === false` 时新建模态的「系统级」选项置灰 + 说明(`cron.systemUnavailable`),文件头面板的系统级保存按钮置灰——避免「填完整张表单点保存才报 ELEVATION_FAILED」;用户级不受限(`crontab -` 会建表,仅实测无 crontab 时也可写)。
20. next-run 预测落位 `src/shared/`(而非 main/domains):渲染层实时预览需本地计算。

## 已知差异清单(预批准/记录)

0. **窗口标题栏接管**(demo 之外的原生需求):`titleBarStyle: 'hiddenInset'` 隐藏系统标题栏,应用自绘 28px 全宽色带(`--surface`,= 侧边栏色,随主题即时切换)兼作拖动区;无系统居中标题文字(Mission Control 仍读 title 字段);交通灯驻留色带内(`trafficLightPosition x20 y6`);样式在 `styles/app-chrome.css`(非移植文件),外壳结构 `.window-root > (.titlebar-drag + .app-shell)`。**侧边栏分割线过渡**(多轮迭代后定稿):原 `border-right` 移除,改由 `.sidebar::after` 画 1px 线——**渐变区 = logo/头部区域本身**(用户红框):渐变起点窗口 y32(色带下沿 y28 再留 4px 全透明),向下渐入,至窗口 y110(局部 82px)达实色,其下实线;色带区无线。**三线同色(基准 = 右侧主区域上方的顶栏底边线)**:竖线与 logo 底边横线统一为 demo 原生 `var(--border)`(深 rgba(255,255,255,.06)/浅 rgba(30,38,68,.08)),不再使用加强色;线在侧边栏自己的层叠上下文内,折叠/展开动画原生跟随。⚠ 踩坑:(1) 外挂在 `.app-shell` 外做「上探色带」会被 `overflow:hidden` 裁剪;(2) 挂 `.window-root::before` 配低 z-index 会被 `.sidebar`(z-index:20 的 flex 子项,自成层叠上下文)整体遮住。
1. **提权模态无密码输入框**(refactor-plan 预批准;真机走 osascript 原生授权框)。
2. **XML 编辑器为 CodeMirror 6**(决策⑥),非 demo 轻量 textarea+高亮层;编辑器 chrome 有细微视觉差。
3. **字体 npm 内置** @fontsource(unicode-range 分片);无 CDN。
4. **minWidth 700** > demo 680px 移动断点 → 移动端侧边栏分支不可达(照移)。
5. **版本号已接真实 `app:info`**(`Launcher v0.1.0`,关于页/页脚/状态栏三处);`MOCK_DATA.meta` 已从生成脚本(`port-demo-mockdata.mjs`)剔除,`AppMeta` 类型删除。
6. **Tray 菜单/折叠 toast/清空日志**硬编码中文(demo 原样;阶段 5 随双形态接入 i18n)。
7. 日志 tab 级别 select 为**功能性过滤**(demo 的 select 无功能)——增强,视觉一致。
8. 抽屉 XML 原文/表单/状态为**全卡片共用 mock**(demo populateDrawerDefaults 原样)。
9. 窗口 `backgroundColor #0e0e17` + boot-splash 配色由 `#14141f` 调整为 `--bg`(无主题闪烁;差异轻微)。
10. **菜单栏角标以 `tray.setTitle(数字)` 呈现**(菜单栏图钉右侧文本,与 template icon 独立渲染层、明暗自适应不受影响);未采用图标内嵌绘制,Dock badge 语义不符 `app.dock.setBadge` 未用。
11. **打开系统设置真实跳转**(`x-apple.systempreferences:`,main 侧 url-guard 只放行 `com.apple.*` 面板);检查更新文案为应用新增 i18n EXTRA 键(demo 冻结不可改;`toast.upToDate` 旧键保留为冻结镜像不再消费)。

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
| AgentRepository.list/toggle/ops/save/remove/clone | **已完成(2026-09-11)** `domains/launchctl-parse` + `services/launchctl-service`(域映射 gui/system、bootstrap/bootout 走文件路径、停止轮询+SIGKILL)+ `agent-service` 门面 | 1 |
| readForm/readStatus/writeXml | **已完成** `domains/plist-xml`(自实现 XML 往返)+ `domains/agent-form`(托管键守卫/argv 规范形态)+ `services/plist-service`(三目录扫描/二进制转 XML/原子写/提权 mv+chown+chmod/plutil -lint) | 1 |
| fseventsActive → fs.watch 自动刷新 | **部分已完成**(监听/去抖/广播/重载链路本轮落地;数据源换真实属阶段 1) | 1 |
| cmdTimeout → ShellRunner | **地基已完成**(shell-runner + 单测;首个调用方 LaunchctlService 属阶段 1) | 1 |
| xmlIndent → XML 格式化 | **已完成**(formatPlistXml;保存写盘属阶段 1) | 1 |
| CronRepository.* | **已完成(2026-09-11)** `main/domains/crontab.ts` 往返解析/序列化 + `main/services/crontab-service.ts`(`crontab -`/`-r`;system 走 osascript 提权 + base64 载荷) | 2 |
| cronLogRetainDays → 日志清理 | **已完成** `cleanupLogs`(list 节流 + 设置变更即时;日志文件 = 任务行重定向产物) | 2 |
| ServiceRepository.list/kill | **已完成** `domains/lsof-parse`(-F 机器可读)+ `services/process-discovery`(ps 补全/3s 按需轮询/diff 推送)+ `termination`(SIGTERM→5s→SIGKILL)+ `docker-service`(daemon 未运行静默降级) | 3 |
| menubarBadge → Tray 角标 | **已完成**(setTitle 数字;阶段 1 后计数改由 main 自算) | 5 |
| APP_VERSION → 设置页/关于 | **已完成**(useAppInfo hook;真实版本三处) | 5 |
| aiAgents/aiSkills(已生成在 mock) | AI 视图 | 4 |

## 打开慢修复(2026-09-11,机制同源开源 AgentStore/BrewManagedSupport)

首屏数据路径实测(本机 32 plist):文件扫描 31ms / launchctl 全家 ~150ms,唯一慢源是 `brew services list --json`(11-13s,曾观测 >120s;`HOMEBREW_NO_AUTO_UPDATE=1` 无效)——且被 `cmdTimeout: 10000` 第 10 秒 SIGTERM 后 `catch(() => [])` 整体丢弃,白等 10s 且 brew 合从未生效。开源 LaunchManager 的 agents 列表关键路径**零 brew**(`AgentStore.refresh()` = plist + launchctl + print-disabled;isBrew 是 `BrewManagedSupport` 纯字符串启发式;brew 数据在独立 `HomebrewServiceStore` 后台 Task)。本次修复即消除移植偏差:

1. **isBrew 纯启发式**:新增 `main/domains/brew-heuristic.ts`(`isBrewManaged`/`brewFormulaName`:label 前缀 `homebrew.mxcl.` → `/opt|Cellar/<公式>` 路径反推,复用 `matchBrewService` 原有分支);`agent-service.listImpl` 从 `Promise.all` 移除 `brewList()`,`buildAgent` 改用启发式。brew 数据仅在 `brewAction`(用户显式启停)按需拉取。**与开源偏差消除**;本机 4 个 brew plist 的 Label 实测均为 `homebrew.mxcl.*`,渲染层 brew 标签/过滤/按钮路由零变化(消费点只依赖 `agent.isBrew` 布尔值)
2. **brew 调用收尾**:`resolveBrewPath()` 提为 `services/brew-path.ts` 共享(process-discovery 原用裸 `brew`,Finder 启动 PATH 精简会 ENOENT);process-discovery brew TTL 30s → 10min + lastBrewAt 先置位单飞
3. **scanAll 记忆 + 单飞**:`plist-service.scanAll()` 结果记忆 1500ms + 进行中 promise 共享;`write/remove/removeWithBootout` 成功后失效;launchd 目录被应用外修改时 fsevents applier 经 `onDirsChanged → plists.invalidate()` 失效(保证 dirChanged reload 读到新状态)。消除抽屉 4 路并发 IPC 各自全量重扫
4. **首屏骨架态**:新增 L0 原语 `components/ui/Skeleton.tsx`(纯视觉无文案,i18n 字典从冻结 demo 生成不新增键;样式在 app-chrome.css);三域视图 `!loaded && 数据为空` 时渲染骨架替代 EmptyState(加载中曾被误呈现为「没有数据」)
5. **长命令显式超时**:`log show`(实测 2.8-31.8s 波动,与 `--last` 窗口大小无关)与 brew 全部调用点(list/action、process-discovery)显式 `timeoutMs: 45_000` 覆盖 `cmdTimeout`,修复系统源日志恒空 / brew 启停必超时;`brew.action` 原本也被 10s 杀死

E2E(CDP,dev 模式):warm reload → 首张卡片中位 **879ms**(修复前 ~10s);brew 过滤 30 → 2 张卡片;invalid 横幅/系统日志/toggle/dirChanged 回归通过。已知遗留(非本次引入):`log show --predicate process == <label>` 对真实进程名 ≠ label 的服务拿不到日志(如 com.deepseek.dsh.web),属预置条件表达式口径问题。
