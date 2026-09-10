// ported-from: docs/demo/js/modals.js parsePlistXml @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// plist 轻量解析(逐行为移植 modals.js parsePlistXml:提取 Label 与 Program/ProgramArguments[0])
export interface ParsedPlist {
  label: string
  program: string
}

export function parsePlistXml(xml: string): ParsedPlist | null {
  if (!xml || !xml.includes('<plist')) return null
  const pick = (key: string): string => {
    const m = xml.match(new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`))
    return m ? m[1].trim() : ''
  }
  const label = pick('Label')
  const program =
    pick('Program') ||
    (() => {
      const m = xml.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/)
      return m ? m[1].trim() : ''
    })()
  return { label, program }
}
