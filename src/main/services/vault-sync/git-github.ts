// GitHub:Git Data API。一批文件加删除打成一次提交,快进更新分支,不带 force。
//
// 列树时 truncated 必须报错,不能把没列到的当成已删除。
// base_tree 用树 SHA,不用 commit SHA。

import { gitBlobSha } from './scan'
import { IncompleteListError, type RemoteStore } from './store'
import type { RemoteEntry } from './plan'
import { requestJson, type HttpOptions } from './http'

export interface GitHubConfig {
  /** owner/repo */
  repo: string
  /** 空 = 用仓库默认分支 */
  branch: string
  /** 空 = https://api.github.com */
  apiBaseUrl: string
  token: string
}

interface RefResponse {
  object: { sha: string }
}
interface CommitResponse {
  sha: string
  tree: { sha: string }
}
interface TreeResponse {
  sha: string
  truncated?: boolean
  tree: { path: string; mode: string; type: string; sha: string; size?: number }[]
}
interface RepoResponse {
  default_branch: string
}

/** 主机上限是 100MB,留一点给 base64 膨胀和请求头 */
export const GITHUB_BLOB_LIMIT = 95 * 1024 * 1024

export function createGitHubStore(config: GitHubConfig, http: HttpOptions): RemoteStore {
  const base = (config.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '')
  const repo = config.repo
  const headers = {
    Authorization: `token ${config.token}`,
    Accept: 'application/vnd.github+json'
  }

  async function branch(): Promise<string> {
    if (config.branch !== '') return config.branch
    const info = await requestJson<RepoResponse>(http, `${base}/repos/${repo}`, { headers })
    return info.default_branch
  }

  async function head(): Promise<{ commit: string; tree: string; name: string }> {
    const name = await branch()
    const ref = await requestJson<RefResponse>(http, `${base}/repos/${repo}/git/ref/heads/${name}`, { headers })
    const commit = await requestJson<CommitResponse>(http, `${base}/repos/${repo}/git/commits/${ref.object.sha}`, {
      headers
    })
    return { commit: ref.object.sha, tree: commit.tree.sha, name }
  }

  let current: { commit: string; tree: string; name: string } | null = null
  /** 本轮待提交:path → blob(base64)或 null(删除)。一次 flush 打成一个提交 */
  const pending = new Map<string, { content: string } | null>()

  const store: RemoteStore = {
    targetId: `github|${base}|${repo}|${config.branch || 'default'}`,
    async list() {
      pending.clear()
      current = await head()
      const tree = await requestJson<TreeResponse>(
        http,
        `${base}/repos/${repo}/git/trees/${current.tree}?recursive=1`,
        { headers }
      )
      if (tree.truncated) throw new IncompleteListError('GitHub 目录树被截断,已停止同步')
      const out = new Map<string, RemoteEntry>()
      for (const item of tree.tree) {
        if (item.type !== 'blob') continue
        out.set(item.path, { path: item.path, etag: item.sha, size: item.size ?? 0, hash: item.sha })
      }
      return out
    },
    async read(path) {
      const listed = current ?? (await head())
      const res = await http.fetch(`${base}/repos/${repo}/contents/${encodePath(path)}?ref=${listed.name}`, {
        headers: { ...headers, Accept: 'application/vnd.github.raw' }
      })
      if (!res.ok) throw new Error(`${res.status} 读取 ${path}`)
      return Buffer.from(await res.arrayBuffer())
    },
    async write(path, body) {
      if (body.length > GITHUB_BLOB_LIMIT) throw new Error(`${path} 超过 GitHub 单文件上限`)
      pending.set(path, { content: body.toString('base64') })
      return { etag: gitBlobSha(body) }
    },
    async remove(path) {
      pending.set(path, null)
    },
    async flush() {
      if (pending.size === 0) return
      const items = [...pending.entries()].map(([path, value]) =>
        value === null
          ? { path, mode: '100644', type: 'blob', sha: null }
          : { path, mode: '100644', type: 'blob', content: value.content }
      )
      pending.clear()
      await commit(items, 'vault sync')
    },
    discard() {
      pending.clear()
    },
    cursor: () => current?.commit
  }

  /** 一次提交里可以同时有新增、更新和删除。sha 为 null 表示删除 */
  async function commit(
    items: { path: string; mode: string; type: string; sha?: string | null; content?: string }[],
    message: string
  ): Promise<void> {
    const tip = current ?? (await head())
    const tree = await requestJson<{ sha: string }>(http, `${base}/repos/${repo}/git/trees`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: tip.tree, tree: items })
    })
    if (tree.sha === tip.tree) return
    const made = await requestJson<{ sha: string }>(http, `${base}/repos/${repo}/git/commits`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: tree.sha, parents: [tip.commit] })
    })
    await requestJson(http, `${base}/repos/${repo}/git/refs/heads/${tip.name}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: made.sha })
    })
    current = { commit: made.sha, tree: tree.sha, name: tip.name }
  }

  return store
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
