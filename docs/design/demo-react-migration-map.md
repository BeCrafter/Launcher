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
| ai | ✅ | 2026-09-22 阶段 4 落地(对话页 + 设置页 AI pane);消息模型改内容块数组,**非** demo 的固定槽位 —— 差异见文末「AI 助手页迁移」 |
| login / plist / design | ❌ | login 为设置页 login pane;plist/design 静态说明页 |

## 视图 1:Launch Agents(`js/agents.js` → `modules/agents/AgentsView.tsx`)

| 项 | 演示行为 | React 落点 | 状态 |
|---|---|---|---|
| 过滤 chips | all/brew/user/system/daemon;brew=!!isBrew;user=scope&&​!isBrew | AgentsView useMemo | ✅ |
| **运行状态筛选**(2026-09-19 应用新增) | demo 无(只有类型筛选) | 过滤栏第二组:全部状态 / 运行中 / 已载入 / 已停止(文案复用卡片状态标签的 `status.*` 键),状态存于 `agents-store.statusFilter`,与类型筛选是「与」关系(如「用户级 + 运行中」);竖线分隔两组;**次级视觉**(`Chip variant='sub'` → `.chip-sub`):不用胶囊形态,改成**方括号包住的纯文本**(`::before`/`::after` 出 `[` `]`,与文字之间吃 `.chip` 的 5px gap),无描边、无底色,选中**只把文字与括号变成 `--accent`**、不变底色 —— 与主 chips 的「描边 + 图标 + 彩底彩字」拉开主次;「已加载但 plist 已不存在」孤儿横幅不属于任何状态分组,仅在状态不限时展示 | 🔶 |
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

39. **表单兼容守卫 + 顶层键原样保留 + KeepAlive 三态 + 数值键「未设置」态(2026-09-18,用户要求)**:起因 = 三轮核验(`man launchd.plist` / launchd 源码 / 上游 Swift 项目逐字段对比)确认三类合规缺口——① **非托管键静默丢失**:`unsupportedKeys` 早在 domain 层算出并传到 renderer,但**零消费**、main 保存也无拦截,含 `Sockets` / `LimitLoadToSessionType` 等键的 plist 表单编辑后保存即丢键;② **KeepAlive 反向条件被改写**:字典里 `Crashed/SuccessfulExit` 的 `false` 是合法反向条件(launchd 源码 `bool ? SUCCESSFUL_EXIT : FAILED_EXIT`,即"失败时重启"),旧解析 `=== true` 把 false 读成「关」并在保存时丢掉该子键;③ **ThrottleInterval「0=不写」语义错**:man 默认 10 秒、0 是合法值,旧实现把「未设置」显示成 0 秒且用户填 0 存不进去。另 `KeepAlive={}` 空字典与「触发卡关掉仍写 dict」两处产物无效。

    **实现要点**:
    - **拦截尺度(用户拍板,基于实测)**:初版「含任何非托管键就锁表单」实测会锁死本机 **19/32 个真实 plist**(Homebrew 自建服务、VirtualBox、podman、ToDesk 等,全因顶层 `AssociatedBundleIdentifiers` / `MachServices` / `LimitLoadToSessionType` 这类**表单从不触碰的键**)。改为两档:**顶层非托管键在保存时按值搬回**(`plistFromForm` 从本次编辑所基于的磁盘字典逐值复制、不修改)+ 编辑页**信息横幅**(「此文件另有 N 个表单未展示的键:{K};保存时原样保留」,不拦保存);**只有「表单拥有父键、保不住」的部分才锁**(KeepAlive 未知子键 / `EnvironmentVariables` 非字符串 / SCI 异常形态)——锁定档仍走**两道拦截**:EditTab 警示横幅 + 「去 XML 编辑」+ 保存禁用(`.d-btn:disabled` 视觉补在 app-chrome.css),main `save()` 写盘前同判据抛可读中文错误,**非任务原地重写路径同样受保护**,`saveXml` 是逃生通道。⚠ **保留边界(整改规范 P1-3)**:这是**值级保留**而非原始文本保留 —— `parsePlistXml→toPlistXml` 会丢 XML 注释、把 `<data>`/`<date>` 降为 string、可能规范化 integer/real 表示;因此上文的「原样保留」应读作「表单不触碰其值」,注释/特殊类型的保真策略见整改规范 P1-3(实施后再回写本节)。⚠ **有意不照搬**上游另两条守卫(KeepAlive 非 bool、多触发器)——本实现有意支持 KeepAlive 字典与多触发器并存。实测改为保留档后:锁表单 **0** 个、仅提示 19 个。
    - **判据单一来源**:`agent-form.ts` 导出 `formIncompatibilities(value)`(锁定档,仅"表单拥有父键"类)与 `unmanagedKeys(value)`(提示档,顶层非托管键);`xmlFallback`(domain 派生标志)与 `formMode`(IPC 契约字段)两个冗余派生项一并删除,单一真值 = `unsupportedKeys` + `preservedKeys`。
    - **草稿落盘的第四条边路**:`save` 的草稿分支此前只依赖 `assertOverwritable`,而它按设计放行「同名任务自身」——扫描记忆(1500ms)过期等竞态下,磁盘上同名文件里的键会被覆盖抹掉。现落盘前读该文件:含"表单拥有父键"类不兼容 → 拒绝;**否则以它为 base**,非托管键照样原样保留(读不动 → 不误拦,交给覆盖守卫)。
    - **两道拦截**(对齐上游 PlistService 的两道,但有取舍):EditTab 顶部横幅列出键名 + 「去 XML 编辑」按钮,「保存并重载」禁用(`.d-btn:disabled` 视觉补在 app-chrome.css);main `save()` 写盘前同判据抛可读中文错误,**非任务原地重写路径同样受保护**,`saveXml` 是逃生通道不受限。⚠ **有意不照搬**上游另两条守卫(KeepAlive 非 bool、多触发器)—— 本实现有意支持 KeepAlive 字典与多触发器并存。
    - **三态**:`KeepAliveDict = { crashed: boolean|null; successfulExit: boolean|null }`(null = 未设置)。用 null 而非 undefined:JSON 会丢 undefined 键,false 必须保真。写盘规则 = 触发卡关 → 不写;dict 模式全 null → 不写(空 dict 仍隐含 RunAtLoad,是无效产物);显式 true/false 逐值落键。UI 每条件三枚 chip(未设置/是/否),全未设置时附一句说明。
    - **数值键**:`throttleInterval: number|null`(空输入 = 不写,占位提示 10;填 0 会真的写 0);`Nice` 保持 0=不写(0 即默认,语义正确,不动)。ProcessType 下拉补「(默认)」空值项(此前一旦选过无法回退到不写)。
    - **错误上浮**:新增 `lib/ipc-error.ts`(`cleanIpcErrorMessage` 剥 Electron invoke 前缀 + `agentErrorToast`)—— 此前 `cronErrorToast` 把一切非提权错误折成「操作失败,请重试」,守卫的可读错误到不了用户眼前(顺带让「已存在同名任务」等既有业务错误也能露出)。
    - **XML 保存后回读**:store 新增 `applyXmlInfo`,XML 里删掉不支持键后,编辑 tab 的横幅与禁用态随之消失。
    - **验证**:`agent-form.test.ts`(三态保真 / 全 null 不落键 / 触发卡关不写 / 0 与 null 可区分 / 非托管键与白名单键逐值搬回、`Program` 不被旧值搬回 / 未知 KeepAlive 子键与 env 非字符串、SCI 异常形态带前缀且不误报);`agent-service.test.ts` 5 项(KeepAlive 未知子键 → 拒绝且零写盘 / 顶层非托管键 → 放行且写出的 XML 保留 Sockets·MachServices / 草稿同名文件 → 以它为 base 保留非托管键 / 草稿同名文件含「拥有父键」类 → 拒绝 / 读不动 → 不误拦);`npm test` 342 项全绿 + `npm run typecheck` + demo 自检通过;i18n 生成器一致性零差异;真实 plist 审计(本机 32 个):锁表单 **0**、仅提示 19;**CDP E2E**:`MachServices + LimitLoadToSessionType` 文件 → 信息横幅 + 可保存 + **保存后两键仍在磁盘上**;`KeepAlive.PathState` 文件 → 警示横幅 + 保存禁用且文件未被改动;`KeepAlive {SuccessfulExit:false}` 保存后值仍在。

40. **字段覆盖 15→19 键 + 「往返白名单」+ 占位字段终局 + 假反馈接线(2026-09-18)**:demo `#view-plist` 设计稿写明「重构 B 的核心:把 formManagedKeys 从 12 键扩展至全量 launchd schema」,`Disabled/EnableTransactions/UserName/Nice/ThrottleInterval/ProcessType` 均标「本次新增」徽章,但迁移后其中 5 个 UI 控件从未接线(无 value/onChange,是摆设)。本次按「合规 + 操作符合预期」收口,并清掉假反馈与重复元素。

    **实现要点**:
    - **MANAGED_KEYS 15→19**(+`UserName` +`StandardInPath` +`Disabled` +`EnableTransactions`),新增概念**往返白名单**(`ROUND_TRIP_KEYS`):无 UI,`plistFromForm(form, base)` 从本次编辑所基于的磁盘字典原样搬回(含非布尔值保真)。理由:本机 4 个真实 plist 含 `Disabled`(VirtualBox / ToDesk 等第三方),不进白名单会被新守卫锁死表单;放服务层而非塞进 `AgentForm`,renderer 就不会持有自己从不编辑、却可能在保存时覆盖磁盘新值的隐形状态。
    - **占位字段终局**:`UserName` **接线且仅 daemon 域渲染**(man:仅特权 system 域适用、agent 域被忽略;demo 页脚亦有「仅在 systemDaemon scope 下暴露」的设计注记,但 demo 自己没实现该显隐);`StandardInPath` 接线(顺带修正 demo 的错键名 `StandardInputPath`,placeholder 文案用 EXTRA 同键覆盖改值);`Debug` 的**未接线 toggle 删除**——⚠ 更正:Debug **是真实 launchd 键**(man:「temporarily adjust its log mask to LOG_DEBUG while dealing with this job」),不是「无对应 plist 键」;既有 plist 的 `Debug` 按未知键保留并进提示清单(见整改规范 §5);`Disabled`/`EnableTransactions` UI 删除、键进白名单。
    - **假反馈接线**:XML tab「保存」接上早已实现却零调用的 `save()`(plutil 校验 → 提权 → `saveXml`),不再只弹 toast;EditTab「存草稿」按钮删除(全仓无 saveDraft API,原实现是 `setXml(xml)` 自赋值 + 假提示)。
    - **重复/恒量清理**:`CfgGroup` 从 EditTab 局部提取为 `components/ui/CfgGroup`,StatusTab 改用(原手写折叠头无 onClick,是**假折叠**);StatusTab 删「Scope」行(与顶栏副标题重复且英文硬编码)与「管理方式:launchd 原生」(恒量,先例:端口服务恒量 proto 标签);LogTab 删与底部重复的 LIVE 徽章,底部指示按日志源区分(file = 实时跟踪 / system = 手动刷新);`MultiValueList` 的 ArgsList / WatchList 收口为 `StringList`;SciBuilder 删与通用 `patch` 重复的 `updateWeekday`/`updateMonth`,并修掉 `patch` 原址 `delete` 污染撤销栈的 bug;`Weekday=7` 显示归一到「周日」(man:0 和 7 都是周日)且**未触碰时原值保留 7**。
    - **风险提示(只提示不阻止,用户拍板)**:WatchPaths 卡片与展开区加 man 原文风险句(race-prone, highly discouraged);KeepAlive 与定时 / 监视触发同开时提示(KeepAlive 隐含 RunAtLoad 且持续拉起,其余触发实际轮不到);Nice 行加「优先用 ProcessType」(man 原话)。
    - **i18n 机制**:新键走 EXTRA 追加;**改义用 EXTRA 同键覆盖**(合并时 EXTRA 后置优先生效、键位置不变 → 重跑生成器仍逐字节一致);被删 UI 的 demo 源键**保留为孤儿**(不删,避免与生成器输出永久漂移)。
    - **验证**:`npm test` 340 项 + `npm run typecheck` 全绿;生成器一致性 = 复制到 /tmp 跑 `port-demo-i18n.mjs` 后 diff 两份字典,除既有 `ai.*` 漂移外零差异;手工 E2E 见第 39 条。

