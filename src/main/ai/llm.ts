// LlmClient 防腐层:**本文件是全仓唯一 import pi-ai 的地方**(ai-capability.md「防腐层」)
//
// 对外只暴露三件事:① 把设置解析成一个可用的模型 ② 给出 pi-agent-core 要的 streamFn ③ 真连一次验活。
// 换库/升 pi 时只改这里。schema 走 typebox(pi 的原生格式),不为工具定义再引一套 zod。

import { createModels, createProvider, type Api, type Model, type Provider } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'
import type { AiProviderId, AiProvidersConfig } from '../../shared/settings'
import type { AiTestResult } from '../../shared/ipc'
import type { SecretStore } from './secret-store'

/** OpenAI 兼容端点连到哪家未知:目录里的 cost/contextWindow 都无从得知,给保守值并在界面说明 */
const UNKNOWN_CONTEXT_WINDOW = 128_000
const UNKNOWN_MAX_TOKENS = 8_192

/** 界面展示名(设置页协议卡标题用) */
const PROVIDER_NAMES: Record<AiProviderId, string> = {
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI 兼容'
}

interface ResolvedConfig {
  providerId: AiProviderId
  modelId: string
  baseUrl: string
  apiKey: string | null
  /** 该协议的附加请求头(企业网关常按 User-Agent 之类放行) */
  headers: Record<string, string> | undefined
}

export interface ResolvedModel {
  model: Model<Api>
  providerId: AiProviderId
  providerName: string
  modelLabel: string
}

export interface LlmClient {
  /** 当前配置能否成行;不能则给出可读原因(界面进未配置态) */
  resolve(): { ok: true; value: ResolvedModel } | { ok: false; reason: string }
  /** pi-agent-core 的 streamFn(每次调用现造,跟随最新设置) */
  streamFn(): StreamFn
  /** 真连一次端点(设置页「测试连接」);demo 里是假的,这里如实发一次最小请求 */
  testConnection(providerId: AiProviderId): Promise<AiTestResult>
  /** 该协议的模型目录(仅 Anthropic 有内置目录;OpenAI 兼容返回空数组) */
  catalog(providerId: AiProviderId): { id: string; name: string }[]
  /** 协议展示名 */
  providerName(providerId: AiProviderId): string
}

