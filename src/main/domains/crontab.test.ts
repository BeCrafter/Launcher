import { describe, expect, it } from 'vitest'
import { cronLogPath } from '../../shared/cron-log'
import {
  hashJobId,
  headerRawOf,
  parseCrontab,
  renderDescLine,
  renderJobLine,
  replaceHeader,
  serializeCrontab,
  unwrapLogCmd
} from './crontab'

const HOME = '/Users/tester'
const USER = 'tester'
const roundtrip = (text: string, scope: 'user' | 'system' = 'user'): string =>
  serializeCrontab(parseCrontab(text, scope, USER, HOME))

describe('parseCrontab 往返保真', () => {
  it('1. 空文本 → 空文档', () => {
    const doc = parseCrontab('', 'user', USER, HOME)
    expect(doc.jobs).toEqual([])
    expect(serializeCrontab(doc)).toBe('')
  })

  it('2. 纯注释 + 空行文件逐字节往返', () => {
    const text = '# 我的定时任务\n#\n\n# 下面还没有任务\n'
    expect(roundtrip(text)).toBe(text)
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.jobs).toEqual([])
    expect(doc.header.endLine).toBe(doc.lines.length)
  })

  it('3. env 行:普通/引号值/等号空格 → 往返 + 解析值', () => {
    const text =
      'SHELL=/bin/zsh\nMAILTO="a@b.c"\nPATH = /usr/bin:/bin\nCRON_TZ=Asia/Shanghai\n\n0 9 * * * /usr/bin/true\n'
    expect(roundtrip(text)).toBe(text)
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.header.env.map((e) => [e.name, e.value])).toEqual([
      ['SHELL', '/bin/zsh'],
      ['MAILTO', '"a@b.c"'],
      ['PATH', '/usr/bin:/bin'],
      ['CRON_TZ', 'Asia/Shanghai']
    ])
    expect(doc.jobs).toHaveLength(1)
  })

  it('4. 基本任务行(制表符/多空格/非 ASCII 命令)往返 + 字段解析', () => {
    const text = '0\t9   * * 1-5 /bin/sh /tmp/日报.sh --en\n'
    expect(roundtrip(text)).toBe(text)
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.jobs[0].job.expr).toBe('0 9 * * 1-5')
    expect(doc.jobs[0].job.cmd).toBe('/bin/sh /tmp/日报.sh --en')
    expect(doc.jobs[0].job.user).toBe(USER)
    expect(doc.jobs[0].job.enabled).toBe(true)
  })

  it('5. 引号命令:命令段整体保留(含引号与 &&)', () => {
    const text = `0 9 * * * echo "hello world" && echo 'a b'\n`
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.jobs[0].job.cmd).toBe(`echo "hello world" && echo 'a b'`)
    expect(roundtrip(text)).toBe(text)
  })

  it('6. 特殊入口 @reboot/@daily/@hourly', () => {
    const text = '@reboot /usr/local/bin/warmup\n@daily /usr/bin/true\n0 * * * * /usr/bin/x\n'
    expect(roundtrip(text)).toBe(text)
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.jobs.map((j) => [j.job.expr, j.job.cmd, j.job.special])).toEqual([
      ['@reboot', '/usr/local/bin/warmup', true],
      ['@daily', '/usr/bin/true', true],
      ['0 * * * *', '/usr/bin/x', false]
    ])
  })

  it('7. system 6 字段:第 6 token 为 user;5 字段行 → unparsed', () => {
    const text = '*/5 * * * * root /usr/bin/x\n0 9 * * * /usr/bin/y\n'
    const doc = parseCrontab(text, 'system', USER, HOME)
    expect(doc.jobs).toHaveLength(1)
    expect(doc.jobs[0].job.user).toBe('root')
    expect(doc.jobs[0].job.system).toBe(true)
    expect(doc.unparsed.map((u) => u.raw)).toEqual(['0 9 * * * /usr/bin/y'])
    expect(roundtrip(text, 'system')).toBe(text) // unparsed 原样保留
  })

  it('8. 未改动行字节级保真:只重写目标行', () => {
    const text = '# 头注释  \nSHELL=/bin/zsh\n0 9 * * * /usr/bin/a\n@daily /usr/bin/b\n'
    const doc = parseCrontab(text, 'user', USER, HOME)
    const target = doc.jobs[0]
    doc.lines[target.lineIndex] = renderJobLine(
      { ...target.job, cmd: '/usr/bin/c' },
      cronLogPath(HOME, target.job.id)
    )
    const out = serializeCrontab(doc)
    expect(out.startsWith('# 头注释  \nSHELL=/bin/zsh\n')).toBe(true) // 首两行含尾随空格逐字节不变
    expect(out.endsWith('@daily /usr/bin/b\n')).toBe(true)
  })

  it('9. 禁用标记:解析 enabled=false;普通注释不受影响;渲染往返一致', () => {
    const text = '# 备份任务\n# [disabled] 0 2 * * * /usr/bin/backup\n# 这是普通注释\n'
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.jobs).toHaveLength(1)
    expect(doc.jobs[0].job.enabled).toBe(false)
    expect(doc.jobs[0].job.desc).toBe('备份任务')
    expect(doc.jobs[0].descLineIndex).toBe(0)

    // 再渲染(启用)后重新解析 → 状态回归
    const line = renderJobLine({ ...doc.jobs[0].job, enabled: true }, cronLogPath(HOME, doc.jobs[0].job.id))
    expect(line).toBe('0 2 * * * /usr/bin/backup')
    const doc2 = parseCrontab(text.replace('# [disabled] ', ''), 'user', USER, HOME)
    expect(doc2.jobs[0].job.enabled).toBe(true)
    expect(doc2.jobs[0].job.id).toBe(doc.jobs[0].job.id) // id 与启用态无关
  })

  it('10. 日志包裹:应用路径解包(log=true/cmd 还原/id 一致);用户自有重定向不误判', () => {
    const base = parseCrontab('0 9 * * * /usr/bin/run --flag\n', 'user', USER, HOME)
    const id = base.jobs[0].job.id
    const path = cronLogPath(HOME, id)
    const wrapped = renderJobLine({ ...base.jobs[0].job, log: true }, path)
    expect(wrapped).toBe(`0 9 * * * ( /usr/bin/run --flag ) >> ${path} 2>&1`)

    const doc = parseCrontab(`${wrapped}\n`, 'user', USER, HOME)
    expect(doc.jobs[0].job.log).toBe(true)
    expect(doc.jobs[0].job.cmd).toBe('/usr/bin/run --flag')
    expect(doc.jobs[0].job.id).toBe(id) // 解包后 id 与未包裹一致(幂等)

    const userOwn = parseCrontab('0 9 * * * /usr/bin/x >> /var/log/x.log 2>&1\n', 'user', USER, HOME)
    expect(userOwn.jobs[0].job.log).toBe(false)
    expect(userOwn.jobs[0].job.cmd).toBe('/usr/bin/x >> /var/log/x.log 2>&1')
    expect(unwrapLogCmd('/usr/bin/x >> /tmp/y.log 2>&1', HOME)).toBeNull()
  })

  it('11. 描述 = 紧邻上方注释;头部不含该行;头部替换只动头部块', () => {
    const text = '# 文件头注释\nSHELL=/bin/zsh\n# 每天问候\n0 9 * * * /usr/bin/hello\n'
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.jobs[0].job.desc).toBe('每天问候')
    expect(doc.jobs[0].descLineIndex).toBe(2)
    expect(headerRawOf(doc)).toBe('# 文件头注释\nSHELL=/bin/zsh')
    expect(doc.header.endLine).toBe(2)

    const replaced = replaceHeader(doc, 'SHELL=/bin/bash\n# 新头部')
    expect(replaced.join('\n')).toBe('SHELL=/bin/bash\n# 新头部\n# 每天问候\n0 9 * * * /usr/bin/hello\n')

    // 空行分隔的注释不采纳为 desc
    const doc2 = parseCrontab('# 段落标题\n\n0 9 * * * /usr/bin/x\n', 'user', USER, HOME)
    expect(doc2.jobs[0].job.desc).toBe('')
    expect(doc2.jobs[0].descLineIndex).toBeNull()
  })

  it('12. 同一命令重复出现 → id 加后缀且稳定', () => {
    const text = '0 9 * * * /usr/bin/x\n0 9 * * * /usr/bin/x\n'
    const doc = parseCrontab(text, 'user', USER, HOME)
    expect(doc.jobs[0].job.id).toBe(hashJobId('user', '0 9 * * *', '/usr/bin/x'))
    expect(doc.jobs[1].job.id).toBe(`${doc.jobs[0].job.id}-2`)
  })

  it('13. desc 渲染与解析往返', () => {
    expect(renderDescLine('备份')).toBe('# 备份')
    const doc = parseCrontab(`# 备份\n0 2 * * * /usr/bin/backup\n`, 'user', USER, HOME)
    expect(doc.jobs[0].job.desc).toBe('备份')
  })
})
