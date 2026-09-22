// 密钥存储的边界:明文不得落盘、损坏不得抛、钥匙串不可用必须拒绝写
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSecretStore } from './secret-store'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launcher-secret-'))
  path = join(dir, 'ai-keys.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** 假加密:base64 反转,仅用于验证"存进去的不是明文"这条契约 */
const fakeCrypto = {
  available: () => true,
  encrypt: (s: string) => Buffer.from(s, 'utf8').toString('base64'),
  decrypt: (s: string) => Buffer.from(s, 'base64').toString('utf8')
}

describe('createSecretStore', () => {
  it('写入后能读回,且落盘内容不是明文', () => {
    const store = createSecretStore({ path, crypto: fakeCrypto })
    store.set('anthropic', 'sk-ant-secret-value')
    expect(store.get('anthropic')).toBe('sk-ant-secret-value')
    expect(store.has('anthropic')).toBe(true)
    expect(readFileSync(path, 'utf8')).not.toContain('sk-ant-secret-value')
  })

  it('两个协议各存各的,互不影响', () => {
    const store = createSecretStore({ path, crypto: fakeCrypto })
    store.set('anthropic', 'a-key')
    store.set('openai-compatible', 'o-key')
    expect(store.get('anthropic')).toBe('a-key')
    expect(store.get('openai-compatible')).toBe('o-key')
    store.clear('anthropic')
    expect(store.has('anthropic')).toBe(false)
    expect(store.get('openai-compatible')).toBe('o-key')
  })

  it('空白 Key 视同清除,不写进文件', () => {
    const store = createSecretStore({ path, crypto: fakeCrypto })
    store.set('anthropic', '   ')
    expect(store.has('anthropic')).toBe(false)
    expect(store.get('anthropic')).toBeNull()
  })

  it('文件损坏按未配置处理,不抛', () => {
    writeFileSync(path, '{ not json')
    const store = createSecretStore({ path, crypto: fakeCrypto })
    expect(store.get('anthropic')).toBeNull()
    // 损坏后仍可正常写入并读回
    store.set('anthropic', 'k')
    expect(store.get('anthropic')).toBe('k')
  })

  it('密文解不开(换了钥匙串)按未配置处理,不把垃圾当 Key 发出去', () => {
    writeFileSync(path, JSON.stringify({ anthropic: 'bm90LWEtcmVhbC1jaXBoZXI=' }))
    const broken = {
      available: () => true,
      encrypt: fakeCrypto.encrypt,
      decrypt: () => {
        throw new Error('keychain changed')
      }
    }
    const store = createSecretStore({ path, crypto: broken })
    expect(store.get('anthropic')).toBeNull()
    expect(store.has('anthropic')).toBe(false)
  })

  it('钥匙串不可用时拒绝写入而不是降级明文', () => {
    const store = createSecretStore({
      path,
      crypto: { ...fakeCrypto, available: () => false }
    })
    expect(() => store.set('anthropic', 'k')).toThrow(/钥匙串/)
    expect(store.get('anthropic')).toBeNull()
  })

  it('__proto__ 键不污染原型', () => {
    writeFileSync(path, '{"__proto__": "polluted"}')
    const store = createSecretStore({ path, crypto: fakeCrypto })
    expect(store.get('anthropic')).toBeNull()
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})
