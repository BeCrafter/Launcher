import { describe, expect, it } from 'vitest'
import { dedupeRows, etimeToUptime, parseLsofListen } from './lsof-parse'

const sample = (pid: number, command: string, ports: string[], uid = 501): string =>
  [`p${pid}`, `c${command}`, `u${uid}`, ...ports.flatMap((n, i) => [`f${i + 8}`, 'PTCP', `n${n}`])].join('\n')

describe('parseLsofListen(-F 机器可读格式)', () => {
  it('标准行:pid/uid/命令/端口/地址/协议', () => {
    const rows = parseLsofListen(sample(2900, 'rapportd', ['*:49168']))
    expect(rows).toEqual([{ pid: 2900, uid: 501, command: 'rapportd', port: 49168, addr: '*', proto: 'TCP' }])
  })

  it('同 pid 同端口双栈重复行 → dedupe 后一条', () => {
    const rows = parseLsofListen(sample(2900, 'rapportd', ['*:49168', '*:49168']))
    expect(rows).toHaveLength(2)
    expect(dedupeRows(rows)).toHaveLength(1)
  })

  it('同 pid 多端口 → 保留多条(ControlCenter 7000/5000)', () => {
    const rows = dedupeRows(parseLsofListen(sample(2993, 'ControlCenter', ['*:7000', '*:7000', '*:5000', '*:5000'])))
    expect(rows.map((r) => r.port).sort((a, b) => a - b)).toEqual([5000, 7000])
  })

  it('多进程混合 + 命令名含空格与中文(完整 UTF-8)', () => {
    const output = [sample(3769, '知音楼 Helper', ['127.0.0.1:4538']), sample(15025, 'Spotify', ['*:54596', '127.0.0.1:7768'])].join('\n')
    const rows = dedupeRows(parseLsofListen(output))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ pid: 3769, command: '知音楼 Helper', port: 4538, addr: '127.0.0.1' })
    expect(rows[1]).toMatchObject({ pid: 15025, command: 'Spotify', port: 54596, addr: '*' })
    expect(rows[2]).toMatchObject({ pid: 15025, port: 7768, addr: '127.0.0.1' })
  })

  it('IPv6 方括号地址形式', () => {
    const rows = parseLsofListen(sample(100, 'node', ['[::1]:3000']))
    expect(rows[0]).toMatchObject({ port: 3000, addr: '[::1]' })
  })

  it('空输出 → 空数组;非法端口行跳过', () => {
    expect(parseLsofListen('')).toEqual([])
    expect(parseLsofListen('p1\ncx\nu0\nf1\nPTCP\nnnoport')).toEqual([])
    expect(parseLsofListen('p1\ncx\nu0\nf1\nPTCP\nn*:99999')).toEqual([])
  })
})

describe('etimeToUptime', () => {
  it('DD-HH:MM:SS / HH:MM:SS / MM:SS', () => {
    expect(etimeToUptime('12-13:40:34')).toBe('12d 13h')
    expect(etimeToUptime('01:20:00')).toBe('1h 20m')
    expect(etimeToUptime('05:30')).toBe('5m')
    expect(etimeToUptime('00:12')).toBe('0m')
  })
})
