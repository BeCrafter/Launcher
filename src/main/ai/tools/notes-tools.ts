// 笔记类工具:检索 / 读取 / 看图 / 写入 / 关联 / 删除
//
// 两条纪律:
//   ① **模型不许自己编持久键**。refs 收的是「松散目标」(label / port / expr),
//      由这里对着实时服务解析成 agentId / hashJobId / serviceIdentityKey。
//      解析不出或有歧义 → 整个调用失败并列出候选,**一个字都不写** —— 悬空关联比失败的调用糟得多。
//   ② 覆盖既有笔记正文前必须先 read_note(拿到当时的内容与 revision)。这不是形式主义:
//      它保证模型是在**看过**现有内容之后才覆盖的,而不是盲写;授权卡上用户看到的也是这个语义。
//      内部仍走 CAS,并发改动照样会被 conflict 挡下。
//
// 注:**@ 引用笔记**(用户显式引用,正文由 note-context.ts 拼进消息)不等于「读过」——
// 引用可能被截断,所以纪律 ② 不因为引用过而放宽。

import { Type } from '@earendil-works/pi-ai'
import type { AgentScope, CronJob } from '../../../shared/models'
import { MAX_ASSET_FOR_AI, type NoteRef } from '../../../shared/notes'
import { serviceIdentityKey } from '../../../shared/service-identity'
import type { AgentService } from '../../services/agent-service'
import type { CrontabService } from '../../services/crontab-service'
import type { NotesService } from '../../services/notes-service'
import type { ProcessDiscovery } from '../../services/process-discovery'
import type { ToolDef, ToolOutputLine } from '../tool-types'
import { cap, line, locateAgent, omittedLine } from './shared'

/** 模型给出的松散关联目标 —— 只有 type 是必填的 */
interface LooseRef {
  type: string
  label?: string
  scope?: string
  id?: string
  expr?: string
  cmd?: string
  desc?: string
  port?: number
  name?: string
}

/** read_note 记下的版本:覆盖既有笔记前必须先读过(见文件头 ②) */
const readRevisions = new Map<string, string>()
const READ_MEMORY_MAX = 500

function rememberRead(sessionId: string, id: string, revision: string): void {
  const key = `${sessionId}\u0000${id}`
  if (readRevisions.size >= READ_MEMORY_MAX && !readRevisions.has(key)) {
    const oldest = readRevisions.keys().next().value
    if (oldest !== undefined) readRevisions.delete(oldest)
  }
  readRevisions.set(key, revision)
}

function recallRead(sessionId: string, id: string): string | undefined {
  return readRevisions.get(`${sessionId}\u0000${id}`)
}

function asLooseRefs(v: unknown): LooseRef[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is LooseRef => typeof x === 'object' && x !== null) as LooseRef[]
}

/** 读图失败的原因要说人话:模型据此换一条路(比如改用 read_note 看文字描述) */
function assetFailReason(r: { reason: string; size?: number }): string {
  if (r.reason === 'not-image') return '这个附件不是图片（视频 / 音频 / PDF / 网页看不了）'
  if (r.reason === 'too-large') {
    return `图片超过 ${MAX_ASSET_FOR_AI / 1024 / 1024} MiB 上限（${Math.round((r.size ?? 0) / 1024)} KiB）`
  }
  if (r.reason === 'io') return '读不到这个文件（可能已被删除或移走）'
  return '路径不在笔记目录的 assets/ 下，或不是支持的图片格式（svg 不支持）'
}

