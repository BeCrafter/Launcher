# BeCrafter Launcher 分发与安装方案

> 状态：已实施（2026-09-17，2026-09-19 补 R2 托管与 cask 自动更新）｜范围：包体积精简 + 零成本签名方案下的两条安装通道 + CI 发布流程
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

## 三、三条零成本安装通道

共同原理：**`com.apple.quarantine` 由下载方应用程序设置，不由网络层设置**。浏览器会设，`curl` 不设。

三条通道的 zip 产物都托管在 **Cloudflare R2**（自定义域名 `https://repo.iskill.site`，路径前缀 `launcher/`），GitHub Release 作为备用下载源同步保留。R2 侧要点：

| 要点 | 做法 |
|---|---|
| 缓存失效 | 文件名带版本号（`Launcher-<版本>-<架构>.zip`），换版本即换 URL，cdn 缓存天然不冲突 |
| 公网访问 | 用**自定义域名**，不用 `r2.dev`（后者有限流，不适合给 cask 用） |
| 上传方式 | R2 兼容 S3 API，CI 用 `aws-actions/configure-aws-credentials` + `aws s3 cp --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com`。**不传 `--acl`**——R2 不支持 ACL，公开访问靠 bucket 的自定义域名开关 |
| latest 别名 | `Launcher-latest-<架构>.zip` 供 install.sh 默认路径使用；文件名恒定故上传时带 `--cache-control no-store`，否则会长期发旧版本 |
| 版本清单 | `versions.txt`（纯文本，一行一版：`0.2.0` / `0.3.0-rc.1 pre`）—— **三条通道「有哪些版本可装」的唯一来源**，CI 发版时增量维护（见下） |

### 通道 A：curl 安装脚本（`scripts/install.sh`）

```bash
curl -fsSL https://raw.githubusercontent.com/BeCrafter/Launcher/dev/scripts/install.sh | bash
curl -fsSL .../install.sh | bash -s -- --version 0.1.0    # 指定版本
curl -fsSL .../install.sh | bash -s -- --check            # 版本检查:装没装、是不是最新
curl -fsSL .../install.sh | bash -s -- --list             # 有哪些版本可装
```

> ⚠ 这条命令里的分支名(`dev`)是**唯一一处硬编码默认分支**——脚本只在打 tag 后才会进 `main`,
> 日常发版改的是 `dev`,故安装入口指向 `dev`。仓库默认分支或流程变了要同步三处:
> `src/shared/ipc.ts` 的 `UPGRADE_COMMAND`、`CLAUDE.md`、本文件。

- 探测 `uname -m` 选择 arm64 / x64 产物；支持 `--list` / `--check` / `--version` / `--dir` / `--pre`
- 直接从 R2 拉取（`LAUNCHER_R2_BASE` 可换镜像），不依赖 GitHub API；只有 `--list` 走 Releases api
- **用 `ditto -x -k` 解压而非 `unzip`**——`unzip` 不保留符号链接与扩展属性，会破坏 `.app` 的代码签名
- 安装到 `/Applications`，不可写时回退 `~/Applications`
- curl 本就不打隔离标记，末尾的 `xattr -dr` 仅作防御
- 装完报出版本号：优先读 `Info.plist`，读不到就从下载 URL 的文件名反解（`%{url_effective}`，不额外发请求）

### 通道 B：Homebrew Tap（`packaging/homebrew/`）

```bash
brew install --cask becrafter/brew/launcher
```

> **关键更正**：常见说法「Homebrew 走 curl 下载所以不带隔离标记」是**错的**。实测本机 `brew install --cask` 安装的 BlueBubbles / Upscayl 都带 `com.apple.quarantine`；源码 `cask/download.rb:254` 无条件调用 `Quarantine.cask!`，macOS 实现（`extend/os/mac/cask/quarantine.rb:57`）通过 LaunchServices SPI 主动打标记，agent 名为 "Homebrew Cask"；Homebrew 7 已**移除** `--no-quarantine` 选项。

