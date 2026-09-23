#!/usr/bin/env bash
# BeCrafter Launcher 安装脚本
#
#   curl -fsSL https://raw.githubusercontent.com/BeCrafter/Launcher/dev/scripts/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --version 0.1.0    # 指定版本
#   curl -fsSL .../install.sh | bash -s -- --list             # 看有哪些版本
#   curl -fsSL .../install.sh | bash -s -- --check            # 版本检查（装没装、是不是最新）
#
# 为什么用 curl 而不是浏览器下载：浏览器会给下载的文件打上 com.apple.quarantine
# 隔离标记，macOS 随后会对未公证的 app 直接报「已损坏」，且不再提供任何图形化
# 绕过入口。curl 不设该标记，因此这条路能真正跑起来。
#
# 产物托管在 Cloudflare R2（自定义域名）。不带 --version 时下载 Launcher-latest-<架构>.zip
# 别名——该对象在所有版本间共用文件名，故 CI 上传时带了 no-store 绕开 cdn 缓存。
# 「有哪些版本」读同目录下的 versions.txt（CI 发版时维护），与产物同源、纯文本、零解析依赖。
#
# ⚠ 安装契约：本文件与 packaging/npm/cli.mjs 是同一套逻辑的两份实现（bash 与 Node 无法
#   共用代码）。R2 地址 / 产物命名 / 架构判据 / ditto 解压 / 安装目录回落 / xattr / 完整性
#   校验七条不变式**改任一侧都要同步另一侧**，契约原文见 docs/design/distribution.md。
set -euo pipefail

APP_NAME="Launcher.app"
# R2 对象前缀必须与 .github/workflows/release.yml 的 R2_PREFIX 一致
R2_BASE="${LAUNCHER_R2_BASE:-https://repo.iskill.site/launcher}"
INSTALL_DIR="${LAUNCHER_INSTALL_DIR:-/Applications}"
VERSION=""
DO_CHECK=0
DO_LIST=0
SHOW_PRE=0

usage() {
  cat <<'EOF'
用法：install.sh [选项]

  （无选项）         安装最新版；已装则先报出当前版本再装
  --list             列出可用版本（默认只列稳定版）
  --check            版本检查：已装版本、仓库最新版
  --version <x.y.z>  安装指定版本（默认取 R2 上的 latest）
  --dir <目录>       安装目录（默认 /Applications,不可写时回退 ~/Applications）
  --pre              配合 --list：连预发布版本一起列
  -h, --help         显示本帮助

环境变量：
  LAUNCHER_R2_BASE     替换下载根地址（镜像/自建 cdn 用）；版本清单也在这个根下
  LAUNCHER_INSTALL_DIR 同 --dir

说明：
  · 版本清单（`<cdn 根>/versions.txt`）与产物同源，镜像只需镜像这个根目录。
  · 用 Homebrew 装的话，更新走 `brew upgrade --cask becrafter/brew/launcher`。
EOF
}

die() { echo "错误：$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || die "--version 需要一个版本号"
      VERSION="$2"; shift 2 ;;
    --dir)
      [ $# -ge 2 ] || die "--dir 需要一个目录路径"
      INSTALL_DIR="$2"; shift 2 ;;
    --check) DO_CHECK=1; shift ;;
    --list) DO_LIST=1; shift ;;
    --pre) SHOW_PRE=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "未知参数：${1}（可用 --list / --check / --version / --dir，见 -h）" ;;
  esac
done

[ "$SHOW_PRE" = 0 ] || [ "$DO_LIST" = 1 ] || die "--pre 只配合 --list 使用"

command -v curl >/dev/null 2>&1 || die "未找到 curl"

# 架构判据必须与 packaging/npm/cli.mjs 同源（都走 uname -m），命令行得出一致结果
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) die "不支持的架构 $(uname -m)：本应用仅提供 arm64 / x64" ;;
esac

# ── 版本发现 ────────────────────────────────────────────────

