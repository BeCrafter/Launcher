import { describe, expect, it } from 'vitest'
import { formatPlistXml } from './plist'

const MINIFIED =
  '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>com.user.x</string><key>RunAtLoad</key><true/><key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string></array><key>KeepAlive</key><dict><key>Crashed</key><true/></dict></dict></plist>'

function lines(...ls: string[]): string {
  return ls.join('\n') + '\n'
}

describe('formatPlistXml', () => {
  it('2 空格:嵌套逐级缩进、叶子内联、自闭合单行', () => {
    expect(formatPlistXml(MINIFIED, '2')).toBe(
      lines(
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0">',
        '  <dict>',
        '    <key>Label</key>',
        '    <string>com.user.x</string>',
        '    <key>RunAtLoad</key>',
        '    <true/>',
        '    <key>ProgramArguments</key>',
        '    <array>',
        '      <string>/bin/sh</string>',
        '      <string>-c</string>',
        '    </array>',
        '    <key>KeepAlive</key>',
        '    <dict>',
        '      <key>Crashed</key>',
        '      <true/>',
        '    </dict>',
        '  </dict>',
        '</plist>'
      )
    )
  })

  it('4 空格与 tab 缩进', () => {
    const four = formatPlistXml(MINIFIED, '4')
    expect(four).toContain('\n    <dict>\n        <key>Label</key>')
    const tab = formatPlistXml(MINIFIED, 'tab')
    expect(tab).toContain('\n\t<dict>\n\t\t<key>Label</key>')
  })

  it('幂等:再格式化输出不变', () => {
    const once = formatPlistXml(MINIFIED, '2')
    expect(formatPlistXml(once, '2')).toBe(once)
    const once4 = formatPlistXml(MINIFIED, '4')
    expect(formatPlistXml(once4, '4')).toBe(once4)
  })

  it('跨行 DOCTYPE 收敛为单行置顶', () => {
    const xml =
      '<?xml version="1.0"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"\n  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist><dict><key>a</key><string>b</string></dict></plist>'
    const out = formatPlistXml(xml, '2')
    expect(out.split('\n')[1]).toBe(
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    )
    expect(out).toContain('\n  <dict>\n    <key>a</key>\n    <string>b</string>\n  </dict>\n')
  })

  it('注释逐行重缩进', () => {
    const xml = '<plist><!-- top --><dict><!--\n multi\n comment\n --><true/></dict></plist>'
    expect(formatPlistXml(xml, '2')).toBe(
      lines(
        '<plist>',
        '  <!-- top -->',
        '  <dict>',
        '    <!--',
        '    multi',
        '    comment',
        '    -->',
        '    <true/>',
        '  </dict>',
        '</plist>'
      )
    )
  })

  it('CDATA 内容逐字保留', () => {
    const xml = '<plist><string><![CDATA[a < b & c\n  keep]]></string></plist>'
    const out = formatPlistXml(xml, '2')
    expect(out).toContain('<![CDATA[a < b & c\n  keep]]>')
  })

  it('空元素内联;文本叶子 trim', () => {
    const out = formatPlistXml('<plist><a></a><b>  x  </b></plist>', '2')
    expect(out).toContain('  <a></a>\n')
    expect(out).toContain('  <b>x</b>\n')
  })

  it('畸形输入原样返回不抛', () => {
    const bad = '<plist><!-- unterminated'
    expect(formatPlistXml(bad, '2')).toBe(bad)
    expect(formatPlistXml('', '2')).toBe('')
  })
})
