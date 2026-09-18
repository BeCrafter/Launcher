import { describe, expect, it } from 'vitest'
import { assertValidAgentLabel, validateAgentLabel } from './agent-label'

describe('validateAgentLabel', () => {
  it('合法:字母/数字/点/下划线与连字符(含常见反向域名式 Label)', () => {
    for (const ok of ['com.example.app', 'homebrew.mxcl.redis', 'a', 'A1', 'my_task-2', 'x.y.z']) {
      expect(validateAgentLabel(ok).ok, ok).toBe(true)
    }
  })

  it('非法:空串 / 空白 / 路径分隔符 / 控制字符 / shell 元字符 / 点段', () => {
    for (const bad of ['', ' ', 'a b', '../../etc/passwd', 'a/b', 'a\\b', 'a\nb', 'a\tb', 'a;rm -rf /', 'a$(id)', 'a`id`', 'a|b', 'a>b', 'a&b', "a'b", 'a"b', '*', 'a*b', 'com.example:app']) {
      const r = validateAgentLabel(bad)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
    }
    expect(validateAgentLabel('.').ok).toBe(false)
    expect(validateAgentLabel('..').ok).toBe(false)
  })

  it('非法:超长(>200)', () => {
    expect(validateAgentLabel('a'.repeat(200)).ok).toBe(true)
    expect(validateAgentLabel('a'.repeat(201)).ok).toBe(false)
  })

  it('assertValidAgentLabel 抛可读中文错误', () => {
    expect(() => assertValidAgentLabel('a b')).toThrow(/Label 不合法/)
    expect(() => assertValidAgentLabel('ok.label')).not.toThrow()
  })
})