# R2 不支持列对象，别名名里也没有版本号 —— 只能发一次请求跟随重定向，
# 从最终 URL 反解（cli.mjs 的 versionFromDownloadUrl 是同一套做法的 Node 侧实现）。
r2_latest() {
  local url effective
  url="$R2_BASE/Launcher-latest-$ARCH.zip"
  effective="$(curl -fsSIL --max-time 20 -o /dev/null -w '%{url_effective}' "$url" 2>/dev/null)" || return 1
  version_of_filename "${effective##*/}" | grep -v '^latest$'
}

# 产物文件名 → 版本号。版式 Launcher-<版本>-<架构>.zip：取「第一个 - 到最后一个 - 之间」，
# 架构不写进正则（同 cli.mjs 的 versionFromDownloadUrl，对两种架构一视同仁）
version_of_filename() {
  echo "$1" | sed -n 's/^Launcher-\(.*\)-[^-]*\.zip$/\1/p'
}

# 可用版本清单（`<cdn 根>/versions.txt`，CI 发版时维护，一行一版：`0.2.0` / `0.3.0-rc.1 pre`）。
# 与产物同源、纯文本，故这条零依赖通道只要 grep/sed 就能读 —— 曾经走 GitHub Releases 的
# JSON，得用 awk 手工拆数组，既脆又让内网镜像用户依赖公网 api。
# 输出两列制表符分隔：版本 与 是否预发布（1/0）。
list_versions() {
  curl -fsSL --max-time 20 "$R2_BASE/versions.txt" |
    sed -n 's/[[:space:]]\+/ /g; s/^ *//; s/ *$//; /^[0-9]/p' |
    awk '{ pre = ($2 == "pre") ? 1 : 0; if (!seen[$1]++) print $1 "\t" pre }'
}
installed_version() {
  defaults read "$INSTALL_DIR/$APP_NAME/Contents/Info" CFBundleShortVersionString 2>/dev/null || true
}

if [ "$DO_LIST" = 1 ]; then
  TMP_LIST="$(mktemp)"
  trap 'rm -f "$TMP_LIST"' EXIT
  if ! list_versions > "$TMP_LIST"; then
    die "取不到版本清单：$R2_BASE/versions.txt
  网络不可达？也可直接用 LAUNCHER_R2_BASE 指向镜像。"
  fi
  [ -s "$TMP_LIST" ] || die "cdn 上的 versions.txt 里没有可用的版本号（尚未发过版？）"

  HAVE="$(installed_version)"
  # 清单自身即按版本号倒序（CI 生成时排好），故「第一个非预发布」就是最新稳定版
  LATEST_STABLE="$(awk -F'\t' '$2 == 0 { print $1; exit }' "$TMP_LIST")"
  echo "BeCrafter Launcher 可用版本"
  SHOWN=0
  while IFS=$'\t' read -r ver pre; do
    [ -n "$ver" ] || continue
    if [ "$pre" = 1 ] && [ "$SHOW_PRE" = 0 ]; then continue; fi
    marks=""
    [ "$pre" = 1 ] && marks="  [预发布]"
    [ -n "$LATEST_STABLE" ] && [ "$ver" = "$LATEST_STABLE" ] && marks="$marks  [最新]"
    [ -n "$HAVE" ] && [ "$ver" = "$HAVE" ] && marks="$marks  [已安装]"
    printf '  %-14s%s\n' "$ver" "$marks"
    SHOWN=$((SHOWN + 1))
  done < "$TMP_LIST"
  [ "$SHOWN" = 0 ] && echo "  没有稳定版（加 --pre 看预发布）"
  HIDDEN="$(awk -F'\t' '$2 == 1' "$TMP_LIST" | wc -l | tr -d ' ')"
  [ "$SHOW_PRE" = 0 ] && [ "$HIDDEN" != 0 ] && echo "（另有 $HIDDEN 个预发布，加 --pre 查看）"
  echo
  echo "  安装指定版本：curl -fsSL <本脚本> | bash -s -- --version <版本>"
  [ -n "$LATEST_STABLE" ] && echo "  不带 --version 装的是最新稳定版 $LATEST_STABLE"
  rm -f "$TMP_LIST"
  trap - EXIT
  exit 0
fi