因此 cask 必须自己清除标记——用 `postflight` 调 `xattr -dr`。这是通道 B 能成立的**必需补丁**，不是可选优化。

- 用**非 bang 的 `system_command`**：macOS 14+ 的 App Management 保护可能让 `xattr` 失败，此时只告警不中断安装，由 `caveats` 提示用户手动执行
- token 用 `launcher`。曾用 `becrafter-launcher` 规避与官方 homebrew-cask 的同名冲突，但官方库当前无此 cask（`brew info --cask launcher` → 不存在），且改名发生在首次发布之前（tap 仓库里从无 `Casks/`），迁移成本为零。⚠ 代价：cask 裸名解析跨所有 tap，日后任一 tap 定义 `launcher` 会让 `brew install --cask launcher` 歧义 —— **故所有文档一律给全限定名 `becrafter/brew/launcher`**
- cask 托管在 `BeCrafter/homebrew-brew`（tap 名 `becrafter/brew`）。本仓库 `packaging/homebrew/launcher.rb` 是唯一事实来源，**发版时 CI 复制过去并替换 version / url / sha256**，tap 仓库那份不要手改
- 维护手册见 `packaging/homebrew/README.md`

### 通道 C：npm（`packaging/npm/`）

```bash
npx -y @becrafter/launcher
```

定位是**给已经装了 Node 的开发者**一个熟悉的入口，不替代 A/B。npm 包里**只有安装器**
（`cli.mjs` + `lib.mjs` + README，约 16KB），应用产物仍从 R2 下载。

**两条 npm 的硬约束决定了这个形态：**

| 约束 | 依据 | 后果 |
|---|---|---|
| **npm v7+ 没有 uninstall 钩子** | 官方文档：「While npm v6 had `uninstall` lifecycle scripts, npm v7 does not… will not function」 | `npm uninstall` **不会**清理 `/Applications`——必须自带 `uninstall` 子命令 |
| **`ignore-scripts=true` 静默失效** | 官方 config 文档；退出码 0、无报错，企业环境常见 | **绝不在 lifecycle script 里干活**，否则会出现"装完了但没装上"且无人察觉 |

因此：**本包不在任何 lifecycle script 里做任何事**，一切由用户显式运行 CLI 完成。这样
`--ignore-scripts` 与 pnpm 下都正常工作。

**为何不用平台分包**（esbuild / sharp 的 `optionalDependencies` + `os`/`cpu` 模式）：
本应用载荷是 **255MB 的 `.app` bundle**，不是单个二进制（对照：同 scope 的
`@becrafter/sail-darwin-arm64` 只有 19.8MB）。`.app` 落进 `node_modules` 会被
**Spotlight 索引、LaunchServices 注册**，系统里出现重复的「Launcher」条目；且 255MB 已贴近
npm 的包体积上限。产物留在 R2（本就出网免费、且是 cask 的 sha256 来源）更合适。

> `@becrafter` 是本项目自己的 npm scope（maintainer `kugouming`），`@becrafter/launcher`
> 未被占用。⚠ scoped 包**默认 private**，`package.json` 里的 `publishConfig.access = "public"`
> 不能省，否则发布失败。

### 安装契约（三条通道必须一致）

`scripts/install.sh`（bash）与 `packaging/npm/cli.mjs`（Node）是同一套逻辑的**两份实现** ——
bash 与 Node 无法共用代码，硬抽只会更脆。以下不变式**改任一侧都要同步另一侧**：

