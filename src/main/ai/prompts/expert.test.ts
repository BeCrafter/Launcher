// 输出语言必须跟随应用语言(用户要求):以前写死「用简体中文回答」,英文界面下助手仍回中文
import { describe, expect, it } from 'vitest'
import { expertPrompt } from './expert'

describe('expertPrompt', () => {
  it('中文环境:要求用简体中文,且不出现英文指令', () => {
    const p = expertPrompt('zh-CN')
    expect(p).toContain('用简体中文回答')
    expect(p).not.toContain('Answer in English')
    // 开头再强调一次(长提示词里语言指令只出现一次容易跟丢)
    expect(p).toContain('【输出语言】')
  })

  it('英文环境:要求用英文,且不出现中文输出指令', () => {
    const p = expertPrompt('en-US')
    expect(p).toContain('Answer in English')
    expect(p).not.toContain('用简体中文回答')
    expect(p).toContain('[Output language]')
  })

  it('两种语言共用同一份正文(单源),只有语言指令那几处不同', () => {
    const zh = expertPrompt('zh-CN')
    const en = expertPrompt('en-US')
    // 角色与工作流段落两边都在
    for (const p of [zh, en]) {
      expect(p).toContain('launchd')
      expect(p).toContain('KeepAlive')
      expect(p).toContain('工作流')
    }
    expect(zh).not.toBe(en)
  })

  it('占位符已被替换(不留 {{OUTPUT}})', () => {
    expect(expertPrompt('zh-CN')).not.toContain('{{OUTPUT}}')
    expect(expertPrompt('en-US')).not.toContain('{{OUTPUT}}')
  })
})
