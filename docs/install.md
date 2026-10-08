# 安装 BeCrafter Launcher

四条路任选其一。**前三条是推荐路径**——它们都不会给产物打上 `com.apple.quarantine` 隔离标记，
装完直接双击就能用（原因见文末「为什么会提示已损坏」）。

| 通道 | 一条命令 | 适合谁 | 能装哪些版本 |
|---|---|---|---|
| **A. curl 脚本** | `curl -fsSL https://repo.iskill.site/launcher/install.sh \| bash` | 想一条命令装完，机器上不想多装包管理器 | **任意版本**（含历史版本与预发布） |
| **B. Homebrew** | `brew install --cask becrafter/brew/launcher` | 已经用 Homebrew 管所有应用 | 只跟最新稳定版 |
| **C. npm** | `npx -y @becrafter/launcher` | 机器上有 Node，习惯 npx | 本 CLI 的版本线，可 `--version` 指定 |
| **D. 手动** | 自己下 zip 解压拖进「应用程序」 | 网络受限、或想留一份离线包 | 任意（但见下方注意事项） |

## 共同要求

- **macOS 12.0（Monterey）或更新**；Apple Silicon（arm64）与 Intel（x64）各有产物
- 下载约 **120MB**，安装后占用约 **260MB**
- 默认装到 `/Applications`；该目录不可写时自动回退到 `~/Applications`（两条路径都会被应用识别）
- 应用是 **ad-hoc 签名、未做 Apple 公证**（本项目不购买开发者证书）。这不影响使用，
  但决定了「不能走浏览器下载那条路」——见文末故障排查

---

## 通道 A：curl 安装脚本（推荐）

```bash
curl -fsSL https://repo.iskill.site/launcher/install.sh | bash
```

> 脚本托管在 R2（与产物、版本清单同域），地址是 `https://repo.iskill.site/launcher/install.sh`；
> 改动 `scripts/install.sh` 推到 dev 会由 CI 自动同步上去。
> 万一 CDN 不可达，可用备用入口 `https://raw.githubusercontent.com/BeCrafter/Launcher/main/scripts/install.sh`（内容相同）。

它会：读 CDN 上的版本清单 → 按 `uname -m` 选架构 → 下载 `Launcher-latest-<架构>.zip` →
**用 `ditto -x -k` 解压**（`unzip` 会丢符号链接与扩展属性、破坏 `.app` 签名）→ 落到 `/Applications`
（不可写则 `~/Applications`）→ 清一次隔离标记（防御性）→ 校验 `Contents/MacOS/Launcher` 存在 →
打印装好的版本号。

### 参数

```bash
# 装指定版本
curl -fsSL .../install.sh | bash -s -- --version 0.1.4

# 看有哪些版本可装（默认只列稳定版，加 --pre 连预发布一起列）
curl -fsSL .../install.sh | bash -s -- --list --pre

# 版本检查：本机装的是哪版、仓库最新是哪版
curl -fsSL .../install.sh | bash -s -- --check

# 装到别处
curl -fsSL .../install.sh | bash -s -- --dir ~/Applications
```

| 选项 | 说明 |
|---|---|
| `--version <x.y.z>` | 安装指定版本；省略时取 CDN 上 latest 别名指向的版本 |
| `--dir <目录>` | 安装目录；默认 `/Applications`，不可写回退 `~/Applications` |
| `--list` | 列出可用版本（`--pre` 连预发布一起列） |
| `--check` | 已装版本 vs 仓库最新版 |
| `-h, --help` | 帮助 |

| 环境变量 | 说明 |
|---|---|
| `LAUNCHER_R2_BASE` | 替换下载根地址（镜像 / 自建 CDN）；版本清单也在同一个根下，镜像只需镜像这个目录 |
| `LAUNCHER_INSTALL_DIR` | 等价于 `--dir` |

### 升级与卸载（通道 A）

```bash
# 升级 = 再跑一次安装（会先报出当前版本）
curl -fsSL .../install.sh | bash

# 卸载
rm -rf /Applications/Launcher.app          # 装在 ~/Applications 的话改这个路径
rm -f ~/.local/bin/launcher-mcp            # 若曾在应用内点过「安装到 PATH」
```

---

## 通道 B：Homebrew

```bash
brew install --cask becrafter/brew/launcher
```

**必须写全限定名 `becrafter/brew/launcher`**：cask 的裸名会跨所有 tap 解析，
将来任何一个 tap 定义了同名 cask，`brew install --cask launcher` 就会报歧义。

装完这个 cask 会自动做两件事（`postflight`）：

1. `xattr -dr com.apple.quarantine` —— Homebrew 下载 cask 时会**主动**给产物打隔离标记
   （`--no-quarantine` 选项在 Homebrew 7 已被移除），不清理的话 macOS 会直接判「已损坏」
2. `chmod +x Contents/Resources/launcher-mcp` —— 解压链路可能丢执行位

若第 1 步因 macOS 14+ 的「App 管理」保护失败，安装时会给出警告，按提示手动执行一次即可：

