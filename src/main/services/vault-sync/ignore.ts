// 排除规则:gitignore 的一个子集,自己解析,不引包。
//
// 支持:按行、# 注释、空行忽略、* 与 ?、末尾 / 只匹配目录、前面加 / 只匹配根。
// 不支持 ** 与取反 ! —— 第一版用不到,这两种行当非法行跳过,不让整轮失败。
// 目录命中则其下整棵跳过。本地扫描与远端清单用同一份规则。

export { DEFAULT_SYNC_IGNORE, SYNC_IGNORE_MAX } from '../../../shared/notes'

interface Rule {
  /** 只匹配目录(末尾带 /) */
  dirOnly: boolean
  /** 只匹配从根开始的路径(前面带 /) */
  anchored: boolean
  /** 去掉前导 / 与末尾 / 之后的模式,段之间仍是 / */
  pattern: string
}

/** 非法行(含 ** 或取反)丢掉,不报错 */
export function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.includes('**') || line.startsWith('!')) continue
    const dirOnly = line.endsWith('/')
    const body = dirOnly ? line.slice(0, -1) : line
    if (body === '') continue
    const anchored = body.startsWith('/')
    const pattern = anchored ? body.slice(1) : body
    if (pattern === '') continue
    rules.push({ dirOnly, anchored, pattern })
  }
  return rules
}

/** 把一段 glob(* 与 ?,不跨 /)编成锚定的正则 */
function segmentToRegExp(segment: string): string {
  let out = ''
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

function ruleRegExp(rule: Rule): RegExp {
  const segments = rule.pattern.split('/').map(segmentToRegExp)
  const body = segments.join('/')
  // 未锚定:模式可以落在任一层(像 gitignore 里不带斜杠的模式匹配任何目录)。
  // 带斜杠但没有前导 / 时也从任一层开始匹配,和 git 一致。
  const source = rule.anchored ? `^${body}$` : `(^|/)${body}$`
  return new RegExp(source)
}

export interface IgnoreMatcher {
  /** rel 用 / 分隔,不以 / 开头。isDir 用来区分末尾带 / 的规则 */
  ignores(rel: string, isDir: boolean): boolean
}

export function compileIgnore(text: string): IgnoreMatcher {
  const compiled = parseIgnore(text).map((rule) => ({ rule, re: ruleRegExp(rule) }))
  return {
    ignores(rel, isDir) {
      const path = rel.replace(/^\/+/, '').replace(/\/+$/, '')
      if (path === '') return false
      // 任一层目录命中,其下整棵都命中
      const parts = path.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('/')
        const prefixIsDir = i < parts.length || isDir
        for (const { rule, re } of compiled) {
          if (rule.dirOnly && !prefixIsDir) continue
          if (re.test(prefix)) return true
        }
      }
      return false
    }
  }
}
