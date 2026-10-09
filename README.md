<div align="center">
  <img src="resources/logo/rocketOrbit2/icon.png" width="128" alt="BeCrafter Launcher">
  <h1>BeCrafter Launcher</h1>
  <p><b>macOS 本地服务管理应用</b><br>
  launchd（Launch Agents / Daemons）· crontab · 端口服务，外加一个能真的动手的 AI 助手</p>
  <p>
    <img alt="platform" src="https://img.shields.io/badge/platform-macOS%2012%2B-000?logo=apple&logoColor=white">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
    <a href="https://www.npmjs.com/package/@becrafter/launcher"><img alt="npm" src="https://img.shields.io/npm/v/@becrafter/launcher"></a>
  </p>
</div>

---

## 它是什么

macOS 上管本地服务一直是命令行活：改 `launchd` 要写 plist + `launchctl bootstrap/bootout/enable/kickstart`，
查定时任务要 `crontab -e` 并自己数五段表达式，看端口占用要 `lsof` 再 `kill` 一串 PID。这些命令能做，
但**看不见状态、改不动细节、出错也不好排查**。

Launcher 把这三件事做成一个原生应用：**读的是真实系统状态**（launchctl / crontab 文件 / lsof），
写的是真实配置，并在同一处给出状态、日志、下一次执行时间与失败原因。它还带一个 AI 助手 ——
它调用的不是模拟数据，而是应用自己的这套能力，所以能真的帮你查端口占用、改 plist、修 crontab。

> 定位：**本地优先**。无账号、无遥测；除「检查更新」读一次版本清单、以及你自己配置的 AI 对话外，不发任何网络请求。

## 功能

### 🚀 Launch Agents（launchd）

三个域全覆盖：`~/Library/LaunchAgents`（用户级）、`/Library/LaunchAgents`（全局）、`/Library/LaunchDaemons`（Daemon）。

