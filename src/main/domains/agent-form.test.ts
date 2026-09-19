import { describe, expect, it } from 'vitest'
import type { AgentForm } from '../../shared/models'
import { formFromPlist, formIncompatibilities, plistFromForm, scanCompatibility, unmanagedKeys, validateNewAgentInput } from './agent-form'

const NANOCLAW = {
  Label: 'com.nanoclaw',
  ProgramArguments: ['/usr/local/bin/node', '/x/index.js'],
  WorkingDirectory: '/Users/x/proj',
  RunAtLoad: true,
  KeepAlive: true,
  EnvironmentVariables: { PATH: '/usr/local/bin:/usr/bin' },
  StandardOutPath: '/tmp/a.log',
  StandardErrorPath: '/tmp/a.err'
}

describe('formFromPlist', () => {
  it('标准结构映射(KeepAlive bool,无不支持键)', () => {
    const r = formFromPlist(NANOCLAW, '纳米虾')
    expect(r.unsupportedKeys).toEqual([])
    expect(r.form).toMatchObject({
      label: 'com.nanoclaw',
      desc: '纳米虾',
      program: '/usr/local/bin/node',
      args: ['/x/index.js'],
      workingDir: '/Users/x/proj',
      stdout: '/tmp/a.log',
      keepAliveMode: 'bool'
    })
    expect(r.form.triggers).toMatchObject({ runAtLoad: true, keepAlive: true })
    expect(r.form.env.PATH).toBe('/usr/local/bin:/usr/bin')
  })

  it('KeepAlive dict → mode=dict、三态保真(false 不再塌成「关」);StartCalendarInterval 数组 → SCI 条目', () => {
    const r = formFromPlist(
      {
        Label: 'a',
        KeepAlive: { Crashed: true, SuccessfulExit: false },
        StartCalendarInterval: [{ Hour: 9, Minute: 0 }, { Weekday: 1, Hour: 8 }],
        StartInterval: 300
      },
      ''
    )
    expect(r.form.keepAliveMode).toBe('dict')
    expect(r.form.keepAliveDict).toEqual({ crashed: true, successfulExit: false })
    expect(r.form.triggers.keepAlive).toBe(true)
    expect(r.form.sciEntries).toEqual([{ Hour: 9, Minute: 0 }, { Weekday: 1, Hour: 8 }])
    expect(r.form.triggers.startCalendarInterval).toBe(true)
    expect(r.form.triggers.startInterval).toBe(300)
  })

  it('KeepAlive 未知子键(AfterInitialDemand / NetworkState)→ 不兼容清单带前缀', () => {
    const r = formFromPlist(
      { Label: 'a', KeepAlive: { Crashed: true, AfterInitialDemand: true, NetworkState: false } },
      ''
    )
    expect(r.unsupportedKeys.length).toBeGreaterThan(0)
    expect(r.unsupportedKeys).toEqual(['KeepAlive.AfterInitialDemand', 'KeepAlive.NetworkState'])
    expect(r.form.keepAliveDict.crashed).toBe(true)
  })

  it('KeepAlive 非 bool 非 dict(字符串)→ 不兼容;空 dict → 视为关闭且不报不支持', () => {
    const bad = formFromPlist({ Label: 'a', KeepAlive: 'yes' }, '')
    expect(bad.unsupportedKeys).toEqual(['KeepAlive'])

    const empty = formFromPlist({ Label: 'a', KeepAlive: {} }, '')
    expect(empty.unsupportedKeys).toEqual([])
    expect(empty.form.triggers.keepAlive).toBe(false)
  })

  it('ThrottleInterval:0 与缺省可区分(0 合法;缺省 → null)', () => {
    expect(formFromPlist({ Label: 'a', ThrottleInterval: 0 }, '').form.throttleInterval).toBe(0)
    expect(formFromPlist({ Label: 'a' }, '').form.throttleInterval).toBeNull()
  })

  it('往返白名单键不触发守卫;UserName 读进表单,StandardInPath 不进表单', () => {
    const r = formFromPlist(
      {
        Label: 'a',
        Disabled: true,
        EnableTransactions: false,
        UserName: 'root',
        StandardInPath: '/tmp/in.txt'
      },
      ''
    )
    expect(r.unsupportedKeys).toEqual([])
    expect(r.form.userName).toBe('root')
    expect(r.form).not.toHaveProperty('stdin') // 无 UI:只按原值往返,不给表单字段
  })

  it('顶层非托管键属于 B 类:进入不兼容清单并保留键名', () => {
    const r = formFromPlist({ Label: 'a', SessionCreate: true, LimitLoadToSessionType: 'Aqua' }, '')
    expect(r.unsupportedKeys).toEqual(['LimitLoadToSessionType', 'SessionCreate'])
    expect(unmanagedKeys({ Label: 'a', SessionCreate: true, LimitLoadToSessionType: 'Aqua' })).toEqual([
      'LimitLoadToSessionType',
      'SessionCreate'
    ])
  })
})

