// 内置技能的契约测试:白名单工具名必须真实存在、闭环技能必须带验证工具与 PATH 规则。
// 工具名的全集以 tools/index.test.ts 的 20 个契约为准 —— 这里重复列出用于白名单校验,
// 两处同时改才能让「白名单写错工具名」这类静默失效被测出来。
import { describe, expect, it } from 'vitest'
import { SKILLS, findSkill } from './skills'

/** tools/index.test.ts 里的工具名契约(20 个) */
const TOOL_NAMES = [
  'add_cron',
  'check_port',
  'collect_diagnostic_context',
  'delete_note',
  'generate_plist',
  'get_service_status',
  'link_note',
  'list_notes',
  'list_services',
  'load_plist',
  'read_note',
  'read_note_image',
  'read_plist',
  'remove_cron',
  'search_services',
  'tail_log',
  'unload_plist',
  'validate_plist',
  'write_note',
  'write_plist'
]

describe('SKILLS 契约', () => {
  it('恰好 4 个技能,id 唯一且 findSkill 能找到', () => {
    expect(SKILLS).toHaveLength(4)
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(4)
    for (const s of SKILLS) {
      expect(findSkill(s.id)).toBe(s)
      expect(s.task.length).toBeGreaterThan(50)
    }
    expect(findSkill(undefined)).toBeUndefined()
    expect(findSkill('sk-none')).toBeUndefined()
  })

  it('白名单里的每个工具名都存在于注册表契约(防拼错工具名静默失效)', () => {
    for (const s of SKILLS) {
      if (s.tools === null) continue
      for (const name of s.tools) {
        expect(TOOL_NAMES, `${s.id} 的白名单含未知工具 ${name}`).toContain(name)
      }
    }
  })

  it('闭环技能(sk-plist / sk-import)带状态与日志工具,且写入后要验证', () => {
    for (const id of ['sk-plist', 'sk-import']) {
      const s = findSkill(id)!
      expect(s.tools, `${id} 应允许写入`).toContain('write_plist')
      expect(s.tools, `${id} 应允许载入`).toContain('load_plist')
      expect(s.tools, `${id} 应能查状态`).toContain('get_service_status')
      expect(s.tools, `${id} 应能看日志`).toContain('tail_log')
      expect(s.task).toMatch(/get_service_status/)
      expect(s.task).toMatch(/tail_log/)
    }
  })

  it('sk-diag 修复后必须实际验证(不是只给步骤)', () => {
    const s = findSkill('sk-diag')!
    expect(s.task).toMatch(/get_service_status/)
    expect(s.task).toMatch(/tail_log/)
  })

  it('sk-refactor 保持只读(不含任何写工具)', () => {
    const s = findSkill('sk-refactor')!
    expect(s.tools).not.toContain('write_plist')
    expect(s.tools).not.toContain('load_plist')
    expect(s.tools).not.toContain('add_cron')
    expect(s.tools).not.toContain('write_note')
  })

  it('闭环技能带 PATH 硬规则(launchd 不加载 shell 配置)', () => {
    for (const id of ['sk-plist', 'sk-import']) {
      const s = findSkill(id)!
      expect(s.task, `${id} 应点名 launchd 不加载 shell 配置`).toMatch(/zshrc|zprofile|shell 配置/)
      expect(s.task, `${id} 应要求 EnvironmentVariables.PATH`).toMatch(/EnvironmentVariables\.PATH/)
    }
  })

  it('闭环技能有 turnLimit(默认 8 轮跑不完验证环)', () => {
    for (const id of ['sk-plist', 'sk-diag', 'sk-import']) {
      const s = findSkill(id)!
      expect(s.turnLimit, `${id} 应设 turnLimit`).toBeGreaterThanOrEqual(16)
    }
  })
})
