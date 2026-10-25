/**
 * 读响应正文,超过上限立即中止。
 *
 * 不能先 `res.text()` 再量长度:对端可以不发 content-length,或发一个假的;
 * 更新检查的超时之前足够把内存撑爆。这里按块累计,超限就 cancel 流并返回 null。
 */
export async function readCappedText(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* 流已被取消时 releaseLock 可能抛错,不影响结果 */
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}
