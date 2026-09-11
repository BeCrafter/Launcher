import { describe, expect, it } from 'vitest'
import type { AgentForm } from '../../shared/models'
import { formFromPlist, plistFromForm } from './agent-form'

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
    expect(r.xmlFallback).toBe(false)
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

  it('KeepAlive dict → mode=dict;StartCalendarInterval 数组 → SCI 条目', () => {
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
    expect(r.form.keepAliveDict).toMatchObject({ crashed: true, successfulExit: false, afterInitialDemand: false })
    expect(r.form.sciEntries).toEqual([{ Hour: 9, Minute: 0 }, { Weekday: 1, Hour: 8 }])
    expect(r.form.triggers.startCalendarInterval).toBe(true)
    expect(r.form.triggers.startInterval).toBe(300)
  })

  it('不支持键 → xmlFallback=true(开源守卫)', () => {
    const r = formFromPlist({ Label: 'a', SessionCreate: true, LimitLoadToSessionType: 'Aqua' }, '')
    expect(r.xmlFallback).toBe(true)
    expect(r.unsupportedKeys.sort()).toEqual(['LimitLoadToSessionType', 'SessionCreate'])
  })
})

describe('plistFromForm', () => {
  it('表单 → dict(空值不落键)+ 与 formFromPlist 值级往返', () => {
    const form: AgentForm = {
      label: 'com.test.x',
      desc: 'x',
      processType: '',
      program: '/bin/sh',
      args: ['-c', 'echo hi'],
      workingDir: '/tmp',
      nice: 5,
      throttleInterval: 10,
      env: { A: '1' },
      triggers: { runAtLoad: true, keepAlive: false, watchPaths: false, startCalendarInterval: false, startInterval: 0 },
      keepAliveMode: 'bool',
      keepAliveDict: { crashed: false, afterInitialDemand: false, successfulExit: false },
      watchPaths: [],
      sciEntries: [],
      stdout: '',
      stderr: ''
    }
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
    expect(back.xmlFallback).toBe(false)
    expect(back.form).toEqual(form)
  })

  it('dict KeepAlive 与单条 SCI', () => {
    const form = formFromPlist({ Label: 'a', KeepAlive: { Crashed: true } }, '').form
    form.sciEntries = [{ Hour: 3 }]
    form.triggers.startCalendarInterval = true
    const dict = plistFromForm(form)
    expect(dict.KeepAlive).toEqual({ Crashed: true })
    expect(dict.StartCalendarInterval).toEqual({ Hour: 3 }) // 单条 → dict 而非数组
  })
})