41. **Agent 编辑器整改规范（2026-09-18，待实施，阻断合入）**：第 39/40 条已解决 KeepAlive 三态、部分嵌套键守卫、顶层非托管键的常见值级保留与假 XML 保存按钮，但 code review 确认仍存在 P0：Label/路径进入提权 shell 的安全边界、保存却宣称重载、XML 保存后旧 form 覆盖、Label 生命周期断裂；另有 revision 并发覆盖、托管字段 schema 不完整，以及 data/date/注释在 parse→重建时并非 XML 原样保留。后续实现**必须以** [`agent-editor-remediation.md`](./agent-editor-remediation.md) 为准：其中定义 A/B/C 保真等级、既有配置与新建配置分流、P0/P1 修复次序、目标 IPC 契约及验收矩阵。第 39/40 条中“原样保留”“保存并重载”“Debug 无对应 plist 键”等表述均受该规范约束，未达第 7 节完成定义前不得作为已验收结论。

41. **Agent 编辑器整改落地：P0 安全/保存事务 + P1 保真与并发(2026-09-18,依据 `docs/design/agent-editor-remediation.md`)**:该规范优先级高于第 39/40 条中「原样保留」「保存并重载」等表述;本条记录落地结果。

    **实现要点**:
    - **P0-1 安全**:新增 `domains/agent-label.ts`(`[A-Za-z0-9._-]+`、非空、非 `.`/`..`、≤200;新建/改名/非任务转正/克隆派生必须过闸,既有不规范 label 只允许「标签不变地改内容」);`plist-service` 加 `assertInsideScope`(writeAt/remove/removeWithBootout/pathFor,用 `relative` 判逃逸,不依赖 join 语义);**提权层重写** —— `ElevationExecutor.run` 改收 `{ steps: [{command,args}], join }`,内部 `shQuote` + **0700 私有临时脚本** + 只提权执行 `sh '<脚本>'`,用户数据不再进入 AppleScript 串(`{script}` 逃生舱仅限无用户数据的管道场景:crontab system 写入);`launchctl-service` 弃 `sh.split(' ')` 改 argv,brew 手工名清洗随之删除。
    - **P0-2 保存/应用分离**:`ApplyMode = 'save' | 'saveAndApply'`;`save` 只写文件且**零 launchctl 调用**(报告 `wasLoaded: null`);`saveAndApply` 仅对「保存前已载入」的任务 bootout → bootstrap(**不 kickstart**),bootstrap 失败则回滚文件并尝试重载旧配置,`ApplyReport` 分阶段如实上报(`fileWritten/fileRolledBack/wasLoaded/nowLoaded/applied/notes`);Edit/Xml tab 均提供「保存」「保存并应用」两个动作,toast 文案与真实结果一一对应(「已保存到文件」/「已保存并重新载入(未主动运行)」/「已保存(任务未载入,无需应用)」)。
    - **P0-3 XML 保存回源**:新增 `AgentDocument`(id/scope/path/revision/sourceXml/form/compatibility/sourceShape);XML 保存成功后 renderer 用 main 返回的整份文档**整体替换**(表单快照、原文、兼容报告、revision、身份),撤销栈清空 —— 修掉「XML 改完再表单保存会把 XML 改动覆盖回旧值」。
    - **P0-4 Label 身份事务**:XML 改/删已有任务的 Label → `rename-required`(提示走「重命名任务」);`renameAgent({id, expectedRevision, newLabel, applyMode})` 单独事务:校验 → 写目标文件 → (已载入时按选择)迁移运行态 → 删除旧文件;已载入 + `save` 直接拒绝;迁移失败**不删旧文件**并尝试重新载入;非任务补 Label 保留原文件名但返回**新任务 id**。
    - **P1-1 revision/CAS**:`revision = sha1(sourceXml)`;saveForm/saveXml/renameAgent/remove 全部带 `expectedRevision`,不符即返回 `{ kind:'conflict', latest }` **零写盘**;渲染层用 `CHOICE` 让用户裁决「重新加载(丢弃我的编辑)/ 保留我的编辑」,不静默覆盖;表单保存只发 `dirtyFields`(未触碰的键取保存时的磁盘最新值)。
    - **P1-2 全键 schema**:`scanCompatibility(value, xml)` 单一判据(UI 横幅与保存守卫共用):KeepAlive(bool 或 boolean 字典)、Program+ProgramArguments 同存、ProgramArguments 元素类型、RunAtLoad/字符串键/整数键类型与范围(Nice -20~20、ThrottleInterval ≥0、StartInterval ≥1)、WatchPaths 数组、EnvironmentVariables(非 dict 同样锁定)、SCI 五键整数与范围(0-59/0-23/1-31/0-7/1-12)、Disabled/EnableTransactions 类型;另导出 `validateNewAgentInput` 做**新建/改名的约束校验**(可执行体、绝对路径、范围、UserName 无空白)。
    - **P1-3 保真边界(选路线 2)**:含 `<data>`/`<date>` 或**多条 XML 注释**的文件 → 锁定表单并提示「表单保存会改变其表示」;文档与 UI 不再宣称「原样保留」,统一表述为「按值保留」。
    - **P1-4 分层提示**:KeepAlive 与定时/监视并存的说明改为规范口径(「任务已运行时到点触发不会创建额外实例」,不再称「轮不到」),既有配置只说明;新建(草稿)首次组合出需解释的效果(KeepAlive+多触发 / 空 SCI 规则=每分钟)时弹一次确认(空规则的新建把关从服务端移到该确认)。
    - **§5 字段政策**:`Debug` 更正为**真实 launchd 键**(此前文档误写「无对应 plist 键」);UserName 仅 daemon 可编辑、其他作用域只保留;Disabled 反映 launchctl override、文件值仅保留。
    - **复审修复(2026-09-18,Codex 复审 6 项)**:① **CAS 不再被进行中扫描绕过** —— 新增 `PlistService.readFresh(scope,path)`(直读目标文件,不复用 memo/pending),`casGuard()` 用它做 fresh read→revision 比对(冲突分支的 `latest` 也来自 fresh);四个写入口包在 `withAgentWriteLock` 串行化(fresh read → 写盘之间不允许插队,全局单锁:写操作由用户驱动、频率极低,且改名涉及双路径、按路径加锁需处理顺序);写后回源同样走 `readDocumentAfterWrite`(fresh)。② **草稿撞名的保真锁**改用 `scanCompatibility(existing.value, existing.xml)`(此前漏传 sourceXml,含 `<data>`/`<date>`/多注释的同名文件会被静默重建)。③ **renameAgent / clone 也过保真判据**(二者同样 `parse→object→toPlistXml` 全量重建):命中 B 类直接拒绝并提示走 XML/手工迁移。④ **改名事务纳入旧文件删除**:删除失败 → `bootout(新) → remove(新) → bootstrap(旧)` 回滚,`fileRolledBack/applied/nowLoaded` 如实上报;回滚中断则返回可操作的半完成说明(两份文件路径 + 处理建议)。⑤ **store 副作用回写加请求版本校验**:`setTab('status')` 与 `loadLogs` 都捕获 `requestVersion` 并在落地前比对 `open/requestVersion/agentId/logSource`,慢响应不再污染当前抽屉。⑥ **历史 Label 不再被 trim**:`applyDocumentImpl` 保留原值,未编辑 Label 时从 `document.form.label`(磁盘身份)取值而非展示串,避免把普通编辑误判为改名。
    - **复审修复·第二轮(2026-09-18,Codex 复审 7 项)**:① **写后回源不再经扫描** —— `readDocumentAt(scope, path)` 直接按已知路径 fresh 读并构造文档(旧实现 `findAgent(id)` 在「旧 pending 扫描」下看不到新建/改名出来的文件,会报 not found 或返回陈旧状态);② **非任务 XML 转正补 Label 全局查重**(`assertLabelFree`,否则两个文件可声明同一 Label、`agentId` 不再唯一);③ **应用失败不再当成功** —— `applyFailureOutcome()`:曾载入却没载上(`wasLoaded && !applied`)返回 `{ok:false, kind:'write-failed', latest, report}`,页面不再给绿色「已保存」;④ **clone 纳入写锁 + revision 契约**(`CloneInput{id, expectedRevision}`):CAS + 保真判据 + **fresh 探测生成 .copy 名**(不依赖缓存目录视图)+ fresh 回源,IPC/preload/ports 全链同步;⑤ **删除/特权写入事务**——用户域删除时 `bootout` 成功而 `rm` 失败 → 尝试重新 bootstrap 并返回结构化失败(不留「文件在、任务没了」);特权 `removeWithBootout` 不再无条件用 `;`(脚本内 case 匹配「未载入」类错误才继续 rm,其余 `exit 1` 中止);特权 `writeAt` 改为**先在临时文件上 chown/chmod、最后才 mv**(权限步骤失败时目标保持完整);⑥ `clearLog()` 补 requestVersion 校验;⑦ 冲突「保留我的编辑」文案改为如实引导(先重新加载再重新应用,避免误以为可直接再保存)。
    - **复审修复·第三轮(2026-09-18,Codex 复审 7 项)**:① **P0 特权临时文件安全** —— `writeAt` 改用 `fs.mkdtemp()` 随机私有目录(0700)+ 目录内独占创建(`flag:'wx'`,不跟随 symlink)+ **提权后整目录清理**(旧实现是可预测的 `.launcher-<ts>-<name>` 放在全局 tmpdir,同用户进程可预创建/替换);② **外部删除不再被当作草稿** —— `casGuard` 区分「真草稿(createDraft 登记)」与「曾落盘但文件已不在」:后者(含扫描缓存未过期、`readFresh` 报 ENOENT 的情况)一律 `not-found`「文件已被外部删除」,**绝不静默重建**;③ **Label 唯一性抗 TOCTOU** —— `assertLabelFree` 改走 `scanNow()`(绕过 memo/pending),并新增 `writeAtVerified()`:原地写入后 fresh 重扫,若出现多份同 Label 则**回滚原内容**并报冲突;④ **特权删除分阶段结果** —— `removeWithBootout` 返回 `{bootoutDone, fileDeleted, cancelled, stderr}`,`bootoutDone && !fileDeleted` 时 `remove()` 尝试重新 bootstrap 原任务并按失败上报(与用户域对等);⑤ **UserName scope 防线** —— main 侧拒绝非 daemon 作用域的 `userName` 补丁(此前仅 UI 隐藏,IPC 可绕过);⑥ **日志清空不再假成功** —— `clearLogs` 返回 `{cleared, failed[]}`,有失败则保留列表并列出文件;新增 `logRequestVersion`,清空成功即失效「清空前发起的读取」;⑦ 删除一条 mock 假阳性用例(「读不动同名文件仍放行」绕过了真实覆盖守卫;真实语义由 plist-service「write 仍拒绝覆盖损坏目标」覆盖)。
    - **复审修复·第四轮(2026-09-18,Codex 复审 7 项)**:① **CAS 后不再复用缓存快照** —— `casGuard` 重构为 `locateFresh(id, expectedRevision, msg)`:成功即返回 **fresh 记录**,五个写入口(saveForm/saveXml/renameAgent/remove/clone)全程以它为配置源,不再 `findAgent` 取 memo/pending 旧快照(否则未触碰字段可能被旧值覆盖);无 revision 的写一律 `invalid`;② **应用后抽屉状态同步** —— `saveAndApply` 成功(`applied`)时按最新列表重算 `ops` 并重读 `statusModel`(带 requestVersion 校验),XML tab 保存后不再残留旧 PID/running;③ **Label 查重按 scope** —— 身份是 `<scope>:<label>`,`assertLabelFree`/`verifyUniqueLabel` 均加 `p.scope === scope`(user 与 daemon 同 Label 合法共存);④ **rename/clone/草稿落盘补齐写后复核** —— 统一 `verifyUniqueLabel()`:写入后 fresh 重扫,命中外部抢名则撤销本次新建/改名/克隆并报 `conflict`;⑤ **remove 强制 revision**(接口必填,main 侧 `undefined`/空串 → `invalid`;草稿的 revision 来自未落盘文档),旧调用方无法绕过 CAS;⑥ **system 日志 predicate 转义** —— 历史 Label 可能含引号/反斜杠,按 predicate 字面量转义后才插入 `log show`(避免读到别的任务的日志);⑦ `.kiro/settings/lsp.json`(本机编辑器工具配置)移出暂存区并加入 `.gitignore`。
    - **复审修复·第五轮(2026-09-18,Codex 复审 7 项 + 架构建议)**:按评审自身给的实施顺序推进 1-4、6-7 项(第 5 项 XML AST 为评审标注的最终形态,尚未落地):① **启停/自启进同一把写事务锁** —— `ops()` 与 save/apply/delete/rename/clone 串行(否则「保存并应用」的 bootout→bootstrap 会与「停止」交错,把用户刚停的任务又拉起来);测试用 busy-guard 断言两个并发流程零交错;② **停用任务的启动不再隐式 enable** —— `lib/agent-ops` 在 start 前弹「启用并启动 / 取消」并说明 launchd 限制(disable 阻塞 bootstrap → macOS 无「仅本次启动」),副作用不再藏在命令内部;③ **`StartInterval` presence 建模** —— `number` → `number | null`(null = plist 无该键),间隔卡由「恒亮」改为开关表达 presence(留空/关闭 = 不写键),显式 0/负数在既有文件里锁表单、在新建时被拒;`<real>` 也纳入类型保真锁(JS 数字不保留 int/real);④ **注释锁定收紧到位置** —— 只有首个 `<dict>` 之前的描述注释被允许,字典内部的单条注释同样锁定(此前 >1 条才锁);⑤ **B 类逐键说明** —— `CompatibilityEntry{path,type,summary,reason,preservation}` 进 `FormCompatibility`/`AgentDocument`,页面在横幅下渲染「键名 + 类型 + 值摘要 + 原因 + 保真等级」;⑥ **非 daemon 的 UserName 如实展示** —— 改为只读行(「当前作用域不适用:launchd 会忽略;保存保持原值」),不再完全隐藏;`Disabled=true` 的文件也加只读告警行(启停以 launchctl 覆盖位为准);⑦ **运行态漂移提示** —— `save`(只写文件)且任务原本已载入时,toast 明示「运行中的任务仍在使用旧配置(点「重启」或「保存并应用」使其生效)」,不再给一句含糊的「已保存」;UI 文案全面改口径为「按值保留(XML 格式可能重排)」。
    - **XML 节点级补丁落地(2026-09-18,复审 item 4/5 的最终形态 = 评审推荐的 AST 路线)**:新增 `domains/plist-xml.scanTopLevelDict()`(跨度扫描:定位根 `<dict>` body 与每个顶层键的 key/值跨度,支持嵌套、自闭合 `<dict/>`、注释与 CDATA 跳过)+ `domains/plist-patch.ts` 的 `patchPlistXml()`:**只改写被改动的顶层键**(值深度比对),其余部分(注释、键序、`<integer>`/`<real>` 原始写法、空行缩进)逐字节保留;新增键插在 `</dict>` 前、删除键整行移除、描述注释按 head 位置更新/插入/删除;结构无法安全扫描(顶层 CDATA、键缺值、根异常)→ 返回 `unsupported` 由页面锁表单,绝不盲重建。**适用面因此扩大**:文件级保真锁(`<data>`/`<date>`/`<real>`/字典内注释)全部撤下,改为「结构可扫描性」判据 —— 此前被锁死的文件(如含字典内注释、`<real>` 数值的)现在可正常表单编辑;rename/clone 同样走补丁(只改 Label 节点)。附带修掉真机发现的缺陷:`extractPlistDesc` 此前取「任意首条注释」会把字典内部注释误当描述、保存时复制一份 → 收紧到「DOCTYPE 与 `<plist>` 之间」。
    - **生命周期区排布修正(2026-09-19,用户反馈)**:① 未开启 KeepAlive 时「保持存活」卡**通栏**(`.keep-alive-layout.solo`;此前只占左半、右半留空洞);② 右侧「保持运行策略」**改用与左侧同款卡片**(`TriggerCard` 的 `trailing` 槽塞下拉:图标 + 中文标题 + 英文小字 `KeepAlive policy` + 右侧控件),长句预设说明从卡面收进 `title` 提示 —— 原先是一个自带标题/下拉/说明三行的深底面板,与左卡形状、密度都不一致;③ 「自定义条件」改由**模式位**决定留存 —— drawer-store 新增 `kaCustom`(纯 UI,不进表单/plist):旧实现按派生值 `keepAlivePreset(form) === 'custom'` 渲染,形态一旦恰好等于某个具名预设(如只把 Crashed 设成「是」),用户点第一个 chip 就会让下拉跳回具名预设、**整个条件编辑器消失**;现在下拉显示的是「模式」(显式选过自定义就保持,再选具名预设即退出),打开抽屉时按磁盘形态取初值,并以 `keepAliveMode === 'dict'` 收口(XML 保存把形态换回 bool 时模式位让位给实际形态);④ 自定义条件**每项独立成卡**(`.ka-item`,两列 grid 内各自带边框底色的子卡;裸排时 Crashed 的三态 chip 会紧贴下一列标题、读成一行),底部说明行独占整行(`grid-column: 1/-1`),文案补「两个都未设置时整条 KeepAlive 都不写」。
    - **IO 字段政策:隐藏 Stdin(2026-09-19,用户要求)**:`StandardInPath` 从「可编辑字段」移入**无 UI 往返白名单**(第 39/40 条把它列为「接线」的表述据此作废)——表单删除 `stdin` 字段与 I/O 组第三行输入框。依据:man 该键只把某文件映射到任务 stdin,而 launchd 任务非交互、stdin 默认 `/dev/null`,正常场景用不到(本机 32 个真实 plist **0 例**,对照 `StandardOutPath` 7 例);文件里确有该键时保存**从磁盘原值原样搬回**(不丢键、不锁表单、不进「保留键」横幅),要改走 XML tab。类型检查归 `STRING_KEYS`(string),布尔往返键的检查收进 `BOOL_ROUND_TRIP_KEYS`。
    - **界面语言一致性(2026-09-19,用户要求)**:demo 把若干文案写死英文(分组副标题 `Identification`/`Execution`/`Startup timing`/`Process lifetime`/`Stdio`、侧栏与面包屑的 `Launch Agents`、设置页 `Login Items` 与 `Login Item`、SCI 列 tooltip `Minute (0-59)` 一族),中文模式下会露出英文。本轮全部收口:① **分组副标题删除** —— demo 里它们与英文标题重复(英文模式同样重复),中文下是纯冗余英文;`CfgGroup` 的 `subtitle` 参数随之删除(CSS 类保留)② 侧栏与顶栏面包屑改用新键 `nav.agents` / `module.agents`(zh「Agent 管理」/ en「Launch Agents」;该页同时管 Agents 与 Daemons,故不叫「启动代理」)③ **表单标签中文化 + plist 键名进 `title` 悬停**(`cfg.label`/`cfg.program`/`cfg.args`/`cfg.workingDir`/`cfg.env`/`cfg.stdout`/`cfg.stderr`/`cfg.userName`;触发卡仍保留「中文名 + 键名」副行 —— 键名与 XML tab 的对应关系不丢)④ 自定义策略卡去掉自造英文 `KeepAlive policy`(该卡无对应 plist 键,与左卡不再强求副行对称)⑤ 设置页 section 标题与对比标签本地化(`settings.login.sectionTitle` / `settings.login.itemLabel`,后者与保留的技术名 `LaunchAgent` 成对)⑥ 顺带修**反向**问题(英文模式露中文):侧栏帮助 tooltip 与设置页 GitHub tooltip 原为硬编码中文,新建 Cron 描述 placeholder 改走已有键 `modal.newCron.descPlaceholder`。**保留英文的仅剩技术术语与标识符**(launchd / launchctl / plist / FSEvents / stdout / PID / `INFO|WARN|ERROR` / `LaunchAgent` / 进程名 / 路径 / 命令行)与 `App.tsx` 的 preload 故障诊断页(开发者向,仅故障时可见)。
    - **性能与保真修正(2026-09-20,用户反馈「允许登录时加载」点击后迟迟不翻面)**:① 定位到 **`ps -p` 在 macOS 上恒定 ~2.5s**(实测 5 个 pid 也要 2.6s,与 pid 数量无关;`ps -eo` 全量仅 ~0.3-0.6s),而列表刷新每次都要给运行中任务补 uptime → 三处调用点(列表 `uptimesFor` / 状态 tab 的 cpu·mem·lstart / 端口服务 `process-discovery`)统一改为**一次 `ps -eo` 全量列举 + JS 按 pid 取用**;状态 tab 原先还调了两次 `ps -p`(cpu/mem 一次、uptime 一次),合并成一次。实测:`list()` 3104→**527ms**、运行中任务 `readStatus` ~5s→**0.7s**、点击开关到 UI 翻面 >3.5s→**359ms**。另:`runAgentIntent` 的列表刷新改为**不阻塞调用方**(动作结果由 main 直接返回,UI 据此立即翻面),列表卡片路径去掉重复的 `load()`。② **未建模顶层键不再锁表单**:`MachServices` / `LimitLoadToSessionType` / `Umask` / `ExitTimeOut` / `Sockets` 这类表单既不展示也不触碰的键,回到 `preservedTopLevelKeys`(页面只显示一行「保存时原文保留(只改写你改动的节点)」),不再进 `unsupportedPaths`;`entries` 区分 `preservation: 'unsupported'`(逐键说明+锁表单)与 `'value'`(按值保留,理由走新键 `cfg.compat.preservedReason`),EditTab 的逐键列表只渲染前者以免与保留横幅重复。锁死的只剩「表单拥有该键/父键却表达不了」:Program+ProgramArguments 同存、KeepAlive 未知子键、env 非字符串、SCI 异常形态、结构无法增量改写 —— 真机 33 个 agent 锁表单 **21 → 5**(4 个 Program 同存 + 1 个结构不可扫描),可编辑率 12/33 → 28/33。③ **单行 plist 保存即格式化**:整份 dict 挤在一行的文件(本机样本 `com.docker.socket.plist`、keystone 的 `<dict/>` 占位)没有原文排版可保留,点补丁只会在单行里塞进带缩进的换行、越改越乱 → 整份按 `xmlIndent` 重排(键序保持);⚠ 含表示层构造(`<data>`/`<date>`/`<real>`/注释)的单行文件继续走逐字节补丁 —— 重排是从字典重建,会把这些写法改成 `<string>` 或丢掉,宁可不美化也不丢表示(该回归由既有 `<data>` 用例当场抓住)。
    - **验证**:`npm test` **432 项全绿**(新增:进行中扫描下的 CAS 冲突、草稿撞名保真锁、rename/clone `<data>` 拒绝、改名删除失败回滚、写后回源不经扫描(scanFrozen)、删除失败恢复运行态、XML 转正查重、提权写入步骤顺序/删除条件化、store 竞态 ×3 + Label 不 trim);真机 CDP 复核(**生命周期区**:关闭态单卡通栏 784px / 开启态 389+389 同排 / 选自定义后点 chip 编辑器不再消失且下拉保持「自定义」/ 再选具名预设即退出 / 临时 plist 打开时按磁盘形态取初值 + 保存后仍留在自定义模式,磁盘 `KeepAlive = {Crashed:true, SuccessfulExit:false}` 且文件其余部分逐字节不变; **Stdin 隐藏**:含 `StandardInPath` 的真实文件 I/O 组只剩 Stdout/Stderr 两行、无兼容横幅、保存按钮可用,改描述保存后磁盘该键位置与取值不变;**AST 补丁**:含字典内注释 + `<real>1.0</real>` 的真实文件改一个字段 → `diff` 仅 `v1→v2` 一行、注释与 `<real>` 原样、`plutil -lint` 通过、该文件此前还被锁死表单)/ 兼容说明逐键列表(MachServices → dict = {"…":true})/ UserName 只读行 / 间隔卡 presence(无键=关+输入禁用、300=亮+可编辑)/ **停用任务点启动弹「启用并启动 / 取消」**、clone 新契约(新建 `.copy` + 陈旧 revision → conflict)、UserName 非 daemon 拒绝、clearLogs 结构化结果、**外部删除后保存 → not-found 且不重建**;冒烟全写路径(save/xmlSave/clone/remove)+ `remove` 缺 revision → `invalid` + `npm run typecheck` + demo 自检;真机 CDP 回归(用户域,测试文件用后即删):文档 revision/兼容报告、`save` 零 launchctl(报告 wasLoaded=null)、陈旧 revision → conflict 且零写盘、XML 保存返回最新文档(表单 args 随之刷新)、XML 改 Label → rename-required、显式改名 → 新 id 且旧文件删除、非法 label → invalid 零写盘、含 MachServices 的文件保存后键仍在; **语言一致性**:运行时 CDP 审计(按 `.sidebar`/`.topbar`/`.filter-bar`/`.launch-statusbar`/`.settings-pane`/`.edit-drawer` 分域抓 innerText,白名单放行技术术语与数据)—— 中文模式下界面外壳零英文文案,剩余命中项全部是术语/路径/命令(如「用户级 · ~/Library/LaunchAgents」「lsof -iTCP -sTCP:LISTEN」);抽屉编辑页分组副标题残留 0、表单标签全中文且 `title` 携带键名(标签/Label、程序/Program、参数/ProgramArguments、工作目录/WorkingDirectory、环境变量/EnvironmentVariables、标准输出/StandardOutPath、标准错误/StandardErrorPath);**⚠ 未覆盖**:system/daemon 作用域的**成功特权写入**需交互式授权,未自动化;真机已验证的部分(2026-09-18):system 域文档读取 + 兼容报告(样本 `com.eagleyun.endpoint.agent` → preservedTopLevelKeys=[LimitLoadToSessionType, MachServices]、表单可用、信息横幅正确)、daemon 域样本 `com.xk72.charles.ProxyHelper` 命中「Program 与 ProgramArguments 同存」→ 表单锁定(真实第三方文件验证规则)、提权取消路径(应用侧说明窗 → 取消 → 目标文件哈希不变、无 osascript 残留);`ElevationExecutor` 的新编码由单测覆盖(含「危险路径不出现在提权串」断言)但不等于真机授权路径已验证。

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
12. **Agent 列表运行状态筛选**(2026-09-19 用户要求,应用新增):demo 的过滤栏只有类型筛选,缺少「一眼看到正在运行的任务」的入口。应用在类型组之后加第二组(全部状态 / 运行中 / 已载入 / 已停止,竖线分隔两组,文案复用卡片状态标签的 `status.*` 键),状态存 `agents-store.statusFilter`,与类型筛选是「与」关系;**视觉上作次级处理**:`Chip variant='sub'` / `.chip-sub` 不用胶囊,改成方括号包住的纯文本(无描边、无图标、无底色),选中只换文字与括号颜色(`--accent`),与主 chips 形成主次;孤儿横幅(已加载但 plist 已不存在)不属于任何状态分组,仅在状态不限时展示。

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

