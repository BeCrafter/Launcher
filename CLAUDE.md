# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库现状

BeCrafter/Launcher 是一个 macOS 本地服务管理应用（管理 launchd / crontab / 端口服务）的设计原型仓库。**当前尚无 Swift 应用源码**——仓库里唯一的代码是 `docs/demo/` 下高保真可交互的 HTML 原型页，用于在原生实现前验证 UI/UX。README 为占位内容。

原型页内的「重构方案」视图（`#view-design`）和「plist 键覆盖」视图（`#view-plist`）描述了原生应用的计划架构（plist 作为唯一事实来源、RowCard/StatusDot 等 UI 原语、ManagedTask 协议、ToastCenter 错误层），是理解本项目长期方向的主要文档。

## 运行方式

无构建步骤，无测试框架，无 lint 配置。

- 打开演示页：直接双击 `docs/demo/index.html`（file:// 协议可用，无需服务器；不要在此引入 fetch/ES 模块，否则 file:// 下会失效）
- 或本地起静态服务：`cd docs/demo && python3 -m http.server` or `npx -y serve ./docs/demo`
- **改动后必跑自检**：`node docs/demo/check.mjs`（零依赖；CSS 括号/锚点、全部 js 语法、MOCK_DATA 结构、i18n 中英键一致、MODULES 注册表与 index.html 引用一一对应；失败 exit 1）。已配置 PostToolUse hook，编辑/写入后自动执行、失败即阻断
- 个别校验仍可用 `node --check docs/demo/js/*.js` 单点排查

## 页面架构（docs/demo/）

单页应用式原型：`index.html` 只有静态结构 + 资源引用，逻辑全部在经典 `<script>` 标签加载的全局作用域文件中（无模块、无 import，文件间通过全局函数/常量互相调用，HTML 内联 `onclick` 直接调用这些全局函数）。script 加载顺序有依赖，调整顺序前确认：`i18n → data → utils → statusbar → 各视图 → drawer → settings → modules → modals → main`。

- **样式** `css/` 与 **脚本** `js/` 均按页面结构拆分，各文件的职责与关键函数见下方「文件地图」。主题通过 `--*` 变量实现（`:root` 深色 + `body.light-theme` 浅色覆写）
- **模块注册表** `js/config.js`：`MODULES` 是模块接线的单一事实来源——视图显隐、面包屑、顶栏操作区模板、搜索行为、底部状态栏配置全部在一条记录里，改模块/加模块只动这里
- **UI 原语组件** `js/components.js`：对齐设计视图「重构 A」的组件函数（`rowCard` / `statusDot` / `tagChip` / `actBtn` / `agentCard` 等），同类 markup 只此一份
- **测试数据** `js/data.js`：全部演示数据集中在此文件的 `MOCK_DATA` 对象，页面与业务逻辑中不写死样例值（该约定是重构时确立的，新增演示数据务必加进 MOCK_DATA，不要硬编码进 HTML/JS）；文件末尾把各数组解构为 `agentData` / `cronData` / `svcData` 等全局常量供其他文件引用
- **多语言** `js/i18n.js`：`I18N` 字典（zh-CN / en-US 两份，新增文案需同时更新）、静态 HTML 通过 `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` 标记，JS 动态文本用 `t('key')`
- **模块切换** `js/modules.js` 的 `switchModule()`：控制 `#view-*` 显隐、重建顶栏按钮/搜索框（每模块的顶栏操作区是运行时 innerHTML 重写的）、驱动侧边栏折叠与底部状态栏
- **抽屉编辑器** `js/drawer.js`：Agent 编辑面板（编辑/状态/日志/XML 四个 tab），初始值由 `populateDrawerDefaults()` 从 `MOCK_DATA.drawer` 填充；日志 tab 有 4.5 秒轮询追加的模拟实时日志
- 外部 CDN 依赖（static0.xesimg.com）：FontAwesome 图标（必备）、Tailwind（基本未用）、Mermaid（仅装饰性架构图，加载失败被 try/catch 容忍）

## 文件地图（docs/demo/）

### 视图与页面入口

侧边栏仅 4 个入口（Launch Agents / 定时任务 / 端口服务 / AI 助手）+ 设置页按钮；`#view-login`、`#view-plist` 是纯静态说明页（i18n 文案 + 静态表格），有 `switchModule` 映射但无页面入口；`#view-design` 仅残留在面包屑/图标映射中。视图显隐由 `switchModule` 的 views 列表驱动。

### css/（规则与内联时代完全一致，仅按结构归文件）

