// launchctl 执行层(阶段 1;机制对齐开源 LaunchctlService)
// - 域映射(开源同款):user/system agent → `gui/<uid>`;daemon → `system`
// - bootstrap/bootout 走「域 + plist 路径」;kickstart/enable/disable 走 `域/label`
// - 停止:kill SIGTERM → 20×150ms 轮询 pid → 仍存活则 SIGKILL → 10×150ms(开源同款兜底)
// - 提权:daemon(system 域)必须提权;其余先在用户域试跑,系统拒绝才升级(见 domainPrivileged)

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

/** 系统明确拒绝(权限不足)的特征:据此决定是否升级为提权重试 */
const PERMISSION_RE = /Operation not permitted|not privileged|permission denied|EPERM/i
/** 任务本就不在/未运行 → 视为成功(开源 try? 语义) */
const NOT_LOADED_RE = /No such process|not find|not loaded|No such file|not running/i

export function createLaunchctlService(deps: {
  runner: ShellRunner
  elevate: ElevationExecutor
  uid: number
}): LaunchctlService {
  // 域映射(开源同款):user 与 system(/Library/LaunchAgents 全用户 agent)都在用户 gui 域;
  // 仅 daemon(/Library/LaunchDaemons)属 system 域
  const domainOf = (scope: AgentScope): string => (scope === 'daemon' ? 'system' : `gui/${deps.uid}`)
  // 提权判定(2026-09-17 本机实测):daemon 走 system 域,**必须**提权;user 与 system 都落在
  // 用户自己的 gui/<uid> 域 —— 实测 enable / kickstart / bootout 无提权即通过(对照实验:同样的
  // 命令打到 system 域返回 "Operation not permitted")。唯一无法用静态判据确定的是 bootstrap:
  // 它对非 root 调用者一律返回不透明的 errno 5(不区分「权限不足」与「不是合法 plist」,system 域
  // 也是同样的 5)。故不逐动词猜,统一「先在用户域试跑 → 被拒绝再提权」,由系统裁决。
  const domainPrivileged = (scope: AgentScope): boolean => scope === 'daemon'

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

  /**
   * 域动词统一执行入口:daemon 直接提权;其余先在用户 gui 域试跑,**仅当系统明确拒绝**(权限不足)
   * 才升级为提权重试 —— 业务错误(未载入/找不到)不重试,避免把真实失败包装成一次授权弹窗。
   * @param tolerate 命中该模式的错误视为成功(如 bootout 一个本就未载入的任务)
   */
  async function runElevatedOrLocal(argv: string[], scope: AgentScope, tolerate?: RegExp): Promise<void> {
    const [cmd, ...args] = argv
    if (!domainPrivileged(scope)) {
      const r = await deps.runner.run(cmd, args)
      if (r.code === 0 || tolerate?.test(r.stderr ?? '')) return
      if (!PERMISSION_RE.test(r.stderr ?? '')) {
        throw new Error(`${cmd} failed: ${r.stderr || r.stdout || r.code}`)
      }
      // 权限不足 → 落到下面提权重试
    }
    const r = await deps.elevate.run({ steps: [{ command: cmd, args }] })
    if (r.ok || tolerate?.test(r.stderr ?? '')) return
    throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
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
      await runElevatedOrLocal(['launchctl', 'bootstrap', domainOf(scope), plistPath], scope)
    },

    async bootout(plistPath, scope) {
      // 已卸载的 bootout 返回非 0;容忍(开源 try? 语义)
      await runElevatedOrLocal(['launchctl', 'bootout', domainOf(scope), plistPath], scope, NOT_LOADED_RE)
    },

    async kickstart(label, scope, opts) {
      // -k:先杀掉正在运行的实例再重启(「重启」意图);目标须在 flag 之后(`kickstart [-kp] service-target`)
      const args = ['launchctl', 'kickstart', ...(opts?.kill ? ['-k'] : []), `${domainOf(scope)}/${label}`]
      await runElevatedOrLocal(args, scope)
    },

    async enable(label, scope) {
      await runElevatedOrLocal(['launchctl', 'enable', `${domainOf(scope)}/${label}`], scope)
    },

    async disable(label, scope) {
      await runElevatedOrLocal(['launchctl', 'disable', `${domainOf(scope)}/${label}`], scope)
    },

    async stop(label, scope, pid) {
      if (pid === null || !alive(pid)) return 'alreadyStopped'
      // kill 失败(进程已不在)视为成功;是否真停掉由下面的 waitGone(pid) 裁决。
      // 但授权类错误必须如实上报,否则用户看到的是「停止超时」而非「授权失败/已取消」。
      const killOnce = async (sig: string): Promise<void> => {
        try {
          await runElevatedOrLocal(['launchctl', 'kill', sig, `${domainOf(scope)}/${label}`], scope, NOT_LOADED_RE)
        } catch (err) {
          const msg = err instanceof Error ? err.message : ''
          if (msg.includes(ELEVATION_CANCELLED) || msg.includes(ELEVATION_FAILED)) throw err
        }
      }
      await killOnce('SIGTERM')
      if (await waitGone(pid, TERM_TRIES)) return 'ok'
      // 兜底 SIGKILL
      await killOnce('SIGKILL')
      return (await waitGone(pid, KILL_TRIES)) ? 'ok' : 'timeout'
    }
  }
}
