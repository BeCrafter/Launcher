// XML 节点级补丁(复审 item 4/5):未改动部分逐字节保留,只改写被改动的顶层键
import { describe, expect, it } from 'vitest'
import { parsePlistXml, type PlistDict } from './plist-xml'
import { patchPlistXml } from './plist-patch'

const ORIGINAL = `<plist version="1.0">
<dict>
\t<!-- 字典内部注释:重建式保存会丢,节点级补丁必须原样保留 -->
\t<key>Label</key>
\t<string>com.demo</string>
\t<key>Nice</key>
\t<real>1.0</real>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>/bin/echo</string>
\t</array>
\t<key>MachServices</key>
\t<dict>
\t\t<key>com.demo</key>
\t\t<true/>
\t</dict>
</dict>
</plist>
`
const parse = (xml: string): PlistDict => {
  const r = parsePlistXml(xml)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const patch = (next: PlistDict, desc?: string) =>
  patchPlistXml({ originalXml: ORIGINAL, originalDict: parse(ORIGINAL), nextDict: next, indent: '\t', desc })

describe('patchPlistXml', () => {
  it('未改动 → 逐字节原样返回(fast path,零改写)', () => {
    const r = patch(parse(ORIGINAL))
    expect(r.ok && r.xml).toBe(ORIGINAL)
    expect(r.ok && r.changed).toEqual([])
  })

  it('只改一个键 → 全文件仅该节点变化:注释/键序/<real> 原样保留', () => {
    const next = { ...parse(ORIGINAL), Nice: 5 }
    const r = patch(next)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 逐字节断言:整份文件 = 原文只把 <real>1.0</real> 换成 <integer>5</integer>
    expect(r.xml).toBe(ORIGINAL.replace('<real>1.0</real>', '<integer>5</integer>'))
    expect(r.xml).toContain('<!-- 字典内部注释:重建式保存会丢,节点级补丁必须原样保留 -->')
    expect(r.changed).toEqual(['Nice'])
  })

  it('改数组值:只换该键的值元素,其余不动', () => {
    const next = { ...parse(ORIGINAL), ProgramArguments: ['/bin/echo', 'v2'] }
    const r = patch(next)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.xml).toContain('\t\t<string>v2</string>')
    // 其它键(含 MachServices 的原始写法)一字未动
    expect(r.xml).toContain('\t\t<key>com.demo</key>\n\t\t<true/>')
    expect(r.xml).toContain('<real>1.0</real>')
    expect(r.xml.match(/com\.demo<\/string>/g)?.length).toBe(1)
  })

  it('新增键插在 </dict> 前;删除键整行移除(不留空行)', () => {
    const base = parse(ORIGINAL)
    const added = patch({ ...base, RunAtLoad: true })
    expect(added.ok).toBe(true)
    if (added.ok) {
      expect(added.xml).toContain('\t<key>RunAtLoad</key>\n\t<true/>')
      expect(added.xml.indexOf('RunAtLoad')).toBeLessThan(added.xml.lastIndexOf('</dict>'))
    }
    const { Nice: _drop, ...rest } = base
    const removed = patch(rest)
    expect(removed.ok).toBe(true)
    if (removed.ok) {
      expect(removed.xml).not.toContain('Nice')
      expect(removed.xml).not.toContain('<real>')
      expect(removed.xml).not.toContain('\n\n') // 不留空行
    }
  })

  it('描述注释:更新 / 插入 / 删除', () => {
    const withDesc = patchPlistXml({
      originalXml: ORIGINAL,
      originalDict: parse(ORIGINAL),
      nextDict: parse(ORIGINAL),
      indent: '\t',
      desc: '我的任务'
    })
    expect(withDesc.ok && withDesc.xml).toContain('<!-- 我的任务 -->')
    expect(withDesc.ok && withDesc.xml.indexOf('<!-- 我的任务 -->')).toBeLessThan(withDesc.ok ? withDesc.xml.indexOf('<plist') : -1)

    const updated = patchPlistXml({
      originalXml: withDesc.ok ? withDesc.xml : ORIGINAL,
      originalDict: parse(ORIGINAL),
      nextDict: parse(ORIGINAL),
      indent: '\t',
      desc: '改过的描述'
    })
    expect(updated.ok && updated.xml).toContain('<!-- 改过的描述 -->')
    expect(updated.ok && updated.xml).not.toContain('我的任务')

    const cleared = patchPlistXml({
      originalXml: withDesc.ok ? withDesc.xml : ORIGINAL,
      originalDict: parse(ORIGINAL),
      nextDict: parse(ORIGINAL),
      indent: '\t',
      desc: ''
    })
    expect(cleared.ok && cleared.xml).not.toContain('<!-- 我的任务 -->')
    expect(cleared.ok && cleared.xml).toContain('<!-- 字典内部注释')
  })

  it('结构无法安全扫描 → ok:false(由调用方锁表单走 XML,不盲重建)', () => {
    const weird = '<plist version="1.0"><dict><![CDATA[junk]]></dict></plist>'
    const r = patchPlistXml({ originalXml: weird, originalDict: {}, nextDict: { Label: 'a' }, indent: '\t' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/非 <key>|CDATA|越界|缺值/)
  })
})
