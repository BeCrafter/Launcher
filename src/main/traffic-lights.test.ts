import { describe, expect, it } from 'vitest'
import { shouldRevealTrafficLights } from './traffic-lights'

const bounds = { x: 100, y: 50, width: 1200, height: 800 }

describe('shouldRevealTrafficLights', () => {
  it('光标在窗口顶部触发带内时显示', () => {
    expect(shouldRevealTrafficLights({ x: 100, y: 50 }, bounds)).toBe(true)
    expect(shouldRevealTrafficLights({ x: 400, y: 73 }, bounds)).toBe(true)
  })

  it('超过触发带高度就不再显示(边界值 24 不算)', () => {
    expect(shouldRevealTrafficLights({ x: 400, y: 74 }, bounds)).toBe(false)
    expect(shouldRevealTrafficLights({ x: 400, y: 75 }, bounds)).toBe(false)
    expect(shouldRevealTrafficLights({ x: 400, y: 76 }, bounds)).toBe(false)
  })

  it('光标在窗口左右边界外时不显示', () => {
    expect(shouldRevealTrafficLights({ x: 99, y: 50 }, bounds)).toBe(false)
    expect(shouldRevealTrafficLights({ x: 1300, y: 50 }, bounds)).toBe(false)
    expect(shouldRevealTrafficLights({ x: 1299, y: 50 }, bounds)).toBe(true)
  })

  it('窗口在负坐标屏幕上(副屏在左侧)同样按相对位置判断', () => {
    const negative = { x: -1400, y: -40, width: 1200, height: 800 }
    expect(shouldRevealTrafficLights({ x: -1400, y: -40 }, negative)).toBe(true)
    expect(shouldRevealTrafficLights({ x: -300, y: -17 }, negative)).toBe(true)
    expect(shouldRevealTrafficLights({ x: -300, y: -16 }, negative)).toBe(false)
  })

  it('光标在窗口上方(负相对 y)不显示', () => {
    expect(shouldRevealTrafficLights({ x: 400, y: 49 }, bounds)).toBe(false)
  })

  it('触发带高度可覆盖', () => {
    expect(shouldRevealTrafficLights({ x: 400, y: 80 }, bounds, 32)).toBe(true)
    expect(shouldRevealTrafficLights({ x: 400, y: 82 }, bounds, 32)).toBe(false)
  })
})