describe('formIncompatibilities', () => {
  it('顶层非托管键与表单无法表达的父键都进入不兼容清单', () => {
    expect(
      formIncompatibilities({
        Label: 'a',
        Sockets: { x: 1 },
        KeepAlive: { PathState: { '/x': true }, Crashed: true }
      })
    ).toEqual(['KeepAlive.PathState', 'Sockets'])
  })

  it('EnvironmentVariables 非字符串值 → 带键名前缀(规范是 dictionary of strings)', () => {
    expect(
      formIncompatibilities({ Label: 'a', EnvironmentVariables: { PORT: 8080, OK: 'x' } })
    ).toEqual(['EnvironmentVariables.PORT'])
  })

  it('SCI 未知子键 / 非数字值 / 非字典 → 带前缀或整键', () => {
    expect(formIncompatibilities({ Label: 'a', StartCalendarInterval: { Hour: 9, Foo: 1 } })).toEqual([
      'StartCalendarInterval.Foo'
    ])
    expect(formIncompatibilities({ Label: 'a', StartCalendarInterval: { Minute: '9' } })).toEqual([
      'StartCalendarInterval.Minute'
    ])
    expect(formIncompatibilities({ Label: 'a', StartCalendarInterval: 'daily' })).toEqual([
      'StartCalendarInterval'
    ])
    // 数组形态逐条检查,且键名去重
    expect(
      formIncompatibilities({ Label: 'a', StartCalendarInterval: [{ Hour: 9, Foo: 1 }, { Foo: 2 }] })
    ).toEqual(['StartCalendarInterval.Foo'])
  })

  it('合法 SCI(单 dict / 数组,5 个数字键)不误报', () => {
    expect(formIncompatibilities({ Label: 'a', StartCalendarInterval: { Minute: 0, Hour: 9 } })).toEqual([])
    expect(
      formIncompatibilities({ Label: 'a', StartCalendarInterval: [{ Weekday: 7 }, { Day: 1, Month: 12 }] })
    ).toEqual([])
  })
})