export function createNotesTools(deps: {
  notes: NotesService
  agents: AgentService
  cron: CrontabService
  discovery: ProcessDiscovery
}): ToolDef[] {
  /**
   * 松散目标 → 持久键。解析不出/有歧义时返回错误行(调用方据此中止整次调用)。
   */
  async function resolveRefs(raw: LooseRef[]): Promise<{ refs: NoteRef[]; error: ToolOutputLine[] }> {
    const refs: NoteRef[] = []
    for (const r of raw) {
      const type = String(r.type ?? '').trim()
      if (type === 'agent') {
        const label = String(r.label ?? '').trim()
        if (label === '') {
          return { refs: [], error: [line('err', 'agent 关联必须给出 label')] }
        }
        const scope = ['user', 'system', 'daemon'].includes(String(r.scope))
          ? (r.scope as AgentScope)
          : undefined
        const hit = await locateAgent(deps.agents, label, scope)
        if (hit.kind === 'not-found') return { refs: [], error: [line('err', hit.message)] }
        if (hit.kind === 'ambiguous') {
          const out: ToolOutputLine[] = [
            line('warn', `${label} 在多个作用域下都存在，请用 scope 指明：`)
          ]
          out.push(...hit.hits.map((h) => line('', `  scope=${h.scope}`)))
          return { refs: [], error: out }
        }
        refs.push({
          type: 'agent',
          key: hit.hit.agent.id,
          label: hit.hit.agent.label || (hit.hit.agent.fileName ?? label),
          detail: `scope=${hit.hit.agent.scope}`
        })
        continue
      }

      if (type === 'cron') {
        const { jobs } = await deps.cron.list()
        const id = String(r.id ?? '').trim()
        const expr = String(r.expr ?? '').trim()
        const cmd = String(r.cmd ?? '').trim().toLowerCase()
        const desc = String(r.desc ?? '').trim().toLowerCase()
        if (id === '' && expr === '' && cmd === '' && desc === '') {
          return { refs: [], error: [line('err', 'cron 关联至少要给出 id / expr / cmd / desc 之一')] }
        }
        const hits: CronJob[] = jobs.filter((j) => {
          if (id !== '') return j.id === id
          let ok = true
          if (expr !== '') ok = ok && j.expr === expr
          if (cmd !== '') ok = ok && j.cmd.toLowerCase().includes(cmd)
          if (desc !== '') ok = ok && (j.desc ?? '').toLowerCase().includes(desc)
          return ok
        })
        if (hits.length === 0) return { refs: [], error: [line('err', '没有匹配的定时任务')] }
        if (hits.length > 1) {
          const { shown, omitted } = cap(hits, 10)
          const out: ToolOutputLine[] = [line('warn', `匹配到 ${hits.length} 条定时任务，请用 id 指定：`)]
          out.push(...shown.map((j) => line('', `  id=${j.id} · ${j.desc || j.cmd} · ${j.expr}`)))
          out.push(...omittedLine(omitted))
          return { refs: [], error: out }
        }
        const j = hits[0]
        refs.push({
          type: 'cron',
          key: j.id,
          label: j.desc || j.cmd,
          // detail 是重解析依据:任务 id 是内容哈希,用户改了命令就失配,靠它把关联找回来
          detail: `${j.expr} · ${j.cmd}`
        })
        continue
      }

      if (type === 'service') {
        const port = typeof r.port === 'number' ? r.port : Number.parseInt(String(r.port ?? ''), 10)
        if (!Number.isInteger(port)) {
          return { refs: [], error: [line('err', 'service 关联必须给出 port')] }
        }
        const scan = await deps.discovery.scanOnce()
        const name = String(r.name ?? '').trim().toLowerCase()
        const hits = scan.services.filter(
          (s) => s.port === port && (name === '' || `${s.name} ${s.command} ${s.cmd}`.toLowerCase().includes(name))
        )
        if (hits.length === 0) return { refs: [], error: [line('err', `没有监听 ${port} 端口的服务`)] }
        if (hits.length > 1) {
          const out: ToolOutputLine[] = [line('warn', `${port} 端口上有多个服务，请用 name 指明：`)]
          out.push(...hits.map((s) => line('', `  ${s.name} (${s.command || s.cmd})`)))
          return { refs: [], error: out }
        }
        const s = hits[0]
        refs.push({
          type: 'service',
          key: serviceIdentityKey(s),
          label: s.name,
          detail: `${s.addr === '*' || s.addr === '' ? '127.0.0.1' : s.addr}:${s.port}`
        })
        continue
      }

      return { refs: [], error: [line('err', `未知的关联类型 ${type}（可用：agent / cron / service）`)] }
    }
    return { refs, error: [] }
  }

  function refLine(r: NoteRef): string {
    const kind = r.type === 'agent' ? 'Launch Agent' : r.type === 'cron' ? '定时任务' : r.type === 'service' ? '端口服务' : r.type
    return `${kind} · ${r.label}`
  }

  return [
    {
      name: 'list_notes',
      label: '列出笔记',
      description:
        '列出用户的笔记。可按关键词（含正文）、标签、或关联对象过滤。返回每篇的 id、标题、标签与关联，关联会带上 key 供后续 link_note 复用。',
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: '关键词，匹配标题/标签/关联名/正文' })),
        tag: Type.Optional(Type.String({ description: '按标签过滤' })),
        ref_type: Type.Optional(Type.String({ description: '按关联类型过滤：agent / cron / service' })),
        ref_key: Type.Optional(Type.String({ description: '按关联的持久键过滤（配合 ref_type）' })),
        limit: Type.Optional(Type.Number({ description: '最多返回几篇，默认 20' }))
      }),
      write: false,
      execute: async (args) => {
        const limit = Math.min(Math.max(Number(args['limit'] ?? 20) || 20, 1), 100)
        const query = String(args['query'] ?? '').trim()
        const tag = String(args['tag'] ?? '').trim()
        const refType = String(args['ref_type'] ?? '').trim()
        const refKey = String(args['ref_key'] ?? '').trim()

        const all = (await deps.notes.list()).notes
        let hits = query !== '' ? await deps.notes.search(query, limit * 4) : all
        if (tag !== '') hits = hits.filter((n) => n.tags.includes(tag))
        if (refType !== '' || refKey !== '') {
          hits = hits.filter((n) =>
            n.refs.some((r) => (refType === '' || r.type === refType) && (refKey === '' || r.key === refKey))
          )
        }
        if (hits.length === 0) {
          return { lines: [line('', '没有匹配的笔记')] }
        }
        const { shown, omitted } = cap(hits, limit)
        const out: ToolOutputLine[] = [line('info', `共 ${hits.length} 篇：`)]
        for (const n of shown) {
          const bits = [`id=${n.id}`, n.title]
          if (n.tags.length > 0) bits.push(`标签:${n.tags.join('/')}`)
          bits.push(`更新于 ${n.updated}`)
          out.push(line('', `· ${bits.join(' · ')}`))
          for (const r of n.refs) out.push(line('', `    关联 ${refLine(r)} [${r.type}:${r.key}]`))
        }
        out.push(...omittedLine(omitted))
        return { lines: out }
      }
    },

    {
      name: 'read_note',
      label: '读取笔记',
      description: '按 id 读取一篇笔记的元数据与正文。覆盖写入前必须先调用它。',
      parameters: Type.Object({
        id: Type.String({ description: '笔记 id（文件名去扩展名）' })
      }),
      write: false,
      execute: async (args, ctx) => {
        const id = String(args['id'] ?? '').trim()
        const got = await deps.notes.readBodyForAi(id)
        if (!got) {
          return { lines: [line('err', `找不到笔记 ${id}；可用 list_notes 查看现有笔记`)], isError: true }
        }
        rememberRead(ctx.sessionId, id, got.note.revision)
        const n = got.note
        const out: ToolOutputLine[] = [
          line('info', `${n.title}（id=${n.id}）`),
          line('', `创建 ${n.created} · 更新 ${n.updated}`)
        ]
        if (n.tags.length > 0) out.push(line('', `标签：${n.tags.join('、')}`))
        for (const r of n.refs) out.push(line('', `关联 ${refLine(r)} [${r.type}:${r.key}]`))
        if (n.frontmatterIssues.length > 0) {
          out.push(line('warn', `以下 frontmatter 键形态无法解析，已原样保留：${n.frontmatterIssues.join('、')}`))
        }
        if (n.refsUnparsed) out.push(line('warn', 'refs 段不是本应用认识的形态，已原样保留（未解析）'))
        out.push(line('', '── 正文 ──'))
        out.push(line('', got.body))
        if (got.truncated) out.push(line('warn', `…已截断（正文共 ${n.size} 字节，仅展示前 64 KiB）`))
        return { lines: out }
      }
    },

    {
      name: 'read_note_image',
      label: '查看笔记里的图片',
      description:
        '查看笔记正文里引用的本地图片（截图 / 附件）。path 用正文里写的那个路径，例如 assets/Pasted image 20261009150211.png。' +
        '图片只在本次查看时可见：它不进历史，需要再看就再调一次。',
      parameters: Type.Object({
        note_id: Type.String({ description: '图片所在笔记的 id（用于说明，不影响路径解析）' }),
        path: Type.String({ description: '正文里写的图片路径，如 assets/xxx.png' })
      }),
      write: false,
      execute: async (args) => {
        const noteId = String(args['note_id'] ?? '').trim()
        const rel = String(args['path'] ?? '').trim()
        if (rel === '') return { lines: [line('err', '必须给出图片路径 path')], isError: true }

        const got = await deps.notes.readAssetForAi(rel)
        if (!got.ok) {
          return { lines: [line('err', `无法查看 ${rel}：${assetFailReason(got)}`)], isError: true }
        }
        const where = noteId === '' ? '' : `笔记 ${noteId} 的`
        return {
          lines: [
            line('ok', `已读取${where}图片 ${rel}（${Math.max(1, Math.round(got.bytes / 1024))} KiB，${got.mimeType}）`)
          ],
          images: [{ type: 'image', data: got.data, mimeType: got.mimeType }]
        }
      }
    },

    {
      name: 'write_note',
      label: '写入笔记',
      description:
        '新建笔记，或改写/追加已有笔记的正文。mode=replace 会覆盖既有正文，调用前必须先 read_note。可同时挂上关联（用 label/port/expr 这类松散目标，不要自己编 key）。',
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: '已有笔记的 id；不传则新建' })),
        title: Type.String({ description: '标题（新建时用它生成文件名）' }),
        body: Type.String({ description: '正文（Markdown）' }),
        tags: Type.Optional(Type.Array(Type.String(), { description: '标签' })),
        refs: Type.Optional(
          Type.Array(
            Type.Object({
              type: Type.String({ description: 'agent / cron / service' }),
              label: Type.Optional(Type.String({ description: 'agent 的 Label' })),
              scope: Type.Optional(Type.String({ description: 'agent 作用域：user / system / daemon' })),
              id: Type.Optional(Type.String({ description: 'cron 的任务 id' })),
              expr: Type.Optional(Type.String({ description: 'cron 表达式' })),
              cmd: Type.Optional(Type.String({ description: 'cron 命令（子串）' })),
              desc: Type.Optional(Type.String({ description: 'cron 说明（子串）' })),
              port: Type.Optional(Type.Number({ description: 'service 的端口' })),
              name: Type.Optional(Type.String({ description: 'service 的名称（子串）' }))
            }),
            { description: '要挂上的关联；解析不出会整次失败' }
          )
        ),
        mode: Type.Optional(
          Type.String({ description: 'create / replace / append；给了 id 时默认 replace，否则 create' })
        )
      }),
      write: true,
      summarize: (a) => {
        const id = String(a['id'] ?? '').trim()
        const mode = String(a['mode'] ?? (id === '' ? 'create' : 'replace'))
        const body = String(a['body'] ?? '')
        const what = mode === 'append' ? '追加到' : mode === 'replace' ? '覆盖' : '新建'
        return {
          detail: `${what}笔记「${String(a['title'] ?? '')}」${id === '' ? '（新建文件）' : `（${id}.md）`}，正文 ${body.length} 字`,
          command: `notes/${id === '' ? '(新文件)' : `${id}.md`} ← ${what}`,
          dangerous: mode === 'replace'
        }
      },
      execute: async (args, ctx) => {
        const title = String(args['title'] ?? '').trim()
        const body = String(args['body'] ?? '')
        const tags = Array.isArray(args['tags']) ? (args['tags'] as string[]).map(String) : undefined
        const id = String(args['id'] ?? '').trim()
        const mode = String(args['mode'] ?? (id === '' ? 'create' : 'replace'))

        const resolved = await resolveRefs(asLooseRefs(args['refs']))
        if (resolved.error.length > 0) {
          // 关联解析不了就整次不写:半成品比失败更难收拾
          return { lines: [line('err', '关联解析失败，本次未写入任何内容：'), ...resolved.error], isError: true }
        }

        if (mode === 'create' || id === '') {
          if (title === '') return { lines: [line('err', '新建笔记必须给出 title')], isError: true }
          const note = await deps.notes.create({ title, body, tags, refs: resolved.refs })
          rememberRead(ctx.sessionId, note.id, note.revision)
          return {
            lines: [
              line('ok', `已新建笔记「${note.title}」（${note.id}.md，${body.length} 字）`),
              ...resolved.refs.map((r) => line('', `已关联 ${refLine(r)}`))
            ]
          }
        }

        const known = recallRead(ctx.sessionId, id)
        if (known === undefined) {
          return {
            lines: [line('err', `改写 ${id} 之前请先调用 read_note 读取它的当前内容`)],
            isError: true
          }
        }

        const nextBody =
          mode === 'append'
            ? `${(await deps.notes.readBodyForAi(id))?.body ?? ''}\n\n${body}`
            : body

        const out = await deps.notes.save({
          id,
          body: nextBody,
          expectedRevision: known,
          meta: { title, tags, refs: resolved.refs }
        })
        if (!out.ok) {
          if (out.kind === 'conflict') {
            return {
              lines: [
                line('err', `${id} 在读取之后被改动过，未写入。请重新 read_note 再试。`),
                line('', `磁盘上的标题：${out.latest.title}`)
              ],
              isError: true
            }
          }
          return { lines: [line('err', `写入失败：${out.message}`)], isError: true }
        }
        if (!('note' in out)) return { lines: [line('err', '写入结果异常')], isError: true }
        rememberRead(ctx.sessionId, id, out.note.revision)
        return {
          lines: [
            line('ok', `已${mode === 'append' ? '追加' : '更新'}笔记「${out.note.title}」（${id}.md）`),
            ...resolved.refs.map((r) => line('', `已关联 ${refLine(r)}`))
          ]
        }
      }
    },

    {
      name: 'link_note',
      label: '关联笔记到服务',
      description:
        '给已有笔记增删关联。目标用松散形态给出（agent 的 label、cron 的 expr/cmd、service 的 port），不要自己编持久键。',
      parameters: Type.Object({
        id: Type.String({ description: '笔记 id' }),
        refs: Type.Array(
          Type.Object({
            type: Type.String({ description: 'agent / cron / service' }),
            label: Type.Optional(Type.String()),
            scope: Type.Optional(Type.String()),
            id: Type.Optional(Type.String()),
            expr: Type.Optional(Type.String()),
            cmd: Type.Optional(Type.String()),
            desc: Type.Optional(Type.String()),
            port: Type.Optional(Type.Number()),
            name: Type.Optional(Type.String())
          })
        ),
        remove: Type.Optional(Type.Boolean({ description: 'true = 移除这些关联而不是添加' }))
      }),
      write: true,
      summarize: (a) => {
        const refs = asLooseRefs(a['refs'])
        const remove = a['remove'] === true
        return {
          detail: `${remove ? '移除' : '添加'} ${refs.length} 条关联：${refs.map((r) => `${r.type}/${r.label ?? r.id ?? r.port ?? ''}`).join('、')}`,
          command: `notes/${String(a['id'] ?? '')}.md ← 改写 refs 段`
        }
      },
      execute: async (args, ctx) => {
        const id = String(args['id'] ?? '').trim()
        const remove = args['remove'] === true
        const got = await deps.notes.readBodyForAi(id)
        if (!got) return { lines: [line('err', `找不到笔记 ${id}`)], isError: true }
        if (got.note.refsUnparsed) {
          return {
            lines: [
              line('err', `笔记 ${id} 的 refs 段不是本应用认识的形态，为避免改写用户原文，工具不做修改。`),
              line('', '请在应用内的笔记页用「重写 refs 段」显式确认。')
            ],
            isError: true
          }
        }

        const resolved = await resolveRefs(asLooseRefs(args['refs']))
        if (resolved.error.length > 0) {
          return { lines: [line('err', '关联解析失败，本次未写入：'), ...resolved.error], isError: true }
        }

        const next = remove
          ? got.note.refs.filter((r) => !resolved.refs.some((n) => n.type === r.type && n.key === r.key))
          : [
              ...got.note.refs,
              ...resolved.refs.filter(
                (n) => !got.note.refs.some((r) => r.type === n.type && r.key === n.key)
              )
            ]

        const out = await deps.notes.save({
          id,
          body: got.body,
          expectedRevision: got.note.revision,
          meta: { refs: next }
        })
        if (!out.ok) {
          if (out.kind === 'conflict') {
            return { lines: [line('err', `${id} 刚被改动过，未写入。请重新读取再试。`)], isError: true }
          }
          return { lines: [line('err', `写入失败：${out.message}`)], isError: true }
        }
        if (!('note' in out)) return { lines: [line('err', '写入结果异常')], isError: true }
        rememberRead(ctx.sessionId, id, out.note.revision)
        return {
          lines: [
            line('ok', `已${remove ? '移除' : '添加'} ${resolved.refs.length} 条关联（${id}.md）`),
            ...out.note.refs.map((r) => line('', `当前关联 ${refLine(r)}`))
          ]
        }
      }
    },

    {
      name: 'delete_note',
      label: '删除笔记',
      description: '删除一篇笔记（进系统废纸篓，可恢复）。',
      parameters: Type.Object({
        id: Type.String({ description: '笔记 id' })
      }),
      write: true,
      summarize: (a) => ({
        detail: `删除笔记 ${String(a['id'] ?? '')}`,
        command: `notes/${String(a['id'] ?? '')}.md → 废纸篓`,
        dangerous: true
      }),
      execute: async (args, ctx) => {
        const id = String(args['id'] ?? '').trim()
        const got = await deps.notes.readBodyForAi(id)
        if (!got) return { lines: [line('err', `找不到笔记 ${id}`)], isError: true }
        const out = await deps.notes.remove({ id, expectedRevision: got.note.revision })
        if (!out.ok) {
          if (out.kind === 'conflict') {
            return { lines: [line('err', `${id} 刚被改动过，未删除。请重新读取再试。`)], isError: true }
          }
          return { lines: [line('err', `删除失败：${out.message}`)], isError: true }
        }
        readRevisions.delete(`${ctx.sessionId}\u0000${id}`)
        return { lines: [line('ok', `已删除笔记「${got.note.title}」（${id}.md，正文 ${got.body.length} 字）`)] }
      }
    }
  ]
}
