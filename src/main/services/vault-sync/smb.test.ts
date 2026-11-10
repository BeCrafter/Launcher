import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentHash } from './scan'
import { createSmbStore } from './smb'
import { ConflictError } from './store'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(d, 0o700)
    } catch {
      /* 已经不在了 */
    }
    rmSync(d, { recursive: true, force: true })
  }
})

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'launcher-smb-'))
  dirs.push(d)
  return d
}

describe('createSmbStore', () => {
  it('挂载点不存在就失败,不列出空目录', async () => {
    const store = createSmbStore({ mountPath: join(temp(), 'missing') })
    await expect(store.list()).rejects.toThrow(/不存在/)
  })

  it('挂载点不可写就失败', async () => {
    const root = temp()
    chmodSync(root, 0o500)
    const store = createSmbStore({ mountPath: root })
    await expect(store.list()).rejects.toThrow(/不可写/)
  })

  it('写入用临时文件改名;指纹变了就冲突,不覆盖', async () => {
    const root = temp()
    writeFileSync(join(root, 'a.md'), 'v1')
    const store = createSmbStore({ mountPath: root })
    const listed = await store.list()
    const etag = listed.get('a.md')?.etag
    expect(listed.get('a.md')?.hash).toBe(contentHash(Buffer.from('v1')))

    writeFileSync(join(root, 'a.md'), 'someone-else')
    await expect(store.write('a.md', Buffer.from('mine'), etag)).rejects.toBeInstanceOf(ConflictError)
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('someone-else')
    expect(existsSync(join(root, 'a.md.tmp'))).toBe(false)

    const again = await store.list()
    await store.write('a.md', Buffer.from('mine'), again.get('a.md')?.etag)
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('mine')

    await store.write('folder/nested.txt', Buffer.from('nested'))
    expect(readFileSync(join(root, 'folder/nested.txt'), 'utf8')).toBe('nested')
  })
})
