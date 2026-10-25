import { describe, expect, it } from 'vitest'
import type { AiProviderId, AiProvidersConfig } from '../../shared/settings'
import { createLlmClient } from './llm'

const providers: AiProvidersConfig = {
  anthropic: { baseUrl: 'https://api.anthropic.com', modelId: 'claude-test-custom' },
  'openai-compatible': { baseUrl: 'https://gateway.example/v1', modelId: 'gpt-test' }
}

function client(
  providerId: AiProviderId,
  apiKey: string | null = 'sk-test',
  cfg: AiProvidersConfig = providers
): ReturnType<typeof createLlmClient> {
  return createLlmClient({
    secrets: {
      get: (id) => (id === providerId ? apiKey : null),
      set: () => {},
      clear: () => {},
      has: (id) => id === providerId && apiKey !== null
    },
    getProviders: () => cfg,
    getProviderId: () => providerId,
    getTimeoutSec: () => 30
  })
}

function inputOf(providerId: AiProviderId, images?: boolean): string[] {
  const r = client(providerId).resolve(undefined, images === undefined ? undefined : { images })
  if (!r.ok) throw new Error(r.reason)
  return (r.value.model as { input?: string[] }).input ?? []
}

describe('LlmClient 图片能力声明', () => {
  it('OpenAI 兼容端点默认 text-only,含图片时才声明 image', () => {
    expect(inputOf('openai-compatible')).toEqual(['text'])
    expect(inputOf('openai-compatible', false)).toEqual(['text'])
    expect(inputOf('openai-compatible', true)).toEqual(['text', 'image'])
  })

  it('Anthropic 始终声明 image(含自建网关/自定义模型 id)', () => {
    expect(inputOf('anthropic')).toEqual(['text', 'image'])
    expect(inputOf('anthropic', false)).toEqual(['text', 'image'])
  })

  it('缺少 Key 时 resolve 失败', () => {
    const r = client('openai-compatible', null).resolve(undefined, { images: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('missing-key')
  })
})

describe('LlmClient.modelMeta:上下文窗口自动识别', () => {
  it('内置目录同名模型给出真实窗口与输出上限(不需要 Key)', () => {
    const meta = client('anthropic', null, {
      ...providers,
      anthropic: { baseUrl: 'https://api.anthropic.com', modelId: 'claude-opus-5' }
    }).modelMeta('anthropic')
    expect(meta).toMatchObject({ modelId: 'claude-opus-5', contextWindow: 1_000_000, maxTokens: 128_000 })
  })

  it('OpenAI 兼容端点按同名模型命中目录(不写死 128k)', () => {
    const meta = client('openai-compatible', null, {
      ...providers,
      'openai-compatible': { baseUrl: 'https://gateway.example/v1', modelId: 'gemini-2.5-pro' }
    }).modelMeta('openai-compatible')
    expect(meta.contextWindow).toBe(1_048_576)
    // 端点后面是哪家未知,输出上限保持保守值,不冒充目录里的 65k
    expect(meta.maxTokens).toBe(8_192)
  })

  it('手动覆盖优先于目录,未知模型退回 128k/8192', () => {
    const manual = client('openai-compatible', null, {
      ...providers,
      'openai-compatible': {
        baseUrl: 'https://gateway.example/v1',
        modelId: 'gpt-4o',
        contextWindow: 32_000
      }
    }).modelMeta('openai-compatible')
    expect(manual.contextWindow).toBe(32_000)

    const unknown = client('openai-compatible', null, {
      ...providers,
      'openai-compatible': { baseUrl: 'https://gateway.example/v1', modelId: 'totally-local-model' }
    }).modelMeta('openai-compatible')
    expect(unknown.contextWindow).toBe(128_000)
    expect(unknown.maxTokens).toBe(8_192)
  })

  it('模型名为空时也给出可展示的兜底(设置页不会因此报错)', () => {
    const meta = client('anthropic', null, {
      ...providers,
      anthropic: { baseUrl: 'https://api.anthropic.com' }
    }).modelMeta('anthropic')
    expect(meta.modelId).toBe('')
    expect(meta.contextWindow).toBe(128_000)
  })
})
