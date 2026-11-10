import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createS3Store } from './s3'
import { IncompleteListError } from './store'

/** 用发出去的头重算 SigV4。If-Match 按小写名取空时，这里对不上 */
function resign(url: string, method: string, headers: Record<string, string>, secret: string): string {
  const auth = headers.Authorization
  const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(';') ?? []
  const scope = /Credential=[^/]+\/([^,]+)/.exec(auth)?.[1] ?? ''
  const payload = headers['x-amz-content-sha256']
  const amzDate = headers['x-amz-date']
  const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.trim()]))
  const u = new URL(url)
  const canonical = [
    method,
    u.pathname,
    [...u.searchParams.entries()]
      .sort()
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&'),
    signed.map((key) => `${key}:${lower.get(key)}\n`).join(''),
    signed.join(';'),
    payload
  ].join('\n')
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`
  const [date, region] = scope.split('/')
  let key: Buffer | string = `AWS4${secret}`
  for (const part of [date, region, 's3', 'aws4_request']) key = createHmac('sha256', key).update(part).digest()
  return createHmac('sha256', key).update(toSign).digest('hex')
}

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

  it('412 记为冲突,If-Match 带上 ETag 的引号', async () => {
    let match = ''
    const fetchImpl: typeof fetch = async (_input, init) => {
      match = ((init?.headers ?? {}) as Record<string, string>)['If-Match'] ?? ''
      return new Response('', { status: 412 })
    }
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
    expect(match).toBe('"old"')
  })

  it('条件写的签名覆盖带引号的 If-Match，不签传输层自己加的头', async () => {
    let sent: { url: string; headers: Record<string, string> } | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      sent = { url: String(input), headers: (init?.headers ?? {}) as Record<string, string> }
      return new Response('', { status: 200, headers: { ETag: '"next"' } })
    }
    const store = createS3Store(
      {
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        bucket: 'vault',
        prefix: '',
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        forcePathStyle: false
      },
      { fetch: fetchImpl }
    )
    await store.write('a.md', Buffer.from('x'), 'old')
    const headers = sent?.headers ?? {}
    const signed = /SignedHeaders=([^,]+)/.exec(headers.Authorization)?.[1]
    expect(signed).toBe('host;if-match;x-amz-content-sha256;x-amz-date')
    expect(headers['x-amz-content-sha256']).toBe(createHash('sha256').update(Buffer.from('x')).digest('hex'))
    const signature = /Signature=([0-9a-f]+)/.exec(headers.Authorization)?.[1]
    expect(signature).toBe(resign(sent?.url ?? '', 'PUT', headers, 'secret'))
  })

  it('403 直接失败，不重试，也不当成冲突', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 })
    }
    const store = createS3Store(
      {
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        bucket: 'vault',
        prefix: '',
        accessKeyId: 'AKID',
        secretAccessKey: 'secret',
        forcePathStyle: false
      },
      { fetch: fetchImpl }
    )
    await expect(store.write('a.md', Buffer.from('x'))).rejects.toThrow(/^403 /)
    expect(calls).toBe(1)
  })
})