describe('plistFromForm', () => {
  const baseForm = (): AgentForm => ({
    label: 'com.test.x',
    desc: 'x',
    processType: '',
    program: '/bin/sh',
    args: ['-c', 'echo hi'],
    workingDir: '/tmp',
    userName: '',
    nice: 5,
    throttleInterval: 10,
    env: { A: '1' },
    triggers: { runAtLoad: true, keepAlive: false, watchPaths: false, startCalendarInterval: false, startInterval: null },
    keepAliveMode: 'bool',
    keepAliveDict: { crashed: null, successfulExit: null },
    watchPaths: [],
    sciEntries: [],
    stdout: '',
    stderr: ''
  })

  it('表单 → dict(空值不落键)+ 与 formFromPlist 值级往返', () => {
    const form = baseForm()
    const dict = plistFromForm(form)
    expect(dict).toEqual({
      Label: 'com.test.x',
      ProgramArguments: ['/bin/sh', '-c', 'echo hi'],
      RunAtLoad: true,
      WorkingDirectory: '/tmp',
      EnvironmentVariables: { A: '1' },
      Nice: 5,
      ThrottleInterval: 10
    })
    expect(dict.KeepAlive).toBeUndefined()

    const back = formFromPlist(dict, 'x')
    expect(back.unsupportedKeys).toEqual([])
    expect(back.form).toEqual(form)
  })

  it('KeepAlive 三态:true/false 都落键,全 null 不落键', () => {
    const f1 = baseForm()
    f1.triggers.keepAlive = true
    f1.keepAliveMode = 'dict'
    f1.keepAliveDict = { crashed: true, successfulExit: null }
    expect(plistFromForm(f1).KeepAlive).toEqual({ Crashed: true })

    const f2 = baseForm()
    f2.triggers.keepAlive = true
    f2.keepAliveMode = 'dict'
    f2.keepAliveDict = { crashed: null, successfulExit: false }
    expect(plistFromForm(f2).KeepAlive).toEqual({ SuccessfulExit: false })

    const f3 = baseForm()
    f3.triggers.keepAlive = true
    f3.keepAliveMode = 'dict'
    f3.keepAliveDict = { crashed: null, successfulExit: null }
    expect(plistFromForm(f3).KeepAlive).toBeUndefined()
  })

  it('触发卡关掉 → dict 有值也不写(dict 模式不再忽略开关)', () => {
    const form = baseForm()
    form.triggers.keepAlive = false
    form.keepAliveMode = 'dict'
    form.keepAliveDict = { crashed: true, successfulExit: true }
    expect(plistFromForm(form).KeepAlive).toBeUndefined()
  })

  it('ThrottleInterval:0 落键、null 不落;Nice:0 不落(0 即默认)', () => {
    const zero = baseForm()
    zero.throttleInterval = 0
    zero.nice = 0
    const d1 = plistFromForm(zero)
    expect(d1.ThrottleInterval).toBe(0)
    expect(d1.Nice).toBeUndefined()

    const unset = baseForm()
    unset.throttleInterval = null
    expect(plistFromForm(unset).ThrottleInterval).toBeUndefined()
  })

  it('非托管键与往返白名单都从 base 原样搬回(逐值保真);无 base 时不产生', () => {
    const form = baseForm()
    const withBase = plistFromForm(form, {
      Label: 'com.test.x',
      Disabled: true,
      EnableTransactions: false,
      Sockets: { Listeners: { SockServiceName: '12345' } },
      MachServices: { 'com.test.x': true },
      LimitLoadToSessionType: 'Aqua',
      Program: '/stale/path'
    })
    expect(withBase.Disabled).toBe(true)
    expect(withBase.EnableTransactions).toBe(false)
    expect(withBase.Sockets).toEqual({ Listeners: { SockServiceName: '12345' } })
    expect(withBase.MachServices).toEqual({ 'com.test.x': true })
    expect(withBase.LimitLoadToSessionType).toBe('Aqua')
    // Program 属托管键(已由 ProgramArguments 规范化)→ 不会被旧值搬回,否则 launchd 会跑旧程序
    expect(withBase.Program).toBeUndefined()

    const noBase = plistFromForm(form)
    expect(noBase.Disabled).toBeUndefined()
    expect(noBase.EnableTransactions).toBeUndefined()
  })

  it('只改描述时保留未触碰的显式 false/0 与 Program 原始形态', () => {
    const base = {
      Label: 'com.test.x',
      Program: '/bin/echo',
      RunAtLoad: false,
      Nice: 0,
      KeepAlive: false
    }
    const form = formFromPlist(base, '').form
    const next = plistFromForm(form, base, ['desc'])
    expect(next).toEqual(base)
  })

  it('UserName 非空即写,带值往返', () => {
    const form = baseForm()
    form.userName = '_www'
    const dict = plistFromForm(form)
    expect(dict.UserName).toBe('_www')
    const back = formFromPlist(dict, 'x').form
    expect(back.userName).toBe('_www')
  })

  // StandardInPath 无 UI:表单保存既不能丢它,也不能凭空造/改动它(值原样取自磁盘快照)
  it('StandardInPath:表单保存原样保留(含未被任何 dirtyField 触碰时)', () => {
    const base = { Label: 'a', ProgramArguments: ['/bin/echo'], StandardInPath: '/tmp/in.txt' }
    const form = formFromPlist(base, '').form
    expect(plistFromForm(form, base, ['desc'])).toEqual(base)
    expect(plistFromForm(form, base)).toEqual(base)
    // 磁盘上没有该键 → 保存也不会新增
    const plain = { Label: 'a', ProgramArguments: ['/bin/echo'] }
    expect(plistFromForm(formFromPlist(plain, '').form, plain)).toEqual(plain)
  })

  it('dict KeepAlive 与单条 SCI', () => {
    const form = formFromPlist({ Label: 'a', KeepAlive: { Crashed: true } }, '').form
    form.sciEntries = [{ Hour: 3 }]
    form.triggers.startCalendarInterval = true
    const dict = plistFromForm(form)
    expect(dict.KeepAlive).toEqual({ Crashed: true })
    expect(dict.StartCalendarInterval).toEqual({ Hour: 3 }) // 单条 → dict 而非数组
  })

  it('WatchPaths 支持多个路径,且固定间隔与日历调度可同时保留', () => {
    const form = formFromPlist(
      {
        Label: 'a',
        WatchPaths: ['/tmp/inbox', '/tmp/outbox'],
        StartInterval: 300,
        StartCalendarInterval: { Hour: 9, Minute: 0 }
      },
      ''
    ).form
    expect(form.watchPaths).toEqual(['/tmp/inbox', '/tmp/outbox'])
    expect(form.triggers).toMatchObject({ watchPaths: true, startInterval: 300, startCalendarInterval: true })

    const dict = plistFromForm(form)
    expect(dict.WatchPaths).toEqual(['/tmp/inbox', '/tmp/outbox'])
    expect(dict.StartInterval).toBe(300)
    expect(dict.StartCalendarInterval).toEqual({ Hour: 9, Minute: 0 })
  })

  it('ProcessType 缺省不写入,合法资源策略可往返', () => {
    const defaultForm = formFromPlist({ Label: 'a' }, '').form
    expect(plistFromForm(defaultForm).ProcessType).toBeUndefined()

    const form = formFromPlist({ Label: 'a', ProcessType: 'Background' }, '').form
    expect(form.processType).toBe('Background')
    expect(plistFromForm(form).ProcessType).toBe('Background')
  })
})

