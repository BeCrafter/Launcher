// 内置技能的契约测试:白名单工具名必须真实存在、闭环技能必须带验证工具与 PATH 规则。
// 工具名的全集以 tools/index.test.ts 的 21 个契约为准 —— 这里重复列出用于白名单校验,
// 两处同时改才能让「白名单写错工具名」这类静默失效被测出来。
import { describe, expect, it } from 'vitest'
import { SKILLS, findSkill } from './skills'

/** tools/index.test.ts 里的工具名契约(21 个) */
const TOOL_NAMES = [
  'add_cron',
  'check_port',
  'collect_diagnostic_context',
  'delete_note',
  'generate_plist',
  'get_service_status',
  'prepare_agent',
  'link_note',
  'list_notes',
  'list_services',
  'list_brew_services',
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

  it('sk-plist 闭环带状态与日志工具,且写入后要验证', () => {
    const s = findSkill('sk-plist')!
    expect(s.tools, 'sk-plist 应允许写入').toContain('write_plist')
    expect(s.tools, 'sk-plist 应允许载入').toContain('load_plist')
    expect(s.tools, 'sk-plist 应能查状态').toContain('get_service_status')
    expect(s.tools, 'sk-plist 应能看日志').toContain('tail_log')
    expect(s.task).toMatch(/get_service_status/)
    expect(s.task).toMatch(/tail_log/)
  })

  it('sk-diag 修复后必须实际验证(不是只给步骤)', () => {
    const s = findSkill('sk-diag')!
    expect(s.task).toMatch(/get_service_status/)
    expect(s.task).toMatch(/tail_log/)
  })

  it('sk-refactor 保持严格只读且最小工具面', () => {
    const s = findSkill('sk-refactor')!
    expect(s.tools).toEqual(['list_services', 'search_services', 'read_plist', 'get_service_status'])
    expect(s.task).toMatch(/严格只读/)
  })

  it('sk-plist 带 PATH 硬规则(launchd 不加载 shell 配置)', () => {
    const s = findSkill('sk-plist')!
    expect(s.task).toMatch(/zshrc|zprofile|shell 配置/)
    expect(s.task).toMatch(/EnvironmentVariables\.PATH/)
  })

  it('需要多轮的工具类技能有 turnLimit(默认 8 轮跑不完)', () => {
    for (const id of ['sk-plist', 'sk-diag', 'sk-import', 'sk-refactor']) {
      const s = findSkill(id)!
      expect(s.turnLimit, `${id} 应设 turnLimit`).toBeGreaterThanOrEqual(16)
    }
  })

  it('sk-plist 带日志默认策略(默认配 stdout/stderr,按输出视情况调整)', () => {
    const s = findSkill('sk-plist')!
    expect(s.task).toMatch(/StandardOutPath/)
    expect(s.task).toMatch(/StandardErrorPath/)
    expect(s.task).toMatch(/logDir/)
    expect(s.task).toMatch(/Library\/Logs/)
    expect(s.task).toMatch(/不轮转/)
    expect(s.task).toMatch(/tail_log path=/)
  })

  it('sk-plist 区分常驻 / 一次性 / 定时任务的验证判据', () => {
    const s = findSkill('sk-plist')!
    expect(s.task).toMatch(/常驻服务/)
    expect(s.task).toMatch(/一次性任务/)
    expect(s.task).toMatch(/定时任务/)
    expect(s.task).toMatch(/exit code 0/)
  })

  it('sk-plist 带端口验证与回滚工具', () => {
    const s = findSkill('sk-plist')!
    expect(s.tools).toContain('check_port')
    expect(s.tools).toContain('unload_plist')
  })

  it('sk-plist 与页面表单能力对齐(WatchPaths / Nice / UserName / KeepAlive dict)', () => {
    const s = findSkill('sk-plist')!
    expect(s.task).toMatch(/WatchPaths/)
    expect(s.task).toMatch(/Nice/)
    expect(s.task).toMatch(/UserName/)
    expect(s.task).toMatch(/Crashed/)
    expect(s.task).toMatch(/SuccessfulExit/)
  })

  it('sk-plist 覆盖仅手动任务与 scope/logs 派生', () => {
    const s = findSkill('sk-plist')!
    expect(s.task).toMatch(/仅手动启动/)
    expect(s.task).toMatch(/scope/)
    expect(s.task).toMatch(/logs: 'none'|logs.*none/)
  })

  it('sk-import 是 Brew 盘点，不写/载入 Brew plist', () => {
    const s = findSkill('sk-import')!
    expect(s.tools).toContain('list_brew_services')
    expect(s.tools).not.toContain('write_plist')
    expect(s.tools).not.toContain('load_plist')
    expect(s.tools).not.toContain('unload_plist')
    expect(s.task).toMatch(/一律盘点/)
    expect(s.task).toMatch(/不 write\/load\/unload/)
  })

  it('sk-diag 按资源类型分支，且工具面不含笔记写入', () => {
    const s = findSkill('sk-diag')!
    expect(s.tools).toContain('search_services')
    expect(s.tools).toContain('tail_log')
    expect(s.tools).not.toContain('write_note')
    expect(s.tools).not.toContain('delete_note')
    expect(s.task).toMatch(/cron/)
    expect(s.task).toMatch(/端口服务/)
  })
})