```bash
xattr -dr com.apple.quarantine "/Applications/Launcher.app"
```

### 升级与卸载（通道 B）

```bash
brew outdated --cask --greedy     # 查是否有新版（cask 要 --greedy 才列出来）
brew update && brew upgrade --cask launcher
brew uninstall --cask launcher
```

> cask 记录的是**某一个具体版本**：想看「有哪些版本可装」要走版本清单
> （`curl -fsSL .../install.sh | bash -s -- --list` 或 `npx -y @becrafter/launcher versions`），
> 装历史版本用通道 A。Homebrew 只维护「最新稳定版」这一条线，**预发布版本永远不进 cask**。

---

## 通道 C：npm

```bash
npx -y @becrafter/launcher
```

这个 npm 包**只是一个安装器**（约 16KB）：它从官方 CDN 下载正版产物装进 `/Applications`，
本身不含应用、无任何依赖、也不在 `postinstall` 里做任何事。要求 Node 18 以上。

### 子命令

| 命令 | 作用 |
|---|---|
| `npx -y @becrafter/launcher` | 未装则装；已装则显示状态 |
| `npx -y @becrafter/launcher status` | 版本检查：已装版本 / CDN 最新 / npm 包最新 |
| `npx -y @becrafter/launcher versions [--pre] [--json]` | 列出可用版本；`--json` 便于脚本消费 |
| `npx -y @becrafter/launcher install [--version <v\|latest>] [--dir <目录>] [--force]` | 显式安装 / 强制重装 |
| `npx -y @becrafter/launcher uninstall` | 卸载（含清理） |

| 选项 | 说明 |
|---|---|
| `--version <x.y.z\|latest>` | 指定版本；默认 = 本 CLI 的版本 |
| `--dir <目录>` | 安装目录；默认 `/Applications`，不可写回退 `~/Applications` |
| `-f, --force` | 已装同版本时也强制重装 |
| `--pre` / `--json` | 仅 `versions`：连预发布一起列 / 输出 JSON |

环境变量：`LAUNCHER_R2_BASE` 换下载根地址，`LAUNCHER_INSTALL_DIR` 同 `--dir`。

> **为什么卸载要自带子命令**：npm v7+ 没有 uninstall 钩子，`npm uninstall` 不会帮你清理
> `/Applications` 里的 `.app`；而且 `ignore-scripts=true` 会让 lifecycle script 静默失效——
> 所以这个包刻意不依赖任何 npm 钩子，干活全靠显式子命令。
>
> 若曾用 `npm i -g` 装过这个 CLI，卸载应用后还需 `npm uninstall -g @becrafter/launcher`。

---

## 通道 D：手动下载

产物同时备份在 **GitHub Releases**（含每个文件的 sha256），主 CDN 是
`https://repo.iskill.site/launcher/`：

```
Launcher-latest-arm64.zip      # 别名：永远指向最近一个稳定版
Launcher-latest-x64.zip
Launcher-<版本>-arm64.zip      # 带版本号的文件名（CDN 按文件名缓存，故下载用带版本号的更稳）
Launcher-<版本>-x64.zip
Launcher-<版本>-<架构>.dmg     # 额外产物，仅手动安装用；下面两条通道只消费 zip
```

**下载后请用 `ditto` 解压，别双击 Finder 的解压（也等价于 unzip）**：

```bash
ditto -x -k ~/Downloads/Launcher-0.1.4-arm64.zip /tmp/launcher-unzip
xattr -dr com.apple.quarantine /tmp/launcher-unzip/Launcher.app
mv /tmp/launcher-unzip/Launcher.app /Applications/
open /Applications/Launcher.app
```

⚠ **这条路要自己清隔离标记**：浏览器下载会给文件打上 `com.apple.quarantine`，而本项目是
ad-hoc 签名 + 未公证，带标记会被 macOS 判为「已损坏」，且**没有任何图形化绕过入口**
（右键→打开只对「有 Developer ID 签名但未公证」的应用保留）。这就是为什么推荐上面三条通道。

---

## 版本：有哪些、最新是哪个

「我们发布了什么」只有一个来源——CDN：

| 想知道 | 从哪读 |
|---|---|
| **有哪些版本** | `<cdn 根>/versions.txt`（纯文本，一行一版：`0.1.4`；预发布行尾带 ` pre`） |
| **最新稳定版是哪个** | `Launcher-latest-<架构>.zip` 别名的 HEAD 重定向 |

三条通道与**应用内**的「检查更新」都读同一份清单，不会出现「通道装得到新版、应用却说没有」。

**预发布规则**：版本号后缀只允许 `alpha` / `beta` / `pre` / `rc`（例：`0.2.0-rc.1`）。
预发布**不触碰稳定通道**——`latest` 别名、Homebrew cask 都跳过它；应用内检查更新同样不会推预发布。

---

## 升级

应用内「设置 → 关于 → 检查更新」会按**检测到的安装来源**给出对应命令（Homebrew / npx / curl 三种），
不必自己回忆当初是怎么装的。

