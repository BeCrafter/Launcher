// brew 托管判定纯函数(机制对齐开源 BrewManagedSupport:纯字符串启发式,零 spawn)
// agents 列表用 isBrewManaged 判标签/过滤/操作路由展示,不再依赖 `brew services list`(11-13s,见
// docs/design/demo-react-migration-map.md「打开慢修复」);需要 brew 记录本体(如 start/stop 路由)
// 时仍走 matchBrewService(有 brew 数据,优先 file 字段精确匹配,启发式仅兜底)。

export const BREW_LABEL_PREFIX = 'homebrew.mxcl.'

const HOMEBREW_PATH_RE = /\/homebrew\/|\/opt\/homebrew\/|\/usr\/local\/(?:opt|Cellar)\//

/** label 前缀 homebrew.mxcl. → 余部即公式名 */
export function formulaNameFromLabel(label: string): string | null {
  if (!label.startsWith(BREW_LABEL_PREFIX)) return null
  const name = label.slice(BREW_LABEL_PREFIX.length)
  return name === '' ? null : name
}

/** 可执行路径落在 Homebrew 安装树(/opt|Cellar/<公式>/)下 → 反推公式名(覆盖 tap/自定义前缀 label) */
export function formulaNameFromProgram(program: string): string | null {
  if (!HOMEBREW_PATH_RE.test(program)) return null
  // 取最后一个 /opt|Cellar/<公式>/ 段(路径可能先出现 /opt/homebrew/ 前缀)
  const matches = [...program.matchAll(/\/(?:opt|Cellar)\/([^/]+)/g)]
  if (matches.length === 0) return null
  const formula = matches[matches.length - 1][1].replace(/\.rb$/, '').replace(/@[\d.]+$/, '')
  return formula === '' ? null : formula
}

export function isBrewManaged(label: string, program: string): boolean {
  return brewFormulaName(label, program) !== null
}

/** 判定顺序与 matchBrewService 一致:label 前缀 → 安装路径 */
export function brewFormulaName(label: string, program: string): string | null {
  return formulaNameFromLabel(label) ?? formulaNameFromProgram(program)
}
