// AgentRepository 的 IPC 实现(阶段 1:真实 launchctl/plist,逻辑全在 main)
import type { AgentRepository } from '../ports'

export function createIpcAgentRepo(): AgentRepository {
  const api = (): Window['launcher']['agents'] => window.launcher.agents
  return {
    list: () => api().list(),
    brewAction: (kind, id) => api().brewAction(kind, id),
    createDraft: (scope, label) => api().createDraft(scope, label),
    readDocument: (id) => api().readDocument(id),
    saveForm: (input) => api().saveForm(input),
    saveXml: (input) => api().saveXml(input),
    renameAgent: (input) => api().renameAgent(input),
    remove: (id, expectedRevision) => api().remove(id, expectedRevision),
    clone: (input) => api().clone(input),
    ops: (id, action) => api().ops(id, action),
    readStatus: (id) => api().readStatus(id),
    readLogs: (id, source) => api().readLogs(id, source),
    clearLogs: (id) => api().clearLogs(id),
    validateXml: (xml) => api().validateXml(xml),
    checkMissing: (candidates) => api().checkMissing(candidates)
  }
}
