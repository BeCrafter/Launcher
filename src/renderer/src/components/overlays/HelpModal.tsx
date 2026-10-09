// 内嵌帮助浮层:把仓库里的 docs/help.md / docs/install.md 经 Vite `?raw` **内联进产物**。
//
// 为什么不是外链:此前是 `openExternal(blob/main/Help.md)` —— 断网、GitHub 不可达、
// 或仓库还没推上去时,用户点「帮助」什么都看不到。内联后离线可读。
// 内容与 GitHub 上的是**同一份文件**(构建期内联,不是拷贝),不会分叉。
//
// 版式:左栏固定目录(不随正文滚动)+ 右栏正文。目录由 `##` 标题自动生成,
// 滚动时高亮当前章节。文档自带的那份「## 目录」在应用内剥掉(左栏已替代它),
// GitHub 上仍保留 —— 只在这里剥,不改文件。
//
// 语言跟随 `settings.language`:切换设置后浮层内容即时切换,无需重开。

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import guideZh from '@root/docs/help.md?raw'
import guideEn from '@root/docs/help.en.md?raw'
import installZh from '@root/docs/install.md?raw'
import installEn from '@root/docs/install.en.md?raw'
import type { Language } from '@shared/settings'
import { useT } from '../../hooks/useT'
import { Modal } from '../Modal'
import { extractHeadings, renderMarkdown } from '../../lib/markdown'
import { useUiStore } from '../../state/ui-store'
import { useSettingsStore } from '../../state/settings-store'

type HelpDoc = 'guide' | 'install'

const DOCS: Record<Language, Record<HelpDoc, string>> = {
  'zh-CN': { guide: guideZh, install: installZh },
  'en-US': { guide: guideEn, install: installEn }
}

const TABS: { id: HelpDoc; key: string }[] = [
  { id: 'guide', key: 'help.tab.guide' },
  { id: 'install', key: 'help.tab.install' }
]

/** 正文里那份「## 目录 / ## Contents」章节 —— 应用内有固定左栏了,重复 */
function stripInlineToc(md: string): string {
  return md.replace(/^## (?:目录|Contents)\n[\s\S]*?(?=^---$)/m, '')
}

/** 高亮判定:标题顶边进到内容区顶部这个距离以内,就算「当前章节」 */
const ACTIVE_OFFSET = 56

export function HelpModal(): React.JSX.Element | null {
  const t = useT()
  const open = useUiStore((s) => s.overlays.includes('helpModal'))
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const language = useSettingsStore((s) => s.settings?.language ?? 'zh-CN')
  const [doc, setDoc] = useState<HelpDoc>('guide')
  const [activeId, setActiveId] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)

  const src = useMemo(
    () => stripInlineToc((DOCS[language] ?? DOCS['zh-CN'])[doc]),
    [language, doc]
  )
  const headings = useMemo(() => extractHeadings(src), [src])

  // 每次打开、或切换文档/语言后:正文回到顶部,高亮复位到首章
  useEffect(() => {
    if (!open) return
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' })
    setActiveId(headings[0]?.id ?? '')
  }, [open, headings])

  if (!open) return null

  // ⚠️ 不要用 CSS.escape:它把 `12-还没解决` 转义成 `\31 2-还没解决`(CSS 标识符不能以数字开头),
  // 而属性值选择器 `[id="..."]` 的引号内**不需要也不接受**这种转义 → 永远匹配不到。
  // 标题 id 由 slugify 产出(只含字母/数字/中文/连字符/下划线),直接插值即可。
  const elById = (id: string): Element | null =>
    contentRef.current?.querySelector(`[id="${id}"]`) ?? null

  const goto = (id: string): void => {
    const c = contentRef.current
    const el = elById(id)
    if (!c || !el) return
    // 用**绝对位置**算目标:两个 rect 同步变化,差值 + scrollTop 恒等于元素相对内容原点的偏移,
    // 与当前动画状态无关(`scrollTop += delta` 在滚动中途会算错)。
    //
    // ⚠️ 必须 `behavior: 'instant'`:实测本环境(Electron 44)里程序化**平滑**滚动完全不动 ——
    // `scrollTo({behavior:'smooth'})` 等 4s 仍停在原地(覆盖 CSS 的 scroll-behavior 也一样),
    // 而 `scrollTop =` 赋值在 CSS smooth 下是异步的、会被下一次点击打断。
    // 瞬时跳转是这里唯一可靠的方式(目录导航要的是「准」,不是动画)。
    c.scrollTo({
      top: el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 12,
      behavior: 'instant'
    })
    setActiveId(id)
  }

  // 滚动时算当前章节:标题顶边越过内容区顶部(留一点余量)的最后一个
  const onScroll = (): void => {
    const c = contentRef.current
    if (!c) return
    const cTop = c.getBoundingClientRect().top
    let cur = headings[0]?.id ?? ''
    for (const h of headings) {
      const el = elById(h.id)
      if (!el) continue
      if (el.getBoundingClientRect().top - cTop <= ACTIVE_OFFSET) cur = h.id
      else break
    }
    setActiveId(cur)
  }

  // 正文里的锚点链接(如 `§10`)由渲染器负责滚动 —— 但那是**程序化滚动**,
  // 本环境不派发 scroll 事件,onScroll 不会跑,左栏高亮就会停在原地。
  // 这里补一次:点击后直接把高亮设到目标章节(滚动本身仍归渲染器)。
  const onContentClick = (e: MouseEvent): void => {
    const href = (e.target as HTMLElement).closest('a.md-anchor')?.getAttribute('href') ?? ''
    if (href.startsWith('#')) setActiveId(href.slice(1))
  }

  return (
    <Modal id="helpModal" open={open} onClose={() => closeOverlay('helpModal')}>
      <div className="modal-box help-box">
        <div className="help-hd">
          <i className="fa-regular fa-circle-question" />
          <span className="help-hd-title">{t('nav.help')}</span>
          <div className="help-tabs">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={'help-tab' + (doc === tb.id ? ' active' : '')}
                onClick={() => setDoc(tb.id)}
              >
                {t(tb.key)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="help-close"
            title={t('common.close')}
            onClick={() => closeOverlay('helpModal')}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="help-body">
          <nav className="help-toc" aria-label={t('help.toc')}>
            {headings.map((h) => (
              <button
                key={h.id}
                type="button"
                className={'help-toc-item' + (h.id === activeId ? ' active' : '')}
                onClick={() => goto(h.id)}
              >
                {h.text}
              </button>
            ))}
          </nav>
          {/* key 带语言与文档:切换时重建正文,避免旧内容的锚点 id 残留 */}
          <div
            className="help-content"
            ref={contentRef}
            onScroll={onScroll}
            onClick={onContentClick}
            key={`${language}-${doc}`}
          >
            {renderMarkdown(src, 'help', { anchors: true })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
