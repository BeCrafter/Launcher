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
| XML 高亮映射 | demo 正则三类:`<...>` 整体青 / `<?...?>` 紫 / 注释 dim,正文 muted;textarea soft-wrap | CM HighlightStyle:tagName/angleBracket/attributeName/attributeValue→青、processingInstruction→紫、comment→dim、正文 muted;lineWrapping 对齐;容器 host 补 flex:1 修正 demo CSS `.xml-editor-wrap{display:flex}` 对流内子元素的收缩 |
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
27. brew 合并升级:匹配顺序 = brew `services list --json` 的 **file 字段精确匹配**(实测本机 brew 标签前缀为 `sh.brew.*` 而非 `homebrew.mxcl.*`)→ `homebrew.mxcl.` 前缀(开源原规则)→ Homebrew 安装路径推断公式名;操作路由 `brew services start/stop/restart`(root 服务提权);brew stop 会移除 plist → 动作后条目消失时容错返回修正状态。
28. 域映射修正(开源同款):`/Library/LaunchAgents`(systemAgent)属**用户 gui 域**,仅 `/Library/LaunchDaemons`(daemon)属 `system` 域(E2E 实测错映射会导致载入失败)。

## 阶段 2/3 落地差异(2026-09-11 定时任务/端口服务真实后端)

12. Cron 数据源真实化(mock 移除);卡片 hover 日志路径 = 后端 `job.logPath`;desc 来自**紧邻上方注释行**(通用约定);禁用 = `# [disabled] ` 前缀(应用自有标记);日志 = `( cmd ) >> ~/Library/Logs/BeCrafter-Launcher/cron/<id>.log 2>&1` 包裹;`readLog` 尾读 256KB/2000 行。`MOCK_DATA.crons/services/brewServices/cronPresets` 已从生成脚本剔除,预设迁至 `lib/cron-presets.ts`。
13. Cron 卡片/编辑预览/新建模态新增「下次执行」行(`shared/cron-next-run.ts`,vixie 语义含 dom/dow OR;U5 增强项)。
14. 新增 Cron 文件头面板(设计文档要求,开源有 demo 无):编辑首个任务前的注释/env 块,保存仅替换该区块。
15. `cron.log.retainHint` 换用动态 {D} 键(demo 冻结文案写死 3 天);`@daily` 等特殊入口新增专用描述文案(修复 demo 解析器只认 5 字段导致的「表达式格式错误」回退)。
16. 端口服务新增:重启按钮、Docker 分组与过滤 chip(fa-box 代 logo)、容器 start/stop/restart;TagChip 文字保持 3 桶,细分 kind(python/php/jvm/ruby/docker/dev)进 tooltip。
17. Topbar 刷新/重新扫描/监听状态真实接线(demo/迁移版此前仅 toast);Open = 系统浏览器打开 `http://127.0.0.1:<port>`,Copy = 真实剪贴板;**轮询仅服务页激活时进行**(离开停扫,角标用最近一次)。
18. 侧边栏 cron/services 计数角标(阶段 1 追加项提前落地两项;内联样式,无新 CSS)。
19. 提权真实化:osascript `with administrator privileges`(密码仅进系统原生框,应用不接触);`authCacheMin` 诚实语义 = 应用侧说明窗的免打扰窗口(与 macOS 约 5 分钟系统授权缓存对齐,弹不弹由系统决定);取消 `(-128)` → toast;`/etc` 下**新建**文件受 SIP 限制即使 root 也被拒(本机实测 EPERM)——系统级任务仅在 /etc/crontab 已存在时可用,读取不受限,文件头面板已显示诚实提示。
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