| 不变式 | 值 |
|---|---|
| 下载根 | `${LAUNCHER_R2_BASE:-https://repo.iskill.site/launcher}` |
| 产物命名 | `Launcher-[latest\|<版本>]-<架构>.zip`（版本号去 `v` 前缀） |
| 架构判据 | **`uname -m`**（`arm64`→arm64，`x86_64`→x64）—— 不能用 `process.arch`：那是 **Node 二进制**自身的架构，x64 Node 跑在 Apple Silicon 上会错装 x64 产物 |
| 解压工具 | **必须 `ditto -x -k`** —— `unzip` 与任何 JS zip 库都会丢符号链接与扩展属性，破坏 `.app` 内部签名（实测安装后保留 14 个符号链接） |
| 安装目录 | `/Applications`；不可写时回退 `~/Applications` |
| 收尾 | `xattr -dr com.apple.quarantine`（防御性：上述下载途径本就不打该标记） |
| 完整性 | 校验 `Contents/MacOS/Launcher` 存在，否则视为产物损坏 |

npm 侧把纯函数拆到 `lib.mjs`（架构 / URL / 版本比较 / 参数解析），配 vitest；`cli.mjs` 顶层有入口
switch，测试 import 它会真的执行，故不靠「是否主模块」判定（npm bin 是符号链接，`argv[1]` 与
`import.meta.url` 不一致），直接分层。

### 版本发现契约（三条通道共用）

「有哪些版本可装」「当前 latest 是哪个版本」在同一条不变式上 —— **两者都在 cdn 上**，
因为这两件事问的都是「我们发布了什么」：

| 问题 | 唯一来源 | 为什么不能用别的 |
|---|---|---|
| **有哪些版本** | `<cdn 根>/versions.txt`（纯文本，CI 发版时维护） | R2 公开域名**不支持列对象**（未开对象列表权限）；GitHub Releases 是另一条链路，产物上传成功而 Release 步骤失败时它会漏掉那个版本 |
| **latest 指向哪个版本** | `Launcher-latest-<架构>.zip` 的 **HEAD 重定向后最终 URL** | 别名名里没有版本号，R2 也没有 `latest.txt` 之类的指针对象 |

**应用内「检查更新」也读同一个清单**（`src/main/services/update-check.ts`）—— 此前打的是 GitHub
`/releases/latest`，于是有两条链路分叉：产物传成功而 Release 步骤失败时，通道能装到的版本应用却
说「已是最新」；内网/限流下应用直接报错而 cdn 侧完好；`/latest` 忽略 pre-release，rc 用户不会被
提示「正式版已经发了」。改读清单后这三条一并消失，代价是本应用检查更新必须先能连上 cdn
（**这是刻意的**：cdn 才是产物的家）。

> 应用判断「有没有新版」看的是清单里的**最新稳定版**，不是 latest 别名。两者在正常发版时相同，
> 但别名回答的是「重装一次会拿到哪个」，而这里要回答「最新的是什么」——副作用正合需要：
> 装了 `0.3.0-rc.1` 的用户会被提示正式版 `0.3.0` 已经发布。

`versions.txt` 的版式是一行一版、空白分隔两段：`0.2.0`（正式）/ `0.3.0-rc.1 pre`（预发布）。
选纯文本而不是 json，是为了让**零依赖的 bash 侧**用 grep/sed 就能读；坏行（空行、混进来的
html）两侧都直接跳过 —— 一份清单宁可少列一个版本，也不能让 `--list` 崩在畸形行上。

**清单在 CI 里生成**（`release.yml` 的「生成版本清单」，在传产物之前）：先 `curl` 取回 R2 上
已有的清单，把本次版本并进去，按版本号倒序去重后上传。做成增量而不是「从 git tag 重算」，
是因为产物不可变、清单是派生的 —— 重跑同一 tag 必须得到同样的结果（幂等由 `sort -V` + 去重保证）。
同一版本既有 `pre` 又有正式记录时（先发 rc 再发正式版），取「最正式」的那条，结论与先后顺序无关。

> ⚠ **预发布也写进清单**：清单回答的是「有哪些版本可装」，不是「稳定通道指向谁」。
> 三条通道的列版本都读它，故 rc 必须出现在列表里；「默认装哪个」由 latest 别名决定 ——
> 那个才跳过预发布。这与「预发布不进稳定通道」并不冲突：列表如实展示，装不装是用户的选择。

