import { describe, expect, it } from 'vitest'
import { parseLaunchctlList, parseLaunchctlPrint, parsePrintDisabled } from './launchctl-parse'

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
  const hermes = `gui/501/ai.hermes.gateway = {
\tactive count = 1
\tpath = /Users/tester/Library/LaunchAgents/ai.hermes.gateway.plist
\ttype = LaunchAgent
\tstate = running

\tprogram = /Users/tester/.hermes/hermes-agent/venv/bin/python
\targuments = {
\t\t/Users/tester/.hermes/hermes-agent/venv/bin/python
\t\t-m
\t\thermes_cli.main
\t}

\tworking directory = /Users/tester/.hermes
\tstdout path = /Users/tester/.hermes/logs/gateway.log
\tstderr path = /Users/tester/.hermes/logs/gateway.error.log
\tenvironment = {
\t\tVIRTUAL_ENV => /Users/tester/.hermes/hermes-agent/venv
\t\tHERMES_HOME => /Users/tester/.hermes
\t}

\truns = 3
\tpid = 4242
\tlast exit code = (never exited)
}`

  it('字段行 + arguments/environment 块解析', () => {
    const info = parseLaunchctlPrint(hermes)
    expect(info.found).toBe(true)
    expect(info.state).toBe('running')
    expect(info.path).toBe('/Users/tester/Library/LaunchAgents/ai.hermes.gateway.plist')
    expect(info.program).toContain('venv/bin/python')
    expect(info.arguments).toEqual(['/Users/tester/.hermes/hermes-agent/venv/bin/python', '-m', 'hermes_cli.main'])
    expect(info.workingDirectory).toBe('/Users/tester/.hermes')
    expect(info.stdoutPath).toBe('/Users/tester/.hermes/logs/gateway.log')
    expect(info.environment['HERMES_HOME']).toBe('/Users/tester/.hermes')
    expect(info.runs).toBe(3)
    expect(info.pid).toBe(4242)
    expect(info.lastExitCode).toBeNull() // (never exited)
  })

  it('last exit code 数值 / 服务不存在', () => {
    expect(parseLaunchctlPrint('gui/501/x = {\n\tstate = spawn scheduled\n\tlast exit code = 78\n}').lastExitCode).toBe(78)
    expect(parseLaunchctlPrint('Could not find service "x" in domain for user gui: 501').found).toBe(false)
  })
})