export function createLlmClient(deps: {
  secrets: SecretStore
  getProviders(): AiProvidersConfig
  getProviderId(): AiProviderId
  /** 请求超时(秒) */
  getTimeoutSec(): number
}): LlmClient {
  const readConfig = (providerId?: AiProviderId): ResolvedConfig => {
    const pid = providerId ?? deps.getProviderId()
    const cfg = deps.getProviders()[pid]
    return {
      providerId: pid,
      // 模型取自该协议自己的配置(切协议不会互相覆盖)
      modelId: (cfg.modelId ?? '').trim(),
      baseUrl: cfg.baseUrl,
      apiKey: deps.secrets.get(pid),
      headers: cfg.headers
    }
  }

  /** 按内置目录造模型;目录里没有(OpenAI 兼容端点、或用户手填的新模型 id)则按保守值合成 */
  const buildModel = (cfg: ResolvedConfig): Model<Api> => {
    if (cfg.providerId === 'anthropic') {
      const known = (ANTHROPIC_MODELS as Record<string, Model<Api> | undefined>)[cfg.modelId]
      if (known) {
        // 端点可被用户改成自建网关:目录里的官方 baseUrl 只在用户没改时生效
        return { ...known, baseUrl: cfg.baseUrl }
      }
      return {
        id: cfg.modelId,
        name: cfg.modelId,
        api: 'anthropic-messages',
        provider: 'anthropic',
        baseUrl: cfg.baseUrl,
        reasoning: true,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: UNKNOWN_CONTEXT_WINDOW,
        maxTokens: UNKNOWN_MAX_TOKENS
      }
    }
    return {
      id: cfg.modelId,
      name: cfg.modelId,
      api: 'openai-completions',
      provider: 'openai-compatible',
      baseUrl: cfg.baseUrl,
      reasoning: false,
      // 不声明 image:端点后面是什么模型未知,声明了会让 pi 放行图片输入
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: UNKNOWN_CONTEXT_WINDOW,
      maxTokens: UNKNOWN_MAX_TOKENS
    }
  }

  /** 按协议构造 provider;Key 现取,不缓存(设置页改 Key 后下一轮立即生效) */
  const buildProvider = (cfg: ResolvedConfig): Provider => {
    const api = cfg.providerId === 'anthropic' ? anthropicMessagesApi() : openAICompletionsApi()
    const apiKey = cfg.apiKey
    return createProvider({
      id: cfg.providerId,
      name: PROVIDER_NAMES[cfg.providerId],
      baseUrl: cfg.baseUrl,
      auth: {
        apiKey: {
          name: PROVIDER_NAMES[cfg.providerId],
          // resolve 返回 undefined = 未配置;pi 会把它变成一条可读的流错误而不是抛异常
          resolve: async () => (apiKey ? { auth: { apiKey } } : undefined)
        }
      },
      models: [buildModel(cfg)],
      api: api as never
    })
  }

  const resolve = (providerId?: AiProviderId): ReturnType<LlmClient['resolve']> => {
    const cfg = readConfig(providerId)
    if (!cfg.apiKey) return { ok: false, reason: 'missing-key' }
    if (!cfg.baseUrl) return { ok: false, reason: 'missing-base-url' }
    if (!cfg.modelId) return { ok: false, reason: 'missing-model' }
    return {
      ok: true,
      value: {
        model: buildModel(cfg),
        providerId: cfg.providerId,
        providerName: PROVIDER_NAMES[cfg.providerId],
        modelLabel: modelLabel(cfg.modelId)
      }
    }
  }

  // 目录里的友好名(claude-opus-5 → Claude Opus 5);目录外(自定义端点)直接用 id
  const modelLabel = (id: string): string => {
    const known = (ANTHROPIC_MODELS as Record<string, Model<Api> | undefined>)[id]
    return known ? known.name : id
  }

  return {
    resolve,
    providerName: (id) => PROVIDER_NAMES[id],
    catalog: (providerId) => {
      if (providerId !== 'anthropic') return []
      return Object.values(ANTHROPIC_MODELS as Record<string, Model<Api>>).map((m) => ({
        id: m.id,
        name: m.name
      }))
    },
    streamFn: () => {
      const cfg = readConfig()
      const provider = buildProvider(cfg)
      const models = createModels()
      models.setProvider(provider)
      // TranscriptContext 可赋值给 Context,且 normalizeContext 对已规范化的 transcript 幂等
      // (systemPrompt/tools 为空时原样返回)——故不要在这里再注入 tools,agent 已放进 system message
      const extra = cfg.headers
      const fn: StreamFn = (m, context, options) =>
        // ⚠ 头必须走**请求选项**这一层:createProvider 的 headers 到不了线上(实测)。
        models.streamSimple(m, context, extra ? { ...options, headers: { ...(options?.headers ?? {}), ...extra } } : options)
      return fn
    },
    testConnection: async (providerId) => {
      const cfg = readConfig(providerId)
      if (!cfg.apiKey) return { ok: false, message: 'missing-key' }
      try {
        const models = createModels()
        models.setProvider(buildProvider(cfg))
        await models.completeSimple(
          buildModel(cfg),
          { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
          // 最小请求:只要端点/Key/模型名三者有一处不对就会失败。
          // 附加头必须带上 —— 否则「测试连接」失败的端点实际是通的(反之亦然)
          { maxTokens: 8, timeoutMs: deps.getTimeoutSec() * 1000, ...(cfg.headers ? { headers: cfg.headers } : {}) }
        )
        return { ok: true, message: 'ok' }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
