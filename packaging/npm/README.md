# @becrafter/launcher

安装 [BeCrafter Launcher](https://github.com/BeCrafter/Launcher) —— 一个 macOS 本地服务管理应用
（管理 launchd 的 Launch Agents / 定时任务 / 端口服务）。

这个包**只是一个安装器**：它把官方产物下载下来装进 `/Applications`，本身不含应用、不含任何依赖、
也不在 `postinstall` 里做任何事。

## 安装

```bash
npx -y @becrafter/launcher
```

会从官方 CDN 下载产物（约 123MB），解压安装到 `/Applications`，并清除隔离标记。

要求：macOS + Node 18 以上。

## 常用命令

```bash
npx -y @becrafter/launcher                 # 未安装则安装；已安装则显示状态
npx -y @becrafter/launcher status          # 版本检查：已装版本 / 仓库最新 / npm 包最新
npx -y @becrafter/launcher versions        # 列出可用版本（加 --pre 连预发布一起列）
npx -y @becrafter/launcher install --force # 强制重装当前版本
npx -y @becrafter/launcher install --version 0.2.0
npx -y @becrafter/launcher uninstall
```

`versions` 的列表来自官方 CDN 上的 `versions.txt`（三条安装通道共用的发现来源，与产物同源）：

```bash
npx -y @becrafter/launcher versions --pre     # 连预发布版本一起列
npx -y @becrafter/launcher versions --json    # 输出 json（含 release notes），供脚本消费
```

| 选项 | 说明 |
|---|---|
| `--version <x.y.z\|latest>` | 指定要装的版本；默认 = 本 CLI 的版本 |
| `--dir <目录>` | 安装目录；默认 `/Applications`，不可写时回退 `~/Applications` |
| `-f, --force` | 已装同版本时也强制重装 |
| `--pre` / `--json` | 仅 `versions`：连预发布一起列 / 输出 json |

环境变量：`LAUNCHER_R2_BASE` 换下载根地址（镜像 / 自建 CDN），`LAUNCHER_INSTALL_DIR` 同 `--dir`，
`LAUNCHER_RELEASES_API` 换版本列表来源。

## 卸载

```bash
npx -y @becrafter/launcher uninstall
```

> ⚠ **必须显式运行这条命令。** npm 从 v7 起**没有卸载钩子**（官方文档明载 v6 的
> `uninstall` 脚本「will not function」），所以 `npm uninstall` 不会、也无法替你清理
> `/Applications/Launcher.app`。
>
> 如果你是用 `npx` 跑的，删掉 `.app` 之后不需要再清理别的东西 —— npx 只把它缓存在
> `~/.npm/_npx/` 下。若曾用 `npm i -g` 装过本 CLI，再补一条
> `npm uninstall -g @becrafter/launcher`。

## 更新

```bash
npx -y @becrafter/launcher            # 默认就会装到最新正式版
npx -y @becrafter/launcher status     # 已装版本 vs 仓库最新
```

`status` 会同时报出「已装版本」与「仓库最新版」（= 官方 CDN 上 `Launcher-latest-<架构>.zip`
指向的版本，也就是不带参数安装会装到的那个），需要时按提示升级。想装预发布版本用
`install --version <版本>`（如 `0.2.0-rc.1`，先用 `versions --pre` 查有哪些）。

## 其它安装方式

| 通道 | 命令 |
|---|---|
| Homebrew | `brew install --cask becrafter/brew/launcher` |
| curl 脚本 | `curl -fsSL https://raw.githubusercontent.com/BeCrafter/Launcher/main/scripts/install.sh \| bash` |

三条通道装出来的是同一个应用；区别只在入口与前置依赖（curl 零依赖，Homebrew 需要 Homebrew，
本包需要 Node 18+）。

## 说明

- 应用为 ad-hoc 签名、未公证。三条通道都通过**不带隔离标记**的方式获取产物，
  因此不会触发 Gatekeeper 的「已损坏」（细节见仓库的 `docs/design/distribution.md`）。
- 本包只发布 JavaScript，应用产物托管在官方 CDN，不随 npm 包分发。

## License

MIT
