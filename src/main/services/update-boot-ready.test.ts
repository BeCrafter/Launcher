import { describe, expect, it, vi } from 'vitest'
import { createUpdateBootReady } from './update-boot-ready'

describe('createUpdateBootReady', () => {
  it('启动完成与首帧都到齐才触发,顺序无关', () => {
    const a = vi.fn()
    const gateA = createUpdateBootReady(a)
    gateA.startupComplete()
    expect(a).not.toHaveBeenCalled()
    gateA.appReady()
    expect(a).toHaveBeenCalledTimes(1)

    const b = vi.fn()
    const gateB = createUpdateBootReady(b)
    gateB.appReady()
    expect(b).not.toHaveBeenCalled()
    gateB.startupComplete()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('只触发一次(重复上报不会重复写 ready 标记)', () => {
    const onReady = vi.fn()
    const gate = createUpdateBootReady(onReady)
    gate.startupComplete()
    gate.appReady()
    gate.appReady()
    gate.startupComplete()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('只有正常应用树、没有启动完成时不触发(渲染层先就绪也不能提前解除回滚保护)', () => {
    const onReady = vi.fn()
    const gate = createUpdateBootReady(onReady)
    gate.appReady()
    gate.appReady()
    expect(onReady).not.toHaveBeenCalled()
  })
})