describe('scanCompatibility(P1-2 全键 schema / P1-3 保真边界)', () => {
  it('各托管键类型异常 → 进 unsupportedPaths(锁表单)', () => {
    const r = scanCompatibility({
      Label: 'a',
      RunAtLoad: 'yes',
      WorkingDirectory: 1,
      Nice: 99,
      ThrottleInterval: -1,
      StartInterval: 0,
      WatchPaths: 'not-array',
      EnvironmentVariables: 'not-dict',
      Disabled: 'true'
    })
    expect(r.unsupportedPaths).toEqual([
      'Disabled',
      'EnvironmentVariables',
      'Nice',
      'RunAtLoad',
      'StartInterval',
      'ThrottleInterval',
      'WatchPaths',
      'WorkingDirectory'
    ])
  })

  it('ProgramArguments 数组含非字符串元素 / 非数组 → 锁定;Program 与 ProgramArguments 同存 → 锁定', () => {
    expect(scanCompatibility({ Label: 'a', ProgramArguments: ['/bin/echo', 42] }).unsupportedPaths).toEqual(['ProgramArguments'])
    expect(scanCompatibility({ Label: 'a', ProgramArguments: 123 }).unsupportedPaths).toEqual(['ProgramArguments'])
    const both = scanCompatibility({ Label: 'a', Program: '/bin/echo', ProgramArguments: ['/bin/echo', 'x'] })
    expect(both.unsupportedPaths).toContain('ProgramArguments(与 Program 同存)')
    expect(both.sourceShape).toEqual({ program: 'both' })
  })

  it('SCI 越界/非法字段 → 锁定;合法范围(含 Weekday 7)不报', () => {
    expect(scanCompatibility({ Label: 'a', StartCalendarInterval: { Minute: 60 } }).unsupportedPaths).toEqual([
      'StartCalendarInterval.Minute'
    ])
    expect(scanCompatibility({ Label: 'a', StartCalendarInterval: { Weekday: 9 } }).unsupportedPaths).toEqual([
      'StartCalendarInterval.Weekday'
    ])
    expect(scanCompatibility({ Label: 'a', StartCalendarInterval: { Weekday: 7, Hour: 23 } }).unsupportedPaths).toEqual([])
  })

  it('KeepAlive 条件值非 boolean → 锁定;多触发并存只给 warning 不锁(P1-4)', () => {
    expect(scanCompatibility({ Label: 'a', KeepAlive: { Crashed: 'yes' } }).unsupportedPaths).toEqual(['KeepAlive.Crashed'])
    const combo = scanCompatibility({ Label: 'a', KeepAlive: true, StartInterval: 60 })
    expect(combo.unsupportedPaths).toEqual([])
    expect(combo.warnings.join()).toMatch(/不会创建额外实例/)
  })

  it('空 SCI 规则 → warning(每分钟);顶层非托管键 → XML-only 不兼容项', () => {
    const r = scanCompatibility({ Label: 'a', StartCalendarInterval: {}, MachServices: { x: true } })
    expect(r.warnings.join()).toMatch(/每分钟/)
    expect(r.preservedTopLevelKeys).toEqual([])
    expect(r.unsupportedPaths).toEqual(['MachServices'])
  })

  it('嵌套 B 类路径显示真实类型与摘要', () => {
    const r = scanCompatibility({ Label: 'a', KeepAlive: { PathState: { '/tmp/a': true } } })
    const entry = r.entries.find((e) => e.path === 'KeepAlive.PathState')
    expect(entry).toMatchObject({ type: 'dict', summary: '{"/tmp/a":true}', preservation: 'unsupported' })
  })


  it('节点级补丁生效后:注释 / <data> / <date> / <real> 不再锁文件(补丁逐字节保留)', () => {
    const withInner = '<plist version="1.0"><dict><!-- 内部注释 --><key>Label</key><string>a</string></dict></plist>'
    expect(scanCompatibility({ Label: 'a' }, withInner).unsupportedPaths).toEqual([])
    const descOnly = '<plist version="1.0"><!-- 描述 --><dict><key>Label</key><string>a</string></dict></plist>'
    expect(scanCompatibility({ Label: 'a' }, descOnly).unsupportedPaths).toEqual([])
    expect(scanCompatibility({ Label: 'a' }, '<plist><dict><key>X</key><data>AQ==</data></dict></plist>').unsupportedPaths).toEqual([])
    expect(scanCompatibility({ Label: 'a' }, '<plist><dict><key>X</key><real>1.0</real></dict></plist>').unsupportedPaths).toEqual([])
  })

  it('结构无法安全增量改写(顶层 CDATA) → 锁文件并给原因', () => {
    const weird = '<plist version="1.0"><dict><![CDATA[junk]]><key>Label</key><string>a</string></dict></plist>'
    const r = scanCompatibility({ Label: 'a' }, weird)
    expect(r.unsupportedPaths.join()).toMatch(/无法安全增量改写/)
  })
})

