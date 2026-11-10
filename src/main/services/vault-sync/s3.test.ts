import { describe, expect, it } from 'vitest'
import { createS3Store } from './s3'
import { IncompleteListError } from './store'

function page(keys: string[], next: string, truncated: boolean): string {
  const contents = keys
    .map((k) => `<Contents><Key>${k}</Key><ETag>&quot;etag-${k}&quot;</ETag><Size>3</Size></Contents>`)
    .join('')
  return `<ListBucketResult>${contents}<IsTruncated>${truncated}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''}</ListBucketResult>`
}

describe('createS3Store', () => {
  it('翻完所有页;被截断但没有下一页标记时拒绝', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      urls.push(url)
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
      expect(auth.startsWith('AWS4-HMAC-SHA256 ')).toBe(true)
      if (url.includes('continuation-token=')) return new Response(page(['notes/b.md'], '', false), { status: 200 })
      return new Response(page(['notes/a.md'], 'tok1', true), { status: 200 })
    }
    const store = createS3Store(
      {
        endpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        bucket: 'vault',
        prefix: 'notes',
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        forcePathStyle: true
      },
      { fetch: fetchImpl }
    )
    const listed = await store.list()
    expect([...listed.keys()].sort()).toEqual(['a.md', 'b.md'])
    expect(listed.get('a.md')?.etag).toBe('etag-notes/a.md')
    expect(urls[0]).toContain('/vault?')
    expect(urls[0]).toContain('list-type=2')

    const broken: typeof fetch = async () => new Response(page(['notes/a.md'], '', true), { status: 200 })
    const bad = createS3Store(
      {
        endpoint: 'https://s3.amazonaws.com',
        region: '',
        bucket: 'vault',
        prefix: '',
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        forcePathStyle: false
      },
      { fetch: broken }
    )
    await expect(bad.list()).rejects.toBeInstanceOf(IncompleteListError)
  })

  it('412 记为冲突', async () => {
    const fetchImpl: typeof fetch = async () => new Response('', { status: 412 })
    const store = createS3Store(
      {
        endpoint: 'https://vault.s3.amazonaws.com',
        region: 'us-east-1',
        bucket: 'vault',
        prefix: '',
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        forcePathStyle: false
      },
      { fetch: fetchImpl }
    )
    await expect(store.write('a.md', Buffer.from('x'), 'old')).rejects.toMatchObject({ name: 'ConflictError' })
  })
})