**会话栏用色对齐设置页侧栏(2026-09-22,用户要求「颜色跟设置页的菜单栏一样,而不是另换一些颜色」)**:`.ai-rail` 底色从 `--panel`(半透白)改 `--surface`(实色,与 `.settings-tab-nav` 逐像素一致:深色 `#151522`、浅色 `#fff`);选中项 `.ai-rail-item.active` 去掉那圈紫描边、只留 `--wash-accent` 底 + `--accent2` 字并补 `font-weight:600`(对齐 `.set-nav-btn.active`);「新对话」按钮的紫蓝渐变 `--accent-wash-grad` 改平涂 `--wash-accent`。即整栏收敛到设置页侧栏那 4 个色(`--surface` / `--muted` / `--hover` / `--wash-accent`+`--accent2`),不再自成一派。

**界面层次补强(2026-09-22,用户要求:「中间空荡荡、没层次」「底部像一条横向底栏,不像 chat 输入区」)**:① **对话画布** —— `.ai-main` 加顶部紫调氛围光(径向 + 线性两层,`body.light-theme .ai-main` 同名覆写压到约 1/3 强度,否则浅底整片发紫),使画布与左侧会话栏(实色 `--surface`)、悬浮输入区构成三层;② **助手消息卡片化** —— `.ai-msg.bot` 由裸文本改 `--surface` 卡(紫调描边 + 投影),`.ai-bot-name` 由 `--dim` 转 `--accent2`,与用户气泡(紫 wash)成对;③ **内容贴底生长** —— `.ai-scroll` 转 flex 列、`.ai-col` 加 `margin-top:auto`,短会话不再在下方留大片空洞(空白挪到顶部、正好被氛围光填掉),内容超出时该 auto 自动归零、按普通滚动;欢迎态用 `.ai-col:has(.ai-welcome){margin-top:0}` 排除在外(它是"入口"要贴顶);⚠ 同时补了 `width:100%` —— `.ai-col` 是 flex 子项且带 auto 横向外边距,`margin:0 auto` 会先吃掉剩余空间、使元素按**内容宽度**收缩而非撑满;不写 width 时流式输出会让整列随文字由窄变宽(卡片化后尤其显眼),故显式撑满再靠 auto 居中(2026-09-22 用户报「输出宽度会逐渐放大」);④ **输入区悬浮** —— 去掉 composer 整条底栏的 `--panel` 底与 `border-top`,改 `.ai-composer::before` 渐隐遮罩(`transparent → var(--bg)` 62%,`pointer-events:none`)把滚到下方的内容淡出、避免与卡片叠字,`.ai-composer-box` 提为 `--surface` + 14px 圆角 + 投影;⑤ 回到底部浮标随之改造 —— 从固定 `bottom:116px` 移入 `.ai-composer`(index.html)并按 `bottom:calc(100% + 12px)` 定位,因输入区高度会随 @ 引用行出现而变化,固定值会压到引擎 chip 上。