describe('validateNewAgentInput(新建/改名约束优先)', () => {
  const form = (over: Partial<Parameters<typeof validateNewAgentInput>[0]> = {}) =>
    ({
      label: 'com.ok',
      desc: '',
      processType: '',
      program: '/bin/echo',
      args: [],
      workingDir: '',
      userName: '',
      nice: 0,
      throttleInterval: null,
      env: {},
      triggers: { runAtLoad: false, keepAlive: false, watchPaths: false, startCalendarInterval: false, startInterval: null },
      keepAliveMode: 'bool',
      keepAliveDict: { crashed: null, successfulExit: null },
      watchPaths: [],
      sciEntries: [],
      stdout: '',
      stderr: '',
      ...over
    }) as Parameters<typeof validateNewAgentInput>[0]

  it('无 Program/args → 拒绝;路径必须绝对;Nice/Throttle 范围校验', () => {
    expect(validateNewAgentInput(form({ program: '' })).join()).toMatch(/必须提供 Program/)
    expect(validateNewAgentInput(form({ workingDir: 'rel/path' })).join()).toMatch(/绝对路径/)
    expect(validateNewAgentInput(form({ nice: 21 })).join()).toMatch(/Nice/)
    expect(validateNewAgentInput(form({ throttleInterval: -1 })).join()).toMatch(/ThrottleInterval/)
    expect(validateNewAgentInput(form())).toEqual([])
  })

  it('SCI 越界 → 拒绝;空规则不在这一层判(由新建确认弹窗把关)', () => {
    expect(
      validateNewAgentInput(
        form({
          triggers: { runAtLoad: false, keepAlive: false, watchPaths: false, startCalendarInterval: true, startInterval: null },
          sciEntries: [{ Minute: 99 }]
        })
      ).join()
    ).toMatch(/Minute 超出范围/)
    expect(
      validateNewAgentInput(
        form({
          triggers: { runAtLoad: false, keepAlive: false, watchPaths: false, startCalendarInterval: true, startInterval: null },
          sciEntries: [{}]
        })
      )
    ).toEqual([])
  })
})


