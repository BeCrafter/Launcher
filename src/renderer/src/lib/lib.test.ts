import { describe, expect, it } from 'vitest'
import { classifySvc } from './classify'
import { parsePlistXml } from './plist'
import { deriveOpsBar } from './ops-bar'

describe('classifySvc', () => {
  const brew = new Set(['nginx', 'postgres', 'redis-server'])
  it('① Brew Resolver:COMMAND ∈ brew services list', () => {
    expect(classifySvc({ command: 'nginx' }, brew)).toBe('brew')
    expect(classifySvc({ command: 'redis-server' }, brew)).toBe('brew')
  })
  it('② COMMAND 映射:node → node', () => {
    expect(classifySvc({ command: 'node' }, brew)).toBe('node')
  })
  it('③ 兜底 generic process', () => {
    expect(classifySvc({ command: 'ngrok' }, brew)).toBe('process')
    expect(classifySvc({ command: 'postgres' }, new Set())).toBe('process')
  })
})

describe('parsePlistXml', () => {
  it('提取 Label 与 Program', () => {
    const out = parsePlistXml('<plist><dict><key>Label</key><string>a.b</string><key>Program</key><string>/x/y</string></dict></plist>')
    expect(out).toEqual({ label: 'a.b', program: '/x/y' })
  })
  it('无 Program 时取 ProgramArguments[0]', () => {
    const out = parsePlistXml('<plist><dict><key>Label</key><string>a.b</string><key>ProgramArguments</key><array><string>/p/q</string><string>--v</string></array></dict></plist>')
    expect(out?.program).toBe('/p/q')
  })
  it('非 plist 输入返回 null', () => {
    expect(parsePlistXml('hello')).toBeNull()
    expect(parsePlistXml('')).toBeNull()
  })
})

describe('deriveOpsBar(5 态表)', () => {
  it('草稿态:三钮全禁,dot unloaded,文案 draft', () => {
    const m = deriveOpsBar({ loaded: true, enabled: true, running: true, isDraft: true })
    expect(m.state).toBe('draft')
    expect(m.loadDisabled && m.enableDisabled && m.kickDisabled).toBe(true)
    expect(m.chipColor).toBe('var(--dim)')
  })
  it('未加载:Load 可用(active-green),其余禁用', () => {
    const m = deriveOpsBar({ loaded: false, enabled: false, running: false, isDraft: false })
    expect(m.state).toBe('unloaded')
    expect(m.loadDisabled).toBe(false)
    expect(m.load.cls).toContain('active-green')
    expect(m.enableDisabled).toBe(true)
  })
  it('已加载未启用:stopped / 黄色', () => {
    const m = deriveOpsBar({ loaded: true, enabled: false, running: false, isDraft: false })
    expect(m.state).toBe('stopped')
    expect(m.chipColor).toBe('var(--yellow)')
    expect(m.enable.labelKey).toBe('drawer.op.enable')
  })
  it('就绪未运行:ready / accent2', () => {
    const m = deriveOpsBar({ loaded: true, enabled: true, running: false, isDraft: false })
    expect(m.state).toBe('ready')
    expect(m.chipColor).toBe('var(--accent2)')
  })
  it('运行中:running / 绿色,Enable 显示 disable', () => {
    const m = deriveOpsBar({ loaded: true, enabled: true, running: true, isDraft: false })
    expect(m.state).toBe('running')
    expect(m.chipColor).toBe('var(--green)')
    expect(m.enable.labelKey).toBe('drawer.op.disable')
    expect(m.load.labelKey).toBe('drawer.op.unload')
  })
})
