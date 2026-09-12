// launchctl 执行层(阶段 1;机制对齐开源 LaunchctlService)
// - 域映射(开源同款):user/system agent → `gui/<uid>`;daemon → `system`
// - bootstrap/bootout 走「域 + plist 路径」;kickstart/enable/disable 走 `域/label`
// - 停止:kill SIGTERM → 20×150ms 轮询 pid → 仍存活则 SIGKILL → 10×150ms(开源同款兜底)
// - system 域操作经 osascript 提权(elevation;密码不进应用,(-128)=取消)

import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { AgentScope } from '../../shared/models'
import {
  parseDomainServices,
  parseLaunchctlList,
  parseLaunchctlPrint,
  parsePrintDisabled,
  type LaunchctlEntry,
  type LaunchctlPrintInfo
} from '../domains/launchctl-parse'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

export interface LaunchctlService {
  domainOf(scope: AgentScope): string
  /**
   * gui = 用户态 `launchctl list`(不含 system 域);system = `launchctl print system` 服务表;按作用域取用
   * disabled 按域分列(print-disabled 输出是 per-domain 的):同名 label 在两域可有不同覆盖位,
   * 不得合并(合并会让 system 域的停用误染用户级同名 agent)
   */
  list(): Promise<{
    gui: Map<string, LaunchctlEntry>
    system: Map<string, LaunchctlEntry>
    disabled: { gui: Set<string>; system: Set<string> }
  }>
  print(label: string, scope: AgentScope): Promise<LaunchctlPrintInfo>
  bootstrap(plistPath: string, scope: AgentScope): Promise<void>
  bootout(plistPath: string, scope: AgentScope): Promise<void>
  kickstart(label: string, scope: AgentScope, opts?: { kill?: boolean }): Promise<void>
  enable(label: string, scope: AgentScope): Promise<void>
  disable(label: string, scope: AgentScope): Promise<void>
  /** 停止(SIGTERM → 轮询 → SIGKILL);进程已不在 → alreadyStopped */
  stop(label: string, scope: AgentScope, pid: number | null): Promise<'ok' | 'alreadyStopped' | 'timeout'>
}

const POLL_MS = 150
const TERM_TRIES = 20
const KILL_TRIES = 10

export function createLaunchctlService(deps: {
  runner: ShellRunner
  elevate: ElevationExecutor
  uid: number
}): LaunchctlService {
  // 域映射(开源同款):user 与 system(/Library/LaunchAgents 全用户 agent)都在用户 gui 域;
  // 仅 daemon(/Library/LaunchDaemons)属 system 域
  const domainOf = (scope: AgentScope): string => (scope === 'daemon' ? 'system' : `gui/${deps.uid}`)
  const privileged = (scope: AgentScope): boolean => scope !== 'user'

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
  }

  async function waitGone(pid: number, tries: number): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
      if (!alive(pid)) return true
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    return !alive(pid)
  }

  /** 普通/提权执行统一入口:提权失败按错误码抛出,普通命令非 0 抛错并带 stderr */
  async function runElevatedOrLocal(sh: string, scope: AgentScope): Promise<void> {
    if (privileged(scope)) {
      const r = await deps.elevate.run(sh)
      if (!r.ok) {
        throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
      return
    }
    const [cmd, ...args] = sh.split(' ')
    const r = await deps.runner.run(cmd, args)
    if (r.code !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout || r.code}`)
  }

  return {
    domainOf,

    async list() {
      const [all, sysDomain, guiDisabled, sysDisabled] = await Promise.all([
        deps.runner.run('launchctl', ['list']),
        deps.runner.run('launchctl', ['print', 'system']),
        deps.runner.run('launchctl', ['print-disabled', `gui/${deps.uid}`]),
        deps.runner.run('launchctl', ['print-disabled', 'system'])
      ])
      const gui = parseLaunchctlList(all.stdout)
      const system = parseDomainServices(sysDomain.stdout)
      const disabled = {
        gui: parsePrintDisabled(guiDisabled.stdout),
        system: parsePrintDisabled(sysDisabled.stdout)
      }
      return { gui, system, disabled }
    },

    async print(label, scope) {
      const r = await deps.runner.run('launchctl', ['print', `${domainOf(scope)}/${label}`])
      return parseLaunchctlPrint(r.stdout || r.stderr)
    },

    async bootstrap(plistPath, scope) {
      await runElevatedOrLocal(`launchctl bootstrap ${domainOf(scope)} ${plistPath}`, scope)
    },

    async bootout(plistPath, scope) {
      // 已卸载的 bootout 返回非 0;容忍(开源 try? 语义)
      if (privileged(scope)) {
        const r = await deps.elevate.run(`launchctl bootout ${domainOf(scope)} ${plistPath}`)
        if (!r.ok && !r.cancelled && /No such process|not find|not loaded|No such file/.test(r.stderr ?? '')) return
        if (!r.ok) {
          throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
        }
        return
      }
      const r = await deps.runner.run('launchctl', ['bootout', domainOf(scope), plistPath])
      if (r.code !== 0 && !/No such process|not find|not loaded|No such file/.test(r.stderr ?? '')) {
        throw new Error(`launchctl bootout failed: ${r.stderr || r.code}`)
      }
    },

    async kickstart(label, scope, opts) {
      // -k:先杀掉正在运行的实例再重启(「重启」意图);目标须在 flag 之后(`kickstart [-kp] service-target`)
      const flag = opts?.kill ? '-k ' : ''
      await runElevatedOrLocal(`launchctl kickstart ${flag}${domainOf(scope)}/${label}`, scope)
    },

    async enable(label, scope) {
      await runElevatedOrLocal(`launchctl enable ${domainOf(scope)}/${label}`, scope)
    },

    async disable(label, scope) {
      await runElevatedOrLocal(`launchctl disable ${domainOf(scope)}/${label}`, scope)
    },

    async stop(label, scope, pid) {
      if (pid === null || !alive(pid)) return 'alreadyStopped'
      if (privileged(scope)) {
        const r = await deps.elevate.run(`launchctl kill SIGTERM ${domainOf(scope)}/${label}`)
        if (!r.ok && r.cancelled) throw new Error(ELEVATION_CANCELLED)
        if (!r.ok && !/No such process|not running/.test(r.stderr ?? '')) {
          throw new Error(`${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
        }
      } else {
        // 开源语义:kill 失败(进程不在)视为成功
        await deps.runner.run('launchctl', ['kill', 'SIGTERM', `${domainOf(scope)}/${label}`])
      }
      if (await waitGone(pid, TERM_TRIES)) return 'ok'
      // 兜底 SIGKILL
      if (privileged(scope)) {
        await deps.elevate.run(`launchctl kill SIGKILL ${domainOf(scope)}/${label}`)
      } else {
        await deps.runner.run('launchctl', ['kill', 'SIGKILL', `${domainOf(scope)}/${label}`])
      }
      return (await waitGone(pid, KILL_TRIES)) ? 'ok' : 'timeout'
    }
  }
}