describe('review regressions', () => {
  it('Program 与空 ProgramArguments 同存也必须锁表单，不能按 Program 形态重写', () => {
    const compatibility = scanCompatibility({ Label: 'a', Program: '/bin/echo', ProgramArguments: [] })
    expect(compatibility.sourceShape).toEqual({ program: 'both' })
    expect(compatibility.unsupportedPaths).toContain('ProgramArguments(与 Program 同存)')
  })

  it('StartInterval presence:缺键 = 未设置(null),显式 0/负数 = 非法值(既有锁表单/新建拒绝)', () => {
    expect(formFromPlist({ Label: 'a' }, '').form.triggers.startInterval).toBeNull()
    expect(formFromPlist({ Label: 'a', StartInterval: 300 }, '').form.triggers.startInterval).toBe(300)
    // 既有文件里的显式 0 与负数都进锁定清单(不是「未设置」)
    expect(scanCompatibility({ Label: 'a', StartInterval: 0 }).unsupportedPaths).toEqual(['StartInterval'])
    expect(scanCompatibility({ Label: 'a', StartInterval: -5 }).unsupportedPaths).toEqual(['StartInterval'])
    // 未设置 → 保存不写该键;300 → 原值写回
    expect(plistFromForm(formFromPlist({ Label: 'a' }, '').form).StartInterval).toBeUndefined()
    expect(plistFromForm(formFromPlist({ Label: 'a', StartInterval: 300 }, '').form).StartInterval).toBe(300)
  })

  it('StartInterval 的负数不是“未设置”，必须被新建/编辑校验拒绝', () => {
    const form = formFromPlist({ Label: 'a', ProgramArguments: ['/bin/echo'] }, '').form
    form.triggers.startInterval = -1
    expect(validateNewAgentInput(form)).toContain('StartInterval 必须是正整数秒（留空 = 未设置）')
  })
})
