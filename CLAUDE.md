# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库现状

BeCrafter/Launcher 是 macOS 本地服务管理应用（管理 launchd / crontab / 端口服务），基于开源 [LaunchManager](https://github.com/Sean10000/LaunchManager)（Swift）重构为 **TS + Electron** 实现（`src/`），核心目标是解决编辑体验问题并新增 AI 能力。

- **demo 是 UI/UX 设计基准（冻结）**：`docs/demo/` 的视觉/交互作为验收对照基线，**自 2026-09 起冻结不再改动**；demo → React 的逐项映射与已知差异见 `docs/design/demo-react-migration-map.md`（改任一侧时按表核对）
- **长期方向文档**：`docs/design/refactor-plan.md`（迁移矩阵 + 分阶段计划 + 已确认决策）、`docs/design/ai-capability.md`（AI 引擎/MCP/专家提示词方案，阶段 4 按此落地）
- README 为占位内容

## 运行方式

**应用（src/，UI 层迁移完成 + mock 数据驱动）**：
- 开发：`npm run dev`（electron-vite，热更新；重复启动由单实例锁捕获；`LAUNCHER_DEV_DEBUG_PORT=9223 npm run dev` 可开 CDP 调试端口供自动化验证）
- 测试：`npm test`（vitest，src/**/*.test.ts）；类型检查：`npm run typecheck`
- 应用编译（构建 + 端到端架构验证）：`npm run build:app`（默认本机架构）/ `build:app:arm64` / `build:app:x64` / `build:app:universal` / `build:app:all`（arm64+x64 依次）
  - `scripts/build-app.mjs`：electron-vite build → electron-builder 打包（dist/，dir 目标）→ 验证：lipo 架构断言（主 bin + Electron Framework）+ 实际启动产物按进程二进制架构断言；主机无法原生运行的架构（如 Intel 机上 arm64）自动 SKIP 运行验证并注明
  - **打包图标固定 rocketOrbit2 浅色版**（icon-light.png → 现场生成 build/icon.icns）；electron-builder extraResources 仅打包 rocketOrbit2（v1 仅作仓库备份不进包）；electron 二进制走 ELECTRON_MIRROR（env > .npmrc > npmmirror 兜底）；未配置开发者证书时 electron-builder 跳过代码签名（ad-hoc 行为，正式分发需补签名）
- 品牌图标（2026-09 定稿：**rocketOrbit2 v2 紫调双主题 = 项目唯一图标**，v1 rocketOrbit 仅磁盘备份、应用内无切换入口）：`npm run icon`（`scripts/gen-custom-icon.mjs` 插画通用生成器，`--name <变体名>` / `--src <源图>` 参数化，源图仓库 `resources/app-logo-src/`）；`npm run icon:theme`（`scripts/gen-demo-logos.mjs`，python3+PIL+numpy → ① demo logo 图 ② rocketOrbit2 深浅图 ③ icns ④ `rocketOrbit2Theme.ts` 双主题 dataURL。**会写 docs/demo/（冻结目录），本轮禁止执行**）。**尺寸基准：贴纸 80.5% 画布、四角透明**
- **设置持久化**：`${HOME}/.config/launcher/config.json`（`src/main/settings/store.ts` 原子写 + 损坏回 .bak；schema 单一来源 `src/shared/settings.ts`；main 唯一写者，renderer 经 `settings:*` IPC 乐观读写，首帧经 additionalArguments 注入免闪烁）

**演示页（docs/demo/）**：
- 打开演示页：直接双击 `docs/demo/index.html`（file:// 协议可用，无需服务器；不要在此引入 fetch/ES 模块，否则 file:// 下会失效）
- 或本地起静态服务：`cd docs/demo && python3 -m http.server` or `npx -y serve ./docs/demo`
- **改动后必跑自检**：`node docs/demo/check.mjs`（零依赖；CSS 括号/锚点、全部 js 语法、MOCK_DATA 结构、i18n 中英键一致、MODULES 注册表与 index.html 引用一一对应；失败 exit 1）。已配置 PostToolUse hook，编辑/写入后自动执行、失败即阻断
- 个别校验仍可用 `node --check docs/demo/js/*.js` 单点排查

## 重构进度（对照 docs/design/refactor-plan.md）

- 阶段 0（脚手架：electron-vite + React 19 + TS + 单实例 + 窗口/Tray）✅
- 阶段 0.5（图标定稿：v2 唯一图标 + 设置持久化 `~/.config/launcher/config.json`）✅
- **UI 层迁移**（demo → React，mock 驱动）：Agents / 定时任务 / 端口服务 / 设置页六 pane / Agent 抽屉(4 tab)/ 全部浮层 ✅——逐项映射见 `docs/design/demo-react-migration-map.md`
- **设置后端完善**（2026-09-10）：15 键全部「落盘 + 生效」；appliers 按域模块化；menubarBadge→Tray 角标 / fseventsActive→fs.watch 链路 / cmdTimeout→ShellRunner 地基 / xmlIndent→编辑器+格式化 全部真实接线（cronLogRetainDays 待阶段 2）；关于页/登录页 mock 真实化（app:info 版本 / GitHub Releases 检查更新 / 系统设置跳转）✅
- **阶段 2/3 真实后端**（2026-09-11）：定时任务（真实 crontab 读写/提权/日志/文件头面板/下次执行预测）+ 端口服务（lsof 发现/分类管线/kill/重启/Docker 降级/按需轮询/角标）✅——差异见 `docs/design/demo-react-migration-map.md`「阶段 2/3 落地差异」
- **阶段 1 真实后端**（2026-09-11）：Launch Agents（launchctl 域映射/bootstrap-bootout-kickstart-enable/plist 三目录扫描与提权写/表单⇄XML 双向/真实状态与日志/brew 合并与路由）✅——差异见 migration-map「阶段 1 落地差异」；**三域（agents/cron/services）至此全部真实**
- 阶段 4 AI+MCP / 阶段 5 双形态与设置收尾（待办）

## src/ 文件地图（Electron 应用，UI 迁移后）

```
src/
├── main/              # 主进程（唯一事实来源）
│   ├── index.ts       # 窗口单实例 + 启动序(设置→applier 注册表→建窗→IPC) + dev-check + 关窗常驻(menubarOnly) + windowOpen 拦截
│   ├── settings/
│   │   ├── store.ts   # config.json 原子写存储(损坏回 .bak/onChange/路径注入)
│   │   ├── types.ts   # ApplyCtx/SettingsApplier/TrayController(域间唯一契约)
│   │   └── appliers/  # 按域副作用模块(appearance/dock/tray/login/fsevents)+ index.ts 注册表调度
│   ├── ipc.ts         # settings:get/set/reset、app:info、agents:badgeCount、app:checkUpdates、shell:openExternal(url-guard 白名单)、settings:changed 广播
│   ├── services/      # 执行层:shell-runner/dir-watcher/update-check/elevation(提权)/launchctl-service+plist-service+brew-agent-service+agent-service(阶段1)/crontab-service/process-discovery/termination/docker-service
│   ├── domains/       # 纯函数领域层:launchctl-parse/plist-xml/agent-form(阶段1)+crontab/cron-next-run→shared/lsof-parse/service-classify/docker-parse/log-lines
│   ├── stores/        # AgentStore/CronStore/ServiceStore（阶段 1 起）
│   ├── ai/            # registry/llm/agent/skills/prompts（阶段 4）
│   └── mcp/           # MCP stdio server（launcher-mcp 入口，阶段 4）
├── preload/           # contextBridge 白名单 IPC（window.launcher;initialSettings 经 additionalArguments 注入;onEvent 白名单订阅）
├── renderer/src/
│   ├── components/    # 分层组件:ui/(L0 原语 TagChip/StatusDot/ActBtn/Toggle/Chip/Toast…)、Modal/GroupBlock/FilterBar/StatusBar(L1)、cards/(L2 Agent/Svc 卡)、overlays/(提权/危险/导入)、XmlEditor(CodeMirror 6)
│   ├── modules/       # 视图:agents/cron(卡片+内联编辑+日志抽屉+新建模态)/services/drawer(壳+4 tab+SciBuilder+MultiValueList)/settings(6 pane)
│   ├── layout/        # AppShell/Sidebar/Topbar/ViewHost
│   ├── state/         # zustand:settings(乐观+IPC)/ui(路由/浮层/toast)/agents/cron/services/drawer(抽屉状态机)/bootstrap
│   ├── data/          # 数据接缝:ports(仓储接口)/index(三域全 IPC)/ipc/(真实后端映射)/mock/(仅剩 mock-data 静态镜像:urls/aiAgents 等)
│   ├── i18n/          # dict.*.ts 由 scripts/port-demo-i18n.mjs 生成(勿手改)+ t/fmt/useT
│   ├── lib/           # 纯函数:cron/sci/plist/classify/ops-bar(5 态表)/elevation(Promise API)/utils/modules(注册表)/statusbars
│   ├── hooks/         # useT/useFmt/useSidebarLayout(ResizeObserver+折叠三重同步)/useAppInfo(app:info 模块级缓存)
│   ├── assets/        # rocketOrbit2Theme.ts(生成的双主题 dataURL)
│   └── styles/        # base/layout/views/settings/drawer.css(逐字节移植自 demo,勿就地修改)
└── shared/            # settings.ts(schema+normalize)/models.ts(领域类型)/ipc.ts(通道契约+事件)/url-guard(外链 scheme 白名单)/constants/api
```

约定：主进程为唯一事实来源；renderer 经 preload 白名单 API 读取 + `settings:changed`/`agents:dirChanged` 订阅；mock 驱动的视图走 `data/` 接缝（后端阶段换 ipcDataSource 零改动）；纯函数配 vitest；新增设置 = `shared/settings.ts` 加键 + `main/settings/appliers/` 对应域模块 + 渲染层消费点（配置单文件不散落）；**移植文件头注释 `ported-from: docs/demo/...`；styles/ 与 i18n 字典/`mock-data.ts` 勿手改（生成脚本见 scripts/）**。

## 页面架构（docs/demo/，冻结基线——以下为 demo 自身约定，仅作对照阅读）

单页应用式原型：`index.html` 只有静态结构 + 资源引用，逻辑全部在经典 `<script>` 标签加载的全局作用域文件中（无模块、无 import，文件间通过全局函数/常量互相调用，HTML 内联 `onclick` 直接调用这些全局函数）。script 加载顺序有依赖，调整顺序前确认：`i18n → data → utils → statusbar → 各视图 → drawer → settings → modules → elevation → modals → main`（elevation/modals 仅为运行时引用互调，先加载其一亦可，但保持此序）。

- **样式** `css/` 与 **脚本** `js/` 均按页面结构拆分，各文件的职责与关键函数见下方「文件地图」。主题通过 `--*` 变量实现（`:root` 深色 + `body.light-theme` 浅色覆写）
- **模块注册表** `js/config.js`：`MODULES` 是模块接线的单一事实来源——视图显隐、面包屑、顶栏操作区模板、搜索行为、底部状态栏配置全部在一条记录里，改模块/加模块只动这里
- **UI 原语组件** `js/components.js`：对齐设计视图「重构 A」的组件函数（`rowCard` / `statusDot` / `tagChip` / `actBtn` / `agentCard` 等），同类 markup 只此一份
- **测试数据** `js/data.js`：全部演示数据集中在此文件的 `MOCK_DATA` 对象，页面与业务逻辑中不写死样例值（该约定是重构时确立的，新增演示数据务必加进 MOCK_DATA，不要硬编码进 HTML/JS）；文件末尾把各数组解构为 `agentData` / `cronData` / `svcData` 等全局常量供其他文件引用
- **多语言** `js/i18n.js`：`I18N` 字典（zh-CN / en-US 两份，新增文案需同时更新）、静态 HTML 通过 `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` 标记，JS 动态文本用 `t('key')`
- **模块切换** `js/modules.js` 的 `switchModule()`：控制 `#view-*` 显隐、重建顶栏按钮/搜索框（每模块的顶栏操作区是运行时 innerHTML 重写的）、驱动侧边栏折叠与底部状态栏
- **抽屉编辑器** `js/drawer.js`：Agent 编辑面板（编辑/状态/日志/XML 四个 tab），初始值由 `populateDrawerDefaults()` 从 `MOCK_DATA.drawer` 填充；日志 tab 有 4.5 秒轮询追加的模拟实时日志
- **提权交互** `js/elevation.js`：非用户所属权限内容（系统级 plist、/etc/crontab、launchctl 特权域）的统一流程——`ELEVATION.request({detail, command})` 返回 Promise<boolean>（`launcher_authCacheMin` 凭证缓存窗口内静默通过；密码非空即授权；取消返回 false 不残留）；`confirmDangerousAction({detail})` 危险操作二次确认（`launcher_confirmDangerous=false` 可关闭）。已在 index.html 挂 elevationModal / dangerModal，接线点：drawer.js（系统级保存/删除、抽屉 ops）、crontab.js（system 编辑/删除）、modals.js（新建 system cron）。**注意：demo 的密码输入框是 macOS 系统授权框的前端模拟；真实实现走 osascript `with administrator privileges` 系统原生框、应用不碰密码，落地时去掉密码框（详见 docs/design/refactor-plan.md「提权模态」）**
- 外部 CDN 依赖（static0.xesimg.com）：FontAwesome 图标（必备）、Tailwind（基本未用）、Mermaid（仅装饰性架构图，加载失败被 try/catch 容忍）

## 文件地图（docs/demo/）

### 视图与页面入口

侧边栏仅 4 个入口（Launch Agents / 定时任务 / 端口服务 / AI 助手）+ 设置页按钮；`#view-login`、`#view-plist` 是纯静态说明页（i18n 文案 + 静态表格），有 `switchModule` 映射但无页面入口；`#view-design` 仅残留在面包屑/图标映射中。视图显隐由 `switchModule` 的 views 列表驱动。

### css/（规则与内联时代完全一致，仅按结构归文件）

- `base.css`：`:root` 主题变量与 `body.light-theme` 浅色覆写、reset/滚动条/动画、跨模块通用组件（tag / chip / toggle / status-dot / act-btn / d-btn / row-card / expand-grid / 表单 f-* / multi-val / toast / modal / empty-state）
- `layout.css`：app-shell、侧边栏（含折叠态与移动端）、顶栏 + 搜索、底部 launch-statusbar（含 560/680/860 响应式）
- `views.css`：filter-bar/chip、list-container、group-block、agent-col-card、row-expand/chevron、invalid-plist、Cron 内联编辑样式、文档页（doc-* / overview-cards / phase / mermaid-wrap）、key-table / key-status
- `settings.css`：设置页整块（settings-layout / tab-nav / pane / hero / section / theme-cards / footer 与 760 响应式）
- `drawer.css`：抽屉（mask / hdr / ops 按钮 / 状态点 / tab 导航 / body / scroll / footer）、log-section、xml-section、cfg-group、trigger / ka / sched / socket 卡片、stat-grid、log-line

### js/（经典脚本，全局作用域，加载顺序见上）

- `i18n.js`：I18N 字典（zh-CN / en-US 双份）、`t()` / `fmt()` / `applyLanguage()`、`currentLang` / `currentModule` 状态
- `data.js`：`MOCK_DATA` + 全局常量别名（`agentData` / `cronData` / `svcData` / `CRON_PRESETS` / `GITHUB_REPO_URL` 等，全部取自 MOCK_DATA）
- `config.js`：`MODULES` 模块注册表（每条记录自包含：viewId / icon / breadcrumb / searchPlaceholderKey / searchHandler / actions 模板 / statusbar 构建函数 / showStatusBar）；`DEFAULT_TOP_ACTIONS` 为无搜索模块共用顶栏
- `components.js`：UI 原语组件——`statusDot` / `statusLabel` / `tagChip`（含合并色板 `TAG_COLORS`）/ `actBtn` / `groupBlock` / `rowInfo` / `rowCard` / `agentCard` / `emptyState`
- `utils.js`：showToast、openExternal、架构检测（`detectArch` / `archLabel`）、`themeLabel` / `languageLabel`、`truncate`、`toggleGroupBlock`、`toggleRowExpand`（tagColor/aiTagColor 已并入 components.js 的 TAG_COLORS）
- `statusbar.js`：`updateModuleStatusBar`（渲染 MODULES[mod].statusbar 配置）、`updateLaunchStatusBar`、`refreshSettingsStatusBar`
- `agents.js`：`renderAgents`（分组渲染 + invalid-plist 横幅）、`filterAgents` / `handleSearch`、`selectAgent` / `toggleAgent` / `brewAction`、`updateAgentFilterCounts`（过滤栏计数）
- `crontab.js`：`parseCronExpr`、`renderCron`、`filterCrons` / `updateCronStats`、内联编辑（`toggleCronEdit` / `applyCronPreset` / `updateCronExpr` / `saveCronEdit` / `cancelCronEdit` / `deleteCronJob` / `toggleCronJob`）；`saveCronEdit` / `deleteCronJob` 对 system 任务先 `confirmDangerousAction` 再 `ELEVATION.request` 提权
- `services.js`：`renderServices` + `killSvc` / `copyPort`
- `ai.js`：`renderAi`（Agent 组 + 技能组）、`filterAi` / `handleAiSearch` / `scanAiAgents` / `runWithAgent`、`aiIconBadgeCls`
- `drawer.js`：`openEditFloat` / `closeDrawerMask`、`drawerAgentState`、`updateOpsBar` / `drawerOpsAction`、`dpAction`（抽屉底部删除/克隆，原为未定义死代码已补齐）、`switchDrawerTab`（按 data-tab 属性匹配）、`efToggleTrig` / `efToggleSection` / `efSetKaMode`、`saveFloatAgent`、表单行构建（`addArgTo` / `addEnvTo` / `addWatchTo` / `delMvRow`）、`sci*`（StartCalendarInterval 规则构建器）、`toggleCfg`、日志（`clearLog` / `addLogLine` / `getTs`）、XML（`validateXml` / `copyXml`）、`populateDrawerDefaults`（初始化时从 MOCK_DATA.drawer 填充抽屉全部样例值）；`drawerOpsAction` / `saveFloatAgent` / `dpAction(delete)` 对 system/daemon scope 接入提权流程
- `settings.js`：`switchSettingsSection`、`setTheme`、`setLanguage`、`saveSetting`、`checkAppUpdates`、`resetSettings`、`loadSettings`、`fillSettingsMeta`（页脚/关于页版本号）
- `modules.js`：`switchModule`（配置驱动：读取 MODULES 记录完成视图显隐 / 顶栏重建 / 状态栏开关）、`handleModuleSearch`（顶栏搜索统一分发）、`syncSidebarLayout`、`toggleSidebarCollapse`、`checkMobile` / `toggleSidebar`
- `modals.js`：`openModal` / `closeModal` / `closeModalBg`、新建与导入弹窗（`showNewModal` / `showImportModal` / `createAgent` / `doImport`）、新建 Cron（`applyNewCronPreset` / `updateNewCronExpr` / `createCronJob`，系统级新建走提权）
- `elevation.js`：`ELEVATION.request`（提权：凭证缓存 `launcher_authCacheMin` / 密码非空授权 / 取消返回 false）、`confirmDangerousAction`（危险二次确认，`launcher_confirmDangerous=false` 关闭）；详见上方「提权交互」
- `main.js`：顶部执行序（实时日志 interval 4500ms、ResizeObserver、侧边栏初始态、架构检测、初始渲染 + `loadSettings`、mermaid 初始化）；末尾调用 `updateAgentFilterCounts` / `populateDrawerDefaults` / `fillSettingsMeta`
- `check.mjs`：自检脚本（见「运行方式」，hook 与手动共用）

### MOCK_DATA 关键结构

- 顶层键：`agents` / `invalidPlists` / `crons` / `services` / `aiAgents` / `aiSkills` / `cronPresets` / `liveLogs` / `drawer` / `meta` / `urls`
- `agents[].status`：`running` / `loaded` / `stopped`；`agents[].scope`：`user` / `system` / `daemon`；`isBrew: true` 标记 brew 服务
- `drawer.form`：编辑表单默认值（label / desc / processType / program / args / workingDir / nice / throttleInterval / env / triggers / keepAliveMode / keepAliveDict / watchPaths / sciEntries / stdout / stderr）；`drawer.status`：状态 tab 指标；`drawer.logLines`：初始日志行 `[ts, type, text]`；`drawer.xml`：XML tab 原文；`drawer.opsState`：抽屉操作栏初始态（loaded / enabled / running）
- `meta` / `urls`：版本号（设置页页脚、关于页）与 GitHub / 帮助链接（`HELP_URL` 供侧边栏帮助按钮使用）

## 硬性约定（每次改动必须遵守）

1. **模块只改注册表**：改模块/加模块 → 只动 `js/config.js` 的 `MODULES` 记录；仅在新增入口/视图时，再补两处 index.html（nav-item、`#view-*` div）。禁止在其他文件散落模块级映射（check.mjs 保证一一对应）
2. **UI 必须复用原语**：新增/修改界面元素 → 先查 `js/components.js`，同类元素必须调用组件函数，禁止拷贝同类 markup（一处修改全站生效）
3. **数据只进 MOCK_DATA**：演示数据/样例值改 `js/data.js`；文案改 `js/i18n.js`（zh-CN / en-US 同步）；不要硬编码进 HTML/JS
4. **改动后必跑自检**：`node docs/demo/check.mjs` 通过后才算完成（hook 会自动执行；失败需修复，不得绕过）

## 改动注意事项

- 数据驱动的表单值（抽屉、过滤计数、日志、XML、版本号）改变效果时，改 `js/data.js`，不要改 HTML 里的静态文本
- 新增模块视图时参照现有模式：`js/config.js` 加 MODULES 记录 + index.html 的 `#view-*` div（nav-item 按需）
- 演示页默认中文；改 i18n 文案需 zh-CN 与 en-US 两套同步
- 验证改动可见 `git show HEAD:docs/demo/index.html` 还原的旧单文件版对照基线（过滤栏计数、抽屉样例值等均由 `main.js`/`drawer.js` 初始化时从 MOCK_DATA 填充，对照需等页面加载完成）
