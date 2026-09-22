// AiRepository 的 IPC 实现(阶段 4:引擎与工具全在 main,renderer 只发意图 + 订阅事件流)
import { IPC_EVENTS } from '@shared/ipc'
import type { AiRunEvent } from '@shared/ai'
import type { AiRepository } from '../ports'

export function createIpcAiRepo(): AiRepository {
  const api = (): Window['launcher']['ai'] => window.launcher.ai
  return {
    getState: () => api().getState(),
    setKey: (providerId, apiKey) => api().setKey(providerId, apiKey),
    clearKey: (providerId) => api().clearKey(providerId),
    testConnection: (providerId) => api().testConnection(providerId),
    listSessions: () => api().listSessions(),
    createSession: () => api().createSession(),
    deleteSession: (id) => api().deleteSession(id),
    getMessages: (sessionId) => api().getMessages(sessionId),
    send: (input) => api().send(input),
    abort: () => api().abort(),
    respondApproval: (input) => api().respondApproval(input),
    skills: () => api().skills(),
    catalog: (providerId) => api().catalog(providerId),
    mcpInfo: () => api().mcpInfo(),
    onRunEvent: (cb) =>
      window.launcher.onEvent(IPC_EVENTS.aiRunEvent, (payload) => cb(payload as AiRunEvent))
  }
}
