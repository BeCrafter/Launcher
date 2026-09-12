// AgentRepository 的 IPC 实现(阶段 1:真实 launchctl/plist,逻辑全在 main)
import type { AgentRepository } from '../ports'

export function createIpcAgentRepo(): AgentRepository {
  const api = (): Window['launcher']['agents'] => window.launcher.agents
  return {
    list: () => api().list(),
    brewAction: (kind, id) => api().brewAction(kind, id),
    createDraft: (scope, label) => api().createDraft(scope, label),
    save: (id, patch) => api().save(id, patch),
    remove: (id) => api().remove(id),
    clone: (id) => api().clone(id),
    ops: (id, action) => api().ops(id, action),
    readForm: (id) => api().readForm(id),
    readStatus: (id) => api().readStatus(id),
    readXml: (id) => api().readXml(id),
    saveXml: (id, xml) => api().saveXml(id, xml),
    readLogs: (id, source) => api().readLogs(id, source),
    clearLogs: (id) => api().clearLogs(id),
    validateXml: (xml) => api().validateXml(xml),
    removeInvalid: (path) => api().removeInvalid(path),
    checkMissing: (candidates) => api().checkMissing(candidates)
  }
}
