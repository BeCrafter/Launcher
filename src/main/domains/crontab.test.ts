import { describe, expect, it } from 'vitest'
import { cronLogDir, cronLogLegacyPath, cronLogTemplate } from '../../shared/cron-log'
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
      cronLogTemplate(HOME, target.job.id)
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
    const line = renderJobLine({ ...doc.jobs[0].job, enabled: true }, cronLogTemplate(HOME, doc.jobs[0].job.id))
    expect(line).toBe('0 2 * * * /usr/bin/backup')
    const doc2 = parseCrontab(text.replace('# [disabled] ', ''), 'user', USER, HOME)
    expect(doc2.jobs[0].job.enabled).toBe(true)
    expect(doc2.jobs[0].job.id).toBe(doc.jobs[0].job.id) // id 与启用态无关
  })

  it('10. 日志包裹(新式日期模板):重定向目标为 $(date …)(% 已转义);解析标 logTemplate', () => {
    const base = parseCrontab('0 9 * * * /usr/bin/run --flag\n', 'user', USER, HOME)
    const id = base.jobs[0].job.id
    const target = cronLogTemplate(HOME, id)
    const wrapped = renderJobLine({ ...base.jobs[0].job, log: true }, target)
    // 模板里的日期 % 必须被转义(cron 语义),shell 收到后才展开为 YYYYMMDDHH
    expect(wrapped).toBe(`0 9 * * * ( /usr/bin/run --flag ) >> ${cronLogDir(HOME)}/${id}-$(date +\\%Y\\%m\\%d\\%H).log 2>&1`)

    const doc = parseCrontab(`${wrapped}\n`, 'user', USER, HOME)
    expect(doc.jobs[0].job.log).toBe(true)
    expect(doc.jobs[0].job.logTemplate).toBe(true) // 模板态:实际文件按 id 扫目录解析
    expect(doc.jobs[0].job.logPath).toBeUndefined()
    expect(doc.jobs[0].job.cmd).toBe('/usr/bin/run --flag') // 解包还原
    expect(doc.jobs[0].job.id).toBe(id) // 解包后 id 与未包裹一致(幂等)
  })

  it('10b. 日志包裹(旧式单文件):仍识别并给出具体 logPath(新老共存)', () => {
    const base = parseCrontab('0 9 * * * /usr/bin/run --flag\n', 'user', USER, HOME)
    const id = base.jobs[0].job.id
    const legacy = cronLogLegacyPath(HOME, id)
    const wrapped = renderJobLine({ ...base.jobs[0].job, log: true }, legacy)
    expect(wrapped).toBe(`0 9 * * * ( /usr/bin/run --flag ) >> ${legacy} 2>&1`)

    const doc = parseCrontab(`${wrapped}\n`, 'user', USER, HOME)
    expect(doc.jobs[0].job.log).toBe(true)
    expect(doc.jobs[0].job.logPath).toBe(legacy) // 旧式有具体路径
    expect(doc.jobs[0].job.logTemplate).toBeUndefined()
  })

  it('10c. 用户自有重定向不误判', () => {
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

describe('命令字段的 % 转义(cron 语义:未转义 % = 换行 + stdin)', () => {
  it('renderJobLine:命令里的 % 一律转义为 \\%(含日志包裹)', () => {
    const job = { expr: '0 9 * * *', cmd: 'date +"%Y-%m-%d"', user: 'tester', enabled: true, log: false, system: undefined, special: false }
    expect(renderJobLine(job as never, '')).toBe('0 9 * * * date +"\\%Y-\\%m-\\%d"')

    const withLog = { ...job, log: true }
    const line = renderJobLine(withLog as never, '/p/x.log')
    expect(line).toBe('0 9 * * * ( date +"\\%Y-\\%m-\\%d" ) >> /p/x.log 2>&1')
    expect(line).not.toMatch(/(^|[^\\])%/) // 不存在未转义的 %
  })

  it('解析:已转义的 \\% 还原为 %(界面显示用户原命令)', () => {
    const doc = parseCrontab('0 9 * * * date +"\\%Y" >> /Users/tester/Library/Logs/BeCrafter-Launcher/cron/a.log 2>&1\n', 'user', USER, HOME)
    const job = doc.jobs[0].job
    expect(job.cmd).toBe('date +"%Y"')
    expect(job.log).toBe(true)
  })

  it('往返稳定:% 命令「读入 → 写回」字节一致', () => {
    const escaped = '0 9 * * * ( date +"\\%Y-\\%m" ) >> /Users/tester/Library/Logs/BeCrafter-Launcher/cron/a.log 2>&1\n'
    const job = parseCrontab(escaped, 'user', USER, HOME).jobs[0].job
    expect(renderJobLine(job, job.logPath!)).toBe(escaped.trim())
  })

  it('未转义的 %(历史遗留/手写)仍能解析出完整命令,写回时被修正', () => {
    // 用户当前两条任务就属于这种:磁盘上未转义 → cron 截断命令 → 日志永远为空
    const legacy = '0 9 * * * date +"%Y" >> /Users/tester/Library/Logs/BeCrafter-Launcher/cron/a.log 2>&1\n'
    const job = parseCrontab(legacy, 'user', USER, HOME).jobs[0].job
    expect(job.cmd).toBe('date +"%Y"') // 界面显示正常
    expect(renderJobLine(job, cronLogTemplate(HOME, job.id))).toContain('date +"\\%Y"') // 写回即修正
  })
})

describe('未转义 % 的检测与修复闭环(cron 会把未转义 % 当换行 → 命令被截断、静默失败)', () => {
  const LOG = '/Users/tester/Library/Logs/BeCrafter-Launcher/cron/a.log'
  const bare = `* * * * * echo "$(date +"%Y")" >> ${LOG} 2>&1\n`

  it('裸 % → 置 percentUnescaped,但界面仍显示原命令', () => {
    const job = parseCrontab(bare, 'user', USER, HOME).jobs[0].job
    expect(job.percentUnescaped).toBe(true)
    expect(job.cmd).toBe('echo "$(date +"%Y")"')
  })

  it('已转义 \\% → 不置位', () => {
    const escaped = `* * * * * echo "$(date +"\\%Y")" >> ${LOG} 2>&1\n`
    const job = parseCrontab(escaped, 'user', USER, HOME).jobs[0].job
    expect(job.percentUnescaped).toBeUndefined()
    expect(job.cmd).toBe('echo "$(date +"%Y")"')
  })

  it('偶数反斜杠(\\\\%)仍视为未转义', () => {
    const job = parseCrontab('* * * * * printf \'a\\\\%b\'\n', 'user', USER, HOME).jobs[0].job
    expect(job.percentUnescaped).toBe(true)
  })

  it('无 % / 无日志包裹时的判定', () => {
    expect(parseCrontab('* * * * * /usr/bin/date\n', 'user', USER, HOME).jobs[0].job.percentUnescaped).toBeUndefined()
    expect(parseCrontab('* * * * * date +"%Y"\n', 'user', USER, HOME).jobs[0].job.percentUnescaped).toBe(true) // 无包裹同样告警
  })

  it('已停用的任务不告警(启用时会经 renderJobLine 自动修正)', () => {
    const job = parseCrontab('# [disabled] * * * * * date +"%Y"\n', 'user', USER, HOME).jobs[0].job
    expect(job.enabled).toBe(false)
    expect(job.percentUnescaped).toBeUndefined()
  })

  it('修复闭环:重写该行 → 命令被转义、再解析不再告警、命令内容不变', () => {
    const job = parseCrontab(bare, 'user', USER, HOME).jobs[0].job
    expect(job.percentUnescaped).toBe(true)
    const rewritten = renderJobLine(job, job.logPath!)
    expect(rewritten).toContain('\\%Y') // 已转义
    const again = parseCrontab(`${rewritten}\n`, 'user', USER, HOME).jobs[0].job
    expect(again.percentUnescaped).toBeUndefined()
    expect(again.cmd).toBe(job.cmd) // 界面命令不受影响
  })
})