if [ "$DO_CHECK" = 1 ]; then
  HAVE="$(installed_version)"
  # ⚠ 变量一律写 ${VAR}：macOS 自带的 bash 3.2 会把变量名后紧跟的多字节字符并进变量名，
  #   `$HAVE（` 会被当成一个叫 `HAVE（` 的变量而报 unbound variable（已踩）
  [ -n "$HAVE" ] && echo "已安装：${HAVE}（${INSTALL_DIR}/${APP_NAME}）" || echo "已安装：无"
  if LATEST_VER="$(r2_latest)"; then
    echo "仓库最新：$LATEST_VER"
    if [ -n "$HAVE" ] && [ "$HAVE" = "$LATEST_VER" ]; then
      echo "已是最新。"
    elif [ -n "$HAVE" ]; then
      echo "有新版本：$HAVE → $LATEST_VER"
      echo "升级：curl -fsSL <本脚本> | bash"
    fi
  else
    echo "仓库最新：(未取到 —— 检查网络，或该别名尚未发布)"
    echo "  可用 --list 看完整版本列表（读 cdn 上的 versions.txt）。"
  fi
  exit 0
fi

# ── 安装 ────────────────────────────────────────────────────

if [ -n "$VERSION" ]; then
  URL="$R2_BASE/Launcher-${VERSION#v}-${ARCH}.zip"
else
  URL="$R2_BASE/Launcher-latest-${ARCH}.zip"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BEFORE="$(installed_version)"
[ -n "$BEFORE" ] && echo "当前版本：$BEFORE"

echo "下载 $(basename "$URL") …"
# 顺便把最终 URL 拿出来：latest 别名重定向后就是带版本号的文件名，等于免费做了版本检查
EFFECTIVE="$(curl -fL --progress-bar "$URL" -o "$TMP/app.zip" -w '%{url_effective}')" ||
  die "下载失败：${URL}（该版本是否存在？用 --list 看可用版本，或用 -h 查看镜像环境变量）"

# 必须用 ditto 解压：unzip 不保留符号链接与扩展属性，会破坏 .app 内部的代码签名
echo "解压…"
mkdir -p "$TMP/out"
ditto -x -k "$TMP/app.zip" "$TMP/out"
[ -d "$TMP/out/$APP_NAME" ] || die "压缩包内未找到 $APP_NAME"

[ -d "$INSTALL_DIR" ] || mkdir -p "$INSTALL_DIR" 2>/dev/null || true
if [ ! -w "$INSTALL_DIR" ]; then
  FALLBACK="$HOME/Applications"
  echo "提示：$INSTALL_DIR 不可写，改装到 $FALLBACK"
  mkdir -p "$FALLBACK"
  INSTALL_DIR="$FALLBACK"
fi

# 优雅退出正在运行的旧实例，避免覆盖时文件被占用。
# `quit app` 是按名字退的，会把任意路径下的实例都退掉；只在目标就是默认位置的常见情形下执行。
if [ "$INSTALL_DIR" = "/Applications" ]; then
  osascript -e 'quit app "Launcher"' >/dev/null 2>&1 || true
  sleep 1
fi

rm -rf "${INSTALL_DIR:?}/$APP_NAME"
ditto "$TMP/out/$APP_NAME" "$INSTALL_DIR/$APP_NAME"

# curl 本就不打隔离标记；此处仅作防御（例如该 zip 曾被浏览器下载过）
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

# MCP stdio 入口:解压链路可能丢执行位,补一次(否则它「找得到但跑不起来」)
chmod +x "$INSTALL_DIR/$APP_NAME/Contents/Resources/launcher-mcp" 2>/dev/null || true

echo
echo "✅ 已安装到 $INSTALL_DIR/$APP_NAME"
# 版本号取自下载 URL 的文件名（重定向后的最终地址），不额外发请求
VERSION_FROM_URL="$(basename "$EFFECTIVE")"
INSTALLED="$(installed_version)"
if [ -n "$INSTALLED" ]; then
  echo "   版本：$INSTALLED"
elif [ -n "$VERSION_FROM_URL" ]; then
  echo "   版本：$(version_of_filename "$VERSION_FROM_URL")"
fi
echo "   打开：open \"$INSTALL_DIR/$APP_NAME\""
