# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库现状

BeCrafter/Launcher 是 macOS 本地服务管理应用（管理 launchd / crontab / 端口服务），基于开源 [LaunchManager](https://github.com/Sean10000/LaunchManager)（Swift）重构为 **TS + Electron** 实现（`src/`），核心目标是解决编辑体验问题并新增 AI 能力。

- **demo 是 UI/UX 设计基准（冻结）**：`docs/demo/` 的视觉/交互作为验收对照基线，**自 2026-09 起冻结不再改动**（**冻结例外 2026-09-13：AI 助手页整体重设计为对话式 Agent 页**，其余页面继续冻结，逐项说明见 migration-map 文末「AI 对话页重设计」）；demo → React 的逐项映射与已知差异见 `docs/design/demo-react-migration-map.md`（改任一侧时按表核对）
- **长期方向文档**：`docs/design/refactor-plan.md`（迁移矩阵 + 分阶段计划 + 已确认决策）、`docs/design/ai-capability.md`（AI 引擎/MCP/专家提示词方案，阶段 4 按此落地）、`docs/design/distribution.md`（分发与安装：包体积精简 + 零成本双通道 + CI 发布，2026-09-17 已实施）
- README 为占位内容

## 运行方式

**应用（src/，UI 层迁移完成 + mock 数据驱动）**：
- 开发：`npm run dev`（electron-vite，热更新；重复启动由单实例锁捕获；`LAUNCHER_DEV_DEBUG_PORT=9223 npm run dev` 可开 CDP 调试端口供自动化验证）
- 测试：`npm test`（vitest，src/**/*.test.ts）；类型检查：`npm run typecheck`
- 应用编译（构建 + 端到端架构验证）：`npm run build:app`（默认本机架构）/ `build:app:arm64` / `build:app:x64` / `build:app:universal` / `build:app:all`（arm64+x64 依次）
  - `scripts/build-app.mjs`：electron-vite build → **字体瘦身**（按构建产物 CSS 实测引用，删 woff2 之后的 woff/ttf 兜底，省 ~13MB）→ electron-builder 打包（dist/，dir 目标）→ 验证：lipo 架构断言（主 bin + Electron Framework）+ 实际启动产物按进程二进制架构断言 + **asar 不含 node_modules 断言**；主机无法原生运行的架构（如 Intel 机上 arm64）自动 SKIP 运行验证并注明
  - **打包图标固定 rocketOrbit2 浅色版**（icon-light.png → 现场生成 build/icon.icns）；electron-builder extraResources 仅打包 rocketOrbit2（v1 仅作仓库备份不进包）；electron 二进制走 ELECTRON_MIRROR（env > .npmrc > npmmirror 兜底）；未配置开发者证书时 electron-builder 跳过代码签名（ad-hoc 行为，正式分发需补签名）
  - **包体积（2026-09-17 精简，与原值对照）**：arm64 **270MB**（原 499）/ x64 **259MB**（原 522）。三条勿破坏：① `package.json` 的 `dependencies` **保持为空**——纯 JS 依赖一律放 `devDependencies`，否则 electron-builder 会把整份 node_modules 打进 asar（+190MB，构建脚本的 asar 断言会 FAIL）② `electronLanguages` 只留 en/zh_CN/zh_TW（省 47MB）③ legacy 字体由构建脚本自动删，勿手工往 `out/renderer/assets/` 补文件
- **发布与安装**（详见 `docs/design/distribution.md`）：
  - 出发布产物：`npm run build:app:release`（= `--arch all --release`，产 zip+dmg，命名 `Launcher-<版本>-<架构>.{zip,dmg}`；**两条安装通道只消费 zip，dmg 为额外产物、不作为推荐路径**）；CI 同款在 `.github/workflows/release.yml`，打 tag `v*` 触发：校验版本 → typecheck/test → 构建 → 算 sha256 → **上传 Cloudflare R2**（`https://repo.iskill.site/launcher/`，另传 `Launcher-latest-<架构>.zip` 别名并带 `no-store`）→ **把 cask 推到 `BeCrafter/homebrew-brew`**（模板 `packaging/homebrew/launcher.rb` 是唯一事实来源，CI 只 sed 替换 version/url/两个 sha256，tap 仓库那份勿手改）→ 发 GitHub Release（备用下载源 + sha256 留档）。R2 secrets 挂在 `r2-publish` 环境上，跨仓推 cask 需 `TAP_GITHUB_TOKEN`（PAT，`GITHUB_TOKEN` 跨不了仓）。**推 cask 只动本包那一个文件**（CI 只 `git add "$CASK_PATH"` 并断言暂存区无其他文件——tap 会并存多个包的 cask）；`git push` 被拒即发版重跑，**不要强推**
  - **预发布**（版本号带后缀）：后缀**只允许 `alpha`/`beta`/`pre`/`rc`**——Homebrew `version.rb` 的 `PRERELEASE_SUFFIX` 只认这四个，其余（`-dev`/`-next`/`-canary`…）会被判为**比正式版更新**，导致正式版用户被 `brew upgrade` 推上去；`scripts/release-version.mjs` 对白名单外后缀**直接拒绝发布**。预发布**不触碰稳定通道**：跳过 `Launcher-latest-<架构>.zip` 别名、跳过 cask 推送、GitHub Release 标 `pre-release`（应用内「检查更新」打的是 `/releases/latest`，天然不推）。发版前可跑 `npm run release:check [-- --tag vX.Y.Z]` 把版本一致性与 tag 占用检查提前到本地（CI 复用同一实现，不在 YAML 另抄）
  - 用户安装：`curl -fsSL https://raw.githubusercontent.com/BeCrafter/Launcher/main/scripts/install.sh | bash`——**curl 不设 quarantine，这是绕过 Gatekeeper 的关键**，产物从 R2 拉（`LAUNCHER_R2_BASE` 可换镜像）；或 Homebrew `brew install --cask becrafter/brew/launcher`——⚠ **Homebrew 会主动打 quarantine**（`cask/download.rb` 无条件调用 `Quarantine.cask!`，且已移除 `--no-quarantine`），故 cask 必须靠 `postflight` 调 `xattr -dr` 清标记，模板与维护手册在 `packaging/homebrew/`
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
- **阶段 2/3 真实后端**（2026-09-11）：定时任务（真实 crontab 读写/提权/日志/文件头面板/下次执行预测）+ 端口服务（lsof 发现/分类管线/kill/重启/Docker 降级/按需轮询）✅——差异见 `docs/design/demo-react-migration-map.md`「阶段 2/3 落地差异」
- **端口服务覆写**（2026-09-17）：服务别名 / Host / 路径（双击改名 + 「配置」浮层）+ Open/Copy 改用完整 URL（修复 Copy 只复制端口号的 bug）+ 地址标签改可连接 host（恒量 `proto` 不再渲染）+ Docker 四处修复（裸命令 ENOENT 路径解析 / `docker ps` 显式超时 / docker chip 补过滤分支 / 不可用带原因提示）✅——差异见 migration-map 差异 21/22；存储为 `shared/settings.ts` 的 `serviceOverrides`（renderer 解析，**main 无需 applier**）
- **阶段 1 真实后端**（2026-09-11）：Launch Agents（launchctl 域映射/bootstrap-bootout-kickstart-enable/plist 三目录扫描与提权写/表单⇄XML 双向/真实状态与日志/brew 合并与路由）✅——差异见 migration-map「阶段 1 落地差异」；**三域（agents/cron/services）至此全部真实**
- **打开慢修复**（2026-09-11）：brew 移出 agents 列表关键路径（isBrew 改 `domains/brew-heuristic` 纯启发式，机制同源开源 BrewManagedSupport；brew services list 实测 11-13s 且被 cmdTimeout 杀掉）、scanAll 记忆+单飞、首屏骨架态（`components/ui/Skeleton`）、log show / brew 全调用点显式 45s 超时——差异见 migration-map「打开慢修复」；首屏 ~10s → ~0.9s
- **包体积精简 + 分发方案**（2026-09-17）：arm64 499→**270MB**、x64 522→**259MB**（根因 = electron-builder 把整份 node_modules 打进 asar，209MB→12.9MB；另裁 Electron 语言包 47MB、删 legacy 字体 13MB）；新增发布产物（dmg+zip）、`scripts/install.sh`（curl 通道）、`packaging/homebrew/`（Tap 模板 + `postflight` 清隔离标记）、`.github/workflows/release.yml`（打 tag 自动发布 + 输出 sha256）✅——完整原理与边界见 `docs/design/distribution.md`；CDP 实测打包产物 414 个 @font-face 零加载失败、界面渲染正常
- **Agent 编辑器整改**（2026-09-18，依据 `docs/design/agent-editor-remediation.md`，**该文优先级高于 migration-map 39/40**）：P0-1 label 校验+目录逃逸围栏+**提权层去 shell 拼接**（command+argv → 0700 临时脚本 → 只提权执行 `sh '<脚本>'`）；P0-2 保存/应用分离（`ApplyMode`，save 零 launchctl、saveAndApply 仅重载原已载入的任务、失败回滚并分阶段上报）；P0-3/P0-4 文档模型（`AgentDocument` + revision + XML 保存回源 + `renameAgent` 身份事务）；P1-1 CAS + dirtyFields；P1-2 全键 schema（`scanCompatibility` + `validateNewAgentInput`）；P1-3 保真边界（`<data>`/`<date>`/多注释 → 锁 B 类；不再宣称「原样保留」）；P1-4 分层提示与新建确认;**复审修复(五轮)**:ops 与写事务同锁、停用任务的启动显式确认、`StartInterval` presence(null=未设置)、逐键兼容说明(`CompatibilityEntry`)、UserName/Disabled 只读如实展示、运行态漂移提示;**CAS 统一走 `locateFresh`(fresh 记录即配置源,不再回取缓存快照)+ 写事务串行锁、草稿撞名/rename/clone 均过保真判据、改名旧文件删除失败可回滚、store 副作用回写带 requestVersion 校验、历史 Label 不 trim；**生命周期区排布修正(2026-09-19)**:未开启 KeepAlive 时单卡通栏(`.keep-alive-layout.solo`)、策略块改用与左卡同款 `TriggerCard`(说明收进 title)、「自定义条件」改由 drawer-store 模式位 `kaCustom` 决定留存(旧按派生预设渲染 → 点第一个 chip 编辑器整块消失)、条件每项独立成卡(`.ka-item`)✅——差异见 migration-map 第 41 条；**写路径契约 = `shared/models.ts` 的 AgentDocument/SaveFormInput/SaveXmlInput/RenameInput/SaveOutcome**
- **表单合规与体验修复**（2026-09-18）：三道合规缺口收口——① 非托管键不再静默丢键：**顶层非托管键原样保留 + 信息横幅**（实测「含任何非托管键就锁表单」会锁死本机 19/32 个真实 plist，故只保留不锁），仅「表单拥有父键」类（KeepAlive 未知子键 / env 非字符串 / SCI 异常形态）才走**两道拦截**（EditTab 横幅+禁用保存 / main 保存前拦截）；② KeepAlive **三态**（`false` 反向条件保真、「全未设置/触发卡关 = 不写键」、移除未文档化的 AfterInitialDemand）；③ `ThrottleInterval` 可区分「未设置」与 0（man 默认 10s）。另：托管键 15→19 + **往返白名单**（Disabled/EnableTransactions 无 UI 保真）、UserName 仅 daemon 域接线、XML tab 保存接线、「存草稿」假按钮删除、重复/恒量清理（CfgGroup 共享 / LIVE 徽章去重 / Scope 重复 / 恒量「管理方式」/ Weekday=7 归一）；**2026-09-19 字段政策**：Stdin(StandardInPath) 移出表单 → 进无 UI 往返白名单（man：任务非交互、stdin 默认 /dev/null；本机 32 个真实 plist 0 例，对照 StandardOutPath 7 例；要改走 XML）✅——差异见 migration-map 第 39/40 条
- **界面语言一致性**（2026-09-19，用户要求）：demo 写死的英文文案全部收口——分组副标题（Identification / Execution / Startup timing / Process lifetime / Stdio）删除、侧栏与面包屑的 `Launch Agents` 改中文「Agent 管理」、表单标签中文化 + **plist 键名进 `title` 悬停**（触发卡仍保留「中文名 + 键名」副行，键名与 XML tab 的对应不丢）、设置页 `Login Items` / `Login Item` 本地化、SCI 列英文 tooltip 删除；顺带修**反向**问题（英文模式露中文：侧栏帮助 tooltip / 设置页 GitHub tooltip / 新建 Cron 描述 placeholder）。保留英文的只有技术术语与标识符（launchd / plist / stdout / PID / 进程名 / 路径 / 命令行）✅——差异见 migration-map 第 41 条
- **Agent 列表运行状态筛选**（2026-09-19，用户要求）：过滤栏在类型组（全部 / Homebrew / 用户级 / 全局 / Daemon）之后加第二组 chips —— 全部状态 / 运行中 / 已载入 / 已停止（竖线分隔两组，文案复用卡片状态标签的 `status.*` 键），状态存 `agents-store.statusFilter`，与类型筛选是**「与」关系**（可叠加出「用户级 + 运行中」）；**次级视觉**：`Chip variant='sub'` → `.chip-sub` —— 不用胶囊形态，改成**方括号包住的纯文本**（`::before`/`::after` 出 `[` `]`，与文字之间吃 `.chip` 的 5px gap），无描边/无图标/无底色，选中**只把文字与括号变紫**（`--accent`），与主 chips 的「描边 + 图标 + 彩底彩字」拉开主次；「已加载但 plist 已不存在」孤儿横幅不属于任何状态分组，仅在状态不限时展示 ✅——差异见 migration-map「视图 1 Launch Agents」与已知差异第 12 条
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
│   ├── services/      # 执行层:shell-runner/dir-watcher/update-check/elevation(提权)/launchctl-service+plist-service+brew-agent-service+agent-service(阶段1)/crontab-service/process-discovery/termination/docker-service/docker-path(与 brew-path 同款绝对路径探测)
│   ├── domains/       # 纯函数领域层:launchctl-parse/plist-xml/agent-label(Label 安全闸)/agent-form(阶段1:托管键 19+往返白名单+scanCompatibility 全键 schema+validateNewAgentInput)+crontab/cron-next-run→shared/lsof-parse/service-classify/docker-parse/log-lines
│   ├── stores/        # AgentStore/CronStore/ServiceStore（阶段 1 起）
│   ├── ai/            # registry/llm/agent/skills/prompts（阶段 4）
│   └── mcp/           # MCP stdio server（launcher-mcp 入口，阶段 4）
├── preload/           # contextBridge 白名单 IPC（window.launcher;initialSettings 经 additionalArguments 注入;onEvent 白名单订阅）
├── renderer/src/
│   ├── components/    # 分层组件:ui/(L0 原语 TagChip/StatusDot/ActBtn/Toggle/Chip/CfgGroup/Toast…)、Modal/GroupBlock/FilterBar/StatusBar(L1)、cards/(L2 Agent/Svc 卡)、overlays/(提权/危险/导入)、XmlEditor(CodeMirror 6)
│   ├── modules/       # 视图:agents/cron(卡片+内联编辑+日志抽屉+新建模态)/services/drawer(壳+4 tab+SciBuilder+MultiValueList)/settings(6 pane)
│   ├── layout/        # AppShell/Sidebar/Topbar/ViewHost
│   ├── state/         # zustand:settings(乐观+IPC)/ui(路由/浮层/toast)/agents/cron/services/drawer(抽屉状态机)/card-menu+svc-config(根级浮层锚点)/bootstrap
│   ├── data/          # 数据接缝:ports(仓储接口)/index(三域全 IPC)/ipc/(真实后端映射)/mock/(mock-data 仅剩静态 urls)
│   ├── i18n/          # dict.*.ts 由 scripts/port-demo-i18n.mjs 生成(勿手改)+ t/fmt/useT
│   ├── lib/           # 纯函数:cron/sci/plist/classify/ops-bar(5 态表)/svc-override(别名·host·URL 解析)/keep-alive(KeepAlive 形态⇄预设)/elevation(Promise API)/ipc-error(main 业务错误上浮)/utils/modules(注册表)/statusbars
│   ├── hooks/         # useT/useFmt/useSidebarLayout(ResizeObserver+折叠三重同步)/useAppInfo(app:info 模块级缓存)
│   ├── assets/        # rocketOrbit2Theme.ts(生成的双主题 dataURL)
│   └── styles/        # base/layout/views/settings/drawer.css(逐字节移植自 demo,勿就地修改)
└── shared/            # settings.ts(schema+normalize)/models.ts(领域类型)/ipc.ts(通道契约+事件)/url-guard(外链 scheme 白名单)/constants/api
```

约定：主进程为唯一事实来源；renderer 经 preload 白名单 API 读取 + `settings:changed`/`agents:dirChanged` 订阅；mock 驱动的视图走 `data/` 接缝（后端阶段换 ipcDataSource 零改动）；纯函数配 vitest；**`dependencies` 保持为空 —— 纯 JS 依赖（react/zustand/codemirror/字体等）一律放 `devDependencies`，它们由 Vite 在构建期打进 `out/`，留 `dependencies` 会让 electron-builder 把整份 node_modules 塞进 asar（+190MB）。唯一例外是原生模块（含 `.node`、无法被 bundle 的包，如 `node-pty`）：它必须放 `dependencies`，electron-vite v5 默认据此 externalize 到 main/preload 并打进包**；新增设置 = `shared/settings.ts` 加键 + **有副作用才**加 `main/settings/appliers/` 域模块 + 渲染层消费点（配置单文件不散落；纯数据键走 `settings:set` 即可 —— `SettingsPatch = Partial<LauncherSettings>` 且 `store.save()` 自带浅合并+normalize+原子写+广播，无需新 IPC / preload / 仓储方法）；**主进程窗口生命周期：`menubarOnly`（默认开）下关窗是 `hide()` 不是销毁 —— 窗口对象仍在、`getAllWindows().length` 仍为 1，故任何唤起窗口的路径（Dock `activate` / `second-instance` / Tray）一律走 `showMainWindow()`（show/restore/focus），不要用「窗口数为 0」判断**（Electron 脚手架的 `activate` 写法即如此 → 打包后点 Dock 图标静默无反应，2026-09-13 修）；**移植文件头注释 `ported-from: docs/demo/...`；styles/ 与 `mock-data.ts` 勿手改；⚠ i18n 字典**勿**用 `node scripts/port-demo-i18n.mjs` 全量重跑** —— demo 侧 `ai.*` 已改、renderer 字典尚未跟上，重跑会注入约 98 个无关键；正确做法：新键写进该脚本的 `EXTRA`，再按同序**定点插入**两份字典，并用「生成到临时目录再 diff」验证（先例见 migration-map 差异 37 与 22）；**改 demo 键的文案 = 在 EXTRA 里放同键覆盖**（合并时 EXTRA 后置优先生效、键位置不变，重跑生成器仍逐字节一致）；**删 UI 不删键** —— demo 源键保留为孤儿（先例：差异 39/40 的 Debug/存草稿等键），避免与生成器输出永久漂移）**。

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
- `ai.css`：AI 对话页（会话栏 rail / 消息流 / 工具步骤块 / 授权卡与结果卡 / composer / @ 引用弹层 / MCP modal 内部样式；步骤输出行复用 drawer.css 的 log-line 族）

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
- `ai.js`：AI 对话页（2026-09-13 重写）——`renderAiChat` 入口 + 会话栏（`aiRenderRail`/`aiSelectChat`/`aiNewChat`/`aiToggleRail`）+ 消息渲染族（`aiMsgHtml`/`aiStepsHtml`/`aiCardHtml`）+ 场景运行器（`aiRunScene`/`aiStartLive`/`aiExecStep`/`aiTypewriter`/`aiStopRun`/`aiAbortRun`；数据源 `MOCK_DATA.aiChats/aiScenes`）+ 授权卡（`aiApprove` 接 `ELEVATION.request`，通过后续播 afterApprove）+ @ 引用（`aiMention*`）+ MCP 接入 modal（`aiOpenMcpModal`）；旧目录页函数（renderAi/filterAi/scanAiAgents 等）已整组移除
- `drawer.js`：`openEditFloat` / `closeDrawerMask`、`drawerAgentState`、`updateOpsBar` / `drawerOpsAction`、`dpAction`（抽屉底部删除/克隆，原为未定义死代码已补齐）、`switchDrawerTab`（按 data-tab 属性匹配）、`efToggleTrig` / `efToggleSection` / `efSetKaMode`、`saveFloatAgent`、表单行构建（`addArgTo` / `addEnvTo` / `addWatchTo` / `delMvRow`）、`sci*`（StartCalendarInterval 规则构建器）、`toggleCfg`、日志（`clearLog` / `addLogLine` / `getTs`）、XML（`validateXml` / `copyXml`）、`populateDrawerDefaults`（初始化时从 MOCK_DATA.drawer 填充抽屉全部样例值）；`drawerOpsAction` / `saveFloatAgent` / `dpAction(delete)` 对 system/daemon scope 接入提权流程
- `settings.js`：`switchSettingsSection`、`setTheme`、`setLanguage`、`saveSetting`、`checkAppUpdates`、`resetSettings`、`loadSettings`、`fillSettingsMeta`（页脚/关于页版本号）
- `modules.js`：`switchModule`（配置驱动：读取 MODULES 记录完成视图显隐 / 顶栏重建 / 状态栏开关）、`handleModuleSearch`（顶栏搜索统一分发）、`syncSidebarLayout`、`toggleSidebarCollapse`、`checkMobile` / `toggleSidebar`
- `modals.js`：`openModal` / `closeModal` / `closeModalBg`、新建与导入弹窗（`showNewModal` / `showImportModal` / `createAgent` / `doImport`）、新建 Cron（`applyNewCronPreset` / `updateNewCronExpr` / `createCronJob`，系统级新建走提权）
- `elevation.js`：`ELEVATION.request`（提权：凭证缓存 `launcher_authCacheMin` / 密码非空授权 / 取消返回 false）、`confirmDangerousAction`（危险二次确认，`launcher_confirmDangerous=false` 关闭）；详见上方「提权交互」
- `main.js`：顶部执行序（实时日志 interval 4500ms、ResizeObserver、侧边栏初始态、架构检测、初始渲染 + `loadSettings`、mermaid 初始化）；末尾调用 `updateAgentFilterCounts` / `populateDrawerDefaults` / `fillSettingsMeta`
- `check.mjs`：自检脚本（见「运行方式」，hook 与手动共用）

### MOCK_DATA 关键结构

- 顶层键：`agents` / `invalidPlists` / `crons` / `services` / `aiAgents` / `aiSkills` / `cronPresets` / `liveLogs` / `drawer` / `meta` / `urls`；AI 对话页另有 `aiChats`（预置会话，messages 静态直出）/ `aiScenes`（场景时间线：user/think/tool/stream/card/suggest 步骤联合类型，`res:true` 的行经 `aiResolve` 实时取三域计数）；共享 plist 草稿常量 `AI_PLIST_DRAFT` 定义在 MOCK_DATA 之前（场景与预置会话共用，避免漂移）
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