两份实现：`scripts/install.sh` 的 `list_versions`（curl + grep/sed，零依赖）与
`packaging/npm/lib.mjs` 的 `fetchReleases` / `parseVersionsFile`（fetch + 文本解析）；
latest 指针则分别是 curl 的 `%{url_effective}` 与 fetch 的 `res.url`。两侧的常量与口径由
`packaging/npm/contract.test.mjs` 钉住：

- `<cdn 根>/versions.txt`：bash 侧 `"$R2_BASE/versions.txt"` ≡ Node 侧 `base + VERSIONS_PATH`
- `version_from_download_url()`（bash 的 `version_of_filename`）≡ `versionFromDownloadUrl()`（Node）：
  版式 `Launcher-<版本>-<架构>.zip`，**架构不写进正则**（第一个 `-` 到最后一个 `-` 之间即版本），
  `Launcher-latest-*.zip` 判为「问不出」而不是回填成字符串 `latest`
- 「取不到」（网络/404）与「清单在但没有版本号」**分态**：前者提示网络与镜像，后者提示尚未发版

> ⚠ 别把「本 CLI / 本脚本的版本」当成 latest：`npx` 拉到的 CLI 版本可能落后于 cdn 上的 latest
> （npm 发版失败、或执行的是缓存的旧 CLI），拿它比对会给出「已是最新」的错误结论。取不到就
> 如实说「未取到」。

---

### 升级路径：应用自己认通道（`src/main/services/install-channel.ts`）

三条通道的**升级动作完全不同**，所以「发现新版本」时不能只喊一句「去下载」——那对 brew / npx
装的用户都是错的（照做会装出第二份应用）。应用在启动时探测一次自己的来源，只为**给对命令**：

| 来源 | 判据 | 判定后给出的命令 |
|---|---|---|
| `brew` | `brew list --cask` 的输出里有 `launcher` | `brew upgrade --cask becrafter/brew/launcher` |
| `npm` | 启动进程的 `_` 环境变量指向 npx 缓存 / `node_modules` / npm 的 bin shim | `npx -y @becrafter/launcher` |
| `manual` | 其余（含探测不出） | 重跑 `install.sh` 那条 curl |

**判据是尽力而为、宁可少认不可误认**：从 Dock / 双击启动时没有 `_`，npm 装的也会落到 `manual`
（给一条无害的 curl 命令），而不是猜成 npm。brew 那条也不是猜——问的就是「`brew upgrade` 是否
认识这个应用」。⚠ 不要改用「/Applications 那份与 Caskroom 是否同 inode」：实测 cask 装完两者
inode 不同，该判据不成立。

> 探测结果同时作为「关于」页的一行展示（Homebrew / npm / 脚本·手动安装），用户能看到应用把自己
> 认成了什么 —— 认错了才好报回来。

## 四、发布流程

`.github/workflows/release.yml` 分两个 job：

- **`release`**（macOS，挂在 `r2-publish` 环境）：push tag `v*`（或手动 dispatch）→ 校验 tag 与 `package.json` 版本一致（并判定是否预发布）→ typecheck + test → 构建 → 算 sha256 → 传 R2 → 验证公网可达 → 更新 tap 的 cask → 发 GitHub Release。
- **`npm-publish`**（Linux，挂在 `npm-publish` 环境）：`needs: release`，仅在 release 成功**且非预发布**时运行 → 从仓库拷 `packaging/npm/` 的四个文件、替换版本占位符 → `npm publish`。

> 为什么 npm 要单独一个 job：**GitHub 一个 job 只能挂一个 environment**，而 `NPM_TOKEN` 与 R2 的凭据分环境授权。该 job 不碰构建产物（只拷 4 个文件），所以用 Linux runner。

