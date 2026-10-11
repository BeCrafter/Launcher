// 图表插入 / 编辑对话框。
//
// 「配置」全部写回**标准 mermaid 源码**:方向写进 `flowchart LR`,主题写进
// mermaid 自己的 `%%{init}%%` 指令。这样这张图在 Obsidian / GitHub 里长得一模一样 ——
// 把配置塞进 frontmatter 或自定义围栏属性,就等于让它只在 Launcher 里能看。
//
// 「跟随应用」是唯一不写进源码的选项:它意味着**不写**主题指令,
// 由渲染时喂进去的 themeVariables 决定(见 lib/mermaid-render.ts),深浅色自动跟手。

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useSettingsStore } from '../../state/settings-store'
import {
  DIAGRAM_KINDS,
  detectKind,
  readDirection,
  readTheme,
  supportsDirection,
  templateFor,
  writeDirection,
  writeTheme,
  type DiagramDirection,
  type DiagramKind,
  type DiagramTheme
} from '../../lib/diagram'
import { Modal } from '../../components/Modal'
import { MermaidBlock } from './MermaidBlock'

const KIND_ICON: Record<string, string> = {
  flowchart: 'fa-diagram-project',
  mindmap: 'fa-sitemap',
  sequence: 'fa-arrow-right-arrow-left',
  class: 'fa-cubes',
  state: 'fa-circle-nodes',
  er: 'fa-database',
  pie: 'fa-chart-pie',
  gantt: 'fa-bars-progress'
}

const DIRECTIONS: { id: DiagramDirection; icon: string }[] = [
  { id: 'TB', icon: 'fa-arrow-down' },
  { id: 'BT', icon: 'fa-arrow-up' },
  { id: 'LR', icon: 'fa-arrow-right' },
  { id: 'RL', icon: 'fa-arrow-left' }
]

const THEMES: DiagramTheme[] = ['app', 'default', 'neutral', 'dark', 'forest']

/**
 * 快捷片段。写 mermaid 语法是这个对话框最容易卡住人的地方 ——
 * 给几个「点一下就多一个节点/一条线」的按钮,比让人背语法实在。
 * `{N}` 是插入时的游标位置(相对片段开头)。
 */
const SNIPPETS: Record<string, { key: string; text: string; caret?: number }[]> = {
  flowchart: [
    { key: 'notes.diagram.snippet.node', text: '\n  C[新节点]', caret: 5 },
    { key: 'notes.diagram.snippet.edge', text: '\n  A --> C' },
    { key: 'notes.diagram.snippet.branch', text: '\n  B -->|条件| C' }
  ],
  mindmap: [{ key: 'notes.diagram.snippet.branch', text: '\n    新分支' }],
  sequence: [{ key: 'notes.diagram.snippet.message', text: '\n  C->>S: 新消息' }],
  class: [{ key: 'notes.diagram.snippet.node', text: '\n  class 新类 {\n    +String 字段\n  }' }],
  state: [{ key: 'notes.diagram.snippet.node', text: '\n  新状态' }],
  er: [{ key: 'notes.diagram.snippet.edge', text: '\n  A ||--o{ B : 关联' }],
  pie: [{ key: 'notes.diagram.snippet.node', text: '\n  "新项" : 10' }],
  gantt: [{ key: 'notes.diagram.snippet.node', text: '\n  任务 :a3, 2026-01-01, 3d' }]
}

export interface DiagramDialogTarget {
  /** 已有图表 → 编辑它;null → 在光标处新建 */
  code: string | null
  /** 编辑时:围栏在正文里的行区间(含首尾),保存时定点替换 */
  from: number
  to: number
}