| 安装来源 | 升级命令 |
|---|---|
| Homebrew | `brew upgrade --cask becrafter/brew/launcher` |
| npm | `npx -y @becrafter/launcher` |
| curl / 手动 | `curl -fsSL https://repo.iskill.site/launcher/install.sh \| bash` |

---

## 卸载

先退出应用（菜单栏托盘 → 退出，或 ⌘Q），然后按安装方式来：

```bash
rm -rf /Applications/Launcher.app                 # 通道 A / C / D（装在 ~/Applications 的话改路径）
brew uninstall --cask becrafter/brew/launcher     # 通道 B
npx -y @becrafter/launcher uninstall              # 通道 C
```

**残留数据**（卸载程序不会替你删，按需清理）：

| 路径 | 内容 |
|---|---|
| `~/.config/launcher/config.json` | 全部设置（主题、语言、`cmdTimeout`、服务别名等） |
| `~/Library/Application Support/becrafter-launcher/` | AI 会话（`ai-sessions.json`）与密钥文件（`ai-keys.json`，内容经系统钥匙串加密；明文 API Key 也从不在磁盘上落明文） |
| `~/Library/Logs/BeCrafter-Launcher/cron/` | 定时任务的日志（按小时分段，默认保留 3 天） |
| `~/.local/bin/launcher-mcp` | 若在应用内点过「安装到 PATH」会留一条符号链接 |
| `~/Library/LaunchAgents/*.plist`、`crontab -l` | **应用不会碰它们** —— 你创建的任务本身归 macOS / cron 管，卸载应用不会删你的任务 |

---

## 故障排查

### 打开时提示「已损坏，请移到废纸篓」

产物被打了 `com.apple.quarantine`（只可能来自**浏览器下载**）。执行一次：

```bash
xattr -dr com.apple.quarantine /Applications/Launcher.app
open /Applications/Launcher.app
```

**为什么前三条通道不会遇到**：隔离标记由**下载方程序**设置，不由网络层设置——
浏览器会设，`curl` 不设；npm 用 Node 的 fetch 下载，同样不设；Homebrew 会设，所以 cask 的
`postflight` 会立刻清掉。这也是本项目「零成本分发」方案的必需补丁，不是可选优化。

### 提示「无法验证开发者」/ 想确认签名

```bash
codesign -dv /Applications/Launcher.app     # 预期看到 Signature=adhoc
```

本项目不购买 Apple 开发者证书（$99/年），产物为 ad-hoc 签名、未公证。

### 装错了架构 / 应用打不开

架构判据是 **`uname -m`**（`arm64` → arm64 产物，`x86_64` → x64 产物）。
Apple Silicon 上推荐装 arm64 产物；x64 产物可经 Rosetta 运行但更慢。
确认装的是哪个架构：

```bash
lipo -archs /Applications/Launcher.app/Contents/MacOS/Launcher
```

### `launcher-mcp: command not found`（外部 Agent 挂载 MCP 时）

说明 PATH 上没有那条链接。打开应用 → AI 助手 → 顶栏「接入 MCP」→ 点「安装到 PATH」
（应用会把它装到你**登录 shell 的 PATH** 里的 `~/.local/bin`，并就地修复悬空/指向别处的旧链接）。
弹窗同时给出可直接复制的完整路径命令，不装链接也能用。

### 下载慢 / 连不上 CDN

指向镜像即可（镜像只需镜像 CDN 根目录，`versions.txt` 也在里面）：

```bash
LAUNCHER_R2_BASE=https://your-mirror.example/launcher \
  curl -fsSL .../install.sh | bash
```

### 校验产物完整性

GitHub Releases 的说明里留有每个 zip 的 sha256：

```bash
shasum -a 256 ~/Downloads/Launcher-0.1.4-arm64.zip
```

---

## 附：三条通道共用的安装契约

`scripts/install.sh`（bash）与 `packaging/npm/cli.mjs`（Node）是同一套逻辑的两份实现，
以下不变式**改任一侧都要同步另一侧**（跨文件断言在 `packaging/npm/contract.test.mjs`）：

| 不变式 | 值 |
|---|---|
| 下载根 | `${LAUNCHER_R2_BASE:-https://repo.iskill.site/launcher}` |
| 产物命名 | `Launcher-[latest\|<版本>]-<架构>.zip` |
| 架构判据 | **`uname -m`**（不能用 `process.arch`：那是 Node 二进制自身的架构，x64 Node 跑在 Apple Silicon 上会错装） |
| 解压工具 | **必须 `ditto -x -k`**（`unzip` 与 JS zip 库会丢符号链接与扩展属性、破坏签名） |
| 安装目录 | `/Applications`，不可写回退 `~/Applications` |
| 收尾 | `xattr -dr com.apple.quarantine`（防御性） |
| 完整性 | 校验 `Contents/MacOS/Launcher` 存在 |

「有哪些版本」「latest 指向谁」同样三通道共用一个来源（CDN 上的 `versions.txt` 与 `latest` 别名），
跨文件断言在 `packaging/npm/contract.test.mjs`。
