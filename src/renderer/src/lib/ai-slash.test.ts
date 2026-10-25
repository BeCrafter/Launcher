import { describe, expect, it } from 'vitest'
import type { AiSkillInfo } from '@shared/ai'
import type { QueryHit } from '@shared/ai-inline'
import { isSlashCommand, slashRows } from './ai-slash'

const skills: AiSkillInfo[] = [
  { id: 'sk-diag', nameKey: 'ai.skill.diag.name', descKey: 'ai.skill.diag.desc', tag: 'diagnose', icon: '' },
  { id: 'sk-plist', nameKey: 'ai.skill.plist.name', descKey: 'ai.skill.plist.desc', tag: 'plist', icon: '' }
]

const dict: Record<string, string> = {
  'ai.skill.diag.name': '诊断任务',
  'ai.skill.diag.desc': '分析 launchd / cron 任务',
  'ai.skill.plist.name': '生成 LaunchAgent',
  'ai.skill.plist.desc': '生成 plist 草稿',
  'ai.slash.file': '添加本地文件',
  'ai.slash.fileDesc': '图片或 UTF-8 文本文件'
}
const t = (key: string): string => dict[key] ?? key

const hit = (query: string, boundary: QueryHit['boundary']): QueryHit => ({ start: 0, query, boundary })

describe('slashRows', () => {
  it('空查询返回全部技能 + 文件行', () => {
    expect(slashRows('', skills, t).map((r) => r.type)).toEqual(['skill', 'skill', 'file'])
  })

  it('按名称、描述、id 过滤', () => {
    expect(slashRows('诊断', skills, t).map((r) => r.label)).toEqual(['诊断任务'])
    expect(slashRows('launchd', skills, t).map((r) => r.label)).toEqual(['诊断任务'])
    expect(slashRows('plist', skills, t).map((r) => r.label)).toEqual(['生成 LaunchAgent'])
  })

  it('匹配不到时只剩空数组', () => {
    expect(slashRows('下午', skills, t)).toEqual([])
  })
})

describe('isSlashCommand', () => {
  it('行首/空白/chip 后的 `/` 一律是命令,空结果也保留空态提示', () => {
    expect(isSlashCommand(hit('下午', 'line'), skills, t)).toBe(true)
    expect(isSlashCommand(hit('下午', 'space'), skills, t)).toBe(true)
    expect(isSlashCommand(hit('下午', 'chip'), skills, t)).toBe(true)
  })

  it('中文后的空查询照常开菜单', () => {
    expect(isSlashCommand(hit('', 'cjk'), skills, t)).toBe(true)
  })

  it('中文后匹配不到就当作普通斜线(「上午/下午」)', () => {
    expect(isSlashCommand(hit('下午', 'cjk'), skills, t)).toBe(false)
    expect(isSlashCommand(hit('输出', 'cjk'), skills, t)).toBe(false)
  })

  it('中文后能匹配到技能就继续当命令', () => {
    expect(isSlashCommand(hit('诊断', 'cjk'), skills, t)).toBe(true)
    expect(isSlashCommand(hit('di', 'cjk'), skills, t)).toBe(true)
    expect(isSlashCommand(hit('文件', 'cjk'), skills, t)).toBe(true)
  })
})