export function DiagramDialog({
  target,
  onClose,
  onInsert,
  onUpdate
}: {
  target: DiagramDialogTarget | null
  onClose: () => void
  onInsert: (source: string) => void
  onUpdate: (from: number, to: number, source: string) => void
}): React.JSX.Element | null {
  const t = useT()
  const lang = useSettingsStore((s) => s.settings?.language ?? 'zh-CN')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  const [kind, setKind] = useState<DiagramKind>('flowchart')
  const [direction, setDirection] = useState<DiagramDirection>('LR')
  const [theme, setTheme] = useState<DiagramTheme>('app')
  const [source, setSource] = useState('')

  const open = target !== null
  const editing = target?.code != null

  // 打开时按已有源码回填 —— 每次打开都重新算,不保留上一次的残留
  useEffect(() => {
    if (target === null) return
    const seed = target.code ?? templateFor('flowchart', lang)
    setSource(seed)
    setKind(target.code === null ? 'flowchart' : detectKind(seed))
    setDirection(readDirection(seed) ?? 'LR')
    setTheme(readTheme(seed))
    // 只认 target 的身份:对话框开着的时候用户改语言/源码不该把内容重置回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.code, target?.from, open])

  const snippets = SNIPPETS[kind] ?? []
  const dirSupported = supportsDirection(kind)

  /** 换类型:源码还是「上一个类型的模板」时才替换,用户改过就一个字不动 */
  const changeKind = (next: DiagramKind): void => {
    setKind(next)
    if (source.trim() === '' || detectKind(source) === kind) {
      const fresh = templateFor(next, lang)
      setSource(writeTheme(writeDirection(fresh, direction), theme))
    }
  }

  const changeDirection = (d: DiagramDirection): void => {
    setDirection(d)
    setSource((s) => writeDirection(s, d))
  }

  const changeTheme = (th: DiagramTheme): void => {
    setTheme(th)
    setSource((s) => writeTheme(s, th))
  }

  const resetTemplate = (): void => {
    setSource(writeTheme(writeDirection(templateFor(kind, lang), direction), theme))
  }

  /** 在光标处追加片段 */
  const insertSnippet = (text: string, caret?: number): void => {
    const el = areaRef.current
    const at = el?.selectionStart ?? source.length
    const next = source.slice(0, at) + text + source.slice(at)
    setSource(next)
    const pos = caret === undefined ? at + text.length : at + caret
    requestAnimationFrame(() => {
      const node = areaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(pos, pos)
    })
  }

  const submit = (): void => {
    const body = source.trim()
    if (body === '') return
    if (editing && target !== null) onUpdate(target.from, target.to, body)
    else onInsert(body)
    onClose()
  }

  // 预览的源码跟输入同步,但空源码不渲染(避免 mermaid 对空串报错刷屏)
  const preview = useMemo(() => source.trim(), [source])

  if (!open) return null

  return (
    <Modal id="diagramDialog" open={open} onClose={onClose}>
      <div className="modal-box diagram-box">
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-solid fa-diagram-project" style={{ color: 'var(--accent2)', marginRight: 7 }} />
            <span>{t(editing ? 'notes.diagram.editTitle' : 'notes.diagram.insertTitle')}</span>
          </span>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="diagram-body">
          <div className="diagram-left">
            <div className="diagram-row">
              <span className="diagram-label">{t('notes.diagram.kind')}</span>
              <div className="diagram-kinds">
                {DIAGRAM_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={'diagram-kind' + (k === kind ? ' active' : '')}
                    title={t(`notes.diagram.kind.${k}`)}
                    onClick={() => changeKind(k)}
                  >
                    <i className={`fa-solid ${KIND_ICON[k] ?? 'fa-diagram-project'}`} />
                    <span>{t(`notes.diagram.kind.${k}`)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="diagram-row">
              {dirSupported && (
                <>
                  <span className="diagram-label">{t('notes.diagram.direction')}</span>
                  <div className="diagram-dirs">
                    {DIRECTIONS.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={'diagram-dir' + (d.id === direction ? ' active' : '')}
                        title={t(`notes.diagram.dir.${d.id}`)}
                        onClick={() => changeDirection(d.id)}
                      >
                        <i className={`fa-solid ${d.icon}`} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              <span className="diagram-label">{t('notes.diagram.theme')}</span>
              <select
                className="diagram-theme"
                value={theme}
                onChange={(e) => changeTheme(e.target.value as DiagramTheme)}
              >
                {THEMES.map((th) => (
                  <option key={th} value={th}>
                    {t(`notes.diagram.theme.${th}`)}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              ref={areaRef}
              className="diagram-src"
              value={source}
              spellCheck={false}
              placeholder={t('notes.diagram.sourcePlaceholder')}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => {
                // ⌘↵ 直接提交;Tab 不吞(文本框里 Tab 该换焦点)
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />

            <div className="diagram-snippets">
              {snippets.map((s) => (
                <button key={s.key} type="button" className="diagram-snippet" onClick={() => insertSnippet(s.text, s.caret)}>
                  <i className="fa-solid fa-plus" />
                  <span>{t(s.key)}</span>
                </button>
              ))}
              <span className="diagram-snippets-spacer" />
              <button type="button" className="diagram-snippet" onClick={resetTemplate}>
                <i className="fa-solid fa-rotate-left" />
                <span>{t('notes.diagram.reset')}</span>
              </button>
            </div>
          </div>

          <div className="diagram-right">
            <div className="diagram-preview-hd">{t('notes.diagram.preview')}</div>
            <div className="diagram-preview">
              {preview === '' ? (
                <div className="diagram-preview-empty">{t('notes.diagram.empty')}</div>
              ) : (
                <MermaidBlock code={preview} />
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="d-btn" onClick={onClose}>
            <span>{t('common.cancel')}</span>
          </button>
          <button className="d-btn accent" disabled={preview === ''} onClick={submit}>
            <i className="fa-solid fa-check" /> <span>{t(editing ? 'notes.diagram.update' : 'notes.diagram.insert')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
