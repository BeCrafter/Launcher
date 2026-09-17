# Homebrew Tap 维护说明

本目录存放在 `BeCrafter/homebrew-tap` 仓库中托管的 cask 模板。**本仓库不消费它**——它只在发版时被复制过去。

## 为什么需要 `postflight` 移除隔离标记

Homebrew 下载 cask 时会主动给下载物打上 `com.apple.quarantine`（`cask/download.rb` 无条件调用 `Quarantine.cask!`，macOS 实现走 LaunchServices SPI），而 Homebrew 7 已移除 `--no-quarantine` 选项。Launcher 只有 ad-hoc 签名、未经 Apple 公证，带着隔离标记会被 macOS 直接判为「已损坏」，且**没有任何图形化绕过入口**（右键→打开只对「有 Developer ID 签名但未公证」的 app 保留）。

因此 cask 必须在安装后立刻执行 `xattr -dr com.apple.quarantine`。这是 C 方案（零成本分发）能成立的必需补丁，不是可选优化。

## 首次搭建（一次性）

1. 在 GitHub 新建仓库 `BeCrafter/homebrew-tap`（**public**，名称必须严格是 `homebrew-` 前缀，Homebrew 靠它推导 tap 名）
2. 把本目录的 `becrafter-launcher.rb` 放进该仓库的 `Casks/` 目录：
   ```
   homebrew-tap/
   └── Casks/
       └── becrafter-launcher.rb
   ```
3. 先跑一次发版（见下）拿到 sha256，填进 cask

安装命令：

```bash
brew install --cask becrafter/tap/becrafter-launcher
```

> token 用 `becrafter-launcher` 而非 `launcher`，避免与官方 homebrew-cask 可能存在的同名 cask 冲突。

## 每次发版

1. 本仓库打 tag 并推送（`v0.2.0` 形式）→ `.github/workflows/release.yml` 自动构建、上传 dmg/zip，并把各产物的 **sha256 写进 Release 正文**
2. 打开该 Release，复制 `Launcher-<版本>-arm64.zip` 与 `Launcher-<版本>-x64.zip` 的 sha256
3. 更新 tap 仓库里的 cask：
   - `version` → 新版本号（不带 `v`）
   - `sha256 arm:` / `sha256 intel:` → 复制的两个值
4. 提交推送 tap 仓库

## 验证

```bash
brew install --cask becrafter/tap/becrafter-launcher
xattr /Applications/Launcher.app          # 期望：无 com.apple.quarantine 输出
open "/Applications/Launcher.app"         # 期望：直接打开，无「已损坏」
```

若 `xattr` 仍显示 `com.apple.quarantine`，说明 `postflight` 被 macOS 的 App Management 保护拦下了——按 cask 的 caveats 提示手动执行一次 `xattr -dr`，并把结果反馈回来以便调整方案。
