# BeCrafter Launcher —— Homebrew Cask 模板
#
# 本文件是「复制到 tap 仓库」的模板，不参与本仓库构建：
#   1. 新建 GitHub 仓库 BeCrafter/homebrew-tap
#   2. 把本文件放到该仓库的 Casks/ 目录下
#   3. 每次发版后更新 version 与两个 sha256 —— CI 会把它们写进 GitHub Release 正文，直接复制即可
# 详见同目录 README.md。
cask "becrafter-launcher" do
  version "0.1.0"

  # 两个架构各自出包（产物名见 electron-builder.yml 的 artifactName），故 url / sha256 按架构分支
  arch arm: "arm64", intel: "x64"

  url "https://github.com/BeCrafter/Launcher/releases/download/v#{version}/Launcher-#{version}-#{arch}.zip"
  sha256 arm:   "REPLACE_WITH_ARM64_ZIP_SHA256",
         intel: "REPLACE_WITH_X64_ZIP_SHA256"

  name "Launcher"
  desc "macOS local service manager for launchd, crontab and port services"
  homepage "https://github.com/BeCrafter/Launcher"

  app "Launcher.app"

  # Homebrew 会给下载物打上 com.apple.quarantine（cask/download.rb 无条件调用 Quarantine.cask!，
  # 且 Homebrew 7 已移除 --no-quarantine 选项），而未公证的 app 带该标记会被 macOS 判为
  # 「已损坏」且不再提供任何图形化绕过入口 —— 故装完立即移除。
  # 用非 bang 的 system_command：macOS 14+ 的 App Management 保护可能让它失败，
  # 那时只告警，由下方 caveats 提示用户手动处理。
  postflight do
    result = system_command "/usr/bin/xattr",
                            args: ["-dr", "com.apple.quarantine", "#{appdir}/Launcher.app"]

    unless result&.success?
      opoo "未能自动移除隔离标记，请手动执行：" \
           "xattr -dr com.apple.quarantine \"#{appdir}/Launcher.app\""
    end
  end

  caveats <<~EOS
    Launcher 使用 ad-hoc 签名（未购买 Apple 开发者证书），本 cask 已尝试自动移除隔离标记。
    若打开时仍提示「已损坏」，请手动执行一次：

      xattr -dr com.apple.quarantine "#{appdir}/Launcher.app"
  EOS
end
