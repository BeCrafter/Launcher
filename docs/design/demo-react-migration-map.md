# Demo ↔ React 迁移对照表

> 本文档是 demo 原型 → React 应用迁移的逐项比对记录。后续调整任一侧时,按此表逐项核对行为与视觉。
> **冻结基线**:demo 基线 commit `da1e34a`(logo 基线 `06ff9ba`);demo 目录自此不再改动。
> **冻结例外(2026-09-13,用户明确要求)**:demo「AI 助手」页整体重设计为对话式 Agent 页(`index.html #view-ai` / `css/ai.css` / `js/ai.js` / `data.js aiChats+aiScenes` / `config.js MODULES.ai` / i18n `ai.*` 重写),其余页面继续冻结;逐项说明见文末「AI 对话页重设计」。
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
| `index.html` L19-62 侧边栏 | `layout/Sidebar.tsx` | 🔶 | AI 入口不迁移(demo 侧 AI 页已于 2026-09-13 重设计为对话页,React 迁移仍推迟);Logo 用 v2 双主题组件(等效 logo-dark/light img 对);nav 图标 crontab 为 fa-regular(硬编码保留) |
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
| ai / login / plist / design | ❌ | AI 未迁移(demo 侧已重设计为对话式 Agent,见文末;React 落点属阶段 4);login 为设置页 login pane;plist/design 静态说明页 |

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
| 卡片 | svc-col-card(PID/addr:port/proto/uptime chips) | `components/cards/SvcCard.tsx` | 🔶(差异 22:地址标签改可连接 host:port,恒量 `proto` 不再渲染) |
| kill | 危险确认 → 真实终止(SIGTERM→5s→SIGKILL;他人进程 EPERM→提权引导);新增重启/容器启停 | ServicesView.onKill/onRestart | 🔶(差异 16) |
| 搜索 | demo searchHandler 仅 toast | 已接线(name/cmd/command/port/addr + 别名 + 生效 host 过滤,差异 17/22) | 🔶 |
| 服务重命名 / Host / 路径 | demo 无(对应开源 `ServiceNameStore` 的重命名机制) | `lib/svc-override.ts` + `overlays/SvcConfigMenu.tsx` + `shared/settings.ts` 的 `serviceOverrides` | 🔶(差异 22) |

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

33. **非任务 plist 兼容 + 写入覆盖守卫(2026-09-11,用户要求)**:本机 `~/Library/LaunchAgents/com.google.keystone.{agent,xpcservice}.plist` 是 Google 写入的合法 plist(181B,内容仅 `<dict/>`),但**无 Label** —— `Label` 是 launchd 对任务的硬性要求(Apple: "This required key uniquely identifies the job"),launchd 自己忽略这类文件,此前我们却归入 `invalid` 横幅并把内部英文串 `missing string Label` 当原因露出(中文界面里的英文很易被误认成假数据)。现改为:**合法 plist 但缺 Label → 静默跳过**(`plist-service.readFile` 返回 null;既不计入 agents 也不计入 invalid;`read()` 公开入口仍视为不可读)。⚠ 与开源 `PlistService`(同一情形归 `invalid`,`parsePlist` 返回 nil)的**有意差异**——已按用户要求选择更贴近 launchd 语义。**配套覆盖守卫**(静默跳过使这些文件从 UI 消失、但文件仍在磁盘上,新建同名任务时 `write` 会原子覆盖):`assertOverwritable` —— 目标已存在时仅允许覆盖「非任务占位(缺 Label)」或「同名任务自身」,其余(他人任务、已存在但无法解析)一律拒绝并给出可读原因,避免新建/改名静默清掉别人的任务。5 项单测覆盖;实机验证 invalid 横幅 0 行、agents 仍 30 条、系统真实文件未改动。**⚠ 本条的「静默跳过」决策已被第 37 条推翻**(用户复审:文件在磁盘上存在却不出现在 UI 里,会产生「文件不存在」与「被过滤」的歧义,且可能连任务一起丢掉)。覆盖守卫本身保留,判定条件见第 37 条。

34. **「已停用 → 卸载 → 加载」死循环修复 + disabled 分域(2026-09-12,用户报告)**:launchd 的 `disable` 是**独立于加载状态的持久覆盖位**(man launchctl:"Once a service is disabled, it cannot be loaded in the specified domain until it is once again enabled";跨重启持久),但 demo 的 ops-bar 状态表把 enable 与 loaded 绑定(`btnEnable.disabled = !s.loaded`;mock 时代 `load` 永远"成功",该假设从未被检验),移植后形成**死循环**:加载必失败(disabled 挡 bootstrap)、启用被前端拦截(`drawer-store` 的 `!loaded → toast.loadFirst`,而 loadFirst 建议的「先加载」恰是不可能的事)、立即运行被拦——三个按钮无一可用,且状态 chip 显示「未加载」掩盖了「已停用」事实(卡片「已禁用」chip 的 tooltip 还在指引用户去点抽屉「启用」)。修复:**① main 侧加载自愈** `loadWithSelfHeal`(disabledFor 命中 → 先 enable 再 bootstrap),`ops('load')` 与 `toggle` 未加载分支共用;**② renderer 状态表判定顺序改为先 `!enabled` 后 `!loaded`**(停用态不再被掩盖;enable 文案只看 `enabled`,与 loaded 正交;enableDisabled 非草稿恒 false);**③ 删除 enable 的 `!loaded` 前置拦截**,加载自愈发生时追加 toast 提示(新 EXTRA 键 `toast.selfHealEnabled`,明示「停用是持久状态」);**④ disabled 覆盖位按域分列**(`{gui, system}` 两集合,原先合并会让 system 域的停用误染用户级同名 agent;域映射 = `tableFor`/`domainOf` 同款:仅 daemon 属 system 域)。**⚠ 本条的第①③两点已被第 35 条的显式两步模型取代**(自愈决策经用户复审后撤销)。