- `base.css`：`:root` 主题变量与 `body.light-theme` 浅色覆写、reset/滚动条/动画、跨模块通用组件（tag / chip / toggle / status-dot / act-btn / d-btn / row-card / expand-grid / 表单 f-* / multi-val / toast / modal / empty-state）
- `layout.css`：app-shell、侧边栏（含折叠态与移动端）、顶栏 + 搜索、底部 launch-statusbar（含 560/680/860 响应式）
- `views.css`：filter-bar/chip、list-container、group-block、agent-col-card、row-expand/chevron、invalid-plist、Cron 内联编辑样式、文档页（doc-* / overview-cards / phase / mermaid-wrap）、key-table / key-status
- `settings.css`：设置页整块（settings-layout / tab-nav / pane / hero / section / theme-cards / keybind-badge / footer 与 760 响应式）
- `drawer.css`：抽屉（mask / hdr / ops 按钮 / 状态点 / tab 导航 / body / scroll / footer）、log-section、xml-section、cfg-group、trigger / ka / sched / socket 卡片、stat-grid、log-line

### js/（经典脚本，全局作用域，加载顺序见上）

- `i18n.js`：I18N 字典（zh-CN / en-US 双份）、`t()` / `fmt()` / `applyLanguage()`、`currentLang` / `currentModule` 状态
- `data.js`：`MOCK_DATA` + 全局常量别名（`agentData` / `cronData` / `svcData` / `CRON_PRESETS` / `GITHUB_REPO_URL` 等，全部取自 MOCK_DATA）
- `config.js`：`MODULES` 模块注册表（每条记录自包含：viewId / icon / breadcrumb / searchPlaceholderKey / searchHandler / actions 模板 / statusbar 构建函数 / showStatusBar）；`DEFAULT_TOP_ACTIONS` 为无搜索模块共用顶栏
- `components.js`：UI 原语组件——`statusDot` / `statusLabel` / `tagChip`（含合并色板 `TAG_COLORS`）/ `actBtn` / `groupBlock` / `rowInfo` / `rowCard` / `agentCard` / `emptyState`
- `utils.js`：showToast、openExternal、架构检测（`detectArch` / `archLabel`）、`themeLabel` / `languageLabel`、`truncate`、`toggleGroupBlock`、`toggleRowExpand`（tagColor/aiTagColor 已并入 components.js 的 TAG_COLORS）
- `statusbar.js`：`updateModuleStatusBar`（渲染 MODULES[mod].statusbar 配置）、`updateLaunchStatusBar`、`refreshSettingsStatusBar`
- `agents.js`：`renderAgents`（分组渲染 + invalid-plist 横幅）、`filterAgents` / `handleSearch`、`selectAgent` / `toggleAgent` / `brewAction`、`updateAgentFilterCounts`（过滤栏计数）
- `crontab.js`：`parseCronExpr`、`renderCron`、`filterCrons` / `updateCronStats`、内联编辑（`toggleCronEdit` / `applyCronPreset` / `updateCronExpr` / `saveCronEdit` / `cancelCronEdit` / `deleteCronJob` / `toggleCronJob`）
- `services.js`：`renderServices` + `killSvc` / `copyPort`
- `ai.js`：`renderAi`（Agent 组 + 技能组）、`filterAi` / `handleAiSearch` / `scanAiAgents` / `runWithAgent`、`aiIconBadgeCls`
- `drawer.js`：`openEditFloat` / `closeDrawerMask`、`drawerAgentState`、`updateOpsBar` / `drawerOpsAction`、`switchDrawerTab`（按 data-tab 属性匹配）、`efToggleTrig` / `efToggleSection` / `efSetKaMode`、`saveFloatAgent`、表单行构建（`addArgTo` / `addEnvTo` / `addWatchTo` / `delMvRow`）、`sci*`（StartCalendarInterval 规则构建器）、`toggleCfg`、日志（`clearLog` / `addLogLine` / `getTs`）、XML（`validateXml` / `copyXml`）、`populateDrawerDefaults`（初始化时从 MOCK_DATA.drawer 填充抽屉全部样例值）
- `settings.js`：`switchSettingsSection`、`setTheme`、`setLanguage`、`saveSetting`、`checkAppUpdates`、`resetSettings`、`loadSettings`、`fillSettingsMeta`（页脚/关于页版本号）
- `modules.js`：`switchModule`（配置驱动：读取 MODULES 记录完成视图显隐 / 顶栏重建 / 状态栏开关）、`handleModuleSearch`（顶栏搜索统一分发）、`syncSidebarLayout`、`toggleSidebarCollapse`、`checkMobile` / `toggleSidebar`
- `modals.js`：`openModal` / `closeModal` / `closeModalBg`、新建与导入弹窗（`showNewModal` / `showImportModal` / `createAgent` / `doImport`）、新建 Cron（`applyNewCronPreset` / `updateNewCronExpr` / `createCronJob`）
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
