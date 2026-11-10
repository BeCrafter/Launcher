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
    expect(items.filter((i) => i.path === '' && !i.isDir)).toEqual([])
  })

  it('目录标记带命名空间属性时仍然是目录', () => {
    const xml = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">
      <D:response><D:href>/notes/</D:href><D:propstat><D:prop>
        <D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype>
      </D:prop></D:propstat></D:response>
      <D:response><D:href>/notes/folder/</D:href><D:propstat><D:prop>
        <D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype>
      </D:prop></D:propstat></D:response>
      <D:response><D:href>/notes/folder/raw.bin</D:href><D:propstat><D:prop>
        <D:resourcetype></D:resourcetype><D:getetag>&quot;abc&quot;</D:getetag><D:getcontentlength>5</D:getcontentlength>
      </D:prop></D:propstat></D:response>
    </D:multistatus>`
    const items = parsePropfind(xml, ROOT)
    expect(items).toHaveLength(3)
    expect(items.find((i) => i.path === 'folder')?.isDir).toBe(true)
    expect(items.find((i) => i.path === 'folder/raw.bin')).toMatchObject({ isDir: false, etag: 'abc', size: 5 })
    expect(items.filter((i) => i.path === '' && !i.isDir)).toEqual([])
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
    expect(listed.has('')).toBe(false)

    await expect(store.write('a.md', Buffer.from('zz'), 'abc')).rejects.toBeInstanceOf(ConflictError)
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.headers['If-Match']).toBe('"abc"')
    expect(put?.headers.Authorization.startsWith('Basic ')).toBe(true)
    const propfind = calls.find((call) => call.method === 'PROPFIND')
    expect(propfind?.headers.Depth).toBe('1')
    expect(propfind?.headers.Accept).toContain('application/xml')
  })

  it('嵌套路径先按层 MKCOL,已存在的集合不挡住写入', async () => {
    const calls: { url: string; method: string }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      if (method === 'MKCOL' && url.endsWith('/folder')) return new Response('', { status: 405 })
      if (method === 'MKCOL') return new Response('', { status: 201 })
      if (method === 'PUT') return new Response('', { status: 201, headers: { ETag: '"new"' } })
      return new Response('', { status: 500 })
    }
    const store = createWebDavStore({ url: ROOT, username: 'u', password: 'p' }, { fetch: fetchImpl })
    const written = await store.write('folder/nested/a.md', Buffer.from('zz'))
    expect(written.etag).toBe('new')
    expect(calls.filter((call) => call.method === 'MKCOL').map((call) => call.url)).toEqual([
      `${ROOT}/folder`,
      `${ROOT}/folder/nested`
    ])
  })

  it('弱 ETag 退回修改时间，写之前再核对，不把弱校验器放进 If-Match', async () => {
    const calls: { method: string; headers: Record<string, string> }[] = []
    const xml = `<?xml version="1.0"?><d:multistatus>
      <d:response><d:href>/notes/</d:href><d:resourcetype><d:collection/></d:resourcetype></d:response>
      <d:response><d:href>/notes/a.md</d:href><d:propstat><d:prop>
        <d:getetag>W/&quot;abc&quot;</d:getetag><d:getcontentlength>2</d:getcontentlength>
        <d:getlastmodified>Mon, 1 Jan 2024 00:00:00 GMT</d:getlastmodified>
      </d:prop></d:propstat></d:response></d:multistatus>`
    const fetchImpl: typeof fetch = async (_input, init) => {
      const method = init?.method ?? 'GET'
      calls.push({ method, headers: (init?.headers ?? {}) as Record<string, string> })
      if (method === 'PROPFIND') return new Response(xml, { status: 207 })
      if (method === 'PUT') return new Response(null, { status: 204, headers: { ETag: 'W/"next"' } })
      return new Response('', { status: 500 })
    }
    const store = createWebDavStore({ url: ROOT, username: 'u', password: 'p' }, { fetch: fetchImpl })
    const etag = (await store.list()).get('a.md')?.etag ?? ''
    expect(etag).toBe('mtime:Mon, 1 Jan 2024 00:00:00 GMT:2')
    const written = await store.write('a.md', Buffer.from('zz'), etag)
    expect(written.etag).toBe(etag)
    expect(calls.filter((call) => call.method === 'PROPFIND')).toHaveLength(2)
    expect(calls.find((call) => call.method === 'PUT')?.headers['If-Match']).toBeUndefined()
  })

  it('父集合创建失败就不写入', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      const method = init?.method ?? 'GET'
      calls.push(method)
      if (method === 'MKCOL') return new Response('', { status: 500 })
      return new Response('should-not-put', { status: 500 })
    }
    const store = createWebDavStore({ url: ROOT, username: 'u', password: 'p' }, { fetch: fetchImpl })
    await expect(store.write('folder/a.md', Buffer.from('zz'))).rejects.toThrow(/500 创建目录/)
    expect(calls).toEqual(['MKCOL'])
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