35. **操作两轴模型定稿:载入/停止/移除 · 启用/停用 · 立即运行(2026-09-12,用户主导设计)**:launchd 管理是**两个正交轴 + 一条依赖**——域成员(`bootstrap`/`bootout`,仅本会话)× 默认加载(`enable`/`disable`,跨重启持久,存外部覆盖位;plist 的 `Disabled` 键只是默认值),唯一依赖 = **disable 阻塞 bootstrap**(顺序必须 enable→bootstrap);`bootstrap` ≠ 运行(注册后由 RunAtLoad/StartInterval/KeepAlive 等触发条件或 kickstart 决定),故按钮弃用「加载/卸载」改用开源同款「**载入/移除**」。**域成员按钮为上下文标签**(同一按钮):未载入→**载入** / 已载入运行中→**停止**(kill→轮询→SIGKILL→bootout,复用 toggle 优雅路径) / 已载入未运行→**移除**(仅 bootout)。**停用为严格语义(用户拍板)**:只改标志位、不停本次进程 → 新增显式双态 chip「运行中 · 已停用」(`drawer.state.runningDisabled`)。**顺序规则仅一条**:停用时「载入」置灰 + 提示(`drawer.hint.enableFirst`),即**显式两步**(启用→载入);上一轮的隐式自愈已删除(main `register` 守卫:停用/已载入均抛可读错误)。**立即运行**仅「已载入且未运行」可用(运行中 kickstart 无意义、未载入必失败);「立即运行/停止」不设独立按钮(停止由域成员按钮承担;KeepAlive 任务单独 kill 会被拉起)。**卡片对齐**:主按钮同款上下文标签(running→停止/loaded→立即运行/stopped→载入,停用且未载入时禁用+提示);`toggle` 链路补提权(system/daemon 此前必然权限失败);toast 去裸英文;**新增根级「更多」浮层菜单(应用新增 UI,超出 demo 冻结基线)**——启用/停用快捷入口(定点定位、Esc/外点关闭;⚠ 卡片内不可做下拉:`.agent-col-card` overflow:hidden + hover transform 会裁剪并错位 fixed 定位)。main 侧 `register`/`unregister` 内部函数收敛 toggle 与 ops(卡片与抽屉行为一致;`ops('unload')` 自适应:运行中先优雅停止)。E2E 全流程实测:载入→运行中→停用(**PID 不变**,严格语义)→停用态载入被守卫拒绝(可读报错)→启用解禁→停止(pid 空、launchctl.list=0)→抽屉 (T,F,T) 态 chip/按钮正确→更多菜单停用生效。**实测 launchctl 怪癖(排障须知)**:① disabled 服务的 bootstrap 报 `5: Input/output error`(与「未加载」的 bootout 报错同文案);② 只有 Label 无 Program/ProgramArguments 的 plist bootstrap 同样报 error 5(launchd 拒载无可执行体的任务,plutil -lint 仍 OK);③ ops 动作后 `print-disabled`/`launchctl.list` 有 ~2s 传播延迟;④ 测试清理后 override 库残留 `=> enabled` 中性条目(SIP 不可手删,无害)。

36. **Agent 操作交互定稿:意图层(2026-09-12,用户主导设计)**:前两轮都在 launchctl 的**概念层**打转(①「两轴模型 + 上下文标签」②「三个恒定开关」),用户实测后反馈「仍然偏技术维度、不容易让人意识到」。**判断:三个维度(域成员 `bootstrap`/`bootout` · 默认加载 `enable`/`disable` · 运行 `kickstart`/`kill`)是 launchd 的模型,不是用户的模型**;同类先例 = `brew services` 只有 `start`/`stop`/`run` 三个动词,登记与顺序由 brew 自己处理。**定稿:界面只留三个控件**——`启动/停止`(主)· `重启` · `开机自启`(开关);顺序逻辑**下沉到 main 的意图动作**(`start`/`stop`/`restart`/`enable`/`disable`/`runOnce`),UI 不再拼命令序列,**因此界面上不存在「因顺序而置灰」的按钮**——「必须先载入才能运行」这条约束对用户不可见。意图→命令映射:`启动` = `enable`(如需)→ `bootstrap`(如需)→ `kickstart`(如需);`停止` = 纯 `bootout`(不做 kill 前置;移出域即终止进程且不会被 KeepAlive 拉起);`重启` = 运行中 `kickstart -k` / 未载入走启动序列;`开机自启` = `enable`/`disable`(**只改覆盖位,不动当前运行状态**);`立即执行一次` 初版为「确保已载入后 kickstart」,但**实测四种状态下分别与「启动」完全重复 / 拒绝 / 无效果**(launchd 的 `disable` 阻塞载入,使『自启关闭时单独跑一次』无法实现)→ **用户确认后移除**(端到端:UI 按钮、卡片菜单项、IPC 联合类型、main 意图、i18n 键)。**联动表达**:状态 chip 用人话(`运行中`/`待运行`/`已停止`/`未保存草稿`)+ **未来时句**(「下次登录将自动启动」/「下次登录不再自动启动」/「等待触发条件,满足时会自动执行」);唯一真正矛盾的决定用**二选一询问**(停止一个开机自启的任务时 → 新增 `lib/choice.ts` + `ChoiceModal` 浮层:`[仅停止本次]`/`[停止并关闭自启]`)。**启动的连带副作用**:在已停用任务上启动会连开「开机自启」(launchd:`disable` 阻塞 `bootstrap`),以开关可见翻转 + toast 明示,不用报错表达。**配套收敛**:删除 `agents:toggle` 链路(卡片改用意图动作,消除历史上「两条停止路径语义不同」的漂移);提权/询问/toast 收敛到 `lib/agent-ops.ts`(抽屉与卡片共用一份,避免两处漂移——上一轮就是这么出的问题);「更多」菜单 = 开机自启项(**仅此一项**;菜单是卡片侧二级动作的落点,后续可扩展)。**布局与宽度(同日跟进)**:抽屉头部实测溢出 15px(scrollWidth 614 > clientWidth 599)、标题容器被 `flex-shrink:0` 的右侧组压成 0 宽 → **状态 chip 与 Agent 名称重叠**、关闭按钮被推出抽屉右边界裁掉。改法:未来时句从右侧移到**标题区第三行**(与 scope 副标题同族)+ 标题区 `min-width:0` 与省略号 + **抽屉 600 → 860px**(`app-chrome.css` 覆写,demo 基线为 600)。修后实测:头部无溢出(859=859)、五段控件**零重叠**、关闭按钮归位。**launchd 实测怪癖**:`kickstart -k` 的重启是异步的,且**频繁重启会被节流**——实测「从停用状态刚启动完就重启」会出现数秒的「已载入未运行」窗口,期间 `launchctl print` 甚至报"服务找不到";故渲染层在重启后做**非阻塞轮询刷新**(拿不到运行中即重试,最多 ~6s),避免 UI 停在「待运行」。前两轮方案均被本轮取代:①的「上下文标签」= 一个命令两个名字 + `kill` 无独立入口;②的「三恒定开关」= 换了名字的同一套技术概念。

