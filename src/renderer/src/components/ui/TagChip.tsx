// ported-from: docs/demo/js/components.js tagChip @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 标签 chip(demo components.js tagChip;色板 TAG_COLORS 合并自原 tagColor+aiTagColor)
// cls 可为色表键(brew/blue/…)或直接 class(red/yellow/…),icon/style/title 可选
const TAG_COLORS: Record<string, string> = {
  brew: 'brew', server: 'blue', sync: 'purple', daemon: 'blue', backup: 'cyan', cron: 'cyan',
  log: 'green', cleanup: 'green', notify: 'purple', network: 'blue',
  anthropic: 'purple', openai: 'green', google: 'cyan', coding: 'blue', git: 'yellow',
  plist: 'purple', diagnose: 'red', refactor: 'purple', import: 'cyan', cli: 'blue'
}

export function TagChip({
  text,
  cls,
  icon,
  style,
  title
}: {
  text: React.ReactNode
  cls?: string
  icon?: string
  style?: React.CSSProperties
  title?: string
}): React.JSX.Element {
  const c = (cls && TAG_COLORS[cls]) || cls || 'purple'
  return (
    <span className={`tag ${c}`} style={style} title={title}>
      {icon && <i className={icon} style={{ marginRight: 2 }} />}
      {text}
    </span>
  )
}
