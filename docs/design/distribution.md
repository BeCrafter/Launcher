# BeCrafter Launcher 分发与安装方案

> 状态：已实施（2026-09-17）｜范围：包体积精简 + 零成本签名方案下的两条安装通道 + CI 发布流程
> 关联：`docs/design/refactor-plan.md`（本方案取代其「④ 暂不管分发/签名」决策与「打包基建留空」条目）、`packaging/homebrew/README.md`（Tap 维护手册）

## Context

两个问题驱动：

1. **包太大**：`dist/mac-arm64/Launcher.app` 实测 499MB、x64 522MB，用户每次下载/分发的代价过高
2. **装不上**：浏览器下载后提示「已损坏」——产物只有 ad-hoc 签名，被 Gatekeeper 拦下

**已确认决策（2026-09-17）**：不购买 Apple 开发者证书（$99/年），改用零成本分发通道。本方案记录这条路径能成立的原理、边界，以及将来若要证书需要补什么。

---

## 一、包体积：499MB → 270MB（arm64，−46%）

### 构成（实测）

| 项 | 优化前 | 优化后 | 手段 |
|---|---|---|---|
| `app.asar` | 209MB | 12.9MB | 依赖移出打包 |
| Electron Framework 语言包 | 49MB（220 个 `.lproj`） | 1.7MB（en / zh_CN / zh_TW） | `electronLanguages` |
| `out/renderer/assets` 字体 | 28MB | 14MB | 删 legacy 兜底格式 |
| Electron Framework 二进制 | 193MB | 208MB | 不可压缩（Chromium + V8） |
| **总计** | **499MB** | **270MB** | |

地板约 210MB —— Electron Framework 二进制自身即占 208MB，这是选 Electron 的固定成本。

### 根因：`app.asar` 里塞了整份 node_modules

`electron-builder.yml` 的 `files: [out/**, package.json]` **拦不住**生产依赖：electron-builder 会另走一条收集通道（`nodeModuleFilePatterns`，见 `dist/builder-debug.yml`）把所有 `dependencies` 打进 asar。结果是 196MB 的构建期依赖随包发行，而它们**只在构建时被 Vite 消费**——React / zustand / CodeMirror 已 bundle 进 `out/renderer/assets/index-*.js`，字体已复制到 `out/renderer/assets/`，主进程与预加载只 import `electron` + node 内建。

**修复**：全部 12 个 `dependencies` 移入 `devDependencies`。electron-builder 只收 `dependencies`，`devDependencies` 天然不进包。

> **约定（新增，勿破坏）**：本项目的 `dependencies` 应当**始终为空**，除非新增**原生模块**（`node-pty`、`better-sqlite3` 之类含 `.node` 二进制、无法被 Vite bundle 的包）。这类包必须放 `dependencies`——electron-vite v5 默认把 `dependencies` 作为 main/preload 的 externalize 清单，届时它们会被正确外置并打进包。把纯 JS 包留在 `dependencies` 会直接让包体积涨回 200MB。

`scripts/build-app.mjs` 新增了护栏：打包后解析 `app.asar` 头部索引，若出现 `node_modules` 条目即 FAIL（asar 会从 13MB 涨到 200MB，一眼可辨）。

### 字体：只保留 woff2

`@fontsource/noto-sans-sc`、`noto-serif-sc`、`@fortawesome/fontawesome-free` 的 CSS 里，每个 `@font-face` 都是 `woff2` 在前、`woff`/`ttf` 兜底。Chromium 自 2015 年起支持 woff2，兜底项**永不被加载**，但 Vite 会照抄 src 列表把文件一并产出（13.4MB）。

`build-app.mjs` 的 `pruneLegacyFonts()` 在打包前按构建产物 CSS 的实际引用逐条判定并删除。保守策略：**首项不是 woff2 的规则整条跳过**，宁可少删不误删。

> 未处理：16 处 `.woff` 兜底被 Vite 内联成 base64 留在 CSS 里（合计 42KB）。重写 CSS 的收益远小于风险，不做。

---

## 二、为什么会「已损坏」

链路：**浏览器下载 → 给文件打上 `com.apple.quarantine` → 首次启动时 Gatekeeper 校验签名**。

当前产物是 ad-hoc 签名（`codesign -dv` → `Signature=adhoc`，`Info.plist=not bound`），未用 Developer ID、未公证：

| 签名状态 | 双击结果 | GUI 绕过入口 |
|---|---|---|
| **ad-hoc（本项目）** | **「已损坏，请移到废纸篓」** | **❌ 没有** |
| Developer ID 签名、未公证 | 「无法验证开发者」 | ✅ 右键→打开 / 系统设置「仍要打开」 |
| Developer ID + 公证 | 直接打开 | — |

macOS 15 起，「已损坏」这一档的绕过入口被移除——**只对有 Developer ID 签名的 app 保留**。所以用户不是操作麻烦，是**真的没有任何图形化出路**。

> **自签名证书不管用**：Gatekeeper 不认自签证书，用户还得手动把证书加进信任链，比跑一条 `xattr` 更麻烦。

---

## 三、两条零成本安装通道

共同原理：**`com.apple.quarantine` 由下载方应用程序设置，不由网络层设置**。浏览器会设，`curl` 不设。

