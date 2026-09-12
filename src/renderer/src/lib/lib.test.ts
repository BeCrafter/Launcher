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

describe('deriveOpsBar(意图层:启动/停止 · 重启 · 开机自启 + 未来时句)', () => {
  it('草稿态:三控件全禁,chip 未保存草稿,无未来时句', () => {
    const m = deriveOpsBar({ loaded: true, enabled: true, running: true, isDraft: true })
    expect(m.state).toBe('draft')
    expect(m.primary.disabled && m.restart.disabled && m.autostart.disabled).toBe(true)
    expect(m.chip.labelKey).toBe('ops.state.draft')
    expect(m.futureHintKey).toBeNull()
  })

  it('未运行未载入:主操作「启动」,chip 已停止', () => {
    const m = deriveOpsBar({ loaded: false, enabled: true, running: false, isDraft: false })
    expect(m.state).toBe('stopped')
    expect(m.primary.action).toBe('start')
    expect(m.primary.labelKey).toBe('ops.start')
    expect(m.primary.disabled).toBe(false) // 意图层:启动恒可用(main 内部按需启用/载入)
    expect(m.chip.labelKey).toBe('ops.state.stopped')
    expect(m.autostart.on).toBe(true)
    expect(m.futureHintKey).toBe('ops.hint.autoOn')
  })

  it('已载入未运行(定时任务两次执行之间)= 待运行,且提示"仍会被自动触发"', () => {
    const m = deriveOpsBar({ loaded: true, enabled: true, running: false, isDraft: false })
    expect(m.state).toBe('pending')
    expect(m.chip.labelKey).toBe('ops.state.pending')
    expect(m.chip.dot).toBe('loaded')
    expect(m.futureHintKey).toBe('ops.hint.pending')
    expect(m.primary.action).toBe('start')
  })

  it('运行中:主操作「停止」,未来时句随开机自启翻转', () => {
    const on = deriveOpsBar({ loaded: true, enabled: true, running: true, isDraft: false })
    expect(on.state).toBe('running')
    expect(on.primary.action).toBe('stop')
    expect(on.primary.labelKey).toBe('ops.stop')
    expect(on.chip.labelKey).toBe('ops.state.running')
    expect(on.futureHintKey).toBe('ops.hint.autoOn')

    const off = deriveOpsBar({ loaded: true, enabled: false, running: true, isDraft: false })
    expect(off.state).toBe('running') // 运行中 + 开机不自启:进程照跑(严格语义)
    expect(off.autostart.on).toBe(false)
    expect(off.futureHintKey).toBe('ops.hint.autoOff')
  })

  it('意图层没有任何"因顺序而置灰"的按钮(仅草稿态禁用)', () => {
    for (const s of [
      { loaded: false, enabled: false, running: false },
      { loaded: true, enabled: false, running: false },
      { loaded: true, enabled: false, running: true },
      { loaded: false, enabled: true, running: false }
    ]) {
      const m = deriveOpsBar({ ...s, isDraft: false })
      expect(m.primary.disabled).toBe(false)
      expect(m.restart.disabled).toBe(false)
      expect(m.autostart.disabled).toBe(false)
    }
  })
})