- **真实状态**：`launchctl list` / `print` / `print-disabled` 三源并集 —— PID、退出码、运行时长、CPU、内存、启动时间，以及「已加载但 plist 已不存在」的孤儿告警
- **意图化操作**：界面只有「启动 / 停止 / 重启 / 允许登录时加载」四个控件，`enable → bootstrap → kickstart` 的顺序逻辑下沉到主进程；不存在「因为顺序而置灰」的按钮
- **表单 ⇄ plist 双向编辑**：19 个托管键（Identifier / Program / ProgramArguments / KeepAlive / StartCalendarInterval / EnvironmentVariables / WorkingDirectory / StandardOutPath …）；**表单不认识的键原样保留**，逐键说明「为什么这个文件只能改 XML」
- **XML 原文编辑**（CodeMirror 6）：按 `xmlIndent` 设置格式化、`plutil -lint` 校验、保存后回源
- **日志**：stdout/stderr 尾读 + `log show` 系统日志，两个来源可切换
- **Homebrew 服务合并**：`brew services` 管理的条目单独标识，启停走 brew 自己的路由
- 与开源 [LaunchManager](https://github.com/Sean10000/LaunchManager) 的机制同源（brew 判定、plist 目录、域映射），但为 TS + Electron 重写

### ⏰ 定时任务（crontab）

- 用户级 `crontab` 与系统级 `/etc/crontab` 真实读写（系统级走系统授权框）
- 卡片内联编辑 + 常用预设；表达式实时翻译成人话；**预测下一次执行时间**（vixie 语义，含 `dom`/`dow` 的 OR 规则）
- **日志按小时分段**：左侧分段文件列表 + 右侧正文，按保留期清理（默认 3 天）；旧式单文件不迁移、可一键改写为分段
- **`%` 未转义告警**：crontab 会把未转义的 `%` 当作换行并截断命令 —— 应用能检测并一键修复（这是「配了日志路径却一直没有日志」的经典成因）

### 🔌 端口服务

- `lsof` 发现监听端口，分类展示（Homebrew / Node.js / 进程 / Docker 容器），带 PID、命令行、运行时长
- **杀掉 / 重启**：SIGTERM → 5s → SIGKILL；他人进程会先引导系统授权；Docker 容器支持 start/stop/restart
- **服务覆写**：双击名字就地改名，或「配置」里改别名 / Host / 路径 —— Open / Copy 用完整 URL（键跨进程重启稳定）
- **按需轮询**：只有停留在本页时才 3 秒一轮，离开即停；扫描失败时**保留上次结果并明确提示**，不会把列表清空成一片白

### 🤖 AI 助手与 MCP

- 对话式 Agent 页，内置引擎（Anthropic / OpenAI 兼容协议，Key 存系统钥匙串）
- **14 个内置工具**（9 只读 + 5 写）与应用共用同一套领域服务：读的就是真实 launchctl / crontab / lsof
- 工具调用在界面里逐步可见；**写操作必须经过授权卡确认**，并显示将要执行的命令
- **可作为 MCP 服务端**供外部 Agent（Claude Code、Claude Desktop 等）挂载 —— 见下节

### 🧩 通用

- 中文 / English 双语，深色 / 浅色 / 跟随系统
- 菜单栏图标（运行中任务数角标**可选**，默认关）；关窗常驻菜单栏，Dock 点击即唤回
- 设置落在 `~/.config/launcher/config.json`（主题、语言、命令超时、服务别名与覆写等）
- 应用内「检查更新」按**检测到的安装来源**给出对应升级命令
- **不安装任何后台守护进程 / 系统扩展**：唯一与应用自身生命周期有关的注册项是「登录时启动」（默认开，设置里可关）
- 卸载不会动你的 plist 与 crontab

## 安装

三条推荐通道（**浏览器下载会被 macOS 判「已损坏」，本项目是 ad-hoc 签名、未公证**）：

```bash
# A. curl 脚本（推荐：任意版本，含历史版本与预发布）
curl -fsSL https://repo.iskill.site/launcher/install.sh | bash

# B. Homebrew
brew install --cask becrafter/brew/launcher

# C. npm（要求 Node 18+）
npx -y @becrafter/launcher
```

也可以手动下载 zip（GitHub Releases 有备份与 sha256），但需要自己 `ditto` 解压并 `xattr -dr` 清隔离标记。

**完整安装文档（含参数表、版本发现、升级、卸载、故障排查）：[`docs/install.md`](docs/install.md)**

要求：macOS 12.0+；下载约 120MB，安装后约 260MB。

## 与 AI Agent 集成（MCP）

应用内含一个 MCP stdio 入口 `launcher-mcp`，默认**只读**（9 个只读工具）；
在「AI 助手 → 接入 MCP」里点一次「安装到 PATH」，外部 Agent 就可以只用命令名挂载：

```bash
claude mcp add launcher -- launcher-mcp
```

不装 PATH 链接也行 —— 弹窗里始终给出应用包内的完整路径命令，复制即用。
另有 HTTP 环回端点 `http://127.0.0.1:7788/mcp`（应用运行期间可用，无需额外进程）。
写工具的可见性由设置里的权限模式控制（`readOnly` 默认 / `full`），且**即使可见，执行仍需应用内授权**。

## 数据与隐私

| 路径 | 内容 |
|---|---|
| `~/.config/launcher/config.json` | 全部设置 |
| `~/Library/Application Support/becrafter-launcher/` | AI 会话（`ai-sessions.json`）与密钥文件（`ai-keys.json`，经系统钥匙串加密；明文 Key 不落磁盘） |
| `~/Library/Logs/BeCrafter-Launcher/cron/` | 定时任务日志（按小时分段，默认保留 3 天） |

- 无账号、无遥测、无崩溃上报
- **不接触你的密码**：需要管理员权限时调 macOS 原生授权框（`osascript with administrator privileges`），密码只进系统对话框
- 卸载应用不会删除你创建的 launchd 任务与 crontab 条目 —— 它们归系统管

## 从源码构建

要求：macOS 12+、Node ≥ 22（CI 用 24）。

```bash
npm ci              # 安装依赖（本项目 dependencies 为空，全部是 devDependencies）

npm run dev         # 开发模式（electron-vite，热更新）
npm test            # vitest 单测（600+ 用例）
npm run typecheck   # tsc 双配置类型检查

npm run build:app         # 打包本机架构到 dist/（含架构/asar 断言与真实启动校验）
npm run build:app:all     # arm64 + x64 依次打包
npm run build:app:release # 出发布产物（zip + dmg）
```

产物与约束：

- `npm run build:app` 会做四件事：electron-vite 构建 → **字体瘦身**（按产物 CSS 实测引用删掉 woff2 之后的兜底格式）→ electron-builder 打包（dir 目标）→ 校验（lipo 架构断言、按进程二进制架构断言、**asar 不含 node_modules** 断言）
- ⚠ **`package.json` 的 `dependencies` 必须保持为空**：纯 JS 依赖一律放 `devDependencies`，由 Vite 在构建期打进 `out/`。留 `dependencies` 会让 electron-builder 把整份 `node_modules` 塞进 asar（+190MB，构建脚本会直接 FAIL）
- 未配置开发者证书时 electron-builder 跳过代码签名（ad-hoc），正式分发需要补签名与公证

## 项目结构

```
src/
├── main/          # 主进程（唯一事实来源）
│   ├── services/  # 执行层：shell-runner / launchctl / plist / crontab / lsof 发现 / docker / 提权
│   ├── domains/   # 纯函数领域层：launchctl 解析 / plist XML 与补丁 / 表单模型 / crontab / lsof 解析
│   ├── stores/    # 三域 store（Agent / Cron / Service）
│   ├── settings/  # 设置存储（原子写）+ 按域副作用 appliers
│   ├── ai/        # AI 引擎、工具注册表、会话与会话存储
│   └── mcp/       # MCP stdio 入口 + HTTP 环回端点
├── preload/       # contextBridge 白名单 API
├── renderer/src/  # React 19 界面（views / drawer / settings / state / i18n / styles）
└── shared/        # 主进程与渲染层共用：设置 schema、领域类型、IPC 契约

docs/
├── help.md / help.en.md    # 使用帮助（中/英；已内嵌进应用，离线可读）
└── install.md              # 安装指南（本文件的延伸）
```

## 文档

- [使用帮助](docs/help.md) · [User Guide](docs/help.en.md) —— 四个页面各管什么、常见任务、FAQ、术语对照（**已内嵌进应用**，左下角「帮助」按钮离线可读）
- [安装指南](docs/install.md) —— 三条通道逐个枚举、版本发现、升级卸载、故障排查

## 许可证

[MIT](LICENSE) © 2026 BeCrafter
