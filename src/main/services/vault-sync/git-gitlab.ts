// GitLab:一次 Commits API 提交,actions 含 create / update / delete,每批最多 100。

import { gitBlobSha } from './scan'
import { IncompleteListError, type RemoteStore } from './store'
import type { RemoteEntry } from './plan'
import { requestJson, type HttpOptions } from './http'

export interface GitLabConfig {
  /** namespace/project */
  repo: string
  branch: string
  /** 空 = https://gitlab.com/api/v4 */
  apiBaseUrl: string
  token: string
}

interface TreeItem {
  path: string
  type: 'blob' | 'tree'
  id: string
}

const BATCH = 100

export function createGitLabStore(config: GitLabConfig, http: HttpOptions): RemoteStore {
  const base = (config.apiBaseUrl || 'https://gitlab.com/api/v4').replace(/\/$/, '')
  const project = encodeURIComponent(config.repo)
  const headers = { 'PRIVATE-TOKEN': config.token }
  const branch = config.branch || 'main'
  const pending: { action: 'create' | 'update' | 'delete'; file_path: string; content?: string; encoding?: 'base64' }[] =
    []
  const known = new Set<string>()

  return {
    targetId: `gitlab|${base}|${config.repo}|${branch}`,
    async list() {
      pending.length = 0
      const out = new Map<string, RemoteEntry>()
      known.clear()
      let page = 1
      for (;;) {
        const items = await requestJson<TreeItem[]>(
          http,
          `${base}/projects/${project}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(branch)}`,
          { headers }
        )
        if (!Array.isArray(items)) throw new IncompleteListError('GitLab 目录响应不是列表')
        for (const item of items) {
          if (item.type !== 'blob') continue
          known.add(item.path)
          out.set(item.path, { path: item.path, etag: item.id, size: 0, hash: item.id })
        }
        if (items.length < 100) break
        page += 1
        if (page > 1000) throw new IncompleteListError('GitLab 目录分页没有结束')
      }
      return out
    },
    async read(path) {
      const res = await http.fetch(
        `${base}/projects/${project}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`,
        { headers }
      )
      if (!res.ok) throw new Error(`${res.status} 读取 ${path}`)
      return Buffer.from(await res.arrayBuffer())
    },
    async write(path, body) {
      pending.push({
        action: known.has(path) ? 'update' : 'create',
        file_path: path,
        content: body.toString('base64'),
        encoding: 'base64'
      })
      known.add(path)
      return { etag: gitBlobSha(body) }
    },
    async remove(path) {
      pending.push({ action: 'delete', file_path: path })
      known.delete(path)
    },
    async flush() {
      while (pending.length > 0) {
        const actions = pending.splice(0, BATCH)
        await requestJson(http, `${base}/projects/${project}/repository/commits`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch, commit_message: 'vault sync', actions })
        })
      }
    },
    discard() {
      pending.length = 0
    }
  }
}