任何一步失败即中断，且整个流程可重跑（重跑同一 tag 会覆盖同一批对象并重算 sha256）。

产物（`electron-builder.yml` 的 `artifactName` 约定命名）：

| 产物 | 角色 |
|---|---|
| `Launcher-<version>-arm64.zip`、`Launcher-<version>-x64.zip` | **三条安装通道的产物** —— install.sh / cask / npm CLI 都只下载 zip；传 R2 + 挂 Release |
| `Launcher-latest-<arch>.zip` | install.sh / npm CLI 不带版本时用的固定别名，**只存在于 R2** |
| `versions.txt` | 可用版本清单，**只存在于 R2**（由「生成版本清单」步骤从远端旧清单增量合成） |
| `Launcher-<version>-arm64.dmg`、`Launcher-<version>-x64.dmg` | 额外产物，供手动安装；**三个通道都不使用，不作为本方案的推荐路径**，只挂 Release |

> install.sh 按 `Launcher-[latest|<版本>]-<架构>.zip` 拼名，cask 用 `arch arm:/intel:` 拼出同名，npm CLI 由 `packaging/npm/lib.mjs` 的 `zipUrl` 拼出——**改产物名、或改 workflow 里的 `R2_PREFIX`（必须与 install.sh 的 `R2_BASE` / cli.mjs 的 `DEFAULT_R2_BASE` 路径一致）会同时打断三条通道**；`versions.txt` 同理，它的路径由「cdn 根 + 固定文件名」拼出，两侧都不能各写一份。

### CI 依赖的 secrets（分挂在 `r2-publish` 与 `npm-publish` 两个环境上）

| Secret | 用途 |
|---|---|
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 的 S3 兼容凭据（endpoint = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`） |
| `R2_REPO_BUCKET_NAME` / `R2_REPO_PUBLIC_DOMAIN` | bucket 名与自定义域名（**不带末尾斜杠**，如 `https://repo.iskill.site`） |
| `TAP_GITHUB_TOKEN` | 对本仓库外的 `BeCrafter/homebrew-brew` 有 `contents: write` 的 PAT——`GITHUB_TOKEN` 只能作用于本仓库，跨仓推送必须用 PAT |
| `NPM_TOKEN` | **归 `npm-publish` 环境**（与上面几项分开授权，`release` job 读不到它）。npmjs.com 的 Automation token，用于发布 `@becrafter/launcher`。⚠ 首次发布前需确认该 scope 属于当前账号（`@becrafter` 现有 `sail` 等包，maintainer `kugouming`） |

R2 侧只需要 bucket + 绑好自定义域名并开启公开访问；`r2.dev` 域名有限流，不要用。

### 预发布版本（`-rc` / `-beta`）

版本号支持后缀，但**只有 `alpha` / `beta` / `pre` / `rc` 四个词可用**——Homebrew 只把这四个识别为预发布：

```ruby
# Homebrew version.rb
PRERELEASE_SUFFIX = /(?:[._-]?(?i:alpha|beta|pre|rc)\.?\d{,2})/
```

实测 `Version.new('0.2.0-dev') > Version.new('0.2.0')` 为 **true** —— 其余后缀（`dev`/`next`/`canary`/`nightly`/…）会被判为**比正式版更新**，已装正式版的用户会被 `brew upgrade` 推到该构建上。故 `scripts/release-version.mjs` 对白名单外的后缀**直接拒绝发布**（fail，不是警告）。

**预发布不触碰任何稳定通道**，四项都由 CI 里的 `IS_PRERELEASE` 控制：

