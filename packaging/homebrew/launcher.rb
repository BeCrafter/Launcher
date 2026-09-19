# BeCrafter Launcher —— Homebrew Cask 模板（唯一事实来源）
#
# 本文件不参与本仓库构建：发版时 .github/workflows/release.yml 会把它复制到
# BeCrafter/homebrew-brew 的 Casks/ 下，并用 sed 替换 version / url / 两个 sha256。
# 因此**不要手改 tap 仓库里的那份**——下次发版会被本模板覆盖。
# 详见同目录 README.md。
cask "launcher" do
  version "REPLACE_WITH_VERSION"

  # 两个架构各自出包（产物名见 electron-builder.yml 的 artifactName），故 url / sha256 按架构分支
  arch arm: "arm64", intel: "x64"

  # 产物托管在 Cloudflare R2：文件名带版本号，规避 cdn 按文件名缓存导致的「装到旧版本」
  url "REPLACE_WITH_R2_PUBLIC_DOMAIN/launcher/Launcher-#{version}-#{arch}.zip"
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
