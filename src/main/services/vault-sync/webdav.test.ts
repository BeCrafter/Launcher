import { describe, expect, it } from 'vitest'
import { createWebDavStore, parsePropfind } from './webdav'
import { ConflictError } from './store'

const ROOT = 'https://dav.example/notes'

function listing(etag: string): string {
  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/notes/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/notes/a.md</d:href><d:propstat><d:prop>
    <d:getetag>&quot;${etag}&quot;</d:getetag><d:getcontentlength>2</d:getcontentlength>
  </d:prop></d:propstat></d:response>
  <d:response><d:href>/notes/sub/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`
}

describe('parsePropfind', () => {
  it('去掉根路径,目录与文件分开,etag 去掉引号', () => {
    const items = parsePropfind(listing('abc'), ROOT)
    expect(items.find((i) => i.path === '')?.isDir).toBe(true)
    expect(items.find((i) => i.path === 'a.md')).toMatchObject({ isDir: false, etag: 'abc', size: 2 })
    expect(items.find((i) => i.path === 'sub')?.isDir).toBe(true)
  })
})

describe('createWebDavStore', () => {
  it('写入带 If-Match;412 记为冲突,不当成成功', async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url, method, headers })
      if (method === 'PROPFIND' && url.endsWith('/notes/')) {
        return new Response(listing('abc'), { status: 207 })
      }
      if (method === 'PROPFIND') return new Response(listing('abc').replace('a.md', 'sub/b.md'), { status: 207 })
      if (method === 'PUT') return new Response('', { status: 412 })
      return new Response('', { status: 500 })
    }
    const store = createWebDavStore(
      { url: `${ROOT}/`, username: 'u', password: 'p' },
      { fetch: fetchImpl }
    )
    const listed = await store.list()
    expect(listed.get('a.md')?.etag).toBe('abc')
    expect(listed.has('sub')).toBe(false)

    await expect(store.write('a.md', Buffer.from('zz'), 'abc')).rejects.toBeInstanceOf(ConflictError)
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.headers['If-Match']).toBe('abc')
    expect(put?.headers.Authorization.startsWith('Basic ')).toBe(true)
  })

  it('没有 ETag 时,写之前再读一次,变了就不写', async () => {
    let reads = 0
    const fetchImpl: typeof fetch = async (_input, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'PROPFIND') {
        reads += 1
        const mtime = reads === 1 ? 'Mon, 1 Jan 2024 00:00:00 GMT' : 'Tue, 2 Jan 2024 00:00:00 GMT'
        const xml = `<?xml version="1.0"?><d:multistatus>
          <d:response><d:href>/notes/</d:href><d:resourcetype><d:collection/></d:resourcetype></d:response>
          <d:response><d:href>/notes/a.md</d:href>
            <d:getcontentlength>1</d:getcontentlength><d:getlastmodified>${mtime}</d:getlastmodified>
          </d:response></d:multistatus>`
        return new Response(xml, { status: 207 })
      }
      return new Response('should-not-put', { status: 500 })
    }
    const store = createWebDavStore({ url: ROOT, username: 'u', password: 'p' }, { fetch: fetchImpl })
    const listed = await store.list()
    const etag = listed.get('a.md')?.etag ?? ''
    expect(etag.startsWith('mtime:')).toBe(true)
    await expect(store.write('a.md', Buffer.from('z'), etag)).rejects.toBeInstanceOf(ConflictError)
  })
})
