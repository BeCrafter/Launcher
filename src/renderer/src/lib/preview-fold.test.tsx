import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderMarkdown } from './markdown'
import { buildPreviewOutline } from './preview-outline'
import {
  applyPreviewFoldDom,
  directHeadingElements,
  findDirectHeading,
  FOLD_BUTTON_CLASS,
  FOLD_HIDDEN_CLASS
} from './preview-fold'

const SOURCE = [
  '# 甲',
  '',
  '甲正文。',
  '',
  '## 乙',
  '',
  '乙正文。',
  '',
  '## 丙',
  '',
  '丙正文。'
].join('\n')

function setup(): HTMLElement {
  document.body.innerHTML = `
    <div class="notes-preview-body">
      <div class="md-h md-h1" role="heading" aria-level="1" data-line="0">甲</div>
      <p class="md-p" data-line="2">甲正文。</p>
      <div class="md-h md-h2" role="heading" aria-level="2" data-line="4">乙</div>
      <p class="md-p" data-line="6">乙正文。</p>
      <div class="md-h md-h2" role="heading" aria-level="2" data-line="8">丙</div>
      <p class="md-p" data-line="10">丙正文。</p>
    </div>`
  return document.querySelector('.notes-preview-body') as HTMLElement
}

const LABELS = { fold: '折叠本节', unfold: '展开本节' }

function apply(
  body: HTMLElement,
  folded: string[],
  onToggle: (key: string) => void = vi.fn(),
  source: string = SOURCE
): (key: string) => void {
  const outline = buildPreviewOutline(source)
  applyPreviewFoldDom(body, outline.headings, new Set(folded), LABELS, onToggle)
  return onToggle
}

function hiddenTexts(body: HTMLElement): string[] {
  return [...body.querySelectorAll(`.${FOLD_HIDDEN_CLASS}`)].map((el) => el.textContent ?? '')
}

describe('applyPreviewFoldDom', () => {
  it('折叠标题后藏起后续兄弟,到下一个同级标题为止', () => {
    const body = setup()
    apply(body, ['乙'])
    expect(hiddenTexts(body)).toEqual(['乙正文。'])
    expect(body.querySelector('[data-line="8"]')?.classList.contains(FOLD_HIDDEN_CLASS)).toBe(false)
  })

  it('折叠父节会连同子标题一起藏起;展开父节后子节自己的折叠仍在', () => {
    const body = setup()
    apply(body, ['甲', '乙'])
    expect(hiddenTexts(body)).toEqual(['甲正文。', '乙H2', '乙正文。', '丙H2', '丙正文。'])

    apply(body, ['乙'])
    expect(hiddenTexts(body)).toEqual(['乙正文。'])
  })

  it('每个标题一枚层级标;能折的同时带箭头,重复重放不会叠加', () => {
    const body = setup()
    apply(body, [])
    apply(body, [])
    expect(body.querySelectorAll(`.${FOLD_BUTTON_CLASS}`)).toHaveLength(3)
    expect(directHeadingElements(body)).toHaveLength(3)
    const first = body.querySelector('[data-line="0"]') as HTMLElement
    expect(first.querySelector('.md-h-level')?.textContent).toBe('H1')
    expect(first.querySelector('.fa-chevron-right')).not.toBeNull()
  })

  it('正文被整段换掉后再重放,旧按钮上的监听不会被带回来', () => {
    const body = setup()
    const first = vi.fn()
    apply(body, [], first)
    // React 重渲染会换掉整段子节点,注入的按钮一起消失。
    body.innerHTML = body.innerHTML
      .replaceAll('class="md-h-fold-btn"', 'class="stale"')
    const second = vi.fn()
    apply(body, [], second)
    const button = body.querySelector('[data-line="0"] > .md-h-fold-btn') as HTMLButtonElement
    button.click()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('重复重放复用同一枚按钮,点击只回调一次', () => {
    const body = setup()
    const onToggle = vi.fn()
    apply(body, [], onToggle)
    const before = body.querySelector('[data-line="0"] > .md-h-fold-btn')
    apply(body, ['甲'], onToggle)
    const after = body.querySelector('[data-line="0"] > .md-h-fold-btn') as HTMLButtonElement
    expect(after).toBe(before)
    expect(after.getAttribute('aria-expanded')).toBe('false')
    after.click()
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('甲')
  })

  it('没有正文可折的标题只有层级标,点击不回调', () => {
    // 丙后面紧接同级标题:丙没有可折的正文。正文直接写出来,避免拼接时多出一个空行。
    const source = [
      '# 甲',
      '',
      '甲正文。',
      '',
      '## 乙',
      '',
      '乙正文。',
      '',
      '## 丙',
      '## 丁'
    ].join('\n')
    const body = document.createElement('div')
    body.className = 'notes-preview-body'
    body.innerHTML = renderToStaticMarkup(
      <>{renderMarkdown(source, 't', { extended: true, lineAnchors: true })}</>
    )
    const onToggle = apply(body, [], vi.fn(), source)
    const heading = body.querySelector('.md-h[data-line="8"]') as HTMLElement
    const button = heading.querySelector(`:scope > .${FOLD_BUTTON_CLASS}`) as HTMLButtonElement
    expect(button.classList.contains('md-h-level-only')).toBe(true)
    expect(button.querySelector('.md-h-level')?.textContent).toBe('H2')
    expect(button.querySelector('.fa-chevron-right')).toBeNull()
    button.click()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('箭头状态与点击回调跟着折叠集合走', () => {
    const body = setup()
    const onToggle = apply(body, ['甲'])
    const heading = body.querySelector('[data-line="0"]') as HTMLElement
    const button = heading.querySelector(`:scope > .${FOLD_BUTTON_CLASS}`) as HTMLButtonElement
    expect(heading.dataset.folded).toBe('true')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.title).toBe(LABELS.unfold)
    button.click()
    expect(onToggle).toHaveBeenCalledWith('甲')
  })

  it('展开后清掉所有隐藏标记', () => {
    const body = setup()
    apply(body, ['甲'])
    apply(body, [])
    expect(hiddenTexts(body)).toEqual([])
    expect(body.querySelectorAll('[data-md-folded-by]')).toHaveLength(0)
  })

  it('只把正文层的标题当节,引用里的标题不参与', () => {
    const body = setup()
    body.insertAdjacentHTML(
      'beforeend',
      '<blockquote class="md-quote"><div class="md-h md-h2" aria-level="2" data-line="99">引用里</div></blockquote>'
    )
    expect(findDirectHeading(body, 99)).toBeNull()
    expect(directHeadingElements(body)).toHaveLength(3)
    apply(body, [])
    expect(body.querySelectorAll(`.${FOLD_BUTTON_CLASS}`)).toHaveLength(3)
  })
})