**会话搜索 + 「新对话」去重(2026-09-22,用户要求)**:① **会话搜索** —— 会话栏顶部加一行 `.ai-rail-tools` = `[搜索框][方形 +]`(用户要求两者同行、新对话做右侧方形钮),搜索框**复用 `.search-wrap` 原语**(顶栏那套:浅底 + 紫色聚焦环,`body.light-theme` 覆写一并生效),`.ai-rail-search` 只覆盖 `width:auto` / `flex:1` / 字号以适配 232px 栏宽;`.ai-rail-new` 由整行文字按钮缩成 28px 方形图标钮(文案移入 `title`,行内 `align-items:stretch` 让两者同高);清除钮 `.ai-rail-search-clear` 仅在 `has-text` 时出现。**搜的是会话正文而非只搜标题**:`aiRailHit(s,q)` 先比标题(命中返回空串),否则逐条比 `aiResolve(m.text)` 找子串,命中切 ±12/+28 字符成片段;高亮走**逐段 `aiEsc` 后再套 `<mark>`**(用户自己输入的内容会经 live 会话回流进片段,不可整段拼 innerHTML);三态 = 标题命中仍显时间戳 / 正文命中显命中片段 / 无命中显 `ai.rail.searchEmpty` 空态。选中会话时过滤**保持**(便于连续翻看),`aiNewChat()` 才清空搜索框。新增 i18n 键 `ai.rail.searchPh/searchEmpty/searchClear`(zh/en 成对,585 → 588 键)。
② **「新对话」去重** —— 原先顶栏与会话栏各一枚、调同一个 `aiNewChat()` 且共用 `ai.rail.new` 键。按用户决定**删顶栏那枚**(顶栏只剩 [接入 MCP];「新对话」语义上属于它创建的列表,ChatGPT/Claude 同款位置)。**折叠态与 <900px 窄屏不补入口**(曾按用户选中方案在 `»` 旁挂过 24px 小号「+」,用户随后明确不要,已撤):会话栏不可见时没有新建入口,要新建需先展开会话栏。
③ **去掉头部 + 折叠钮移出面板**(同日再迭代,用户提出「搜索框上面的部分移除、搜索框放上面、折叠钮移到菜单外面」) —— 先试过把头部做成「身份砖 + 标题 + 会话数 pill + ghost 折叠钮」(用色更丰富,用户仍不满意),随后按用户方案收敛:**整条头部删除**,`.ai-rail-tools`(搜索 + 方形 `+`)直接成为会话栏第一行 —— 标题本就冗余(左侧导航高亮「AI 助手」、顶栏面包屑同名),`ai.rail.title` 随之成为孤儿键(按约定保留不删)。**折叠钮改成画布上的悬浮图标钮**(用户三轮收口:先在面板外的缝位挂常驻槽位 → 嫌那条缝占地方改悬浮圆钮 → 嫌圆框底色丑,最终**只留图标**:无框、无底、无投影,且**紧贴会话栏右缘**):`.ai-rail-expand` 改名 `.ai-rail-toggle`,移入 `.ai-main` 并 `position:absolute; top:14px; left:6px` —— 以 `.ai-main` 为包含块,故 left 恒等于"画布左缘内缩 Npx"(展开时即会话栏右缘旁),展开/折叠都不用改 left;**不占布局宽度**,会话栏收起时画布完全吃满。裸图标要压在画布上还看得清,颜色取 `--muted` 而非更暗的 `--dim`。**动效**:图标恒为 `fa-angles-right`,展开态由 `.is-in` 整体 `rotate(180deg)` 得到向左形态——开合是"转"出来的(0.3s cubic-bezier)而不是硬换图标;悬停再朝"即将收/放的方向"轻推 2px(`--nudge` 变量在 `.is-in` 下翻符号)。展开/折叠共用同一个钮,`aiSyncRailToggle()` 写 `.is-in` 与 tooltip(`aiSyncRailToggle()` 按「当前是否可见」写:宽屏看 `collapsed`、窄屏看 `mobile-open`,`aiToggleRail()` 与 `aiRenderRail()` 均调用)。⚠ **窄屏连带坑**:≤900px 会话栏是 `position:absolute` 覆盖层,会盖住画布左上角的钮,而面板内此时已无关闭钮可放 —— 故 `.ai-shell:has(.ai-rail.mobile-open) .ai-rail-toggle{left:246px}`(z-index 41 压过覆盖层的 40)把钮让到覆盖层右侧。⚠ **已知代价(用户知悉并选择接受)**:长会话滚动时内容会从悬浮钮下面经过——钮有不透明底与投影,可读,但会压住卡片左上角;窄屏 880px 画布与 `.ai-col` 之间没有留白,压得比宽屏明显。

