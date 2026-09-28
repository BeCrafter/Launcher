import { describe, expect, it } from 'vitest'
import { parseDomainServices, parseLaunchctlList, parseLaunchctlPrint, parsePrintDisabled } from './launchctl-parse'

const LIST = ['PID\tStatus\tLabel', '-   \t0\tio.tailscale.ipn.macsys.login-item-helper', '97961\t-9\tcom.apple.cloudphotod', '-\t-\tcom.foo.bar', ''].join('\n')

describe('parseLaunchctlList', () => {
  it('三列解析:跳过表头,"-" 转 null,退出码可负', () => {
    const m = parseLaunchctlList(LIST)
    expect(m.size).toBe(3)
    expect(m.get('io.tailscale.ipn.macsys.login-item-helper')).toEqual({ label: 'io.tailscale.ipn.macsys.login-item-helper', pid: null, lastExitCode: 0 })
    expect(m.get('com.apple.cloudphotod')).toMatchObject({ pid: 97961, lastExitCode: -9 })
    expect(m.get('com.foo.bar')).toMatchObject({ pid: null, lastExitCode: null })
  })
})

describe('parseDomainServices(system 域服务表)', () => {
  const sample = [
    '\tservices = {',
    '\t\t     324      - \tcom.brocadesoft.BSPrintMonitor',
    '\t\t       0   (pe) \tcom.apple.noticeboard.state',
    '\t\t       0     78 \tcom.apple.appleh13camerad',
    '\t\t   66884      - \tcom.apple.diskimagesiod.09000001-0000-0000-9BD3-5B0100000000',
    '\t\tactive count = 1',      // 非表格行不误收
    '\t\tstate = running',
    '\t}'
  ].join('\n')
  it('pid/状态码/label 解析;(pe) 等标记 → 退出码 null;非表格行忽略', () => {
    const m = parseDomainServices(sample)
    expect(m.size).toBe(4)
    expect(m.get('com.brocadesoft.BSPrintMonitor')).toMatchObject({ pid: 324, lastExitCode: null })
    expect(m.get('com.apple.noticeboard.state')).toMatchObject({ pid: null, lastExitCode: null })
    expect(m.get('com.apple.appleh13camerad')).toMatchObject({ pid: null, lastExitCode: 78 })
    expect(m.get('com.apple.diskimagesiod.09000001-0000-0000-9BD3-5B0100000000')?.pid).toBe(66884)
  })
  it('真实机输出回放:能解析出 BSPrintMonitor 且带 pid', () => {
    // 取真实 launchctl print system 片段(实测该服务 pid 非 0)
    const real = '\t\t     324      - \tcom.brocadesoft.BSPrintMonitor\n\t\t     143      - \tcom.apple.usbmuxd\n'
    const m = parseDomainServices(real)
    expect(m.get('com.brocadesoft.BSPrintMonitor')?.pid).toBe(324)
  })
})

describe('parsePrintDisabled', () => {
  it('仅收集 disabled(=> enabled 行忽略)', () => {
    const out = [
      '',
      '\tdisabled services = {',
      '\t\t"com.docker.helper" => enabled',
      '\t\t"com.apple.ManagedClientAgent.enrollagent" => disabled',
      '\t\t"com.x.y" => disabled',
      '\t}'
    ].join('\n')
    const d = parsePrintDisabled(out)
    expect([...d].sort()).toEqual(['com.apple.ManagedClientAgent.enrollagent', 'com.x.y'])
  })
})

describe('parseLaunchctlPrint', () => {
  const sample = `gui/501/com.example.demo = {
\tactive count = 1
\tpath = /Users/tester/Library/LaunchAgents/com.example.demo.plist
\ttype = LaunchAgent
\tstate = running

\tprogram = /Users/tester/.venv/bin/python
\targuments = {
\t\t/Users/tester/.venv/bin/python
\t\t-m
\t\tapp.main
\t}

\tworking directory = /Users/tester
\tstdout path = /Users/tester/logs/app.log
\tstderr path = /Users/tester/logs/app.error.log
\tenvironment = {
\t\tVIRTUAL_ENV => /Users/tester/.venv
\t\tAPP_HOME => /Users/tester
\t}

\truns = 3
\tpid = 4242
\tlast exit code = (never exited)
}`

  it('字段行 + arguments/environment 块解析', () => {
    const info = parseLaunchctlPrint(sample)
    expect(info.found).toBe(true)
    expect(info.state).toBe('running')
    expect(info.path).toBe('/Users/tester/Library/LaunchAgents/com.example.demo.plist')
    expect(info.program).toContain('venv/bin/python')
    expect(info.arguments).toEqual(['/Users/tester/.venv/bin/python', '-m', 'app.main'])
    expect(info.workingDirectory).toBe('/Users/tester')
    expect(info.stdoutPath).toBe('/Users/tester/logs/app.log')
    expect(info.environment['APP_HOME']).toBe('/Users/tester')
    expect(info.runs).toBe(3)
    expect(info.pid).toBe(4242)
    expect(info.lastExitCode).toBeNull() // (never exited)
  })

  it('last exit code 数值 / 服务不存在', () => {
    expect(parseLaunchctlPrint('gui/501/x = {\n\tstate = spawn scheduled\n\tlast exit code = 78\n}').lastExitCode).toBe(78)
    expect(parseLaunchctlPrint('Could not find service "x" in domain for user gui: 501').found).toBe(false)
  })
})