| 动作 | 正式版 | 预发布 |
|---|---|---|
| 上传 `Launcher-<版本>-<架构>.zip` | ✅ | ✅ |
| 覆盖 `Launcher-latest-<架构>.zip` 别名 | ✅ | ❌ **跳过** —— 否则所有用默认命令安装的人会被静默换成预发布 |
| 更新 Homebrew cask | ✅ | ❌ **跳过** —— 版本比较只保证老用户不被"升级"到 rc，但**新用户 `brew install` 会直接装到 rc**；Homebrew 应保持纯稳定通道 |
| 发布 npm 包 | ✅ | ❌ **跳过** —— 同理，否则 `npx -y @becrafter/launcher` 会拉到 rc（`latest` dist-tag 被预发布占据） |
| GitHub Release 标 `pre-release` | ❌ | ✅ —— 应用内「检查更新」打的是 `/releases/latest`，该 API 只返回最新的**非** pre-release、**非** draft，标记后自然不推给用户 |

预发布因此只发 **zip + GitHub Release（pre-release）**；Release 正文的安装命令会自动带上 `--version`。

### 发版前预检

```bash
npm run release:check                  # 自检 package.json 的版本号
npm run release:check -- --tag v0.2.0  # 额外校验:tag 与版本一致、本地与远端都未被占用
```

打 tag 是**先推后验**——CI 的一致性校验发生在 tag 已推上去之后，一旦对不上只能删 tag 重打。这个脚本把同样的判断提前到本地。CI 里也调它（`--version <v> --emit`），**版本判定逻辑只有 `scripts/release-version.mjs` 一份实现**，不在 YAML 里另抄一遍。

工作区不干净只给**警告**不阻断：CI 构建的是 tag 指向的那个 commit，本地未提交的改动不影响产物；提示是为了拦住「改了版本号却没提交就打算打 tag」。

### 其它约定

- `--arch all` 逐架构出包（体积优先；universal 会让下载量翻倍）
- CI 把各产物 sha256 写进 Release 正文——**cask 已自动更新，这里只是留档与人工核对用**
- `npm ci` **不能加 `--omit=dev`**：构建期依赖现在全在 `devDependencies`
- `--no-run` 跳过运行验证（runner 无法原生执行另一架构产物），静态架构校验仍执行
- **推 cask 时只允许改动本包那一个文件**：tap 仓库 `BeCrafter/homebrew-brew` 会并存多个包的 cask，CI 只 `git add "$CASK_PATH"`，并在提交前断言暂存区**有且只有** `Casks/launcher.rb`——将来若有人把 `git add` 写成 `-A`/`.`，会在提交前失败而不是静默带上别人的 cask。若 clone 之后 tap 被他人推过，`git push` 会被拒（非快进），这是**期望**行为：宁可本次发版红掉重跑，也不覆盖别人刚推的内容
- 推 cask 的步骤对**预发布跳过**（见上），所以 tap 里那份 cask 始终指向最近一个正式版

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
6. 发版后 `curl -fsSI https://repo.iskill.site/launcher/Launcher-latest-arm64.zip` 返回 200（R2 公开访问 + latest 别名都活着）
7. `brew install --cask becrafter/brew/launcher` 后 `xattr /Applications/Launcher.app` **无 quarantine 输出**，双击能开
8. 版本发现三处一致（任一未发版时都应给出「尚未发过版」而不是崩溃/空列表）：
   - 发版后 `curl -fsSL https://repo.iskill.site/launcher/versions.txt` 里能看到本次版本（预发布是 `0.3.0-rc.1 pre` 两段）
   - `curl -fsSL .../install.sh | bash -s -- --list` 与 `npx -y @becrafter/launcher versions` 列出的版本集合相同
   - `--check` 与 `npx … status` 报出的「仓库最新」都等于 `Launcher-latest-<架构>.zip` 重定向指向的版本
9. 应用内「关于 → 检查更新」与 cdn 同源，且**按通道给对命令**：
   - 用 cask 装的那份，点检查更新 → 提示里应是 `brew upgrade --cask …`（不是「前往 GitHub 下载」）
   - 「关于」页的「安装来源」一行显示探测结果（cask 装的应显示 Homebrew）——**判错在界面上一眼可见**
   - 未发版时提示「尚未发布」，断网时提示带原因（HTTP 码 / 请求超时）

