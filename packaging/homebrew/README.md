# Homebrew Tap 维护说明

cask 托管在 **`BeCrafter/homebrew-brew`** 仓库（tap 名 `becrafter/brew`）。本目录的 `launcher.rb` 是**唯一事实来源**，发版时由 CI 复制过去并替换 version / url / sha256——**不要手改 tap 仓库里的那份**，下次发版会被覆盖。

```bash
brew install --cask becrafter/brew/launcher
```

> **token 为什么叫 `launcher`**：曾用 `becrafter-launcher` 规避与官方 homebrew-cask 的同名冲突，但官方库**当前没有 `launcher` 这个 cask**（`brew info --cask launcher` → 不存在），且改名发生在首次发布之前（tap 仓库里从无 `Casks/`，无人装过），迁移成本为零。
> ⚠ **代价要记住**：cask 裸名解析跨**所有** tap。若日后任一 tap 定义了 `launcher`，`brew install --cask launcher` 会报歧义——**因此所有文档与安装提示一律给全限定名 `becrafter/brew/launcher`，不要省略 tap**。

## 为什么需要 `postflight` 移除隔离标记

Homebrew 下载 cask 时会主动给下载物打上 `com.apple.quarantine`（`cask/download.rb` 无条件调用 `Quarantine.cask!`，macOS 实现走 LaunchServices SPI），而 Homebrew 7 已移除 `--no-quarantine` 选项。Launcher 只有 ad-hoc 签名、未经 Apple 公证，带着隔离标记会被 macOS 直接判为「已损坏」，且**没有任何图形化绕过入口**（右键→打开只对「有 Developer ID 签名但未公证」的 app 保留）。

因此 cask 必须在安装后立刻执行 `xattr -dr com.apple.quarantine`。这是零成本分发方案能成立的必需补丁，不是可选优化——**去掉它等于让所有 Homebrew 用户装完打不开**。

## 首次搭建（一次性）

1. 仓库 `BeCrafter/homebrew-brew` 已建（public；`homebrew-` 前缀是 Homebrew 推导 tap 名所必需的）
2. 在 `BeCrafter/Launcher` 配好 secrets（详见 `docs/design/distribution.md`）：
   - R2 一组：`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_REPO_BUCKET_NAME` / `R2_REPO_PUBLIC_DOMAIN`（挂在 `r2-publish` 环境上）
   - `TAP_GITHUB_TOKEN`：对 `homebrew-brew` 有 `contents: write` 的 PAT，CI 用它推送 cask
3. 打 tag 发一次版，CI 会创建 `Casks/launcher.rb` 并填入真实 url 与 sha256

## 每次发版

**全自动**，无需人工复制 sha256：

1. 本仓库打 tag 并推送（tag 形如 `v1.2.3`，须与 `package.json` 的 `version` 一致；
   推之前先跑 `npm run release:check -- --tag v1.2.3`，把版本一致性与 tag 占用检查提前到本地）
   → `.github/workflows/release.yml` 构建双架构 zip
2. 上传到 R2（`<R2 公有域名>/launcher/Launcher-<版本>-<架构>.zip`，外加 `Launcher-latest-<架构>.zip` 别名供 install.sh 用）
3. 复制本目录的模板到 tap 仓库，`sed` 替换 `version` / `url` / 两个 `sha256` 后提交推送
4. 同时照常发 GitHub Release（产物 + sha256 清单），作为备用下载源

> **预发布（`-rc` / `-beta`）不更新本 cask**——第 2、3 步的 latest 别名与本步一并跳过。
> 版本比较只保证老用户不会被 `brew upgrade` 推到 rc，但**新用户 `brew install` 会直接装到 rc**，
> 故 Homebrew 保持纯稳定通道；预发布只发 zip + GitHub Release（标 pre-release）。
> 后缀只允许 `alpha` / `beta` / `pre` / `rc`（Homebrew 只认这四个，其余会被判为比正式版更新，
> 见 `docs/design/distribution.md`）。CI 会直接拒绝非法后缀。

需要人工介入的只有一种情况：**cask 结构本身要改**（比如加 `depends_on`、改 `postflight`）——改本目录的模板，提交到本仓库，下次发版自动带到 tap。

> ⚠ **tap 仓库会并存多个包的 cask**，CI 只 `git add` 本包那一个文件，并在提交前断言暂存区有且只有 `Casks/launcher.rb`。
> 手工往 tap 提交别的内容时也请保持「一个包只动自己那份文件」；若 CI 的 `git push` 被拒（非快进），
> 说明 clone 之后有人推过——重跑本次发版即可，**不要去强推**。

## 验证

```bash
brew install --cask becrafter/brew/launcher
xattr /Applications/Launcher.app          # 期望：无 com.apple.quarantine 输出
open "/Applications/Launcher.app"         # 期望：直接打开，无「已损坏」
```

若 `xattr` 仍显示 `com.apple.quarantine`，说明 `postflight` 被 macOS 的 App Management 保护拦下了——按 cask 的 caveats 提示手动执行一次 `xattr -dr`，并把结果反馈回来以便调整方案。

若 `brew` 报 sha256 不匹配，说明 R2 上的对象与 cask 记录的不是同一份（常见于用同一版本号重发版）：把版本号 +1 重新发版即可。
