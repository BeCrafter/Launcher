// ported-from: docs/demo/js/drawer.js addArgTo/addEnvTo/addWatchTo @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 多值行编辑(收口 demo addArgTo/addEnvTo/addWatchTo/delMvRow 三处同构)
// 行 markup 与内联样式逐字保留(demo 中这些行由 JS createElement 生成)
// 2026-09-18:Arguments 与 WatchPaths 曾各写一份逐行同构的实现 → 收口为 StringList(仅 idx 符号/占位/按钮文案不同)
import { useT } from '../../hooks/useT'

// Arguments / WatchPaths 共用的字符串行列表
function StringList({
  values,
  onChange,
  idx,
  placeholder,
  addLabelKey
}: {
  values: string[]
  onChange: (next: string[]) => void
  idx: (i: number) => React.ReactNode
  placeholder?: string
  addLabelKey: string
}): React.JSX.Element {
  const t = useT()
  const update = (i: number, v: string): void => {
    const next = [...values]
    next[i] = v
    onChange(next)
  }
  const remove = (i: number): void => onChange(values.filter((_, j) => j !== i))
  return (
    <div className="multi-val">
      {values.map((v, i) => (
        <div className="mv-row" key={i}>
          <span className="mv-idx">{idx(i)}</span>
          <input
            className="f-input mono"
            type="text"
            value={v}
            placeholder={placeholder}
            onChange={(e) => update(i, e.target.value)}
          />
          <button className="mv-del" type="button" onClick={() => remove(i)}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      ))}
      <button className="add-row-btn" type="button" onClick={() => onChange([...values, ''])}>
        <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> <span>{t(addLabelKey)}</span>
      </button>
    </div>
  )
}

// Arguments:[i] 序号行(demo mv-row + mv-idx)
export function ArgsList({
  args,
  onChange
}: {
  args: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  return <StringList values={args} onChange={onChange} idx={(i) => `[${i}]`} addLabelKey="cfg.addArg" />
}

// EnvVars:KEY=VALUE 行(demo kv-row,内联样式逐字)
export function EnvList({
  env,
  onChange
}: {
  env: Record<string, string>
  onChange: (next: Record<string, string>) => void
}): React.JSX.Element {
  const t = useT()
  const entries = Object.entries(env)
  const setKey = (oldKey: string, newKey: string): void => {
    const next: Record<string, string> = {}
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v
    onChange(next)
  }
  return (
    <div className="multi-val">
      {entries.map(([k, v]) => (
        <div className="kv-row" key={k}>
          <input
            className="f-input mono"
            type="text"
            value={k}
            style={{ maxWidth: 110, fontSize: 10.5 }}
            onChange={(e) => setKey(k, e.target.value)}
          />
          <span className="kv-eq">=</span>
          <input
            className="f-input mono"
            type="text"
            value={v}
            style={{ fontSize: 10.5 }}
            onChange={(e) => onChange(Object.fromEntries(entries.map(([k2, v2]) => [k2, k2 === k ? e.target.value : v2])))}
          />
          <button
            className="mv-del"
            type="button"
            onClick={() => onChange(Object.fromEntries(entries.filter(([k2]) => k2 !== k)))}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      ))}
      <button
        className="add-row-btn"
        type="button"
        onClick={() => onChange({ ...env, '': '' })}
      >
        <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> <span>{t('cfg.addEnv')}</span>
      </button>
    </div>
  )
}

// WatchPaths:• 圆点行(demo mv-row 圆点变体)
export function WatchList({
  paths,
  onChange
}: {
  paths: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  return (
    <StringList
      values={paths}
      onChange={onChange}
      idx={() => '•'}
      placeholder="/path/to/watch"
      addLabelKey="cfg.addPath"
    />
  )
}