## MCP stdio 入口:`launcher-mcp`(2026-09-22)

应用内含一个 MCP stdio 入口,供外部 Agent(Claude Code / Claude Desktop)挂载。它**不再要求用户
手写那串又长又脆的命令**。

**做法**:打包时把 `packaging/mcp/launcher-mcp`(一个可执行 shell 脚本)放进
`Contents/Resources/`(asar **外面**),脚本自己按相对位置找到隔壁 `MacOS/Launcher` 与
`Resources/app.asar/out/main/launcher-mcp.js`,再以 `ELECTRON_RUN_AS_NODE=1` exec。
这样**不额外分发 Node 运行时,也不需要给第二个可执行文件签名**。

**命令给短形式还是完整路径,判据是 PATH 上那条链接的真实状态**(`main/services/path-link.ts` 扫 PATH +
解析符号链接 + 比对是否指向**本应用**的脚本),不是「安装来源是不是 brew」——
链接可能被删、应用可能被挪走、也可能指向另一个 Launcher 副本,靠猜迟早猜错,猜错的后果是用户拿到一条
`command not found`。四种状态:`linked`(给短命令)/ `missing` / `dangling` / `foreign`(后三者给完整路径,
并在弹窗里说明原因)。检查是**只读**的,启动即可算。

弹窗展示的是**要运行的命令本身**(`launcher-mcp` 或完整路径),不是 `claude mcp add …` 那种客户端配置语法 ——
前者是各家 MCP 客户端通用的"跑什么",后者只是某一家的语法(该示例行与弹窗底部那个复制按钮均已按用户要求移除,
块头的小复制钮复制命令本体)。

| 状态 | 弹窗给的命令 |
|---|---|
| `linked` | `claude mcp add launcher -- launcher-mcp` |
| 其余三态 | `claude mcp add launcher -- "<安装目录>/Launcher.app/Contents/Resources/launcher-mcp"` |

**「安装到 PATH」按钮**:非 `linked` 时弹窗出现该按钮,**点了才写** ——
往 PATH 里放可执行文件是应用之外可见的动作,而且 brew 装的情况下那条链接归 brew 管
(`brew uninstall` 要靠它清理),应用不该在启动时静默跟包管理器抢所有权。落点优先级:
① 已命中的那个目录(悬空/指向别处时**就地修**,不制造第二份)② PATH 里已有的 `~/.local/bin`
③ 其余可写 PATH 目录;都不行就如实报原因,让用户手动建。dev 下不提供该按钮(仓库里那份脚本
假设打包布局,链进 PATH 只会造出坏命令)。

**三条通道必须一致的两点**:
1. 解压链路可能**丢掉执行位** —— cask `postflight`、`scripts/install.sh`、`packaging/npm/cli.mjs`
   三处都补了一次 `chmod +x`,否则 PATH 上的 `launcher-mcp` 会「找得到但跑不起来」。
2. 脚本会解开自身的符号链接再定位(brew 的 `binary` 建的就是符号链接);不用 `readlink -f`,
   它到 macOS 12.3 才有,而本应用最低支持 12.0。

⚠ **两个实现坑(实测)**:
- 脚本里**不能**用 shell 的 `-f` 去检查 `app.asar/out/...` 是否存在 —— asar 是**单个文件**,
  其内部路径只有 Electron 打过补丁的 fs 才认识,shell 永远判为不存在,会把本来能跑的场景误判成缺失。
  检查 `app.asar` 本身即可。
- 已实测确认 `ELECTRON_RUN_AS_NODE=1` **能**读取 asar 内部的脚本(打包产物完整 MCP 握手通过),
  故入口留在 asar 里是安全的。

⚠ 符号链接指向 app 内部文件 —— **应用被移走或删除后该命令会失效**(脚本自身会给出可读报错)。
