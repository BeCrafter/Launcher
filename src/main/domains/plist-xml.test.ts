import { describe, expect, it } from 'vitest'
import { extractPlistDesc, parsePlistXml, toPlistXml } from './plist-xml'

const NANOCLAW = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>com.nanoclaw</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>/usr/local/bin/node</string>
\t\t<string>/x/index.js</string>
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>/usr/local/bin:/usr/bin</string>
\t</dict>
</dict>
</plist>`

describe('parsePlistXml', () => {
  it('解析真实结构:dict/array/bool/嵌套 dict', () => {
    const r = parsePlistXml(NANOCLAW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({
      Label: 'com.nanoclaw',
      ProgramArguments: ['/usr/local/bin/node', '/x/index.js'],
      RunAtLoad: true,
      KeepAlive: true,
      EnvironmentVariables: { PATH: '/usr/local/bin:/usr/bin' }
    })
  })

  it('错误分支:缺 plist 根 / 根非 dict / 标签未闭合', () => {
    expect(parsePlistXml('<foo/>').ok).toBe(false)
    expect(parsePlistXml('<plist version="1.0"><array/></plist>')).toMatchObject({ ok: false, error: 'root is not a dictionary' })
    expect(parsePlistXml('<plist><dict><key>a</key>').ok).toBe(false)
  })

  it('实体转义往返:& < >', () => {
    const r = parsePlistXml('<plist><dict><key>K</key><string>a &amp; b &lt;c&gt;</string></dict></plist>')
    expect(r.ok && r.value.K).toBe('a & b <c>')
  })
})

describe('toPlistXml', () => {
  it('序列化 → 再解析 值级往返一致', () => {
    const r = parsePlistXml(NANOCLAW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const xml = toPlistXml(r.value, { indent: '\t' })
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist')).toBe(true)
    expect(xml.endsWith('</plist>\n')).toBe(true)
    const again = parsePlistXml(xml)
    expect(again.ok && again.value).toEqual(r.value)
  })

  it('desc 注释:写出 → extractPlistDesc 读回;不影响解析', () => {
    const xml = toPlistXml({ Label: 'a' }, { desc: '我的服务 & 说明' })
    expect(extractPlistDesc(xml)).toBe('我的服务 & 说明')
    expect(parsePlistXml(xml)).toMatchObject({ ok: true })
  })

  it('缩进注入(tab/2/4)与空 dict', () => {
    expect(toPlistXml({ Label: 'a' }, { indent: '    ' })).toContain('\n    <key>Label</key>')
    expect(toPlistXml({})).toContain('<dict/>')
  })
})