37. **非任务/异常 plist 改为「列表内可见 + 置灰 + 可编辑」(2026-09-13,用户要求;推翻第 33 条的静默跳过)**:用户提出三点——① 静默跳过**可能连真任务一起丢掉**(`typeof value.Label === 'string'` 守卫会把非字符串 `Label`、以及 dict 子节点错位导致 `Label` 解析失败的文件一并压成空串,当成"非任务"吞掉);② 文件存在却不在列表里 → 无法区分「文件不存在」与「被过滤」;③ 这类文件此前连**删除**都做不到(`findAgent` 查不到 → `remove` 静默 no-op),只能去终端。**定稿:管理目录里每个 `.plist` 都要在列表里有一行**,分三类 —— 真实任务(原样式)/ **非任务文件**(灰显)/ **无法解析**(灰显 + 原因);后两类可点铅笔编辑、可删除,但**不可启停**。三个用户决策:**(a) 混在各自作用域分组内**(不是另立分组;最能体现"这个文件就在这个目录里");**(b) 两类一起做**,损坏 plist 从红色 invalid 横幅挪进列表行,编辑走 **XML 修复模式**——这正是 `refactor-plan.md:110`/`refactor-gap-analysis.md:37` 已登记未实施的缺口「无法编辑无效 plist」;**(c) 编辑后保存 = 原地重写、保留原文件名**。

    **实现要点**:
    - **统一记录模型**:`readFile` 不再返回 `null`、不再抛错 —— 每个文件恰好一条记录(`PlistFile` 加 `isTask` / `parseError`);`ScanResult` 从 `{valid, invalid}` 收敛为 `PlistFile[]`,**`InvalidPlist` 类型与 `removeInvalid` IPC 端到端移除**(横幅被行取代,不做兼容残留,同 `runOnce` 的处理)。合法 plist 缺 Label(含非字符串)→ `isTask:false`;解析/`plutil -convert` 失败 → `isTask:false + parseError`(保留原文供 XML 修复;二进制不可读时给空串)。
    - **身份方案(本改动的关键,也是修掉的真 bug)**:id 由 `<scope>:<label>` 扩展出 `<scope>:file:<fileName>`;`findAgent` 改为 `idFor(pf) === id` 比较。此前所有非任务文件的 `label` 都是空串 → 同作用域**多个占位会撞成同一个 id,编辑其中一个会打开第一个文件**。`file:` 前缀不会被 launchd Label 撞上(`:` 是 launchd 自己的域/job 分隔符),`parseAgentId` 同时拒绝 `file:` 前缀防草稿占用该命名空间。
    - **保存语义(数据丢失防线)**:`save()` 原逻辑在路径变化时是「写新文件 + `remove` 原文件」,照直走会把用户的占位文件**删掉**(那是第三方文件,不是本应用创建的)。现:非任务走 `plists.writeAt`(无守卫的原子写)**原地重写** + 要求填 Label(空 Label 保存被前端拦下并 toast)+ `assertLabelFree` 防同目录重名(原地路径没有"目标已存在"这层天然保护)。`saveXml` 对非任务/损坏文件同样走 `writeAt`(守卫会对损坏目标一律拒绝,修复否则无从进行)。
    - **覆盖守卫保持原判**:`assertOverwritable` 改为 `!existing.isTask && !existing.parseError` 才放行占位。⚠ 不能只判 `!isTask` —— 损坏文件的 `isTask` 也是 false,那样会让新建/改名**静默覆盖别人的坏 plist**。单测专门覆盖这一条。
    - **渲染**:复用 `AgentCard`(L0 原语不变),根 class 加 `not-task` / `broken`,状态点换成「非任务文件」/「无法解析」chip(不谎报 running/loaded/stopped),启停与「更多」禁用、**铅笔保持可用**;CSS 只新增在 `app-chrome.css`,**只对内容区降透明度、不给 `.acc-actions` 加 opacity**(否则铅笔看起来像禁用,与"可编辑"直接冲突);并补 `.act-btn:disabled` 与 `.toggle:has(input:disabled)` 的禁用观感。抽屉:非任务走**正常表单**(空 Label,填上即变任务)+ 顶部提示条;损坏文件 `form` **显式置空**(否则 `formFromPlist({})` 会"成功地"给出一张空表单,保存只会把损坏文件写成另一坨垃圾)并直接落到 **XML tab**,表单 tab 只留「说明 + 删除」。`openFor` 的三个读调用各自 `.catch(() => null)`(任一 reject 会让抽屉静默不开)。
    - **计数**:置灰行**计入 `total`**(总数与可见行数不一致会原样复现"看不见但存在"的歧义),`running` 天然排除。搜索谓词补 `fileName`(否则一输入搜索词,占位行又会消失)。
    - **i18n**:7 个新键(`agent.notTask` / `agent.notTask.title` / `agent.broken` / `agent.broken.title` / `agents.notTask.hint` / `agents.notTask.labelRequired` / `agents.broken.reason`)经 `scripts/port-demo-i18n.mjs` 的 `EXTRA` 加入。⚠ 重新生成全量字典会一并带出 demo 侧已改、renderer 字典尚未跟上的 `ai.*` 新键(AI 对话页尚未迁到 renderer)—— 故本次按 EXTRA 的顺序**定点插入**两份字典,并已用「生成到临时目录再 diff」验证与生成器输出逐字节一致,后续重跑不会漂移。
    - **与 demo 基线的有意分歧**:demo 的 invalid 横幅(红底 + 路径 + 原因 + 删除)在 renderer 被列表行取代;`AgentsView.tsx:144` 原有的 `filter === 'all' || filter === 'user'` 门控(导致 system/daemon 的坏 plist 从不显示)随之消失。
    - **验证**:单测 263 项全绿(plist-service 14 项含「非字符串 Label 不再被吞」「损坏文件产记录不抛错」「write 仍拒绝覆盖损坏目标」「writeAt 可原地修复」;agent-service 新增 8 项含「同作用域两个非任务 id 不同」「save 只写原路径且从不 remove」「ops 零 launchctl 调用」);`npm run typecheck` 通过;CDP E2E 30/30 通过(占位置灰/动作禁用/铅笔可用、空 Label 拦截、填 Label 保存后**磁盘上原文件名不变而内容带新 Label 且未另建文件**、损坏文件抽屉落 XML tab、XML 修复后成为正常任务、非任务文件可删除),真实 keystone 文件开工前后 shasum 逐字节一致、测试文件全部清理。

