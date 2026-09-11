// lsof 输出解析纯函数(阶段 3)
// 用机器可读的 -F 格式(字段行 p/c/u/f/P/n),规避列式输出的截断与多字节字符破坏:
//   列式 COMMAND 列会截断到 10 字节并在多字节字符中间切断产生非法 UTF-8;
//   -F 输出完整 UTF-8 命令名(含空格,如「知音楼 Helper」)。
// 端口/地址从 n 字段解析:*:port / 1.2.3.4:port / [::1]:port

export interface LsofRow {
  pid: number
  uid: number
  command: string
  port: number
  addr: string
  proto: string
}

/** 解析 lsof -FpcuPn 输出(仅 LISTEN 场景) */
export function parseLsofListen(output: string): LsofRow[] {
  const rows: LsofRow[] = []
  let pid = -1
  let uid = -1
  let command = ''
  let proto = ''
  let pendingAddr: string | null = null

  const flush = (): void => {
    if (pendingAddr === null) return
    const parsed = splitAddr(pendingAddr)
    if (parsed && pid > 0) {
      rows.push({ pid, uid, command, port: parsed.port, addr: parsed.addr, proto })
    }
    pendingAddr = null
  }

  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    const tag = line[0]
    const value = line.slice(1)
    switch (tag) {
      case 'p':
        flush()
        pid = Number.parseInt(value, 10) || -1
        uid = -1
        command = ''
        proto = ''
        break
      case 'c':
        command = value
        break
      case 'u':
        uid = Number.parseInt(value, 10)
        break
      case 'P':
        flush()
        proto = value
        break
      case 'n':
        flush()
        pendingAddr = value
        break
      case 'f':
        flush()
        break
      default:
        break
    }
  }
  flush()
  return rows
}

function splitAddr(name: string): { addr: string; port: number } | null {
  const idx = name.lastIndexOf(':')
  if (idx <= 0) return null
  const port = Number.parseInt(name.slice(idx + 1), 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  const addr = name.slice(0, idx)
  return { addr: addr === '' ? '*' : addr, port }
}

/** 同一进程同一端口同一地址的重复行(IPv4/IPv6 双栈)去重,保持首次出现顺序 */
export function dedupeRows(rows: LsofRow[]): LsofRow[] {
  const seen = new Set<string>()
  const out: LsofRow[] = []
  for (const r of rows) {
    const key = `${r.pid}:${r.port}:${r.addr}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/** ps etime(MM:SS / HH:MM:SS / DD-HH:MM:SS)→ 卡片展示文案 */
export function etimeToUptime(etime: string): string {
  const t = etime.trim()
  let days = 0
  let rest = t
  const dash = t.indexOf('-')
  if (dash > 0) {
    days = Number.parseInt(t.slice(0, dash), 10) || 0
    rest = t.slice(dash + 1)
  }
  const parts = rest.split(':').map((p) => Number.parseInt(p, 10) || 0)
  let h = 0
  let m = 0
  if (parts.length === 3) {
    h = parts[0]
    m = parts[1]
  } else if (parts.length === 2) {
    m = parts[0]
  }
  if (days > 0) return `${days}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