### 通道 A：curl 安装脚本（`scripts/install.sh`）

```bash
curl -fsSL https://raw.githubusercontent.com/BeCrafter/Launcher/main/scripts/install.sh | bash
curl -fsSL .../install.sh | bash -s -- --version 0.1.0    # 指定版本
```

- 探测 `uname -m` 选择 arm64 / x64 产物；支持 `--version` / `--dir`
- 纯 shell 解析 GitHub Releases API（不依赖 jq / python3）
- **用 `ditto -x -k` 解压而非 `unzip`**——`unzip` 不保留符号链接与扩展属性，会破坏 `.app` 的代码签名
- 安装到 `/Applications`，不可写时回退 `~/Applications`
- curl 本就不打隔离标记，末尾的 `xattr -dr` 仅作防御

### 通道 B：Homebrew Tap（`packaging/homebrew/`）

```bash
brew install --cask becrafter/tap/becrafter-launcher
```

> **关键更正**：常见说法「Homebrew 走 curl 下载所以不带隔离标记」是**错的**。实测本机 `brew install --cask` 安装的 BlueBubbles / Upscayl 都带 `com.apple.quarantine`；源码 `cask/download.rb:254` 无条件调用 `Quarantine.cask!`，macOS 实现（`extend/os/mac/cask/quarantine.rb:57`）通过 LaunchServices SPI 主动打标记，agent 名为 "Homebrew Cask"；Homebrew 7 已**移除** `--no-quarantine` 选项。

因此 cask 必须自己清除标记——用 `postflight` 调 `xattr -dr`。这是通道 B 能成立的**必需补丁**，不是可选优化。

- 用**非 bang 的 `system_command`**：macOS 14+ 的 App Management 保护可能让 `xattr` 失败，此时只告警不中断安装，由 `caveats` 提示用户手动执行
- token 用 `becrafter-launcher` 而非 `launcher`，避免与官方 homebrew-cask 潜在同名冲突
- 维护手册见 `packaging/homebrew/README.md`

---

## 四、发布流程

`.github/workflows/release.yml`：push tag `v*`（或手动 dispatch）→ 校验 tag 与 `package.json` 版本一致 → typecheck + test → 构建 → 发布。

产物（`electron-builder.yml` 的 `artifactName` 约定命名）：

| 产物 | 角色 |
|---|---|
| `Launcher-<version>-arm64.zip`、`Launcher-<version>-x64.zip` | **两条安装通道的产物** —— install.sh 与 cask 都只下载 zip |
| `Launcher-<version>-arm64.dmg`、`Launcher-<version>-x64.dmg` | 额外产物，供手动安装；**两个通道都不使用，不作为本方案的推荐路径** |

> install.sh 按 `-arm64.zip` / `-x64.zip` 后缀匹配，cask 用 `arch arm:/intel:` 分支拼出同一命名——**改产物名会同时打断两条通道**。

- `--arch all` 逐架构出包（体积优先；universal 会让下载量翻倍）
- CI 把各产物 sha256 **写进 Release 正文**——更新 cask 时直接复制，无需手算
- `npm ci` **不能加 `--omit=dev`**：构建期依赖现在全在 `devDependencies`
- `--no-run` 跳过运行验证（runner 无法原生执行另一架构产物），静态架构校验仍执行

本地等价命令：`npm run build:app:release`（不带 `--no-run`，含完整运行验证）。

---

## 五、将来若要买证书（$99/年）

补上即可获得「双击即开、零提示」，且是自动更新（Squirrel.Mac 要求签名）的前提：

1. 加入 Apple Developer Program，取 Developer ID Application 证书装入 keychain
2. `electron-builder.yml` 的 `mac` 增补：
   ```yaml
   hardenedRuntime: true
   gatekeeperAssess: false
   entitlements: build/entitlements.mac.plist
   entitlementsInherit: build/entitlements.mac.plist
   notarize: true
   ```
   （`refactor-plan.md` 已确认**沙盒必须关闭**——spawn `launchctl`/`lsof`/`osascript` 需要，故 entitlements 只开 hardened runtime 不含 sandbox）
3. CI 增补 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`（或 App Store Connect API Key）secrets
4. **届时可移除** cask 的 `postflight`/`caveats` 与 install.sh 的 `xattr` 兜底——公证后不再需要

---

## 验证清单

1. `npm run build:app:arm64` → `du -sh dist/mac-arm64/Launcher.app` ≈ 270MB
2. 构建日志出现 `asar 内容：… 不含 node_modules → PASS`、`字体瘦身：删除 ~396 个…释放 ~13MB`
3. `npm run typecheck` + `npm test` 全绿
4. 启动打包产物，确认**中文正文（Noto Sans SC）、中文标题衬线体（Noto Serif SC）、FontAwesome 图标**三处渲染正常——这是删 legacy 字体后唯一需要肉眼确认的回归点
5. `node scripts/build-app.mjs --arch all --release --no-run` → `dist/` 出 4 个产物（2 个 **zip 供两条通道**、2 个 dmg 为额外产物）
6. `brew install --cask …` 后 `xattr /Applications/Launcher.app` **无 quarantine 输出**，双击能开
