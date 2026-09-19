// 版本号语义:发布流水线与本地预检的**唯一实现**(CI 通过 release-check.mjs --emit 复用,
// 避免把判断逻辑再抄一份进 YAML 导致漂移)

/**
 * Homebrew 只把这四个词识别为预发布。
 * 源码依据:Homebrew `version.rb` 的 `PRERELEASE_SUFFIX = /(?:[._-]?(?i:alpha|beta|pre|rc)\.?\d{,2})/`
 *
 * ⚠ 其余后缀(dev / next / canary / nightly / snapshot …)会被 `Version` 判为【比正式版更新】——
 * 实测 `Version.new('0.2.0-dev') > Version.new('0.2.0')` 为 true。后果是**正式版用户会被
 * `brew upgrade` 推到该构建上**，而不是"装不到"。故这里只放行这四个词，其余一律拒绝发布。
 */
export const PRERELEASE_WORDS = ['alpha', 'beta', 'pre', 'rc']

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/

/** 后缀的首个连续字母段:`rc.1` → `rc`、`rc1` → `rc`、`beta.2` → `beta` */
function leadingWord(suffix) {
  const m = /^[A-Za-z]+/.exec(suffix)
  return m ? m[0].toLowerCase() : ''
}

/** 解析 X.Y.Z / X.Y.Z-<后缀>;失败给出可读原因 */
export function parseVersion(version) {
  const raw = String(version ?? '').trim()
  const m = VERSION_RE.exec(raw)
  if (!m) {
    return { ok: false, reason: `版本号须形如 X.Y.Z 或 X.Y.Z-<后缀>,收到 ${JSON.stringify(raw)}` }
  }
  return {
    ok: true,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    suffix: m[4] ?? null
  }
}

export function isPrerelease(version) {
  const p = parseVersion(version)
  return p.ok && p.suffix !== null
}

/**
 * 发布前的版本号校验。
 * @returns {{ok:true, prerelease:boolean} | {ok:false, reason:string}}
 */
export function validateVersion(version) {
  const p = parseVersion(version)
  if (!p.ok) return { ok: false, reason: p.reason }
  if (p.suffix === null) return { ok: true, prerelease: false }

  const word = leadingWord(p.suffix)
  if (!PRERELEASE_WORDS.includes(word)) {
    return {
      ok: false,
      reason:
        `预发布后缀 "${word}" 不被 Homebrew 识别(只认 ${PRERELEASE_WORDS.join(' / ')})。` +
        `Homebrew 会把 ${version} 判为比正式版**更新**,` +
        `导致已装正式版的用户被 brew upgrade 推到该构建上——故拒绝发布。` +
        `预发布请改用 -rc.N 或 -beta.N 形式。`
    }
  }
  return { ok: true, prerelease: true }
}

/** 校验失败时的统一提示(CLI 与测试共用同一份文案) */
export function describePrereleaseEffects(prerelease) {
  return prerelease
    ? [
        '预发布:不会覆盖 Launcher-latest-<架构>.zip 别名',
        '(install.sh 不带 --version 时仍指向最近一个正式版)',
        'GitHub Release 会标记为 pre-release —— 应用内「检查更新」不会推给用户'
      ]
    : ['正式版:会更新 Launcher-latest-<架构>.zip 别名与 GitHub Release latest']
}
