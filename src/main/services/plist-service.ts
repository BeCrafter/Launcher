// plist 执行层(阶段 1;机制对齐开源 PlistService)
// - 三个作用域目录:user=~/Library/LaunchAgents;system=/Library/LaunchAgents;daemon=/Library/LaunchDaemons
// - 读取:二进制 plist 经 plutil 转 XML;解析失败 → invalid(带原因)
// - 写入:用户级 原子写(tmp+rename);提权级 临时文件 → 提权 mv && chown root:wheel && chmod 644
// - 校验:plutil -lint(stdin),与系统口径一致

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { AgentScope, InvalidPlist } from '../../shared/models'
import { extractPlistDesc, parsePlistXml, type PlistDict } from '../domains/plist-xml'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

export interface PlistFile {
  path: string
  scope: AgentScope
  fileName: string
  xml: string
  value: PlistDict
  label: string
  desc: string
}

export interface PlistService {
  dirs(): { scope: AgentScope; dir: string; privileged: boolean }[]
  scanAll(): Promise<{ valid: PlistFile[]; invalid: InvalidPlist[] }>
  read(scope: AgentScope, path: string): Promise<PlistFile>
  write(scope: AgentScope, path: string, xml: string): Promise<void>
  remove(scope: AgentScope, path: string): Promise<void>
  lint(xml: string): Promise<{ ok: boolean; error: string | null }>
  pathFor(scope: AgentScope, label: string): string
  /** 提权作用域删除:bootout + rm 合并为一条授权命令(开源同款,避免二次授权) */
  removeWithBootout(scope: AgentScope, path: string, loaded: boolean, domain: string): Promise<void>
}

const BPLIST_MAGIC = 'bplist'

export function createPlistService(deps: {
  runner: ShellRunner
  elevate: ElevationExecutor
  home: string
}): PlistService {
  const dirs = (): { scope: AgentScope; dir: string; privileged: boolean }[] => [
    { scope: 'user', dir: join(deps.home, 'Library/LaunchAgents'), privileged: false },
    { scope: 'system', dir: '/Library/LaunchAgents', privileged: true },
    { scope: 'daemon', dir: '/Library/LaunchDaemons', privileged: true }
  ]

  async function readFile(scope: AgentScope, path: string): Promise<PlistFile> {
    let xml = await fs.readFile(path, 'utf8')
    if (xml.startsWith(BPLIST_MAGIC)) {
      const r = await deps.runner.run('plutil', ['-convert', 'xml1', '-o', '-', path])
      if (r.code !== 0) throw new Error(`plutil convert failed: ${r.stderr || r.code}`)
      xml = r.stdout
    }
    const parsed = parsePlistXml(xml)
    if (!parsed.ok) throw new Error(parsed.error)
    const label = typeof parsed.value.Label === 'string' ? parsed.value.Label : ''
    if (label === '') throw new Error('missing string Label')
    return { path, scope, fileName: basename(path), xml, value: parsed.value, label, desc: extractPlistDesc(xml) }
  }

  return {
    dirs,

    async scanAll() {
      const valid: PlistFile[] = []
      const invalid: InvalidPlist[] = []
      for (const { scope, dir } of dirs()) {
        let names: string[]
        try {
          names = await fs.readdir(dir)
        } catch {
          continue // 目录不存在(如 /Library/LaunchDaemons 在极简系统)
        }
        for (const name of names) {
          if (!name.endsWith('.plist')) continue
          const path = join(dir, name)
          try {
            valid.push(await readFile(scope, path))
          } catch (err) {
            invalid.push({ path, reason: err instanceof Error ? err.message : String(err) })
          }
        }
      }
      return { valid, invalid }
    },

    read: readFile,

    async write(scope, path, xml) {
      const parsed = parsePlistXml(xml)
      if (!parsed.ok) throw new Error(`拒绝写入非法 plist: ${parsed.error}`)
      const privileged = scope !== 'user'
      const tmp = join(privileged ? tmpdir() : join(path, '..'), `.launcher-${Date.now()}-${basename(path)}`)
      await fs.writeFile(tmp, xml, 'utf8')
      if (!privileged) {
        await fs.rename(tmp, path)
        return
      }
      const r = await deps.elevate.run(`mv ${tmp} ${path} && chown root:wheel ${path} && chmod 644 ${path}`)
      if (!r.ok) {
        await fs.unlink(tmp).catch(() => {})
        throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
    },

    async remove(scope, path) {
      if (scope === 'user') {
        await fs.unlink(path)
        return
      }
      const r = await deps.elevate.run(`rm ${path}`)
      if (!r.ok) {
        throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
    },

    async lint(xml) {
      const r = await deps.runner.run('plutil', ['-lint', '-'], { input: xml })
      if (r.code === 0) return { ok: true, error: null }
      return { ok: false, error: (r.stderr || r.stdout).trim() || 'plutil lint failed' }
    },

    async removeWithBootout(scope, path, loaded, domain) {
      const sh = loaded ? `launchctl bootout ${domain} ${path}; rm -f ${path}` : `rm -f ${path}`
      const r = await deps.elevate.run(sh)
      if (!r.ok) {
        const tolerated = /No such process|not find|not loaded|No such file/.test(r.stderr ?? '')
        if (r.cancelled) throw new Error(ELEVATION_CANCELLED)
        if (!tolerated) throw new Error(`${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
    },

    pathFor(scope, label) {
      const dir = dirs().find((d) => d.scope === scope)?.dir ?? ''
      return join(dir, `${label}.plist`)
    }
  }
}
