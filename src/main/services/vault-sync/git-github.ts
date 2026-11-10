// GitHub:Git Data API。一批文件加删除打成一次提交,快进更新分支,不带 force。
//
// 列树时 truncated 必须报错,不能把没列到的当成已删除。
// base_tree 用树 SHA,不用 commit SHA。

import { gitBlobSha } from './scan'
import { IncompleteListError, type RemoteStore } from './store'
import type { RemoteEntry } from './plan'
import { HttpError, requestJson, type HttpOptions } from './http'

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
/** 空仓库还不能用 Git Data API。Contents API 能落下第一次提交,但单文件不超过 1MB */
const GITHUB_CONTENTS_LIMIT = 1024 * 1024

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

  async function head(): Promise<{ commit: string; tree: string; name: string } | null> {
    const name = await branch()
    let ref: RefResponse
    try {
      ref = await requestJson<RefResponse>(http, `${base}/repos/${repo}/git/ref/heads/${name}`, { headers })
    } catch (err) {
      // 空仓库还没有这个分支。GitHub 对空仓库返回 409，分支不存在返回 404。
      // 列目录当成空的，第一次提交再创建它
      if (err instanceof HttpError && (err.status === 404 || err.status === 409)) return null
      throw err
    }
    const commit = await requestJson<CommitResponse>(http, `${base}/repos/${repo}/git/commits/${ref.object.sha}`, {
      headers
    })
    return { commit: ref.object.sha, tree: commit.tree.sha, name }
  }

  let current: { commit: string; tree: string; name: string } | null = null
  /** 本轮待提交:path → blob(base64)或 null(删除)。一次 flush 打成一个提交 */
  const pending = new Map<string, { content: string; bytes: number } | null>()

  const store: RemoteStore = {
    targetId: `github|${base}|${repo}|${config.branch || 'default'}`,
    async list() {
      pending.clear()
      current = await head()
      if (current === null) return new Map()
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
      // 每次都重新取 HEAD。别的客户端提交之后，缓存的树里没有新文件
      const listed = await head()
      current = listed
      if (listed === null) throw new Error(`读取 ${path} 失败: 远端还没有提交`)
      const tree = await requestJson<TreeResponse>(
        http,
        `${base}/repos/${repo}/git/trees/${listed.tree}?recursive=1`,
        { headers }
      )
      const item = tree.tree.find((entry) => entry.path === path && entry.type === 'blob')
      if (item === undefined) throw new Error(`404 读取 ${path}`)
      // Contents API 的 raw 会按文本转码，二进制会变。blob 接口给的是原始字节
      const blob = await requestJson<{ content: string; encoding: string }>(
        http,
        `${base}/repos/${repo}/git/blobs/${item.sha}`,
        { headers }
      )
      if (blob.encoding !== 'base64') throw new Error(`读取 ${path} 失败: 未知编码 ${blob.encoding}`)
      return Buffer.from(blob.content.replace(/\n/g, ''), 'base64')
    },
    async write(path, body) {
      if (body.length > GITHUB_BLOB_LIMIT) throw new Error(`${path} 超过 GitHub 单文件上限`)
      pending.set(path, { content: body.toString('base64'), bytes: body.length })
      return { etag: gitBlobSha(body) }
    },
    async remove(path) {
      pending.set(path, null)
    },
    async flush() {
      if (pending.size === 0) return
      if (current === null) current = await head()
      // 空仓库的 blob 接口直接 409。先用 Contents API 落下一个小文件，后面的提交才能用 Git Data API
      if (current === null) await seedEmptyRepo()
      if (pending.size === 0) return
      // 删到只剩一个文件时，Git Data API 拒绝空树。Contents API 可以删掉最后一个文件
      if (await deleteLastFile()) return
      // tree 的 content 是原文，不是 base64。二进制必须先上传 blob，再按 SHA 引用。
      // 删除项是 sha:null，并且也要带 mode 和 type，否则 GitHub 返回 422
      const items: { path: string; mode: string; type: string; sha: string | null }[] = []
      for (const [path, value] of pending) {
        if (value === null) {
          items.push({ path, mode: '100644', type: 'blob', sha: null })
          continue
        }
        const blob = await requestJson<{ sha: string }>(http, `${base}/repos/${repo}/git/blobs`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: value.content, encoding: 'base64' })
        })
        items.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
      }
      pending.clear()
      await commit(items, 'vault sync')
    },
    discard() {
      pending.clear()
    },
    cursor: () => current?.commit
  }

  /**
   * Git Data API 不能提交空树。仓库里只剩这一个文件、并且本轮只是删它时，
   * 用 Contents API 把它删掉。还有别的文件，或者同时还要写文件，就走普通提交。
   */
  async function deleteLastFile(): Promise<boolean> {
    if (current === null) return false
    const deletions = [...pending.entries()].filter((entry) => entry[1] === null)
    if (deletions.length !== 1 || pending.size !== 1) return false
    const tree = await requestJson<TreeResponse>(http, `${base}/repos/${repo}/git/trees/${current.tree}?recursive=1`, {
      headers
    })
    const blobs = tree.tree.filter((entry) => entry.type === 'blob')
    const [path] = deletions[0]
    const target = blobs.find((entry) => entry.path === path)
    if (blobs.length !== 1 || target === undefined) return false
    const file = await requestJson<{ sha: string }>(http, `${base}/repos/${repo}/contents/${encodePath(path)}`, {
      headers: { ...headers, Accept: 'application/vnd.github+json' }
    })
    await requestJson(http, `${base}/repos/${repo}/contents/${encodePath(path)}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'vault sync', sha: file.sha, branch: current.name })
    })
    pending.clear()
    current = await head()
    return true
  }

  /** 空仓库不能创建 blob。挑一个不超过 Contents API 上限的文件，先把它提交上去 */
  async function seedEmptyRepo(): Promise<void> {
    const candidates = [...pending.entries()].filter(
      (entry): entry is [string, { content: string; bytes: number }] =>
        entry[1] !== null && entry[1].bytes <= GITHUB_CONTENTS_LIMIT
    )
    candidates.sort((a, b) => a[1].bytes - b[1].bytes)
    const first = candidates[0]
    if (first === undefined) throw new Error('空仓库无法开始同步: 需要至少一个不超过 1MB 的文件')
    const [path, value] = first
    const name = await branch()
    await requestJson(http, `${base}/repos/${repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'vault sync', content: value.content, branch: name })
    })
    pending.delete(path)
    current = await head()
    if (current === null) throw new Error('空仓库的第一次提交没有生效')
  }

  /** 一次提交里可以同时有新增、更新和删除。sha 为 null 表示删除 */
  async function commit(
    items: { path: string; mode: string; type: string; sha: string | null }[],
    message: string
  ): Promise<void> {
    const tip = current ?? (await head())
    const tree = await requestJson<{ sha: string }>(http, `${base}/repos/${repo}/git/trees`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(tip === null ? { tree: items } : { base_tree: tip.tree, tree: items })
    })
    if (tip !== null && tree.sha === tip.tree) return
    const made = await requestJson<{ sha: string }>(http, `${base}/repos/${repo}/git/commits`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: tip === null ? [] : [tip.commit]
      })
    })
    const name = tip?.name ?? (await branch())
    if (tip === null) {
      await requestJson(http, `${base}/repos/${repo}/git/refs`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${name}`, sha: made.sha })
      })
    } else {
      await requestJson(http, `${base}/repos/${repo}/git/refs/heads/${name}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: made.sha })
      })
    }
    current = { commit: made.sha, tree: tree.sha, name }
  }

  return store
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