38. **孤儿横幅与置灰行互补**:`missingPlists`(launchd 已加载但 plist 已不存在)保留原样 —— 它管的是「文件没了」,第 37 条管的是「文件在但不是任务」,两者合起来才覆盖"看到的和磁盘上的不一致"的全部情形;`agents-store.load()` 的孤儿复核候选构建跳过非任务条目(空 label 是噪声)。

## 阶段 2/3 落地差异(2026-09-11 定时任务/端口服务真实后端)

12. Cron 数据源真实化(mock 移除);卡片 hover 日志路径 = 后端 `job.logPath`;desc 来自**紧邻上方注释行**(通用约定);禁用 = `# [disabled] ` 前缀(应用自有标记);日志 = `( cmd ) >> ~/Library/Logs/BeCrafter-Launcher/cron/<id>.log 2>&1` 包裹;`readLog` 尾读 256KB/2000 行。`MOCK_DATA.crons/services/brewServices/cronPresets` 已从生成脚本剔除,预设迁至 `lib/cron-presets.ts`。
13. Cron 卡片/编辑预览/新建模态新增「下次执行」行(`shared/cron-next-run.ts`,vixie 语义含 dom/dow OR;U5 增强项)。
14. 新增 Cron 文件头面板(设计文档要求,开源有 demo 无):编辑首个任务前的注释/env 块,保存仅替换该区块。
15. `cron.log.retainHint` 换用动态 {D} 键(demo 冻结文案写死 3 天);`@daily` 等特殊入口新增专用描述文案(修复 demo 解析器只认 5 字段导致的「表达式格式错误」回退)。
16. 端口服务新增:重启按钮、Docker 分组与过滤 chip(fa-box 代 logo)、容器 start/stop/restart;TagChip 文字保持 3 桶,细分 kind(python/php/jvm/ruby/docker/dev)进 tooltip。**2026-09-17 修四处**:①`filterServices` 此前无 docker 分支 → 点 Docker chip 实际不过滤(已补);②`docker` 此前以裸命令 spawn,Finder/Dock 启动的 app PATH 精简必 ENOENT(本机实测 docker 只存在于 `/Applications/Docker.app/Contents/Resources/bin/`,且 `/usr/local/bin/docker` 无软链)→ 新增 `main/services/docker-path.ts`(镜像 `brew-path.ts` 的可注入 `exists` 形状);③`docker ps` 此前吃默认 `cmdTimeout`(5s),冷启动超时被 SIGTERM → `code: null` → 被 `isDockerUnavailable` 静默吞成「不可用」→ 显式 12s(**注意 `scanOnce` 在跑 lsof 之前 await 它,故该超时是整张端口列表刷新的下限,不是纯 docker 预算**);④Docker 不可用不再整组静默消失,改为带原因提示条(`dockerUnavailableReason` 区分 cli-missing / daemon-down / timeout —— daemon-down 复用了此前从未被消费的死键 `svc.dockerUnavailable`)。**仍未修**:无法识别的 docker 非零退出会报 `available: true` 且零容器,仍表现为「没有容器」而不给提示。
17. Topbar 刷新/重新扫描/监听状态真实接线(demo/迁移版此前仅 toast);**Open/Copy 使用完整 URL `http://{host}:{port}{path}`**(host 由 lsof 绑定地址推导、可被覆写;路径来自服务覆写)—— 2026-09-17 前 Copy 只把端口号写进剪贴板、toast 却写「已复制 localhost:{P}」,Open 硬编码 `127.0.0.1` 且不带路径;toast 改用新键 `toast.svcUrlOpening`/`toast.svcUrlCopied`(demo 冻结键 `toast.openingPort`/`toast.copiedPort` 保留为不再消费的镜像,同已知差异 #11);**轮询仅服务页激活时进行**(离开停扫,已有数据冻结保留)。
18. 侧边栏计数角标:阶段 2/3 曾提前落地 cron/services 两项(内联样式),**2026-09-11 按用户要求移除**——侧边栏恢复 demo 基线(仅图标+文字);refactor-plan 阶段 1 追加的「counts badge」仍为待办,需要时再评估。
19. 提权真实化:osascript `with administrator privileges`(密码仅进系统原生框,应用不接触);`authCacheMin` 诚实语义 = 应用侧说明窗的免打扰窗口(与 macOS 约 5 分钟系统授权缓存对齐,弹不弹由系统决定);取消 `(-128)` → toast;`/etc` 下**新建**文件受 SIP 限制即使 root 也被拒(本机实测 EPERM)——系统级任务仅在 /etc/crontab 已存在时可用,读取不受限。**入口前置拦截(2026-09-11)**:`headers.system.exists === false` 时新建模态的「系统级」选项置灰 + 说明(`cron.systemUnavailable`),文件头面板的系统级保存按钮置灰——避免「填完整张表单点保存才报 ELEVATION_FAILED」;用户级不受限(`crontab -` 会建表,仅实测无 crontab 时也可写)。
20. next-run 预测落位 `src/shared/`(而非 main/domains):渲染层实时预览需本地计算。
21. **crontab 命令字段的 `%` 转义修复(2026-09-13,用户报告「配了日志路径但日志无内容」)**:根因是 **crontab 的 `%` 语义** —— `man 5 crontab`:命令字段里**未转义的 `%` 会被 cron 变成换行,其后所有内容作为命令的 stdin**。此前写回时未转义,于是 `date +"%Y-%m-%d %H:%M:%S"` 这类命令被腰斩为 `date +"`(语法错误),**重定向与剩余部分都变成 stdin → 任务每分钟静默失败、日志文件永不创建**(实测:同一命令不转义时文件根本不生成,转义后正常落盘)。修法:`domains/crontab.ts` 新增 `escapePercent`/`unescapePercent` —— `renderJobLine` 写回时把**整个命令字段(含日志重定向)**的 `%` 转义为 `\%`;`parseJobLine` 解析时还原,保证「读入 → 编辑 → 写回」往返稳定(4 项单测:转义渲染、解析还原、往返字节一致、历史未转义行仍可解析且写回即修正)。**注意**:修复只在**写回**时生效,已存在于 crontab 里的历史未转义行需要**在应用内重新保存一次**才会被修正。诊断路径可复用:①`crontab -l | cat -e` 看行尾/字节 ②隔离探针(加一条写 `/tmp` 的任务)确认 cron 是否执行用户任务 ③对照实验定位差异项(此处即 `%`)。
22. **端口服务覆写:别名 / Host / 路径(2026-09-17)** —— 解禁 `refactor-plan.md` 阶段 3 中「经用户确认跳过」的**重命名**项(「生成 LA 草稿」仍跳过)。
    - **存储**:`LauncherSettings.serviceOverrides: Record<identityKey, { alias?, host?, path? }>`,落在 `${HOME}/.config/launcher/config.json`。**偏离开源**:开源用 UserDefaults(`ServiceNameStore`),我们复用 settings 通道 —— 因 `SettingsPatch = Partial<LauncherSettings>` 且 `store.save()` 自带浅合并 + normalize + 原子写 + 广播,故**无需新 IPC / preload 方法 / 仓储方法 / applier**(applier 只注册有副作用的域,无副作用的键不需要)。
    - **身份键**(`lib/svc-override.ts`):容器 `<port>:docker:<容器名小写>`;进程 `<port>:<lsof c 字段小写>`。与开源 `ServiceNameStore.identityKey` 一致(同为「端口 + 小写可执行名」,容器也含端口)。**刻意不用 `PortService.id`**(=`<pid>:<port>`,进程重启即变 —— 开源注释原文即 "stable across PID changes")。lsof 的 `c` 字段实测最长 31 字符(32 字节缓冲)会截断,同前缀长命令名理论上碰撞(概率极低);`command` 为空时回退 `cmd`,统一截到 64 字符以保证整键低于键长上限。
    - **生命周期**:进程重启(PID 变)/ 容器重启 → 键不变 → 覆写保留;端口漂移或同端口换程序 → 键变 → 不再匹配,旧条目成孤儿**留在文件里不清理**(开源同样不清理;服务用回原端口 + 原程序时自动复用)。改名走开源同款细节:输入等于自动名时不写条目,直接清空。
    - **上限**:128 条 + 字段长度上限(alias 40 / host 64 / path 160)。理由:设置经 `additionalArguments` 注入每个新窗口 argv 且每次 `save()` 全量 normalize,无上限时损坏文件可撑大启动参数(典型用量约 12KB)。**满则拒绝写入并 toast**(`svc.overrideLimit`),不做静默截断。`normalizeServiceOverrides` 显式跳过 `__proto__` 键防原型污染,并有对应单测。
    - **UI**:双击卡片名称就地改名(Enter 提交 / Esc 取消 / 空串清除);新增「配置」按钮开根级浮层(`overlays/SvcConfigMenu.tsx`,复用 `.agent-card-menu` 外壳样式)编辑三项,placeholder 即自动值,「恢复默认」整条删除。卡片地址标签由 `*:8080 TCP` 改为可连接 `127.0.0.1:8080`(恒为 "TCP" 的 `proto` 段不再渲染;悬停显示完整 URL,路径不上卡片)。搜索新增**别名**与**生效 host** 两个维度(原名/命令行/端口仍全部保留)。
    - **本轮搁置**(理由见下):HTTP/TCP 应用层协议判定与 TCP 的 nc 呈现(现有 `proto` 是恒量,去掉即可,已随本项落地);**用 launchd `Label` 作键**(判据被实测推翻 —— macOS 把每个 GUI 应用都注册成 launchd job,`PID ∈ launchctl list` 抓到的是 Chrome / Spotify / ControlCenter,而真正的 `./sail serve webdav`、hermes agent 反而不在其中,按它 gate 会正好反了);「从进程创建 LaunchAgent」(开源有 `LaunchAgentDraft.from(service:)` + 行内按钮,但它是「让服务常驻」的能力,需杀进程后再 bootstrap,且**环境不可复现** —— macOS 读不到别的进程的环境变量);「只看开发服务」过滤器(开源 `DevServiceFilter`:dev 端口白名单 + 系统进程黑名单,治的是噪音问题 —— 本机 32 条监听里大半是 GUI 应用的 IPC 端口);「谁能改名」的门槛(结论:**不设门槛**,任何自动判据都会猜错)。

23. **cron 日志改为「按小时分段」——让清理真正生效(2026-09-13,用户提出方案)**:用户提问「日志是单文件、没有按时间切分,那清理是怎么做的」→ 排查发现**既有清理只对「沉默的」任务有效**:清理规则是「按 mtime 整文件删除」,而活跃任务的单文件每次执行都被追加、mtime 永远新鲜 → `mtime < N 天前` 永不成立 → **永不清理、无限增长**。用户提出「把时间放进重定向目标」→ 实测可行,故采用:**重定向目标改为日期模板** `( cmd ) >> <目录>/<id>-$(date +\%Y\%m\%d\%H).log 2>&1`(函数 `cronLogTemplate`),cron 先还原 `\%`→`%`、再由 shell 展开为 `YYYYMMDDHH` → **每小时一段**;每段在小时结束后停止写入 → mtime 变旧 → **既有的 mtime 清理规则对所有任务生效**(实测:伪造 5 天前的旧段 + 触发清理 → 旧段被删、当前活跃段存活)。粒度选**按小时**(用户选;每任务每天 ≤24 段,3 天保留 ≤72 段)。配套:`logTemplate` 标记(模板态 `logPath` 由后端解析);`readLog` 改为**跨段按时间累积**(受既有 256KB 预算约束,跨小时/跨天不丢连续性);`list()` 把模板态 `logPath` 解析为该任务**最新非空段**(供抽屉显示/复制/访达揭示);**旧式 `<id>.log` 不迁移、新老共存**(读取/清理都覆盖,`matchCronLogFile` 同时匹配两种形态)。**实现中踩到两个坑(已记)**:①`unwrapLogCmd` 原用 `(\S+)` 抓路径,而模板里 `date +%Y…` **含空格** → 抓不全导致模板行不被识别;放宽为 `(.+?)` 并由「必须落在本应用日志目录内」兜底。②`matchCronLogFile` 误用 `\d{8}` 而 `%Y%m%d%H` 是 **10 位** → 读日志恒为空;已修并补 `src/shared/cron-log.test.ts`(含重复 id `-N` 后缀互不串的用例)。

    **2026-09-16 追加:分段在 UI 里可见 + 旧式任务的出路(用户报「现在看还是一整份日志」)**。排查结论:**分段在磁盘上一直生效**(实测 crontab 两条任务均已是模板形态、日志目录每小时一段),卡住的是「看不见」和「没有出路」两处 ——
    - **看不见**:`resolveLogPaths` 只回一个路径,卡片与抽屉都只渲染这一个字符串;而 `readLog` 把该 id 的**所有**匹配文件(含迁移前的整份 `<id>.log`)累积成一条平铺流 → 打开抽屉看到「90KB 老日志 + 新内容」连成一片,与分段前视觉无差别。
    - **没有出路**:`parseJobLine` 有意保留历史旧式行,而**只有 `create()`/`update()` 会写成模板**、`list()` 是纯读 → 从没重新保存过的任务永远停在旧式;且旧式整份文件因每次执行都在追加、mtime 永远新鲜 → **永远不被清理**(正是分段要解决的那个问题),UI 上也没有任何提示。
    - **改法(用户提方案,优于最初设想的"分隔线")**:日志抽屉改为**左栏分段文件列表 + 右栏选中段正文** —— 每行 = 一个文件(人类可读小时区间 + 文件名 title + 大小 + 逐段删除按钮),「历史单文件」单独标注、「当前段」只标真正的分段文件;页脚「清理过期段」按钮复用既有 `cleanupLogsInternal`(现返回删除数量供 toast)。**左栏可折叠**(2026-09-16 追加,用户要求「给日志留更多空间、折叠后尽量简洁」):照搬 demo 会话栏(`.ai-rail.collapsed` + `.ai-rail-expand`)的形态 —— 折叠即整栏 `display:none`、内容区左上角浮出 24px 的 `»` 小钮;偏好存 localStorage(`launcherCronLogListCollapsed`,与 `launcherAiRailCollapsed` 同款,属 UI chrome 不进设置文件);折叠时页脚「共 N 段」仍在,信息不丢。实测折叠后正文宽 615 → 825px。**`readLog` 随之从「跨段累积」改为「只读一个段」**(`name` 省略 → 最新非空段;跨小时改由列表切换)——一屏只读一段,顺带消掉「72 段 × 2000 行 = 十几万行对象进渲染层」的隐患。`listLogs` 供列表,`deleteLog` 只接受属于该任务的文件名(正则不含 `/`,天然无目录穿越;已不存在按成功处理)。
    - **旧式任务不再只是「不迁移」**:卡片出现「未分段」告警(与 %-告警同款样式,条件 `job.log && !job.logTemplate && job.enabled` —— 未启用不提示:文件不增长、且启用本身就会重写该行),点击 = 空补丁 `update` 重写该行为模板 + toast 明示「旧的整份保留到过期」。⚠ 迁移瞬间**显示的路径不会变**(当前小时的新段要等下次执行),没有 toast 会被当成"点了没反应"。`resolveLogPaths` 补 `segmentCount`(不含历史整份)并**优先指向分段文件**,刚迁移完才回落到整份。抽屉无轮询 → 删除/清理/迁移后主动 refetch。
    - **验证**:单测 272 全绿(新增 `cronLogSegmentOf`、`listLogs`/`deleteLog`/`cleanupLogs` 计数、`resolveLogPaths` 优先分段与 `segmentCount`、`segmentRangeLabel`);CDP E2E 实测用户真实任务——列表 6 段 + 历史整份、小时区间与「当前段」标记、点行切换正文、逐段删除(磁盘核对只少被删那一个)、清理只删 mtime 超期者(伪造 5 天前文件)、旧式任务告警→点击→crontab 行变回模板 + 告警消失 + toast。⚠ **`/etc/crontab` 在本机不存在且 sudo 需密码 → system 作用域未验证**。

22. **未转义 % 的「可见化 + 一键修复」(2026-09-13,承接上条)**:上条的转义只在**写回**时生效,crontab 里**已存在**的手写/历史未转义 `%` 仍会静默失败(实测用户两条任务静默失败近两天、日志目录全空)。改为「**让失败可见**」:`domains/crontab.ts` 新增 `hasUnescapedPercent`(按 crontab 词法精确判定 —— `%` 前连续反斜杠**偶数即未转义**;`\%` 已转义、`\\%` 仍未转义),仅对**已启用**任务置 `CronJob.percentUnescaped`(停用任务在启用时会经 `renderJobLine` 自动修正,故不告警);卡片命令旁出现黄色警示按钮,tooltip 讲清 cron 会截断命令,**点击即修**(store 新增 `repairEscaping` → 空补丁触发 `update` 重写该行,内容身份 (expr,cmd) 未变故 id 稳定)。E2E 用用户真实两条任务验收:告警 chip → 点击修复 → `diff` 确认**只有 `%` → `\%` 变化、其余一字未动** → 等 70s **日志文件首次产生内容**。**同时修复日志正文被吞**:`domains/log-lines.ts` 的 `parseLogText` 原先在剥离行首时间戳后把剩余内容直接当正文,若整行就是时间戳(`date` 类输出)则正文为空串 → 界面正文列全空、**看起来仍像"没有内容"**;现改为「行首时间戳进 ts 列,**正文为空时退回整行**」(ts 仍取行内真实值而非文件 mtime);新增 `log-lines.test.ts`(此前该域无测试)。**已评估并否决的备选方案(勿重复提案)**:把命令写入独立脚本文件、crontab 只调用脚本 —— 虽可让用户文本零进 crontab,但有四项代价:①脚本目录必须另起(`cleanupLogsInternal` 会删除日志目录中**超过保留期的所有文件**、不按扩展名过滤 → 脚本会被清理掉、任务静默失效);②单点事实来源拆两处;③新增脚本文件生命周期;④已有任务需迁移。且命令在界面本就是单行输入,脚本方案额外买到的「多行/复杂引号免疫」当前用不上。

22. **文件头面板暂时隐藏(2026-09-13,用户反馈列表上方不需要该区域)**:`CronView` 不再渲染 `<CronHeaderPanel />`(组件文件与 main 侧 `cron:writeHeader` 能力保留,组件顶部注明「当前未挂载,需要时重新渲染即可恢复」);相应 i18n 键与 IPC 通道保持不动。


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
- `addCronEntryTo` 忽略参数;`ai.js` 部分函数无引用 → 属未迁移域,注明(**2026-09-13 AI 页重写后旧函数整组移除**:`renderAi`/`filterAi`/`handleAiSearch`/`scanAiAgents`/`runWithAgent`/`aiIconBadgeCls`,该条目已消除)。
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
| aiAgents/aiSkills(已生成在 mock) | AI 视图(demo 已改为对话页:`aiAgents` → MCP 接入 modal 数据源;`aiSkills` → 欢迎技能建议卡;新增 `aiChats`/`aiScenes` 场景数据) | 4 |

## 打开慢修复(2026-09-11,机制同源开源 AgentStore/BrewManagedSupport)

首屏数据路径实测(本机 32 plist):文件扫描 31ms / launchctl 全家 ~150ms,唯一慢源是 `brew services list --json`(11-13s,曾观测 >120s;`HOMEBREW_NO_AUTO_UPDATE=1` 无效)——且被 `cmdTimeout: 10000` 第 10 秒 SIGTERM 后 `catch(() => [])` 整体丢弃,白等 10s 且 brew 合从未生效。开源 LaunchManager 的 agents 列表关键路径**零 brew**(`AgentStore.refresh()` = plist + launchctl + print-disabled;isBrew 是 `BrewManagedSupport` 纯字符串启发式;brew 数据在独立 `HomebrewServiceStore` 后台 Task)。本次修复即消除移植偏差:

1. **isBrew 纯启发式**:新增 `main/domains/brew-heuristic.ts`(`isBrewManaged`/`brewFormulaName`:label 前缀 `homebrew.mxcl.` → `/opt|Cellar/<公式>` 路径反推,复用 `matchBrewService` 原有分支);`agent-service.listImpl` 从 `Promise.all` 移除 `brewList()`,`buildAgent` 改用启发式。brew 数据仅在 `brewAction`(用户显式启停)按需拉取。**与开源偏差消除**;本机 4 个 brew plist 的 Label 实测均为 `homebrew.mxcl.*`,渲染层 brew 标签/过滤/按钮路由零变化(消费点只依赖 `agent.isBrew` 布尔值)
2. **brew 调用收尾**:`resolveBrewPath()` 提为 `services/brew-path.ts` 共享(process-discovery 原用裸 `brew`,Finder 启动 PATH 精简会 ENOENT);process-discovery brew TTL 30s → 10min + lastBrewAt 先置位单飞
3. **scanAll 记忆 + 单飞**:`plist-service.scanAll()` 结果记忆 1500ms + 进行中 promise 共享;`write/remove/removeWithBootout` 成功后失效;launchd 目录被应用外修改时 fsevents applier 经 `onDirsChanged → plists.invalidate()` 失效(保证 dirChanged reload 读到新状态)。消除抽屉 4 路并发 IPC 各自全量重扫
4. **首屏骨架态**:新增 L0 原语 `components/ui/Skeleton.tsx`(纯视觉无文案,i18n 字典从冻结 demo 生成不新增键;样式在 app-chrome.css);三域视图 `!loaded && 数据为空` 时渲染骨架替代 EmptyState(加载中曾被误呈现为「没有数据」)
5. **长命令显式超时**:`log show`(实测 2.8-31.8s 波动,与 `--last` 窗口大小无关)与 brew 全部调用点(list/action、process-discovery)显式 `timeoutMs: 45_000` 覆盖 `cmdTimeout`,修复系统源日志恒空 / brew 启停必超时;`brew.action` 原本也被 10s 杀死

E2E(CDP,dev 模式):warm reload → 首张卡片中位 **879ms**(修复前 ~10s);brew 过滤 30 → 2 张卡片;invalid 横幅/系统日志/toggle/dirChanged 回归通过。已知遗留(非本次引入):`log show --predicate process == <label>` 对真实进程名 ≠ label 的服务拿不到日志(如 com.deepseek.dsh.web),属预置条件表达式口径问题。

## AI 对话页重设计(2026-09-13,冻结例外)

用户判定原 AI 页(「本机 CLI Agent + 技能卡片」目录页)不符合预期,要求重开冻结、整体重设计为**对话式 Agent 页**;引擎形态对齐 `docs/design/ai-capability.md`(pi = `@earendil-works/pi-ai` 流式 + `pi-agent-core` tool calling;用户口径「Phi Agent」= 该 pi 引擎,2026-09-13 已与用户确认)。demo 全 mock,但交互面按 pi 能力设计(流式逐字 / 工具调用步骤可视化 / 写操作授权)。

**布局(用户选定,A/B/C 三案中选 B)**:左侧会话栏(232px,可折叠、<900px 窄屏改覆盖层;localStorage `launcherAiRailCollapsed` 记忆)+ 居中对话列(~720px);工具执行步骤为消息流内**可折叠步骤块**(运行中展开、「执行中 · 已完成 N 步」,完成后自动折叠为「已执行 N 步 · 用时 T」);写操作**授权卡内联**在对话流;底部 composer(引擎 chip / @ 引用 / 发送↔停止切换)。

**逐文件改动**:

| 文件 | 内容 |
|---|---|
| `index.html` | `#view-ai` 旧结构(filter-bar + 计数 span + `#aiList`)整块替换为对话骨架(`.ai-shell` 双栏 + composer);新增 `#aiMcpModal`(MCP 接入);head 增 `css/ai.css` link |
| `css/ai.css` | **新建**(锚点 `.ai-shell`,已加入 check.mjs cssAnchors):rail/欢迎态/消息/步骤块/卡片/授权卡/composer/@ 弹层;全部走主题变量;步骤输出行复用 drawer.css `.log-line` 族;@ 弹层 fixed 挂 body(沿「浮层须挂根部防裁剪」教训);composer 底部预留 50px 避让固定状态栏(同 list-container 64px 同源) |
| `js/ai.js` | **整体重写**(97 行 → ~700 行)。模块级 `chatState`(timers 句柄池/typer/botMi/pendingApprove/afterApprove/runElapsed+runTickStart 计时);入口 `renderAiChat`(语言切换经 switchModule 重入 → `aiAbortRun` + 从 messages 静态重渲染);运行器 `aiStartLive/aiNextStep/aiExecStep/aiTypewriter`(16ms 逐字、字符同步回写消息对象)/`aiStopRun`/`aiAbortRun`(运行中项归一 warn,无残 spinner);授权 `aiApprove`(dangerous→`confirmDangerousAction`→`ELEVATION.request`)→ approved 后**续播 afterApprove 步骤到同一步骤块**;`aiCancelApprove` 追加取消文案并终止;@ 引用(`aiMention*`,按钮/@ 输入双入口,data-* 传参防引号注入);MCP modal(`aiOpenMcpModal/aiRenderMcpModal/aiCopyMcpCmd/aiToggleMcpPerm`);**旧函数整组移除**(renderAi/filterAi/handleAiSearch/scanAiAgents/runWithAgent/aiIconBadgeCls) |
| `js/data.js` | 新增 `aiChats`(4 条预置已完成会话,静态直出、含 approved 态授权卡)+ `aiScenes`(6 个场景时间线:health/sk-diag/sk-refactor/sk-import/sk-plist/**fallback**;步骤联合类型 user/think/tool/stream/card/suggest,`res:true` 的行经 `aiResolve` 实时取 `agentData/cronData/svcData` 计数)+ 共享 `AI_PLIST_DRAFT` 常量(定义在 MOCK_DATA 前,场景与预置会话共用)+ 别名 `aiChatData/aiSceneData`;`aiAgents`/`aiSkills` 保留(check.mjs 非空数组硬约束),改作 MCP modal / 欢迎技能卡数据源 |
| `js/config.js` + `js/modules.js` | `MODULES.ai` 重写:顶栏 = [接入 MCP] + [新对话 accent],**去搜索框**(search 字段不配即合法);状态栏 = 引擎 pi 已连接 · 流式就绪 / 只读工具 9 / 写工具 5(需授权)/ 技能 4 / 本会话工具调用 N;`switchModule('ai')` 分支 `renderAi()` → `renderAiChat()` |
| `js/i18n.js` | 删 20 个废弃 `ai.*` 键(searchPh/filter/group/run/scan 等);新增 ~50 键(rail/engine/welcome/input/mention/steps/thinking/suggest/appr/report/plist/cron/stopped/scroll/mcp/sb);`ai.sb.path/monitor` 改值;zh/en 严格成对(585 键) |

**关键行为(已 CDP E2E 全量验证,零 console 报错)**:欢迎态(问候 + 一键体检主卡 + 4 技能卡;技能卡 `data i18n` 名/描述)→ 点卡起新 live 会话(user→think 思考中→tool 步骤逐条+输出行逐条→正文逐字→卡片→建议 chips);写操作授权卡暂停时间轴(**授权等待不计入用时**,计时冻结/恢复)→ 提权 modal(复用零新增 markup)→ approved 续播进同一步骤块;取消 → 「已取消」+ 取消文案 + 终止;任意自由输入 → fallback(概览数字与 mock 实时一致 6/3/4/3/5);运行中发送钮变停止(清定时器/待授权卡置取消/折叠/toast「已停止生成」);预置 4 会话静态直出(cron 卡经 `parseCronExpr` 人话:如 `30 18 * * *` → 「每天 18:30 执行」);@ 引用(过滤 → 选择 → composer chip → 用户气泡内 chip);MCP modal(挂载命令复制/写权限开关 localStorage `launcher_mcpAllowWrite`/本机 CLI Agent 列表);深浅双主题、zh↔en 切换(流式中途切也安全)、900px 断点(rail 收为覆盖层)、rail 折叠跨模块记忆。体检报告卡「前往处理」= `switchModule` 跳对应模块(跳转前 `aiStopRun`)。

**已知遗留(demo 范围,阶段 4 落地时以真实能力替换)**:流式/延时为脚本模拟;MCP 挂载命令为示意(真实 `launcher-mcp` 入口属阶段 4);「在编辑器中打开」= 跳转 agents 模块的演示指代;未配 Key 引导态未建(demo 无设置耦合,阶段 4 随 safeStorage 配置落地);多轮上下文为单轮场景(每次发送起新 live 会话)。