**AI 引擎配置页(2026-09-22,用户要求)**:给 AI 助手补上此前完全缺失的 LLM 配置入口(对话页原先只有一个写死的「pi 引擎·已连接」徽章)。**放置(用户拍板)**:新增设置页第 7 个 tab「AI 助手」,与既有「Launchd 引擎」并列 —— 理由是引擎级配置本就都在设置页,且设置页在 React 侧已迁移完成,而对话页尚未迁移(状态 ❌),把要长期维护的配置挂在未落地的宿主上不划算;对话页保留一条**只读状态 chip** + 点击跳转,做到「看得见、改得动」而引擎配置只有一个家。⚠ demo 冻结范围因此**再次扩展**:此前例外仅 AI 对话页(2026-09-13),本次进入 `#view-settings`(新增 tab + pane),其余设置页内容仍全冻结。

**配置项 —— 文档已定 vs 本次新增**:`ai-capability.md:71` 已规定 `provider/model/apiKey(safeStorage)、MCP 开关、权限模式 readOnly/full`,`:70` 给了 stdio / 本地 HTTP 两种传输,`:81` 要求挂载命令 + Claude Desktop JSON —— 这些照搬。**本次新增两项文档未提的**:① **工具调用最大轮数**(`:107` 的「≤3 次重试」是生成闭环重试、非 agent 轮数,故独立成键、默认 8)② **流式输出开关**(`:117` 要求逐字流式且可取消)与**请求超时**(与既有 `cmdTimeout` 同族)。**明确不做**(文档未提,用户选定「只加三项有依据的」):温度、max tokens、对话记录保留天数、token/费用统计、工具调用详情日志、专家提示词自定义(`:90` 规定 expert.md 单源、不可用户编辑)、MCP 工具域作用域(`:80` 规定单一 ToolRegistry)。

**供应商 → 接入协议(2026-09-22 同日修正,用户质疑「是不是按 pi 支持的方式设置的」后核实)**:首版照 `ai-capability.md:42` 的厂商名铺了 Anthropic / OpenAI / Gemini / OpenRouter 四张卡,**未核对 pi 的实际形态**。查 `@earendil-works/pi-ai@0.87.0` 包本体后确认:pi 内置 provider **约 28 个**(`anthropic` `openai` `google` `google-vertex` `amazon-bedrock` `azure-openai-responses` `deepseek` `groq` `mistral` `xai` `together` `fireworks` `moonshotai` `openrouter` `github-copilot` `cloudflare-*` …),底层是**一组命名线协议适配器**(`anthropic-messages` / `openai-completions` / `openai-responses` / `google-generative-ai` / `mistral-conversations` / `bedrock-converse-stream` / `pi-messages` …),且 `createProvider({ id, baseUrl, auth, models, api })` **允许自定 provider 并复用任一内置协议**。故收敛为**两张协议卡**:「**Anthropic**」(anthropic-messages)与「**OpenAI 兼容**」(openai-completions,覆盖 OpenRouter / DeepSeek / 本地 Ollama 等长尾与自建网关)。**模型字段随之由下拉改文本框**:Anthropic 有已知模型列表(取自 pi 目录,故给快捷 chip),OpenAI 兼容端点连到哪家未知、**无法预知模型名**。⚠ 取舍要记住:pi 内置 provider 的价值在**模型目录 + 各家鉴权(OAuth 等)**,只用「OpenAI 兼容」一种会丢掉这两样;需要时**再加一张原生协议卡即可**(数据形状已支持,加卡不动代码)。⚠ 阶段 4 注意:`provider` 在设置里应是**已知协议的枚举**(而非任意字符串),与 pi 的 `KnownApi` 对齐。

