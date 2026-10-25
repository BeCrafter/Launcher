// 悬浮输入区:引擎 chip(点击跳设置页 AI 面板)/ 未配置引导卡(pulse)/ 内联引用与附件 /
// CodeMirror 自增高输入框 / `/` 技能菜单 / 上下文用量环 / 发送↔停止。
//
// 引用不再单独占一行:文字、@ 引用、附件和技能都是同一个文档流里的 chip,
// 发送时再拆回 text + mentions + attachments + skillIds(顺序按 chip 在正文里的位置)。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { useT } from '../../hooks/useT'
import { useAiStore, isRunningHere } from '../../state/ai-store'
import { useUiStore } from '../../state/ui-store'
import { useSettingsNav } from '../../state/settings-nav-store'
import {
  ATTACHMENT_BINARY,
  ATTACHMENT_IMAGE_READ_FAILED,
  ATTACHMENT_IMAGE_TOO_LARGE,
  ATTACHMENT_TEXT_ENCODING,
  FILE_ACCEPT,
  formatAttachmentBytes,
  isSupportedImageFile,
  isSupportedTextFile,
  makeAttachmentKey,
  readImageAttachment,
  readTextAttachment
} from '../../lib/ai-attachment'
import { fmt } from '../../i18n'
import { showToast } from '../../lib/utils'
import { AiMentionPopover } from './AiMentionPopover'
import { AiSlashPopover } from './AiSlashPopover'
import { AiContextMeter } from './AiContextMeter'
import { AiComposerEditor, type AiComposerEditorApi, type InlineDisplay } from './AiComposerEditor'
import { isSlashCommand } from '../../lib/ai-slash'
import {
  docFromSegments,
  fallbackDoc,
  inlineRefKeys,
  inlineTokenFor,
  isSlashBoundary,
  mentionQueryAt,
  parseInlineItems,
  segmentsFromDoc,
  skillIdsOf,
  slashQueryAt,
  stripInlineTokens,
  type InlineItem,
  type QueryHit
} from '@shared/ai-inline'
import {
  MAX_ATTACHMENTS,
  MAX_IMAGE_ATTACHMENTS,
  MAX_MENTIONS,
  MAX_TEXT_ATTACHMENTS,
  MAX_TEXT_ATTACHMENTS_TOTAL_BYTES,
  type AiAttachment,
  type AiMention
} from '@shared/ai'
import { cutUtf8, utf8Bytes } from '@shared/text'

interface PendingFile {
  kind: 'image' | 'text'
  name: string
}

/** 技能 id 列表是否一致(顺序也算);用于避免每次输入都重设 React 状态 */
/** 输入提示默认收成右上角的键盘图标；悬停或键盘聚焦时展开完整说明。 */
function AiComposerHint(): React.JSX.Element {
  const t = useT()
  const hint = t('ai.welcome.hint')
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = hovered || focused
  return (
    <div className="ai-hint">
      <button
        className="ai-hint-btn"
        type="button"
        aria-label={hint}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          setHovered(false)
          setFocused(false)
          e.currentTarget.blur()
        }}
      >
        <i className="fa-solid fa-keyboard" aria-hidden="true" />
      </button>
      {open && (
        <div className="ai-hint-tip" aria-hidden="true">
          {hint}
        </div>
      )}
    </div>
  )
}

function sameSkillIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export function AiComposer({
  showBot,
  scrollBottom
}: {
  showBot: boolean
  scrollBottom: (force?: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const send = useAiStore((s) => s.send)
  const stop = useAiStore((s) => s.stop)
  const guard = useAiStore((s) => s.guardConfigured)
  const engine = useAiStore((s) => s.engine)
  const skills = useAiStore((s) => s.skills)
  const currentId = useAiStore((s) => s.currentId)
  const runSessionId = useAiStore((s) => s.runSessionId)
  const connectPulse = useAiStore((s) => s.connectPulse)
  const composerDraft = useAiStore((s) => s.composerDraft)
  const clearComposerDraft = useAiStore((s) => s.clearComposerDraft)
  const retracting = useAiStore((s) => s.retractingId !== null)
  const autoApprove = useAiStore((s) =>
    s.sessions.some((x) => x.id === s.currentId && x.autoApprove === true)
  )
  const setAutoApprove = useAiStore((s) => s.setAutoApprove)
  const switchModule = useUiStore((s) => s.switchModule)
  const configured = engine?.configured ?? false
  const running = isRunningHere({ runSessionId, currentId })

  const [doc, setDoc] = useState('')
  const [mentions, setMentions] = useState<AiMention[]>([])
  const [attachments, setAttachments] = useState<AiAttachment[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [attachBusy, setAttachBusy] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [popOpen, setPopOpen] = useState(false)
  const [btnMode, setBtnMode] = useState(false)
  const [mentionHit, setMentionHit] = useState<QueryHit | null>(null)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashHit, setSlashHit] = useState<QueryHit | null>(null)

  const text = useMemo(() => stripInlineTokens(doc), [doc])
  const editorApiRef = useRef<AiComposerEditorApi | null>(null)
  const mentionBtnRef = useRef<HTMLButtonElement | null>(null)
  const composerBoxRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  /** 同步维护数组快照:异步读取/编辑器回调不能依赖 React 状态的闭包 */
  const attachmentsRef = useRef<AiAttachment[]>([])
  const mentionsRef = useRef<AiMention[]>([])
  const pendingRef = useRef<Record<string, PendingFile>>({})
  const selectedSkillRef = useRef<string[]>([])
  const mentionHitRef = useRef<QueryHit | null>(null)
  const slashHitRef = useRef<QueryHit | null>(null)
  const btnModeRef = useRef(false)

  const updateAttachments = useCallback(
    (update: AiAttachment[] | ((prev: AiAttachment[]) => AiAttachment[])): void => {
      const next = typeof update === 'function' ? update(attachmentsRef.current) : update
      attachmentsRef.current = next
      setAttachments(next)
    },
    []
  )
  const updateMentions = useCallback(
    (update: AiMention[] | ((prev: AiMention[]) => AiMention[])): void => {
      const next = typeof update === 'function' ? update(mentionsRef.current) : update
      mentionsRef.current = next
      setMentions(next)
    },
    []
  )

  /** 串行汇总批次:文本读取与图片压缩的完成先后不能改变用户添加顺序 */
  const attachQueueRef = useRef<Promise<void>>(Promise.resolve())
  /** 读取/压缩是异步的;切会话/新对话后旧结果不能再落进当前草稿 */
  const attachEpochRef = useRef(0)
  /** 已消费的撤回草稿;StrictMode 会重放 effect,避免同一份草稿追加两次。 */
  const consumedDraftRef = useRef<number | null>(null)

  /** 附件读取失败 → 可读文案(错误码是 lib 里定义的稳定常量) */
  const attachErrorText = (err: unknown): string => {
    const code = err instanceof Error ? err.message : String(err)
    switch (code) {
      case ATTACHMENT_IMAGE_TOO_LARGE:
        return t('ai.attach.tooLargeImage')
      case ATTACHMENT_TEXT_ENCODING:
        return t('ai.attach.textEncoding')
      case ATTACHMENT_BINARY:
        return t('ai.attach.binary')
      case ATTACHMENT_IMAGE_READ_FAILED:
      default:
        return t('ai.attach.readFailed')
    }
  }

  /** 单条附件按条数/类型/文本总量收敛;超出总量的文本按 UTF-8 边界截断 */
  const fitAttachment = (incoming: AiAttachment): AiAttachment | null => {
    const prev = attachmentsRef.current
    if (prev.some((x) => x.key === incoming.key)) return null
    if (prev.length >= MAX_ATTACHMENTS) return null
    if (incoming.type === 'image') {
      if (prev.filter((x) => x.type === 'image').length >= MAX_IMAGE_ATTACHMENTS) return null
      return incoming
    }
    if (prev.filter((x) => x.type === 'text').length >= MAX_TEXT_ATTACHMENTS) return null
    const used = prev.reduce((n, x) => n + (x.type === 'text' ? utf8Bytes(x.content) : 0), 0)
    const remaining = MAX_TEXT_ATTACHMENTS_TOTAL_BYTES - used
    if (remaining <= 0) return null
    if (utf8Bytes(incoming.content) <= remaining) return incoming
    const cut = cutUtf8(incoming.content, remaining)
    return {
      ...incoming,
      content: cut.text,
      bytes: utf8Bytes(cut.text),
      truncated: true
    }
  }

  const removePending = (key: string): void => {
    if (!(key in pendingRef.current)) return
    const next = { ...pendingRef.current }
    delete next[key]
    pendingRef.current = next
  }

  /**
   * 选择文件 → 立刻在光标处插入「读取中」chip,再串行读取。
   * 先插 chip 的好处:多选时顺序在点击瞬间就固定,不会因为图片压缩慢而排到文本后面。
   */
  const addFiles = (files: File[]): void => {
    if (files.length === 0) return
    const supported = files.filter((f) => isSupportedImageFile(f) || isSupportedTextFile(f))
    if (supported.length < files.length) {
      showToast(fmt(t('ai.attach.unsupported'), { N: String(files.length - supported.length) }), '#eec04d', 'fa-paperclip')
    }
    if (supported.length === 0) return

    const epoch = attachEpochRef.current
    // 切换会话不清输入框(草稿属于 composer 本身,不是某个会话),所以只按 epoch 失效;
    // 新对话会 clearComposer 并推进 epoch,读取结果自然丢弃。
    const stale = (): boolean => epoch !== attachEpochRef.current

    const cur = attachmentsRef.current
    const pending = Object.values(pendingRef.current)
    const imageSlots = Math.max(
      0,
      MAX_IMAGE_ATTACHMENTS -
        cur.filter((a) => a.type === 'image').length -
        pending.filter((p) => p.kind === 'image').length
    )
    const textSlots = Math.max(
      0,
      MAX_TEXT_ATTACHMENTS -
        cur.filter((a) => a.type === 'text').length -
        pending.filter((p) => p.kind === 'text').length
    )
    const totalSlots = Math.max(
      0,
      MAX_ATTACHMENTS - cur.length - pending.length
    )
    const selected: Array<{ file: File; key: string; kind: 'image' | 'text'; name: string }> = []
    let images = 0
    let texts = 0
    for (const file of supported) {
      if (selected.length >= totalSlots) break
      const isImage = isSupportedImageFile(file)
      if (isImage) {
        if (images >= imageSlots) continue
        images += 1
      } else {
        if (texts >= textSlots) continue
        texts += 1
      }
      const kind = isImage ? 'image' : 'text'
      selected.push({
        file,
        kind,
        key: makeAttachmentKey(isImage ? 'img' : 'txt'),
        name: file.name || (isImage ? 'image' : 'file')
      })
    }
    if (selected.length < supported.length) {
      showToast(fmt(t('ai.attach.tooMany'), { N: String(MAX_ATTACHMENTS) }), '#eec04d', 'fa-paperclip')
    }
    if (selected.length === 0) return

    const nextPending = { ...pendingRef.current }
    for (const s of selected) nextPending[s.key] = { kind: s.kind, name: s.name }
    pendingRef.current = nextPending
    setAttachBusy((n) => n + selected.length)
    editorApiRef.current?.insertAtCursor(
      `${selected.map((s) => inlineTokenFor({ kind: 'attachment', key: s.key })).join(' ')} `
    )

    const job = async (): Promise<void> => {
      for (const s of selected) {
        // 用户可能在读取完成前就删掉了这颗 chip
        const stillWanted = (): boolean => !stale() && s.key in pendingRef.current
        try {
          const att = s.kind === 'image'
            ? await readImageAttachment(s.file)
            : await readTextAttachment(s.file)
          if (!stillWanted()) continue
          const stored = fitAttachment({ ...att, key: s.key } as AiAttachment)
          if (!stored) {
            removePending(s.key)
            editorApiRef.current?.removeItems(
              (i) => i.kind === 'attachment' && i.key === s.key
            )
            showToast(fmt(t('ai.attach.tooMany'), { N: String(MAX_ATTACHMENTS) }), '#eec04d', 'fa-paperclip')
            continue
          }
          removePending(s.key)
          updateAttachments((prev) =>
            prev.some((x) => x.key === stored.key) ? prev : [...prev, stored]
          )
          editorApiRef.current?.refresh()
          if (stored.type === 'text' && stored.truncated) {
            showToast(fmt(t('ai.attach.truncated'), { NAME: stored.name }), '#eec04d', 'fa-paperclip')
          }
        } catch (err) {
          if (!stillWanted()) continue
          removePending(s.key)
          editorApiRef.current?.removeItems(
            (i) => i.kind === 'attachment' && i.key === s.key
          )
          showToast(attachErrorText(err), '#f87171', 'fa-paperclip')
        } finally {
          if (!stale()) setAttachBusy((n) => Math.max(0, n - 1))
        }
      }
    }

    attachQueueRef.current = attachQueueRef.current.then(job, job)
  }

  /** 追加引用并把它们插到当前光标(或刚输入的 @ 查询词位置) */
  const addMentions = (ms: AiMention[], consumeQuery: boolean): void => {
    const next = mentionsRef.current.slice()
    const added: AiMention[] = []
    let dropped = 0
    for (const m of ms) {
      if (next.some((x) => x.key === m.key)) continue
      if (next.length >= MAX_MENTIONS) {
        dropped++
        continue
      }
      next.push(m)
      added.push(m)
    }
    if (added.length > 0) {
      updateMentions(next)
      const api = editorApiRef.current
      if (api) {
        const hit = consumeQuery ? mentionHitRef.current : null
        const head = api.getHead()
        const tokens = `${added.map((m) => inlineTokenFor({ kind: 'mention', key: m.key })).join(' ')} `
        if (hit) api.replaceRange(hit.start, head, tokens)
        else api.insertAtCursor(tokens)
      }
    }
    if (dropped > 0) {
      showToast(fmt(t('ai.mention.tooMany'), { N: String(MAX_MENTIONS) }), '#eec04d', 'fa-at')
    }
    setPopOpen(false)
    btnModeRef.current = false
    setBtnMode(false)
    requestAnimationFrame(() => editorApiRef.current?.focus())
  }

  const removeInline = (item: InlineItem): void => {
    const api = editorApiRef.current
    if (!api) return
    if (item.kind === 'skill') {
      api.removeItems((i) => i.kind === 'skill' && i.id === item.id)
      return
    }
    if (item.kind === 'attachment') {
      api.removeItems((i) => i.kind === 'attachment' && i.key === item.key)
      return
    }
    api.removeItems((i) => i.kind === 'mention' && i.key === item.key)
  }

  /** 编辑器文档变化:同步 text、裁剪已经删掉的引用、更新 @ 与 / 的查询词 */
  const syncFromDoc = (nextDoc: string, head: number, docChanged: boolean): void => {
    if (docChanged) {
      setDoc(nextDoc)
      const keys = inlineRefKeys(nextDoc)
      const aKeys = new Set(keys.attachments)
      if (attachmentsRef.current.some((a) => !aKeys.has(a.key))) {
        updateAttachments((prev) => prev.filter((a) => aKeys.has(a.key)))
      }
      if (Object.keys(pendingRef.current).some((key) => !aKeys.has(key))) {
        const nextPending = { ...pendingRef.current }
        for (const key of Object.keys(nextPending)) {
          if (!aKeys.has(key)) delete nextPending[key]
        }
        pendingRef.current = nextPending
      }
      const mKeys = new Set(keys.mentions)
      if (mentionsRef.current.some((m) => !mKeys.has(m.key))) {
        updateMentions((prev) => prev.filter((m) => mKeys.has(m.key)))
      }
      if (!sameSkillIds(keys.skillIds, selectedSkillRef.current)) {
        selectedSkillRef.current = keys.skillIds
        setSelectedSkillIds(keys.skillIds)
      }
    }

    const mh = mentionQueryAt(nextDoc, head)
    const sh = slashQueryAt(nextDoc, head)
    let showMention = mh !== null
    let showSlash = sh !== null
    // 中文之后的 `/` 可能是「上午/下午」这种并列,未必是命令:匹配不到就收起菜单
    if (sh !== null && !isSlashCommand(sh, skills, t)) showSlash = false
    // 两个触发词不可能同时有效;更靠近光标的那个优先
    if (mh && sh) {
      if (sh.start > mh.start) showMention = false
      else showSlash = false
    }
    mentionHitRef.current = showMention ? mh : null
    slashHitRef.current = showSlash ? sh : null
    setMentionHit(mentionHitRef.current)
    setSlashHit(slashHitRef.current)
    if (docChanged && btnModeRef.current) {
      btnModeRef.current = false
      setBtnMode(false)
    }
    setPopOpen(btnModeRef.current ? true : showMention)
    setSlashOpen(showSlash)
  }

  const resolveInline = (item: InlineItem): InlineDisplay | null => {
    if (item.kind === 'skill') {
      const skill = skills.find((s) => s.id === item.id)
      return {
        kind: 'skill',
        label: skill ? t(skill.nameKey) : item.id,
        // 与左下角的 `/` 技能钮共用同一个字形;具体技能看名称
        glyph: '/',
        title: skill ? `${t('ai.skill.badge')} · ${t(skill.nameKey)}` : item.id
      }
    }
    if (item.kind === 'attachment') {
      const pending = pendingRef.current[item.key]
      if (pending) {
        return {
          kind: 'pending',
          label: pending.name,
          loading: true,
          title: t('ai.attach.reading')
        }
      }
      const a = attachmentsRef.current.find((x) => x.key === item.key)
      if (!a) {
        return { kind: 'missing', label: t('ai.attach.invalid'), icon: 'fa-triangle-exclamation' }
      }
      if (a.type === 'image') {
        const usable = !a.trimmed && typeof a.data === 'string' && a.data !== ''
        return {
          kind: 'image',
          label: a.name,
          icon: 'fa-image',
          imageSrc: usable ? `data:${a.mimeType};base64,${a.data}` : undefined,
          meta: usable ? undefined : t('ai.attach.cleanedImage'),
          title: a.name
        }
      }
      return {
        kind: 'file',
        label: a.name,
        // 附件统一用回形针,和工具栏的附件按钮同一个符号
        icon: 'fa-paperclip',
        meta: a.truncated ? t('ai.attach.truncatedTag') : formatAttachmentBytes(a.bytes),
        title: `${a.name} · ${formatAttachmentBytes(a.bytes)}${a.truncated ? ` · ${t('ai.attach.truncatedTip')}` : ''}`
      }
    }
    const m = mentionsRef.current.find((x) => x.key === item.key)
    if (!m) return { kind: 'missing', label: t('ai.mention.added'), icon: 'fa-link' }
    return {
      kind: m.type,
      label: m.quote !== undefined ? `${m.label} · ${t('ai.mention.quote')}` : m.label,
      // 用 @ 统一标识「引用」;具体是笔记/任务/定时任务由名称和颜色区分
      icon: 'fa-at',
      title: m.quote !== undefined ? `${m.label} · ${t('ai.mention.quote')}` : m.label
    }
  }

  const pickSkill = (id: string): void => {
    const api = editorApiRef.current
    if (!api) return
    const hit = slashHitRef.current
    const head = api.getHead()
    if (selectedSkillRef.current.includes(id)) {
      // 再选一次 = 取消这个技能(其它已选技能保持不动)
      if (hit) api.replaceRange(hit.start, head, '')
      api.removeItems((i) => i.kind === 'skill' && i.id === id)
    } else {
      // 插入而不替换:一条消息可以同时启用多个技能
      api.insertSkill(id, hit ? hit.start : head, head)
    }
    setSlashOpen(false)
    setSlashHit(null)
    slashHitRef.current = null
    setPopOpen(false)
    btnModeRef.current = false
    setBtnMode(false)
    requestAnimationFrame(() => editorApiRef.current?.focus())
  }

  const closeSlash = (): void => {
    setSlashOpen(false)
    setSlashHit(null)
    slashHitRef.current = null
  }

  /** 打开文件选择器;从 `/` 菜单进来时先删掉查询词,避免草稿里留下一个 `/` */
  const openFilePicker = (consumeSlashQuery: boolean): void => {
    const api = editorApiRef.current
    const hit = consumeSlashQuery ? slashHitRef.current : null
    if (api && hit) api.replaceRange(hit.start, api.getHead(), '')
    closeSlash()
    setPopOpen(false)
    btnModeRef.current = false
    setBtnMode(false)
    fileRef.current?.click()
  }

  /**
   * 工具栏 `/` 按钮:在光标处插入一个能触发菜单的 `/`,并让编辑器继续持有焦点。
   * 直接开一个空菜单的话,焦点留在按钮上,用户没法打字过滤 —— 按钮只是「键入 /」的快捷方式。
   */
  const openSlashMenu = (): void => {
    if (slashOpen) {
      closeSlash()
      return
    }
    setPopOpen(false)
    btnModeRef.current = false
    setBtnMode(false)
    const api = editorApiRef.current
    if (!api) {
      setSlashOpen(true)
      return
    }
    const currentDoc = api.getDoc()
    const head = api.getHead()
    const prev = head > 0 ? currentDoc[head - 1] : ''
    // 与触发规则同一套边界判断:ASCII 文字后面补一个空格(否则菜单不会开),
    // 中文/全角标点/chip 后面直接写 `/` —— 补空格反而会改变正文
    const prefix = head > 0 && !isSlashBoundary(prev) ? ' /' : '/'
    // 用 replaceRange 而不是 insertAtCursor:后者会替换当前选区,而按钮不该吞掉用户选中的字
    api.replaceRange(head, head, prefix)
  }

  const clearComposer = (): void => {
    attachEpochRef.current += 1
    setDoc('')
    editorApiRef.current?.setDoc('')
    updateAttachments([])
    updateMentions([])
    pendingRef.current = {}
    selectedSkillRef.current = []
    setSelectedSkillIds([])
    setAttachBusy(0)
    setDragOver(false)
    setPopOpen(false)
    btnModeRef.current = false
    setBtnMode(false)
    setMentionHit(null)
    mentionHitRef.current = null
    setSlashOpen(false)
    setSlashHit(null)
    slashHitRef.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  const doSend = (): void => {
    // 撤回还在进行时不要开新 run:main 正在删消息,此时发送会竞争状态。
    if (retracting || attachBusy > 0) return
    if (running) {
      void stop()
      return
    }
    if (!guard()) return
    const api = editorApiRef.current
    const currentDoc = api?.getDoc() ?? doc
    const v = stripInlineTokens(currentDoc)
    const skillIds = inlineRefKeys(currentDoc).skillIds

    const atts: AiAttachment[] = []
    const ms: AiMention[] = []
    let order = 0
    for (const item of parseInlineItems(currentDoc)) {
      if (item.kind === 'attachment') {
        if (atts.some((a) => a.key === item.key)) continue
        const a = attachmentsRef.current.find((x) => x.key === item.key)
        if (a) atts.push({ ...a, order: order++ })
      } else if (item.kind === 'mention') {
        if (ms.some((m) => m.key === item.key)) continue
        const m = mentionsRef.current.find((x) => x.key === item.key)
        if (m) ms.push({ ...m, order: order++ })
      }
    }
    // 允许只发附件,也允许只选技能(技能提示词会先问目标);三者都空才拦
    if (v === '' && atts.length === 0 && skillIds.length === 0) return
    const segments = segmentsFromDoc(currentDoc)
    clearComposer()
    requestAnimationFrame(() => editorApiRef.current?.focus())
    void send(v, {
      ...(ms.length ? { mentions: ms } : {}),
      ...(atts.length ? { attachments: atts } : {}),
      ...(segments.length ? { segments } : {}),
      ...(skillIds.length ? { skillIds } : {})
    })
    scrollBottom(true)
  }

  const handleEnter = (): boolean => {
    // 运行中 Enter 只换行,不误触「停止生成」(停止仍走右侧按钮)。
    if (running) return false
    if (retracting || attachBusy > 0) return false
    // @ 菜单开着时 Enter 先换行并关掉菜单,避免「还没选引用就把消息发出去」
    if (popOpen) return false
    doSend()
    return true
  }

  const handleEscape = (): boolean => {
    if (slashOpen) {
      setSlashOpen(false)
      setSlashHit(null)
      slashHitRef.current = null
      return true
    }
    if (popOpen) {
      setPopOpen(false)
      btnModeRef.current = false
      setBtnMode(false)
      return true
    }
    return false
  }

  /** 粘贴:只有剪贴板里真的带文件时才接管;图片+文字同时存在时手动把文字插回 */
  const onEditorPaste = (e: ClipboardEvent, view: EditorView): boolean => {
    const dt = e.clipboardData
    if (!dt) return false
    const files = [...dt.files].filter((f) => isSupportedImageFile(f) || isSupportedTextFile(f))
    if (files.length === 0) {
      // 部分 Chromium 版本里截图只出现在 items 中,不保证同时出现在 files
      for (const item of dt.items) {
        if (item.kind !== 'file') continue
        const f = item.getAsFile()
        if (f && (isSupportedImageFile(f) || isSupportedTextFile(f))) files.push(f)
      }
    }
    if (files.length === 0) return false
    const pastedText = dt.getData('text/plain')
    e.preventDefault()
    addFiles(files)
    if (pastedText !== '') view.dispatch(view.state.replaceSelection(pastedText))
    return true
  }

  const onModKey = (e: KeyboardEvent): boolean => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      openFilePicker(false)
      return true
    }
    return false
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragOver(false)
    addFiles([...e.dataTransfer.files])
  }

  // 新对话(currentId → null)清空输入与引用(demo aiNewChat;切会话不清)
  //
  // ⚠ 判据必须是**跃迁**(上一个会话 id ≠ 这一个),不能是「currentId === null」:
  //   · 进 AI 页时 composer 是新挂载的,而下面那条「领走待挂引用」会在挂载时把引用填进来;
  //   · StrictMode 下 effect 要跑两遍,按「=== null」判的话第二遍正好把刚填进来的引用抹掉。
  const prevId = useRef(currentId)
  useEffect(() => {
    const was = prevId.current
    prevId.current = currentId
    if (was === currentId || currentId !== null) return
    clearComposer()
    // clearComposer 只由 setters/refs 组成,不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  // 笔记页「在 AI 中引用」附上的引用,在这里领走。
  // 必须声明在**上面那条清空 effect 之后**:两条都在挂载时跑,顺序反了的话
  // 新对话会把刚附上的引用一起清掉(而这条路径恰恰多半发生在欢迎态)。
  useEffect(() => {
    const pending = useAiStore.getState().takePendingMentions()
    if (pending.length === 0) return
    const next = mentionsRef.current.slice()
    const added: AiMention[] = []
    let dropped = 0
    for (const m of pending) {
      if (next.some((x) => x.key === m.key)) continue
      if (next.length >= MAX_MENTIONS) {
        dropped++
        continue
      }
      next.push(m)
      added.push(m)
    }
    if (added.length > 0) updateMentions(next)
    if (dropped > 0) {
      showToast(fmt(t('ai.mention.tooMany'), { N: String(MAX_MENTIONS) }), '#eec04d', 'fa-at')
    }
    if (added.length === 0) return
    requestAnimationFrame(() => {
      const api = editorApiRef.current
      if (!api) return
      api.insertAtCursor(
        `${added.map((m) => inlineTokenFor({ kind: 'mention', key: m.key })).join(' ')} `
      )
      api.focus()
    })
    // 挂载时领一次;takePendingMentions 会清空队列
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 撤回后的原文/引用回到输入框。用户如果已经在写下一段(罕见),追加而不是覆盖,
  // 避免「点撤回反而吞掉我刚打的内容」。
  useEffect(() => {
    if (!composerDraft || composerDraft.sessionId !== currentId) return
    if (consumedDraftRef.current === composerDraft.nonce) return
    consumedDraftRef.current = composerDraft.nonce

    const draftAttachments = composerDraft.attachments.filter((a) => !a.trimmed)
    const draftMentions = composerDraft.mentions
    if (draftAttachments.length > 0) {
      updateAttachments((prev) => {
        const next = prev.slice()
        for (const a of draftAttachments) {
          if (!next.some((x) => x.key === a.key)) next.push(a)
        }
        return next
      })
    }
    if (draftMentions.length > 0) {
      updateMentions((prev) => {
        const next = prev.slice()
        for (const m of draftMentions) {
          if (!next.some((x) => x.key === m.key)) next.push(m)
        }
        return next
      })
    }

    const draftDoc = composerDraft.segments?.length
      ? docFromSegments(composerDraft.segments)
      : fallbackDoc(composerDraft.text, draftAttachments, draftMentions, skillIdsOf(composerDraft))
    const api = editorApiRef.current
    const currentDoc = api?.getDoc() ?? doc
    const nextDoc =
      currentDoc.trim() === ''
        ? draftDoc
        : `${currentDoc.replace(/\s+$/, '')}\n\n${draftDoc}`
    if (api) api.setDoc(nextDoc)
    else setDoc(nextDoc)
    setPopOpen(false)
    btnModeRef.current = false
    setBtnMode(false)
    clearComposerDraft(composerDraft.nonce)
    requestAnimationFrame(() => editorApiRef.current?.focus())
    // doc 只作为 api 不可用时的兜底;草稿消费应由 nonce 驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerDraft, currentId, clearComposerDraft, updateAttachments, updateMentions])

  const goSettings = (): void => {
    // 引擎 chip 是配置的唯一可见面:跳设置页那份配置(独立导航 store;SettingsView 读 tab)
    useSettingsNav.getState().setTab('ai')
    switchModule('settings')
  }

  const sendTitle = running
    ? t('ai.input.stop')
    : configured
      ? t('ai.input.send')
      : t('ai.connect.title')

  return (
    <div className="ai-composer">
      <button
        className={`ai-scroll-bot${showBot ? ' show' : ''}`}
        type="button"
        title={t('ai.scroll.bottom')}
        onClick={() => scrollBottom(true)}
      >
        <i className="fa-solid fa-arrow-down" />
      </button>
      <div className="ai-composer-inner">
        {/* key=脉冲计数:拦截一次重挂一次,CSS 动画(ai-connect-pulse)随之重放(demo 强制重排同效) */}
        <div className="ai-connect-card" key={connectPulse} style={{ display: configured ? 'none' : 'flex' }}>
          <span className="ai-connect-icon">
            <i className="fa-solid fa-key" />
          </span>
          <div className="ai-connect-body">
            <div className="ai-connect-title">{t('ai.connect.title')}</div>
            <div className="ai-connect-desc">{t('ai.connect.desc')}</div>
          </div>
          <button className="d-btn accent" type="button" onClick={goSettings}>
            <span>{t('ai.connect.btn')}</span>
            <i className="fa-solid fa-arrow-right" />
          </button>
        </div>
        <div
          ref={composerBoxRef}
          className={`ai-composer-box${dragOver ? ' drag-over' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            // 移到子元素也会触发 dragleave;只有真正离开盒子才收起高亮
            const next = e.relatedTarget as Node | null
            if (next && e.currentTarget.contains(next)) return
            setDragOver(false)
          }}
          onDrop={onDrop}
        >
          <AiComposerEditor
            value={doc}
            placeholder={t(configured ? 'ai.input.ph' : 'ai.input.phLocked')}
            apiRef={editorApiRef}
            resolve={resolveInline}
            onRemove={removeInline}
            onUpdate={syncFromDoc}
            onEnter={handleEnter}
            onEscape={handleEscape}
            onPaste={onEditorPaste}
            onModKey={onModKey}
            removeLabel={t('ai.attach.remove')}
          />
          <AiComposerHint />
          <div className="ai-composer-toolbar">
            <div className="ai-composer-tools">
              <button
                ref={mentionBtnRef}
                className={`ai-comp-btn${popOpen ? ' active' : ''}`}
                id="aiMentionBtn"
                type="button"
                title={t('ai.input.mention')}
                onClick={() => {
                  if (popOpen) {
                    setPopOpen(false)
                    btnModeRef.current = false
                    setBtnMode(false)
                    return
                  }
                  setSlashOpen(false)
                  setSlashHit(null)
                  slashHitRef.current = null
                  btnModeRef.current = true
                  setBtnMode(true)
                  setPopOpen(true)
                }}
              >
                <i className="fa-solid fa-at" />
              </button>
              <button
                className="ai-comp-btn"
                type="button"
                title={`${t('ai.attach.add')} · ⌘⇧U`}
                onClick={() => openFilePicker(false)}
              >
                <i className="fa-solid fa-paperclip" />
              </button>
              <button
                className={`ai-comp-btn ai-slash-btn${slashOpen ? ' active' : ''}`}
                type="button"
                title={t('ai.input.slash')}
                onClick={openSlashMenu}
              >
                <span className="ai-slash-glyph">/</span>
              </button>
              {attachBusy > 0 && (
                <span className="ai-composer-busy" title={t('ai.attach.reading')}>
                  <i className="fa-solid fa-circle-notch fa-spin" />
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={FILE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])]
                  // 清空 value,同一个文件删掉后还能再次选择
                  e.target.value = ''
                  addFiles(files)
                }}
              />
            </div>
            <div className="ai-composer-right">
              {autoApprove && (
                <span className="ai-composer-chip auto-approve" title={t('ai.appr.sessionOnHint')}>
                  <i className="fa-solid fa-shield-halved" />
                  <span className="ai-auto-label">{t('ai.appr.sessionOn')}</span>
                  <i
                    className="fa-solid fa-xmark"
                    title={t('ai.appr.sessionRevoke')}
                    onClick={() => {
                      const sid = useAiStore.getState().currentId
                      if (sid) void setAutoApprove(sid, false)
                    }}
                  />
                </span>
              )}
              {/* 上下文环在左、模型在右:模型是「当前用哪个」的主语,环只是它的前置读数,
                  按「状态 → 设置」的顺序读起来更顺;交换后也离发送钮更近。 */}
              <AiContextMeter text={text} attachments={attachments} mentions={mentions} />
              <button
                className={`ai-engine-chip${configured ? '' : ' off'}`}
                type="button"
                // 供应商挪进 tooltip:胶囊上只留模型名,但「用的是哪家」随时查得到
                title={
                  configured && engine
                    ? `${engine.providerName} · ${engine.modelLabel}`
                    : t('ai.engine.pickProvider')
                }
                onClick={goSettings}
              >
                <span className="ai-engine-label">
                  {configured && engine ? engine.modelLabel : t('ai.engine.unconfigured')}
                </span>
                <i className="fa-solid fa-sliders ai-engine-cog" />
              </button>
              <button
                className={`ai-send${running ? ' stop' : ''}${!configured && !running ? ' disabled' : ''}`}
                id="aiSendBtn"
                type="button"
                title={sendTitle}
                disabled={retracting || attachBusy > 0}
                onClick={doSend}
              >
                <i className={`fa-solid ${running ? 'fa-stop' : 'fa-arrow-up'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <AiMentionPopover
        open={popOpen && (btnMode || mentionHit !== null)}
        btnMode={btnMode}
        query={btnMode ? '' : (mentionHit?.query ?? '')}
        anchorRef={mentionBtnRef}
        picked={mentions}
        onPick={(m) => addMentions([m], !btnMode)}
        onPickMany={(ms) => addMentions(ms, !btnMode)}
        onClose={() => {
          setPopOpen(false)
          btnModeRef.current = false
          setBtnMode(false)
        }}
      />
      <AiSlashPopover
        open={slashOpen}
        query={slashHit?.query ?? ''}
        anchorRef={composerBoxRef}
        selectedSkillIds={selectedSkillIds}
        onPickSkill={pickSkill}
        onPickFile={() => openFilePicker(true)}
        onClose={closeSlash}
      />
    </div>
  )
}
