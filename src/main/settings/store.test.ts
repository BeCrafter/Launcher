import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsStore, defaultConfigPath } from './store'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launcher-settings-'))
  file = join(dir, 'config.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createSettingsStore', () => {
  it('文件缺失 → 默认值', () => {
    const store = createSettingsStore(file)
    expect(store.get()).toEqual(JSON.parse(JSON.stringify(store.get())))
    expect(store.get().theme).toBe('system')
    expect(existsSync(file)).toBe(false) // 读不落盘,首次 save 才写
  })

  it('defaultConfigPath 拼接 $HOME/.config/launcher/config.json', () => {
    expect(defaultConfigPath('/Users/x')).toBe('/Users/x/.config/launcher/config.json')
  })

  it('save 合并 patch 并原子落盘(无 .tmp 残留)', () => {
    const store = createSettingsStore(file)
    const out = store.save({ theme: 'dark', language: 'en-US' })
    expect(out.theme).toBe('dark')
    expect(out.language).toBe('en-US')
    expect(out.cmdTimeout).toBe(5000) // 未触碰的键保持默认
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.theme).toBe('dark')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('目录不存在时自动创建(.config/launcher 两级)', () => {
    const deep = join(dir, 'a', 'b', 'config.json')
    createSettingsStore(deep).save({ theme: 'light' })
    expect(JSON.parse(readFileSync(deep, 'utf8')).theme).toBe('light')
  })

  it('损坏文件 → 备份 .bak 并回默认值', () => {
    writeFileSync(file, '{ not valid json !!', 'utf8')
    const store = createSettingsStore(file)
    expect(store.get().theme).toBe('system')
    expect(existsSync(`${file}.bak`)).toBe(true)
  })

  it('损坏文件在下次 save 时被新内容覆盖恢复', () => {
    writeFileSync(file, 'broken', 'utf8')
    const store = createSettingsStore(file)
    store.save({ theme: 'light' })
    expect(JSON.parse(readFileSync(file, 'utf8')).theme).toBe('light')
  })

  it('reset 回默认值并落盘', () => {
    const store = createSettingsStore(file)
    store.save({ theme: 'dark' })
    store.reset()
    expect(store.get()).toEqual({ ...store.get(), theme: 'system' })
    expect(JSON.parse(readFileSync(file, 'utf8')).theme).toBe('system')
  })

  it('onChange 收到变更通知,退订后不再收到', () => {
    const store = createSettingsStore(file)
    const cb = vi.fn()
    const off = store.onChange(cb)
    store.save({ theme: 'dark' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].theme).toBe('dark')
    off()
    store.save({ theme: 'light' })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
