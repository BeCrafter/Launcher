#!/usr/bin/env bash
# BeCrafter Launcher 安装脚本
#
#   curl -fsSL https://raw.githubusercontent.com/BeCrafter/Launcher/main/scripts/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --version 0.1.0
#
# 为什么用 curl 而不是浏览器下载：浏览器会给下载的文件打上 com.apple.quarantine
# 隔离标记，macOS 随后会对未公证的 app 直接报「已损坏」，且不再提供任何图形化
# 绕过入口。curl 不设该标记，因此这条路能真正跑起来。
set -euo pipefail

REPO="BeCrafter/Launcher"
APP_NAME="Launcher.app"
INSTALL_DIR="${LAUNCHER_INSTALL_DIR:-/Applications}"
VERSION=""

usage() {
  cat <<'EOF'
用法：install.sh [--version <x.y.z>] [--dir <安装目录>]

  --version <x.y.z>  安装指定版本（默认取最新 Release）
  --dir <目录>       安装目录（默认 /Applications，不可写时回退 ~/Applications）
  -h, --help         显示本帮助
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
    -h | --help) usage; exit 0 ;;
    *) die "未知参数：$1（可用 --version / --dir，见 -h）" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "未找到 curl"

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) die "不支持的架构 $(uname -m)：本应用仅提供 arm64 / x64" ;;
esac

if [ -n "$VERSION" ]; then
  API="https://api.github.com/repos/$REPO/releases/tags/v${VERSION#v}"
else
  API="https://api.github.com/repos/$REPO/releases/latest"
fi

echo "查询发布信息…"
JSON="$(curl -fsSL -H 'User-Agent: becrafter-launcher-install' "$API")" ||
  die "无法获取 Release 信息（${API}）——若仓库尚未发布任何 Release，请改用源码构建（npm run build:app）"

URL="$(printf '%s' "$JSON" |
  grep -o '"browser_download_url": *"[^"]*"' |
  sed 's/.*"\(http[^"]*\)"/\1/' |
  grep -- "-${ARCH}\.zip\$" |
  head -1)"

[ -n "$URL" ] || die "该 Release 中没有 ${ARCH} 架构的 zip 产物"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "下载 $(basename "$URL") …"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip"

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

# 优雅退出正在运行的旧实例，避免覆盖时文件被占用
osascript -e 'quit app "Launcher"' >/dev/null 2>&1 || true
sleep 1

rm -rf "${INSTALL_DIR:?}/$APP_NAME"
ditto "$TMP/out/$APP_NAME" "$INSTALL_DIR/$APP_NAME"

# curl 本就不打隔离标记；此处仅作防御（例如该 zip 曾被浏览器下载过）
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo
echo "✅ 已安装到 $INSTALL_DIR/$APP_NAME"
echo "   打开：open \"$INSTALL_DIR/$APP_NAME\""
