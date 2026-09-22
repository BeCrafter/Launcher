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

// ────────────────────────────────────────────────────────────────────────────
// 正式版递增 与 dev 测试版序号
//
// 本地 `npm run release:*`(scripts/release.mjs)与 CI 的 dev-release.yml 共用这里的实现 ——
// 「下一个版本号是几」只有一处定义,避免两边算法漂移导致同名 tag 撞车。
// ────────────────────────────────────────────────────────────────────────────

/** 递增类型 → 下一版。语义同 semver:minor 清 patch、major 清 minor+patch */
export const BUMP_KINDS = ['major', 'minor', 'patch']

export function bumpStable(version, kind) {
  const p = parseVersion(version)
  if (!p.ok) return { ok: false, reason: p.reason }
  if (!BUMP_KINDS.includes(kind)) {
    return {
      ok: false,
      reason: `递增类型须是 ${BUMP_KINDS.join(' / ')},收到 ${JSON.stringify(kind)}`
    }
  }
  const next = {
    major: `${p.major + 1}.0.0`,
    minor: `${p.major}.${p.minor + 1}.0`,
    patch: `${p.major}.${p.minor}.${p.patch + 1}`
  }[kind]
  return { ok: true, version: next }
}

/** 纯 X.Y.Z 才算「已发布的正式版」;带任何后缀(rc/beta/dev…)的都不算 */
export function isStableVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(String(version ?? '').trim())
}

function compareStable(a, b) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/**
 * 最新正式版(入参是 tag 名或版本号,带不带 v 都行)。
 * 一个正式版都没有时返回 null —— **不**回退到预发布 tag:rc 不是「已发布的版本」,
 * 拿它当 dev 基线会让 0.3.0-rc.2 催出 0.3.0-rc.2-dev.1 这种没人看得懂的号。
 */
export function latestStableVersion(tags) {
  const stable = (tags ?? [])
    .map((t) => String(t).trim().replace(/^v/, ''))
    .filter(isStableVersion)
  if (stable.length === 0) return null
  return stable.sort(compareStable)[stable.length - 1]
}

/** dev-release.yml 只管 X.Y.Z-dev.N;rc/beta/pre/alpha 归正式发布流水线 */
export function isDevVersion(version) {
  return /^\d+\.\d+\.\d+-dev\.\d+$/.test(String(version ?? '').trim())
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 该基线下已有 `v<base>-dev.<n>` 的最大 n + 1(累加,不复用已发过的号) */
export function nextDevNumber(tags, base) {
  const re = new RegExp(`^v?${escapeRe(String(base))}-dev\\.(\\d+)$`)
  let max = 0
  for (const t of tags ?? []) {
    const m = re.exec(String(t).trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/**
 * dev 版本号 = `<基线>-dev.<序号>`。
 * 基线优先级:显式指定 > 最新正式版 tag > package.json 的 X.Y.Z > 0.1.0(仓库尚无任何版本时)。
 */
export function resolveDevVersion({ tags = [], base, fallback } = {}) {
  const core = parseVersion(fallback)
  const explicit = String(base ?? '').trim()
  const chosen =
    explicit ||
    latestStableVersion(tags) ||
    (core.ok ? `${core.major}.${core.minor}.${core.patch}` : '') ||
    '0.1.0'
  if (!isStableVersion(chosen)) {
    return { ok: false, reason: `dev 基线须是纯 X.Y.Z,收到 ${JSON.stringify(chosen)}` }
  }
  return { ok: true, base: chosen, version: `${chosen}-dev.${nextDevNumber(tags, chosen)}` }
}