**模型目录来源与「上次用过」(2026-09-22,用户追问「模型列表是接口取的还是内置」后核实)**:查包确认 pi 的模型列表是**随包发布的静态目录**(`dist/providers/data/*.json`,由 `scripts/generate-models.ts` 生成;Anthropic 14 条、OpenAI 39 条,条目含 `name`/`contextWindow`/`maxTokens`/`reasoning`/**`cost`**),**启动即读、不发网络请求**;`Provider.fetchModels`(动态覆盖)+ `Models.refreshModels()`(显式刷新)是预留能力,**内置 provider 里无一处使用**(连 OpenRouter 都走静态目录)—— 即「默认内置、需要时按需刷新」。顺带核对:demo 里写的 `claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5-20251001` / `gpt-5.1` **在 pi 目录里都真实存在**(友好名也照抄目录的 `name` 字段)。**首版给「OpenAI 兼容」编了 4 个预设(DeepSeek V4 / Qwen3 Max / Llama 4 70B 等),属虚构且必然漂移 —— 按用户选择改为「上次用过的模型」**:`aiCfgSetModel()` 把模型 ID 记进 `providerConfigs[协议id].lastModel`,下次切回该协议时以「上次用过」chip 呈现,点击即回填。零虚构内容,对任意网关成立;代价是首次配置时没有引导(端点连到哪家只有用户知道,这本来也不该由我们猜)。⚠ 阶段 4 可考虑升级为 `refreshModels()`(pi 已预留)+ 展示目录里的 cost/context。

**端点对两种协议一律可编辑(2026-09-22,用户明确要求「所有协议的端点 key 模型ID都可以更改」)**:首版给 Anthropic 锁死了端点(理由:改了就退化成另一种协议),但用户要的是**每种协议都能指向自己的网关/代理**——这条也符合实际:企业常走自建 Anthropic 兼容网关。故去掉 `baseLocked` 与只读展示态(`.ai-cfg-fixed` 样式随之删除),两条分叉的渲染路径合成一条,端点行 desc 改为中性的「填该协议的服务端点:官方地址、代理网关或本地服务均可」。⚠ **端点按协议各存各的**(`providerConfigs[协议id].baseUrl`,切卡不互相覆盖)—— 已实测:改 Anthropic 端点 → 切到 OpenAI 兼容(仍显示其默认端点)→ 切回,改动仍在。

**取消「传输方式」配置项,两种用法并列进 MCP 弹窗(2026-09-22,用户指出这是伪选择)**:首版把 stdio / 本地 HTTP 做成设置页的一个下拉,用户判断「不需要」并给出理由 —— **stdio 是外部 Agent 拉子进程,应用管不着;HTTP 是否可连取决于服务跑不跑,做成单选没有意义;真正要说清的是「用哪种协议就用哪种命令」**。这个判断成立:两者不是「切到哪套」而是「用哪套」(stdio 甚至不要求本应用在跑),故 ① 删掉 `mcpTransport` 配置键与设置页那一行 ② **MCP 弹窗改为两块并列** —— `stdio 命令行挂载(推荐)` + `HTTP 本地 HTTP 端点`(`http://127.0.0.1:7788/mcp`),各带独立复制钮(统一走 `data-copy`,页脚那枚复制主命令)。弹窗因此从「展示一条命令」变成**用法参考卡**。

**MCP 配置整体移出设置页(2026-09-22,用户要求「默认开启,设置里不做任何操作,只在 AI 助手页保留右上角按钮」)**:MCP 是应用自带能力,不该要求用户先「启用」它。故 ① 删掉设置页整个「MCP 服务」节(总开关 + 权限模式 + 接入方式三行)与 `mcpEnabled` 配置键 —— **`sp-ai` 现在只剩「接入协议」「AI 行为」两节**,页脚 subtitle 也同步改为「MCP 接入在 AI 助手页右上角」 ② 弹窗去掉 HTTP 状态徽章与「在设置中配置」跳转行(设置页已无对应内容),**权限模式开关留在弹窗内**(它本来就只在这里) ③ `.ai-seg` 分段控件随设置页那行一并删除(`aiCfgSeg` 成为零调用方)。

**⚠ 安全模型更正(2026-09-22,用户问「权限设置能限制住 CLI 模式吗」后核实)**:`ai-capability.md:85` 写「外部 **stdio** 默认 readOnly…需在应用设置显式开启」—— 这条**名不副实**:`claude mcp add launcher -- …/launcher-mcp` 是用户在终端亲手拉起的进程,**以用户身份运行**,其能力上界由用户自己的权限决定,应用的设置管不着它。权限模式真正约束的是**暴露哪些工具**(工具面收窄),而这一条只对**由应用把门的通道**有效 —— 即 **HTTP 环回端口**(本机任意进程都可能连上,权限模式在请求时读取,是唯一名副其实的闸门);stdio 每次挂载会新起进程、读到的也是最新配置,故对**之后新起的会话**有效、对已在跑的会话无效。**真正兜住写操作的是应用自身的提权确认**(写 plist/cron 最终都要过系统授权框),权限模式是减少攻击面而非安全边界。弹窗里那行说明已按此如实改写(「仅约束 HTTP 连接;命令行挂载与内置聊天的写操作仍各自需要系统授权」)。⚠ 阶段 4 落地时,`ai-capability.md:85` 这段需要同步订正。

**MCP 弹窗去掉「本机已装 CLI Agent」列表(2026-09-22,用户要求)**:那 4 行(Claude / Codex / Aider / Gemini CLI + 装没装)与用户真正要做的动作(填 Key、选模型、开 MCP)无关,是重设计前的旧目录页残留 —— 设置页与弹窗两处渲染一并移除,`ai.mcp.agentsTitle` 与 4 条 `ai.agent.*.desc` 成为孤儿键、`MOCK_DATA.aiAgents`(+`aiAgentData` 别名)成为孤儿数据(均按约定保留不删,后者还受 check.mjs「非空数组」约束)。`.ai-mcp-agent*` 样式同理保留。

**数据与刷新链路**:单一状态源 = 整份 JSON 存 `localStorage['launcher_aiConfig']`,默认值在 `MOCK_DATA.aiConfigDefaults`,`refreshAiSurfaces()`(设置页 pane / 对话页 chip / 引导卡 / composer)/ `refreshAiSurfaces→aiSyncComposer()` 是全量同步入口 —— 双向不靠事件总线,只靠这一条链路,避免设置页与对话页分叉。协议卡**点击即选中**(选中态只加描边 + 勾,不画第二套视觉)。

**两个界面新增**:① 权限模式的**分段控件**(`.ai-seg`,demo 迄今**无 radio/segmented 原语**,这是首个,仅此一处使用);② MCP 弹窗内一行虚线**跳转设置页**的入口。协议卡沿用设置页既有 section 骨架与用色,但**不复用 `.theme-cards-grid`** —— 那是 3 列 + 固定 68px 预览块且与「主题外观」标题耦合,混用会让改主题卡波及 AI 配置。深浅主题全部走 `var(--*)`,故与 `settings.css` 一样无需 `body.light-theme` 覆写。

**协议卡与字段宽度的两轮视觉修正(2026-09-22,用户逐条反馈)**:
① **卡片底色**:首版照抄 `.theme-card-item` 的 `background: rgba(0,0,0,0.2)` —— 那是**给深色主题调的固定值**(`base.css` 里 `--panel` 在浅色下是 `rgba(255,255,255,.7)`,而该卡绕过变量硬写),浅色下压在浅灰 section 上糊成一片脏灰。改为 `var(--surface2)` 常态 + `var(--wash-accent)` 选中态(wash 变量深色取 `rgba(124,106,244,.16)`、浅色取 `rgba(106,88,224,.12)`,两端都是柔和紫),整个紫调强调色的固定值随之不再需要。**教训:跨主题复用别处样式前,先确认它是否绕过了主题变量。**
② **字段宽度单一来源**:端点、API Key、模型 ID 三处原先各自为政(只读端点无宽度约束、输入框 `max-width:240px`),**切换协议时这一列会跳宽**。统一为 `#sp-ai { --cfg-field-w: 280px }` 并加长到 280px;560px 断点下才放宽为 100%。(只读端点那次的不一致随「端点一律可编辑」一并消失,见上条。)
③ **模型预设恒为单行**:原先 `flex-wrap: wrap` + 右对齐,4 个预设会折成两行且末端参差。改 `flex-wrap: nowrap` + `overflow-x: auto`(细滚动条),宽度与上方输入框对齐;560px 断点下回退换行。

**MCP 权限收口(修正文档与实现的既有矛盾)**:`ai-capability.md:29` 写明写权限「**在应用设置**显式开启」,而实现只在对话页的 MCP 弹窗里 —— 本次把权限模式做成**设置页与弹窗同一份状态**(两边都能改、即时互见),弹窗那个开关保留原形态只换语义(勾选 = `full`),另加一行跳转设置页。MCP **总开关关闭**时弹窗开关禁用并注明原因。⚠ 旧的 `localStorage['launcher_mcpAllowWrite']` **废弃不再读取**(演示态无版本迁移需求),旧 `ai.mcp.permDesc` 键改由设置页与弹窗共用的 `permDescReadOnly` 承担。

**未配置态补口(migration-map 已知遗留「未配 Key 引导态未建」)**:未配 Key(或切到没填 Key 的供应商)时,引擎 chip 转中性并显示「未配置模型」、composer 上方出现引导卡、发送钮置灰且按下去只提示并脉冲引导卡、输入框 placeholder 改「配置模型后即可开始对话…」、状态栏摘要改「未配置模型供应商」—— 六处同步,不再有「点了没反应」。

**逐文件改动**:

| 文件 | 内容 |
|---|---|
| `index.html` | `#view-ai` 旧结构(filter-bar + 计数 span + `#aiList`)整块替换为对话骨架(`.ai-shell` 双栏 + composer);新增 `#aiMcpModal`(MCP 接入);head 增 `css/ai.css` link |
| `css/ai.css` | **新建**(锚点 `.ai-shell`,已加入 check.mjs cssAnchors):rail/欢迎态/消息/步骤块/卡片/授权卡/composer/@ 弹层;全部走主题变量;步骤输出行复用 drawer.css `.log-line` 族;@ 弹层 fixed 挂 body(沿「浮层须挂根部防裁剪」教训);composer 底部预留 50px 避让固定状态栏(同 list-container 64px 同源) |
| `js/ai.js` | **整体重写**(97 行 → ~700 行)。模块级 `chatState`(timers 句柄池/typer/botMi/pendingApprove/afterApprove/runElapsed+runTickStart 计时);入口 `renderAiChat`(语言切换经 switchModule 重入 → `aiAbortRun` + 从 messages 静态重渲染);运行器 `aiStartLive/aiNextStep/aiExecStep/aiTypewriter`(16ms 逐字、字符同步回写消息对象)/`aiStopRun`/`aiAbortRun`(运行中项归一 warn,无残 spinner);授权 `aiApprove`(dangerous→`confirmDangerousAction`→`ELEVATION.request`)→ approved 后**续播 afterApprove 步骤到同一步骤块**;`aiCancelApprove` 追加取消文案并终止;@ 引用(`aiMention*`,按钮/@ 输入双入口,data-* 传参防引号注入);MCP modal(`aiOpenMcpModal/aiRenderMcpModal/aiCopyMcpCmd/aiToggleMcpPerm`);**旧函数整组移除**(renderAi/filterAi/handleAiSearch/scanAiAgents/runWithAgent/aiIconBadgeCls) |
| `js/data.js` | 新增 `aiChats`(4 条预置已完成会话,静态直出、含 approved 态授权卡)+ `aiScenes`(6 个场景时间线:health/sk-diag/sk-refactor/sk-import/sk-plist/**fallback**;步骤联合类型 user/think/tool/stream/card/suggest,`res:true` 的行经 `aiResolve` 实时取 `agentData/cronData/svcData` 计数)+ 共享 `AI_PLIST_DRAFT` 常量(定义在 MOCK_DATA 前,场景与预置会话共用)+ 别名 `aiChatData/aiSceneData`;`aiAgents`/`aiSkills` 保留(check.mjs 非空数组硬约束),改作 MCP modal / 欢迎技能卡数据源 |
| `js/config.js` + `js/modules.js` | `MODULES.ai` 重写:顶栏 = [接入 MCP] + [新对话 accent](**2026-09-22 起只留 [接入 MCP]** —— 「新对话」与会话栏那枚重复,已删顶栏那枚,见下);**去搜索框**(search 字段不配即合法;会话搜索改挂左侧会话栏,不是顶栏搜索);状态栏 = 引擎 pi 已连接 · 流式就绪 / 只读工具 9 / 写工具 5(需授权)/ 技能 4 / 本会话工具调用 N;`switchModule('ai')` 分支 `renderAi()` → `renderAiChat()` |
| `js/i18n.js` | 删 20 个废弃 `ai.*` 键(searchPh/filter/group/run/scan 等);新增 ~50 键(rail/engine/welcome/input/mention/steps/thinking/suggest/appr/report/plist/cron/stopped/scroll/mcp/sb);`ai.sb.path/monitor` 改值;zh/en 严格成对(585 键) |

**关键行为(已 CDP E2E 全量验证,零 console 报错)**:欢迎态(问候 + 一键体检主卡 + 4 技能卡;技能卡 `data i18n` 名/描述)→ 点卡起新 live 会话(user→think 思考中→tool 步骤逐条+输出行逐条→正文逐字→卡片→建议 chips);写操作授权卡暂停时间轴(**授权等待不计入用时**,计时冻结/恢复)→ 提权 modal(复用零新增 markup)→ approved 续播进同一步骤块;取消 → 「已取消」+ 取消文案 + 终止;任意自由输入 → fallback(概览数字与 mock 实时一致 6/3/4/3/5);运行中发送钮变停止(清定时器/待授权卡置取消/折叠/toast「已停止生成」);预置 4 会话静态直出(cron 卡经 `parseCronExpr` 人话:如 `30 18 * * *` → 「每天 18:30 执行」);@ 引用(过滤 → 选择 → composer chip → 用户气泡内 chip);MCP modal(挂载命令复制/写权限开关 localStorage `launcher_mcpAllowWrite`/本机 CLI Agent 列表);深浅双主题、zh↔en 切换(流式中途切也安全)、900px 断点(rail 收为覆盖层)、rail 折叠跨模块记忆。体检报告卡「前往处理」= `switchModule` 跳对应模块(跳转前 `aiStopRun`)。

**已知遗留(demo 范围,阶段 4 落地时以真实能力替换)**:流式/延时为脚本模拟;MCP 挂载命令为示意(真实 `launcher-mcp` 入口属阶段 4);「在编辑器中打开」= 跳转 agents 模块的演示指代;未配 Key 引导态未建(demo 无设置耦合,阶段 4 随 safeStorage 配置落地);多轮上下文为单轮场景(每次发送起新 live 会话)。

23. **提权模型与三处提权体验修补(2026-09-17)**
    - **模型结论:保持「每次操作提权」,不做特权 helper**。三条理由:①**签名硬阻塞** —— SMAppService(13+)/SMJobBless 强制应用与 helper 同一 Developer ID Team ID,而本项目按 `distribution.md` 的决定不买证书、产物是 ad-hoc,helper 路线根本注册不上;②**即使签了名,默认形态也更危险** —— osascript 提权是"通用 root shell 但每次有用户可见确认框",而能跑任意命令的 helper 是"通用 root shell 且永久静默";helper 要做对必须暴露窄接口并把 11 个提权点全部降解为受校验的具名操作,是一次重写;③**本项目分发刻意绕过 Gatekeeper**(curl 不设 quarantine / cask `postflight` 清标记),应用包无 OS 级完整性校验,「无签名校验 + 静默 root」正是 Apple 安全模型要防的组合。**明确不做** `/etc/sudoers.d/` 免密条目 —— 那不是给这个 app 权限,而是给该用户开永久免密 root 后门。将来若因别的理由买了证书,亦应拆开:helper 只接高频低变异操作,破坏性操作(写/删 plist、写 `/etc/crontab`)继续逐次提示。
    - **① 草稿新建 system/daemon 缺说明框(条件写反)**:`drawer-store` 的闸口原先带 `!s.isDraft`,把**恰恰最该解释的高危操作**(新建一个落在 `/Library/LaunchDaemons` 或 `/Library/LaunchAgents` 的 agent)排除在外 —— 只弹一个没有任何上下文、连待执行命令都不展示的系统密码框。已去掉该条件,并补 `noteSuccess()` 置热窗口。
    - **② 服务「重启」失败不给提权引导**:`termination.ts` 本就返回 `error:'denied'`,但 UI 把它渲染成泛化的「重启失败」(kill 有完整引导,restart 没有)。已把 `{privileged}` 沿 restart 链路打通并在 `denied` 时走同款引导。⚠ **语义警告已写进确认文案**:`restart` 是「kill + 以**当前用户**重新 spawn」,对他人/root 进程即使终止成功,**重新拉起的身份也会变**(文件访问/HOME/端口绑定权限都可能不同),故文案必须言明,不能只报成功。
    - **④ system scope 的 launchctl 动词不再提权(本机实测)**:域映射上 `system`(`/Library/LaunchAgents`)**属用户自己的 `gui/<uid>` 域**(差异 28 已证),但 `privileged()` 原为 `scope !== 'user'` —— 在自己域里执行动词却申请了 root。实测(无 sudo):`enable` exit 0、`kickstart` exit 0、`bootout`(不存在 label)返回 "No such process" 而非 EPERM,而**同样三个动词打到 `system` 域全部 `Operation not permitted`**。唯一无法静态判定的是 `bootstrap`:它对非 root 调用者一律返回不透明的 errno 5(不区分权限与"不是合法 plist",system 域也是同样的 5)。**故不逐动词猜,统一改为「先在用户域试跑 → 仅当系统明确拒绝才升级为提权重试」**,由系统裁决;业务错误(未载入/找不到)不重试,避免把真实失败包装成一次授权弹窗。`plist-service` 的**文件读写判定不变**(`/Library/LaunchAgents` 目录 root 拥有、文件 root:wheel 644,写仍需 root)。渲染层闸口同步从 `scope !== 'user'` 改为 `scope !== 'daemon'`。实测回归:system agent 的开机自启开关**不再弹任何框**、daemon agent 仍弹说明框。
    - **③ 多命令合并授权 —— 测量后结论为「不做」**:先前列出的「改名保存 3 次 / 启动 3 次 / 停止 2 次」是 **osascript 进程 spawn 次数,不等于用户看到的弹窗次数** —— macOS 授权缓存(约 5 分钟)吸收同一 burst 内的后续调用,`authCacheMin` 另外抑制应用说明框。且逐条看:启动序列(`bootstrap` 后需重新读取才能判断是否 `kickstart`)与停止序列(`SIGTERM` → 等待 → `SIGKILL`)都**不能安全合并**(合并会改变语义或引入无条件 `kickstart -k`);④ 落地后 system scope 更是完全不提权。唯一可安全合并的「改名保存」属低频路径,收益不足,不做。


## AI 助手页迁移(阶段 4:真实引擎 + MCP,2026-09-22)

demo 的 AI 页是**脚本化模拟**(`aiScenes` 时间线 + `aiChats` 预置会话),迁移后由 **pi 真实引擎**驱动
(`@earendil-works/pi-ai` + `pi-agent-core`,锁精确版本 `0.87.0`)。UI 逐项对齐原型,数据来源整体替换。

### 落地位置

| 层 | 文件 | 说明 |
|---|---|---|
| 契约 | `shared/ai.ts` | 消息模型 / 运行事件 / 引擎状态 / 技能;**内容块数组**,非固定槽位 |
| 引擎 | `main/ai/{llm,agent→chat-service,message-map,secret-store,skills,prompts/expert}` | `llm.ts` 是全仓唯一 import pi-ai 的文件(防腐层) |
| 工具 | `main/ai/tools/{shared,service,plist,cron,log,index}` | 14 个工具(9 只读 + 5 写),**内置聊天与 MCP 共用同一份** |
| MCP | `main/mcp/{server,http-endpoint,stdio-entry}` | stdio 与 HTTP 环回;入口见 `electron.vite.config.ts` 的第二 main entry |
| 视图 | `renderer/src/modules/ai/*`(`AiView`/`AiRail`/`AiMessages`/`AiCards`/`AiComposer`/`AiMentionPopover`/`AiMcpModal`)+ `state/ai-store.ts` | 逐项对齐 `js/ai.js` |
| 设置 | `modules/settings/AiPane.tsx` + `state/settings-nav-store.ts` | 设置页第 7 个 tab;Key 走 safeStorage |
| 样式 | `styles/ai.css` | **逐字节复制自 `demo/css/ai.css`**,勿就地修改 |

### 与 demo 的差异(逐条)

1. **消息模型改内容块数组**(`docs/design/ai-message-model-gap.md` 的结论)。demo 是 `{thinking,steps,text,cards,suggest}` 固定槽位 + 写死渲染顺序,表达不了「工具中途插一段文字」;现在助手消息是 `text / thinking / image / toolCall / card / suggest` 的**有序块数组**,按到达顺序渲染。工具**调用**在助手消息的 content 里,工具**结果**是独立记录,按 `toolCallId` 配对(不是数组下标)。
2. **审批改为引擎钩子触发**,不是消息里的一种卡片类型。demo 把 `approve` 做成 `cards[]` 的一种 `kind`;真实机制是宿主的 `beforeToolCall` 拦下调用 → 抛授权卡 → 用户裁决 → 放行或 `{block:true}`。**授权卡视觉与位置不变**,仍内联在消息流里。
3. **预置会话(`aiChats`)不移植**。它们是手写的假历史(引用 mock agent),真实应用不该凭空多出这些对话。会话栏只列用户真跑过的会话(落 `${userData}/ai-sessions.json`)。
4. **场景脚本(`aiScenes`)整体不移植** —— 由真实模型驱动;技能(= 任务提示词 + 工具白名单)在 `main/ai/skills.ts`,4 项与 demo 同名同图标。
5. **正文改 Markdown 渲染**(新增 `lib/markdown.tsx`):demo 是「转义 + `pre-wrap`」裸文本,因为它是手写 mock;真实模型输出标题/列表/代码块时裸文本会一片混乱。产出 **React 节点,不拼 HTML**,HTML 一律 inert。demo 的 `ai.css` 未含相关样式,markdown 样式落在 `app-chrome.css`。
6. **thinking 块渲染正文**(demo 只有「思考中」三点转圈);`stopReason` 7 态、`usage`/cost 有展示位 —— 都是 demo 没有的位,新增在消息底部 meta 行。
7. **未配置态是真判定**:demo 的 `aiCfgConfigured()` 只看 localStorage 里有没有非空 Key 串;真实实现按「该协议是否存有 Key」判定,且 **Key 本体不出 main**(IPC 只回 `hasKey` 布尔)。
8. **「测试连接」真发一次最小请求**(demo 按 Key 里有没有 `example`/`invalid` 假装成败)。
9. **MCP 挂载命令是真实路径**(`ELECTRON_RUN_AS_NODE=1 <应用二进制> <app.asar>/out/main/launcher-mcp.js`),不是 demo 里示意性的 `/Applications/Launcher.app/Contents/MacOS/launcher-mcp`。
10. **工具行不再有 `warn` 字符串级别**:结果错误是 `isError` 布尔(pi 约定);界面三态由 `status`(ok/warn/err)表达,其中 **warn 特指「用户取消」**——与真正失败在视觉上分开。
11. **工具显示名用 `label`**(pi 的 `AgentTool.label`),不再拿工具 id 当显示名(demo 显示 `generate_plist`,现在显示「生成 plist 草稿」)。
13. **模型 id 按协议各存各的**(2026-09-22 用户报「切换协议后模型没保留」):demo 只有一份全局配置,没有这个问题。真实实现里端点一直是按协议存的(`aiProviders[id].baseUrl`),模型却是**一个全局槽位** `aiModelId` —— 切到另一协议再切回来就丢。已把模型挪进 `aiProviders[id].modelId`,全局键删除;老配置的 `aiModelId` 在 normalize 时迁移给「当时生效的那个协议」。
12. **切会话不中止运行**:demo 切换会话会 `aiAbortRun()` 掐掉本地脚本;真实运行归 main 管,切走再切回来仍在跑。

### 设置页 AI pane 的三处调整(2026-09-22,用户要求)

1. **Key 输入框默认明文** —— demo 是 `type=password`(占位串本来也是假的)。真实场景下用户粘完 Key 看不到自己贴了什么,核对困难,故改为**默认明文**,右侧加一枚眼睛按钮可临时遮挡。同时:**保存后不再清空输入框**(以前一保存就清空,更没法核对);并**移除「清除密钥」按钮**(用户明确不要;`clearKey` 能力保留,仍被「恢复默认」用于清两条协议的 Key)。
2. **模型快捷填入只列最近用过的 3 个** —— demo 铺的是整个内置目录(Anthropic 14 个),既撑爆一行也没人会点第 14 个。改为按协议维护 `recentModels`(新在前、去重、上限 3,**含当前模型并以 `active` 态呈现**),两侧协议一视同仁。
3. **chip 行不再横向滚动,改为占满整行换行** —— demo 后期把 `flex-wrap` 从 wrap 改成 `nowrap + overflow-x: auto`(为了让 4 个预设挤在一行对齐输入框),但它挤在右上角那 280px 的一列里,多了就得拉滚动条。覆盖样式在 `app-chrome.css`(`.ai-model-picks-wide`,双类选择器压过冻结的 `ai.css`),换成**换行 + 占满整行宽度**(含左半区)。

⚠ **附带修掉的一个测试性缺口**:`LAUNCHER_E2E_USER_DATA` 此前只隔离 userData,而设置文件仍写真实的 `~/.config/launcher/config.json` —— 自动化验证会**悄悄改掉用户的配置**(本项目真发生过:验证脚本把 Anthropic 端点留成了一个已关闭的本机测试地址)。`app.getPath('home')` 走 NSHomeDirectory,改 `HOME` 环境变量无效,故改为在同一个环境变量下**显式把 config 路径也指到隔离目录**。

### AI pane 第二轮调整(2026-09-22,用户要求)

4. **显示/隐藏按钮移到输入框上方并靠右** —— 原来与输入框同排,挤在「测试连接」旁边。
5. **Key 常驻显示** —— 光显示「已保存」用户没法确认当初填了什么。新增 `ai:revealKey`(main → 明文)按需取回填进输入框;**这是一处刻意放宽**:引擎态与其它视图仍只拿 `hasKey` 布尔,Key 依旧只存 safeStorage、不落设置文件。值没变时不重写(避免每次失焦都写一次盘)。
6. **模型 chip 改靠右** —— 与上方输入框同侧;放不下时向左换行(仍保留「不横向滚动」)。
7. **新增「自定义请求头」** —— 起因是下面那条 cc-switch 调试:企业网关常按客户端标识放行。按协议存 `headers: Record<string,string>`,UI 是多行「名称: 值」文本框。
   ⚠ **实现要点**:附加头必须注入到 **`streamSimple` 的 `options.headers`**,不能放 `createProvider({ headers })` —— 后者到不了线上(实测:A 方案仍 403,C/D 方案才通)。`testConnection` 也必须带上,否则「测试连接」与实际对话会给出相反结论。

### cc-switch 本地代理接入(2026-09-22,用户要求调试)

本机 Claude Code 走 `cc-switch`(监听 `127.0.0.1:15721`)转发到企业网关 `ai-service.tal.com/coding`。
**此前直连该代理一律 403,根因是 `User-Agent`**:上游只放行 UA 前缀为小写 `claude-cli` 的请求(`Claude-CLI/1.0`、`curl/8.0`、无 UA 全部 403;`claude-cli` 裸串即可)。补上自定义请求头后,应用侧**真实跑通**:连接测试通过、真实对话调用了工具(`list_services` 返回本机 30 项任务的真实数据)、零 console 错误。

配置(直接在设置 › AI 助手 › Anthropic 卡片里填):

| 字段 | 值 |
|---|---|
| API 端点 | `http://127.0.0.1:15721` |
| 自定义请求头 | `User-Agent: claude-cli/2.0.0` |
| API Key | `PROXY_MANAGED`(cc-switch 写进 `~/.claude/settings.json` 的固定代理令牌) |
| 模型 ID | `claude-sonnet-5` / `claude-opus-5` / `claude-haiku-4-5` 等(由 cc-switch 映射到上游真实模型) |

⚠ **两个注意**:① 该网关把模型名映射到自己的后端(实测 `claude-sonnet-5` → `deepseek-v4-flash-vision`、`claude-opus-5` → `deepseek-v4-pro`),因此界面上的**费用是按你填的模型名用 pi 目录价估的,不是真实计费**;② cc-switch 必须处于运行状态(其代理端口是本机进程,应用侧无法代它启动)。

### AI pane / 对话页 第三轮调整(2026-09-22,用户要求)

8. **自定义请求头挪到「模型 ID」下方** —— 端点/密钥/模型/请求头这个顺序不符合"主字段在前、附加项靠后"的阅读习惯。
9. **AI 输出语言跟随应用语言** —— 此前专家提示词写死「用简体中文回答」,英文界面下助手仍回中文。改为 `expertPrompt(lang)`:
   提示词本体**保持单源**(中文撰写,模型两种语言都听得懂指令),只替换「输出语言」那一段,并在**开头再点一次**
   (长提示词里语言指令只出现一次时模型容易跟丢)。MCP Prompts 同样按语言产出(stdio 进程从设置文件读 `language`)。
10. **Key 的眼睛按钮改为浮在输入框内部右缘** —— 上一轮放在输入框上方另起一行,视觉上脱离了输入框。
    现在 `position: absolute` 贴在框内右侧,输入框右侧留 30px 内边距,长 Key 不会钻到按钮底下。
11. **「测试连接」精简为图标钮**(带 tooltip + 测试中转圈),文字版那一行占地过大。
12. **设置页去掉顶栏搜索框** —— demo 的 `MODULES.settings` 本就没有搜索框,而 React 侧此前按 `module !== 'ai'` 硬判,
    给设置页多渲染了一个点了没反应的框。改为**由注册表的 `searchPlaceholderKey` 驱动**(只有 agents/crontab/services 有)。
13. **设置页 tab 顺序** —— 「AI 助手」移到「登录项」之前。

### 右侧会话锚点(2026-09-22,用户要求,对齐 Codex 桌面端体验)

`modules/ai/AiAnchors.tsx`,浮在画布右侧:
- **锚点 = 用户消息**(每轮对话的起点)。语义上就是"会话位置",数量也天然受控;按助手消息切会碎得多(一条 run 里有多条 assistant 消息)。
- **一次最多显示 10 个**(`MAX_VISIBLE`);超出时锚点条自身成窗口。**指针移到条的上/下缘即持续滚动窗口**(rAF + 边缘 26px 感应区),
  这就是用户要的"移动到区域顶部或尾部时实现该区域滚动"。
- **悬浮**:目标消息加柔和高亮环 + 锚点条旁浮出该轮的首行文字;当前阅读位置那个锚点常驻加长加亮。
- **点击**:平滑滚到该消息(顶部留 12px)。
- ⚠ **两个实现要点**:① 悬浮高亮**用命令式加类**,不走 React state —— 否则每次划过都要重渲整条消息流(流式输出时尤其亏);
  ② 跳转用 **`scrollTop` 赋值而不是 `scrollTo({behavior:'smooth'})`** —— 后者在这个容器上实测不生效(调用后 scrollTop 纹丝不动),
  而 `.ai-scroll` 本就带 CSS `scroll-behavior: smooth`,赋值同样平滑;本视图的 `scrollBottom` 也是这么写的。
- ⚠ 手动滚动窗口后有 600ms 的"自动跟随"锁,否则"当前锚点必须在窗口内"会把窗口立刻拉回去。

### 刻意不做 / 未覆盖

- **孤儿任务不在 AI 工具里报**。判定「launchd 里还在、plist 已不存在」需要逐 label 跑 `launchctl print` 拿路径,而 launchctl 的表里混着上千条系统自带服务(本就不在扫描的三个目录里)。实测按「表里有、文件没有」粗判会报出 **1344 条假孤儿** → 宁可不报。界面上的孤儿横幅用的是有界候选集,不受影响。
- **孤儿/按行级别着色**:工具结果的行级 `level` 未随消息模型下发(结果块只带文本),步骤级 ok/warn/err 保留。
- **全量运行耗时**:demo 自己播放脚本所以能计时;真实运行的「用时」= 各工具耗时之和(没有整轮计时源)。

### 后端新增(超出原型)

- **同一份 ToolRegistry 供给内置聊天与 MCP**;MCP 走低层 `Server` 直接复用 typebox(= JSON Schema)定义,零二次转换。
- **MCP 权限模式**:`readOnly`(默认,只暴露 9 个只读工具)/ `full`(加 5 个写工具,带 `destructiveHint` 标注)。⚠ 只对 **HTTP 环回连接**名副其实 —— stdio 是用户自己在终端拉起的进程,以用户身份运行,应用管不着。
- **HTTP 端点必须显式拒绝非 POST**(无状态模式)。交给 transport 处理时它不给应答,MCP 客户端的 `connect()` 会一直挂着(实测卡满 90s),表现为「HTTP 通道连不上」而服务端日志正常 —— 已加回归测试锁住。
- **专家提示词作为 MCP Prompts 暴露**(`expert` + 4 个技能),外部 Agent 拉到的与内置聊天同一份设定。
- **`core-services.ts`**:应用与 `launcher-mcp` 独立进程共用一份服务栈装配,避免两处漂移。

### 验收(2026-09-22)

- 单测:**591 项全绿**(AI 模块内 62 项);`typecheck` 双配置干净;`npm run build` 通过;demo 自检通过(demo 零改动)。
- **应用级 CDP 端到端**:用本地假 OpenAI 兼容端点(真 SSE 流)跑完整链路 —— 未配置引导态 → 设置页配端点/存 Key(safeStorage)→ 真实连接测试 → 流式对话 → 工具步骤块(人类可读工具名)→ 内联授权卡(含待执行命令)→ **取消**(卡片转已取消、该步标 warn、工具确未执行)→ **授权**(卡片转已执行、工具真执行)→ 会话栏/正文搜索高亮 → MCP 弹窗。20 项断言全过,运行期零 window error。
- **独立进程 MCP**:用弹窗给出的真实命令拉起 `launcher-mcp`,握手成功、9 个只读工具、5 个 prompts、真实工具调用返回本机数据、`write_plist` 在 readOnly 下被正确拒绝。
- **真机只读工具冒烟**:30 个 launchd 任务(三作用域)、2 个非任务占位文件、停用位、brew 服务、33 个监听端口均如实报出。
- 验收未在机器上留下任何残留(launchd 目录/launchctl/crontab 均已核对为空)。
- **真实第三方 provider 验收(2026-09-22)**:用 OpenAI 兼容端点(`apihub.agnes-ai.com/v1` + `agnes-2.5-flash`)实跑 ——
  连接测试通过;真实对话**确实调用了工具**(`list_services` / `collect_diagnostic_context`,工具名按 label 显示)、
  工具输出 19 行真实数据落进消息流;回答里给出本机真实的 30 项任务统计与任务表;
  **推理内容按 thinking 块渲染**(该模型的 `reasoning_content` 经 pi 的 openai-completions 适配器映射为 thinking 块);
  正文里的 Markdown 表格渲染成真表格。
- **真跑中发现并修掉的三处**:
  ① **工具轮数上限打满时是静默死路** —— 模型连续调工具直到上限,用户只看到一屏步骤、没有任何答案也没有解释。
     现在末条终止原因为 `toolUse` 时给出提示(`ai.notice.toolLimit`),并收紧了专家提示词(禁止逐个枚举、
     要求先给结论):同题实测从 **8 轮 36 次调用无答案** 降到 **3 轮 2 次调用 + 完整回答**。
     ⚠ 该提示**必须限定在整段对话的最后一条** —— 中间任何调过工具的助手消息都是 `toolUse` 状态,不限定会满屏重复。
  ② **未知计价显示 `$0.0000`** 会被读成「免费」而不是「不知道」—— 改为仅有真实目录价时才显示。
  ③ **Markdown 表格退化成一堆竖线** —— 模型在概览/对比类回答里大量用表格,补了 GFM 表格渲染(`.md-table`,窄容器横向滚动)。
- **Anthropic 协议链路验收(2026-09-22)**:本机的 Claude 配置走 `cc-switch` 代理到企业网关(`ai-service.tal.com/coding`),
  实测该网关对第三方客户端**一律 403**(经代理、以及用配置里的 key 直连上游都试过),故**没能拿它当上游**。
  改用本地的 **Anthropic Messages 原生协议**端点验收(SSE 事件名、content_block_start/delta/stop、thinking 块带 signature、
  tool_use 的 input_json_delta 分片一个不少 —— 不是 OpenAI 转译),验的正是我们自己这条链路:
  provider 构造 / anthropic-messages 适配器 / thinking 映射 / tool_use 往返 / 计费展示。
  结果:配置与连接测试通过;模型显示名取自 pi 目录(`Claude Opus 5`);thinking 块渲染出推理正文;
  `input_json_delta` 分片被正确拼成参数;授权卡 → **授权** → 工具真实执行并回填结果 → 卡片转「已执行」;
  `已取消` 分支同样验过(该步标 warn);正文 Markdown 列表/代码块/引用正常;**用量带真实目录价**(`1108 tok · $0.0068`);
  运行期零 window error。
  ⚠ 副产品知识:pi 的 anthropic 适配器请求路径带查询串(`/v1/messages?beta=true`),自建端点判路由要按 pathname。
- ⚠ **仍未覆盖**:真实 Anthropic 上游(system/daemon 域的**成功特权写入**,需交互式授权)。写工具的取消/执行两条分支都已验,但「系统授权框走完并成功落盘」这一段没有。
