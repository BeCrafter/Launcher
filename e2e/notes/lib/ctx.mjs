// 用例上下文:把「页面里怎么点、怎么量」收在这里,用例只写人话。
//
// 选择器都按**结构**取,不按中文文案取:
//   · 菜单项用 `:scope > .notes-block-menu-item` 的固定顺序（插入/分隔线/复制/移动到…/复制文本/删除/图表/嵌入）;
//   · 视图模式用 `.notes-mode-btn` 的固定顺序（分栏/编辑/预览）;
//   · 语言切换不应该让用例失败,只有断言正文内容时才用固定的 E2E 文案。

import { sleep } from './cdp.mjs'
import { readNoteBody } from './app.mjs'

const VIEW = `document.querySelector('.notes-editor-pane .cm-content')?.cmTile?.root?.view ?? null`
const EDITOR_LINE = (text) =>
  `[...document.querySelectorAll('.notes-editor-pane .cm-line')].find((el) => el.textContent === ${JSON.stringify(
    text
  )})`

const MODES = ['split', 'edit', 'preview']

export class NoteE2EContext {
  constructor({ cdp, profileDir, noteFile, noteTitle, logs }) {
    this.cdp = cdp
    this.profileDir = profileDir
    this.noteFile = noteFile
    this.noteTitle = noteTitle
    /** 应用进程日志(main 的 console.log 会进这里);用于断言打开文件的 IPC 落点 */
    this.logs = logs ?? []
  }

  // ── 启动 / 导航 ──

  async boot() {
    await this.cdp.waitFor(`document.readyState === 'complete'`, { timeout: 20_000 })
    await this.cdp.waitFor(
      `[...document.querySelectorAll('.nav-item')].some((el) => el.textContent?.includes('随心手记'))`,
      { timeout: 20_000, message: '导航栏出现「随心手记」' }
    )
    await this.cdp.eval(
      `[...document.querySelectorAll('.nav-item')].find((el) => el.textContent?.includes('随心手记'))?.click()`
    )
    await this.cdp.waitFor(`document.querySelector('.notes-rail') !== null`, {
      timeout: 10_000,
      message: '笔记列表出现'
    })
    await this.cdp.waitFor(
      `[...document.querySelectorAll('.notes-row-main')].some((el) => el.textContent?.includes(${JSON.stringify(
        this.noteTitle
      )}))`,
      { timeout: 15_000, message: `笔记「${this.noteTitle}」出现在列表里` }
    )
    await this.cdp.eval(
      `[...document.querySelectorAll('.notes-row-main')].find((el) => el.textContent?.includes(${JSON.stringify(
        this.noteTitle
      )}))?.click()`
    )
    await this.cdp.waitFor(`document.querySelector('.notes-editor-pane .cm-editor') !== null`, {
      timeout: 10_000,
      message: '编辑器挂载'
    })
    await sleep(250)
  }

  // ── 文档读写 ──

  async body() {
    const value = await this.cdp.eval(`(() => { const v = ${VIEW}; return v === null ? null : v.state.doc.toString() })()`)
    if (value === null) throw new Error('编辑器尚未挂载,拿不到正文')
    return value
  }

  async currentTitle() {
    return this.cdp.eval(`document.querySelector('.notes-title')?.value ?? null`)
  }

  /** 用例可能跳到别的笔记（点 wikilink / 新建笔记），下一条用例前必须回到主笔记。 */
  async ensureMainNote() {
    const title = await this.currentTitle()
    if (title === this.noteTitle) return
    await this.cdp.eval(
      `[...document.querySelectorAll('.notes-row-main')].find((el) => el.textContent?.includes(${JSON.stringify(
        this.noteTitle
      )}))?.click()`
    )
    await this.cdp.waitFor(
      `document.querySelector('.notes-title')?.value === ${JSON.stringify(this.noteTitle)}`,
      { timeout: 10_000, message: `回到笔记「${this.noteTitle}」` }
    )
    await this.cdp.waitFor(`document.querySelector('.notes-editor-pane .cm-editor') !== null`, {
      timeout: 10_000,
      message: '主笔记编辑器挂载'
    })
    await sleep(200)
  }

  /** 标签筛选 / 关联筛选 / 搜索都会改变列表内容,下一条用例前清掉。 */
  async clearRailFilters() {
    await this.cdp.eval(
      `[...document.querySelectorAll('.notes-rail-chip button')].forEach((el) => el.click())`
    )
    if (await this.cdp.eval(`document.querySelector('.notes-rail-clear') !== null`)) {
      await this.cdp.eval(`document.querySelector('.notes-rail-clear')?.click()`)
    }
    await sleep(150)
  }

  async lines() {
    return (await this.body()).split('\n')
  }

  async lineIndex(text, occurrence = 0) {
    const lines = await this.lines()
    let seen = 0
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index] === text) {
        if (seen === occurrence) return index
        seen += 1
      }
    }
    return -1
  }

  async offsetOfLine(index) {
    const lines = await this.lines()
    if (index < 0 || index >= lines.length) throw new Error(`行号越界:${index}`)
    let offset = 0
    for (let i = 0; i < index; i += 1) offset += lines[i].length + 1
    return offset
  }

  /** 整篇替换。用例之间的隔离全靠它 —— 不重开笔记、不重启应用。 */
  async reset(body) {
    await this.dismissOverlays()
    await this.clearRailFilters()
    await this.ensureMainNote()
    await this.setMode('split')
    const text = body.endsWith('\n') ? body : `${body}\n`
    await this.cdp.eval(`(() => {
      const v = ${VIEW}
      if (v === null) return false
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text)} },
        selection: { anchor: 0 }
      })
      v.scrollDOM.scrollTop = 0
      v.focus()
      return true
    })()`)
    await this.waitForNode(async () => (await this.body()) === text, '正文重置成功')
    // 预览折叠状态只随「换笔记」归零,整篇替换正文不会清:上一条用例折起的节会带进来,
    // 下一条再点同一个箭头就变成「展开」而不是「折叠」。
    // 先等预览重渲染完这一篇 —— 否则点击会落在旧正文的按钮上,等新按钮出现时
    // 那次点击的状态更新才到,把新正文的第一节又折起来。
    // 源文第一行带着 # ,预览里渲染掉了,要比渲染后的文字。
    const firstLine = (text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '')
      .replace(/^#{1,10}\s+/, '')
    await this.cdp.waitFor(
      `document.querySelector('.notes-preview-body')?.textContent?.includes(${JSON.stringify(
        firstLine
      )}) === true`,
      { message: '预览已换成重置后的正文' }
    )
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remaining = await this.cdp.eval(`(() => {
        const folded = [...document.querySelectorAll('.notes-preview-body > .md-h[data-folded="true"]')]
        for (const el of folded) el.querySelector(':scope > .md-h-fold-btn')?.click()
        return folded.length
      })()`)
      if (remaining === 0) break
      await sleep(120)
    }
    // 预览滚动容器跨用例存在:不归零的话上一条用例滚到哪儿,这一条就从哪儿开始,
    // 大纲的「当前节」和解出来的滚动位置都会跟着串味。
    await this.cdp.eval(`(() => {
      const pv = document.querySelector('.notes-preview')
      if (pv === null) return false
      pv.scrollTop = 0
      pv.dispatchEvent(new Event('scroll'))
      return true
    })()`)
    // 等这次重置落盘再开跑:否则上一条用例的保存 / 文件监听回调会闯进下一条用例的拖拽,
    // 偶发地把刚提交的移动又刷回旧正文。
    await this.waitSaved()
    await sleep(120)
  }

  async focus() {
    await this.cdp.eval(`(() => { const v = ${VIEW}; if (v === null) return false; v.focus(); return true })()`)
  }

  async setCursor(text, column = 0, occurrence = 0) {
    const index = await this.lineIndex(text, occurrence)
    if (index < 0) throw new Error(`找不到行:${text}`)
    const offset = await this.offsetOfLine(index)
    const pos = offset + column
    await this.cdp.eval(`(() => { const v = ${VIEW}; if (v === null) return false;
      v.dispatch({ selection: { anchor: ${pos} }, scrollIntoView: true }); v.focus(); return true })()`)
    await sleep(80)
  }

  async selectRange(text, startColumn, endColumn, occurrence = 0) {
    const index = await this.lineIndex(text, occurrence)
    if (index < 0) throw new Error(`找不到行:${text}`)
    const offset = await this.offsetOfLine(index)
    await this.cdp.eval(`(() => { const v = ${VIEW}; if (v === null) return false;
      v.dispatch({
        selection: { anchor: ${offset + startColumn}, head: ${offset + endColumn} },
        scrollIntoView: true
      }); v.focus(); return true })()`)
    await sleep(120)
  }

  async selectWholeLine(text, occurrence = 0) {
    const index = await this.lineIndex(text, occurrence)
    if (index < 0) throw new Error(`找不到行:${text}`)
    const lines = await this.lines()
    await this.selectRange(text, 0, lines[index].length, occurrence)
  }

  /** 从一行行首选到另一行行尾（含中间所有行）。 */
  async selectLines(startText, endText) {
    const startIndex = await this.lineIndex(startText)
    const endIndex = await this.lineIndex(endText)
    if (startIndex < 0 || endIndex < 0) throw new Error(`找不到行:${startText} / ${endText}`)
    const lines = await this.lines()
    const from = await this.offsetOfLine(startIndex)
    const to = (await this.offsetOfLine(endIndex)) + lines[endIndex].length
    await this.cdp.eval(`(() => { const v = ${VIEW}; if (v === null) return false;
      v.dispatch({ selection: { anchor: ${from}, head: ${to} }, scrollIntoView: true });
      v.focus(); return true })()`)
    await sleep(120)
  }

  // ── 视图模式 ──

  async setMode(mode) {
    const index = MODES.indexOf(mode)
    if (index < 0) throw new Error(`未知视图模式:${mode}`)
    await this.cdp.eval(`document.querySelectorAll('.notes-mode-btn')[${index}]?.click()`)
    await this.cdp.waitFor(
      `document.querySelectorAll('.notes-mode-btn')[${index}]?.getAttribute('aria-pressed') === 'true'`,
      { message: `视图模式切换为 ${mode}` }
    )
    await sleep(100)
  }

  // ── 几何 / 指针 ──

  async scrollTop() {
    return this.cdp.eval(`document.querySelector('.notes-editor-pane .cm-scroller')?.scrollTop ?? 0`)
  }

  async setScrollTop(value) {
    await this.cdp.eval(
      `(() => { const el = document.querySelector('.notes-editor-pane .cm-scroller'); if (el) el.scrollTop = ${value}; })()`
    )
    await sleep(120)
  }

  async wheel(deltaY) {
    const rect = await this.cdp.json(
      `(() => { const el = document.querySelector('.notes-editor-pane .cm-scroller'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
    )
    await this.cdp.wheel(rect.x, rect.y, deltaY)
    await sleep(150)
  }

  /** 行元素的屏幕矩形;不在视口里就先滚到它。 */
  async lineRect(text, occurrence = 0) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rect = await this.cdp.json(
        `(() => { const el = ${EDITOR_LINE(text)}; if (el === null) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
      )
      if (rect !== null) return rect
      await this.setCursor(text, 0, occurrence)
      await sleep(150)
    }
    throw new Error(`编辑器里找不到可见行:${text}`)
  }

  async hoverLine(text, occurrence = 0) {
    const rect = await this.lineRect(text, occurrence)
    await this.cdp.mouse('mouseMoved', rect.x + Math.min(100, Math.max(16, rect.width / 2)), rect.y + rect.height / 2)
    await sleep(250)
  }

  async pillRect() {
    return this.cdp.json(
      `(() => { const el = document.querySelector('.notes-editor-pane .cm-block-pill'); if (el === null) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()`
    )
  }

  async waitPill() {
    await this.cdp.waitFor(
      `(() => { const el = document.querySelector('.notes-editor-pane .cm-block-pill');
        if (el === null) return false; const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 })()`,
      { message: '块手柄出现' }
    )
    return this.pillRect()
  }

  /** 在块手柄上按下再松开（不移动）→ 打开块菜单。 */
  async clickPill(text) {
    await this.hoverLine(text)
    const pill = await this.waitPill()
    await this.cdp.click(pill.x + pill.width / 2, pill.y + pill.height / 2)
    await sleep(150)
  }

  async openBlockMenu(text) {
    await this.clickPill(text)
    await this.cdp.waitFor(`document.querySelector('.notes-block-menu') !== null`, {
      message: '块菜单打开'
    })
    return this.blockMenuItems()
  }

  async blockMenuItems() {
    return this.cdp.json(
      `[...document.querySelectorAll('.notes-block-menu > .notes-block-menu-item')].map((el, index) => ({
        index, text: el.textContent?.trim() ?? '', danger: el.classList.contains('danger')
      }))`
    )
  }

  async clickBlockMenuItem(index) {
    await this.cdp.eval(
      `document.querySelectorAll('.notes-block-menu > .notes-block-menu-item')[${index}]?.click()`
    )
    await sleep(250)
  }

  async openMovePicker(text) {
    await this.openBlockMenu(text)
    // 固定顺序:插入到下方 / 分隔线 / 复制区块 / 移动到… / 复制 / 删除 / 图表 / 嵌入
    await this.clickBlockMenuItem(3)
    await this.cdp.waitFor(`document.querySelector('.notes-move-picker') !== null`, {
      message: '「移动到…」面板打开'
    })
    await sleep(120)
  }

  async movePickerRows() {
    return this.cdp.json(
      `[...document.querySelectorAll('.notes-move-row')].map((el) => el.textContent?.trim() ?? '')`
    )
  }

  async pickerSearch(text) {
    await this.cdp.eval(
      `(() => { const el = document.querySelector('.notes-move-picker input'); if (el === null) return false; el.focus(); return true })()`
    )
    await this.pressLetter('a', 4)
    await this.press('Backspace')
    await this.cdp.type(text)
    await sleep(200)
  }

  // ── 拖拽 ──

  /**
   * 开始拖拽并停住,返回手柄中心。需要自定义移动（贴边自动滚动 / 滚轮重算）的用例用它。
   * 用完记得 releaseDrag() 或 cancelDrag()。
   */
  async beginDrag(source) {
    await this.setCursor(source, 0)
    await this.hoverLine(source)
    const pill = await this.waitPill()
    const x = pill.x + pill.width / 2
    const y = pill.y + pill.height / 2
    await this.cdp.mouse('mousePressed', x, y, { buttons: 1 })
    await sleep(60)
    await this.cdp.mouse('mouseMoved', x + 10, y + 10, { buttons: 1 })
    await this.cdp.waitFor(`document.body.classList.contains('cm-block-dragging')`, {
      message: '进入拖拽状态'
    })
    await sleep(80)
    return { x, y }
  }

  async releaseDrag(x, y) {
    await this.cdp.mouse('mouseReleased', x, y, { buttons: 0 })
    await this.waitForNode(
      async () => (await this.cdp.eval(`document.body.classList.contains('cm-block-dragging')`)) === false,
      '拖拽结束'
    )
    await sleep(300)
  }

  /**
   * 从 `source` 的块手柄拖到 `target` 行。edge 决定落点线在目标行的上方/下方/中间。
   * 返回拖拽过程中看到的标签、落点线与大纲状态,供用例断言「所见即所得」。
   */
  async dragBlock(source, target, { edge = 'before', release = true, steps = 4 } = {}) {
    const targetRect = await this.lineRect(target)
    await this.setCursor(source, 0)
    await this.hoverLine(source)
    const pill = await this.waitPill()
    await this.cdp.mouse('mousePressed', pill.x + pill.width / 2, pill.y + pill.height / 2, {
      buttons: 1
    })
    await sleep(60)
    await this.cdp.mouse('mouseMoved', pill.x + pill.width / 2 + 10, pill.y + pill.height / 2 + 10, {
      buttons: 1
    })
    await this.cdp.waitFor(`document.body.classList.contains('cm-block-dragging')`, {
      message: '进入拖拽状态'
    })
    const y =
      edge === 'before'
        ? targetRect.y + 2
        : edge === 'after'
          ? targetRect.y + targetRect.height + 2
          : targetRect.y + targetRect.height / 2
    const x = Math.max(24, Math.min(targetRect.x + 80, targetRect.x + targetRect.width - 8))
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      await this.cdp.mouse(
        'mouseMoved',
        pill.x + pill.width / 2 + (x - pill.x - pill.width / 2) * t,
        pill.y + pill.height / 2 + (y - pill.y - pill.height / 2) * t,
        { buttons: 1 }
      )
      await sleep(40)
    }
    // 落点标签/线由鼠标移动后的 React 提交渲染 —— 机器忙时可能晚于固定等待。
    // 轮询到任一指示可见再取快照(上限 1s):断言不放松,只是不再赌某个固定毫秒数足够。
    // 不抛错:有个别拖拽场景本来就不该出现落点,调用方会自行断言缺席。
    const indicatorDeadline = Date.now() + 1000
    while (Date.now() < indicatorDeadline) {
      const visible = await this.cdp.eval(`(() => {
        const line = document.querySelector('.cm-block-drop-line')
        const label = document.querySelector('.cm-block-drop-label')
        return (line !== null && line.hidden === false) || (label !== null && label.hidden === false)
      })()`)
      if (visible === true) break
      await sleep(30)
    }
    const snapshot = await this.dragSnapshot()
    if (release) {
      await this.cdp.mouse('mouseReleased', x, y, { buttons: 0 })
      await this.waitForNode(async () => {
        return (await this.cdp.eval(`document.body.classList.contains('cm-block-dragging')`)) === false
      }, '拖拽结束')
      await sleep(300)
    }
    return snapshot
  }

  async dragSnapshot() {
    return this.cdp.json(`(() => {
      const label = document.querySelector('.cm-block-drop-label')
      const line = document.querySelector('.cm-block-drop-line')
      const active = document.querySelector('.cm-block-outline-entry.is-active')
      const labelRect = label !== null && label.hidden === false ? label.getBoundingClientRect() : null
      const lineRect = line !== null && line.hidden === false ? line.getBoundingClientRect() : null
      return {
        label: label !== null && label.hidden === false ? label.textContent : null,
        labelRect: labelRect === null ? null : { x: labelRect.x, y: labelRect.y },
        dropLine: lineRect === null ? null : { x: lineRect.x, y: lineRect.y, width: lineRect.width },
        activeOutline: active === null ? null : active.textContent?.trim() ?? '',
        outlineCount: document.querySelectorAll('.cm-block-outline-entry').length,
        sourceBlockId: document.querySelector('.notes-editor-pane .cm-block-pill')?.dataset.blockId ?? null
      }
    })()`)
  }

  async cancelDrag() {
    await this.cdp.key('Escape', 'Escape', 27)
    await this.waitForNode(
      async () => (await this.cdp.eval(`document.body.classList.contains('cm-block-dragging')`)) === false,
      'Escape 取消拖拽'
    )
    // Escape 只取消了应用侧的拖拽;在 CDP 里鼠标按键仍是按下状态。
    // 不补这一下 pointerup,后续 mousemove 会一直被当成拖拽态输入,
    // 下一条用例就再也悬停不到块手柄上了。
    await this.cdp.mouse('mouseReleased', 8, 8, { buttons: 0 })
    await sleep(150)
  }

  async outlineEntries() {
    return this.cdp.json(
      `[...document.querySelectorAll('.cm-block-outline-entry')].map((el) => el.textContent?.trim() ?? '')`
    )
  }

  async outlineRect(text) {
    return this.cdp.json(`(() => {
      const rows = [...document.querySelectorAll('.cm-block-outline-entry')]
      const el = ${JSON.stringify(text)} === '@start'
        ? rows.find((row) => row.classList.contains('is-edge'))
        : ${JSON.stringify(text)} === '@end'
          ? [...rows].reverse().find((row) => row.classList.contains('is-edge'))
          : rows.find((row) => (row.textContent ?? '').includes(${JSON.stringify(text)}))
      if (el === undefined) return null
      el.scrollIntoView({ block: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
  }

  /**
   * 拖到右侧大纲的某一项上。返回 {
   *   active: 高亮项文本, label: 目标标签, scrollTop: 跳转后的滚动位置,
   *   outlineRect: 面板矩形
   * }。不释放时由调用方继续操作（移出面板 / 松手）。
   */
  async dragToOutline(source, entryText, { release = false, leaveBeforeRelease = false } = {}) {
    await this.setCursor(source, 0)
    await this.hoverLine(source)
    const pill = await this.waitPill()
    await this.cdp.mouse('mousePressed', pill.x + pill.width / 2, pill.y + pill.height / 2, {
      buttons: 1
    })
    await sleep(60)
    await this.cdp.mouse('mouseMoved', pill.x + pill.width / 2 + 10, pill.y + pill.height / 2 + 10, {
      buttons: 1
    })
    await this.cdp.waitFor(`document.querySelector('.cm-block-outline') !== null`, {
      message: '长文档拖拽出现右侧大纲'
    })
    const entry = await this.outlineRect(entryText)
    if (entry === null) throw new Error(`大纲里找不到:${entryText}`)
    const outline = await this.cdp.json(`(() => { const el = document.querySelector('.cm-block-outline');
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
    const x = entry.x + Math.min(40, entry.width / 2)
    const y = entry.y + entry.height / 2
    await this.cdp.mouse('mouseMoved', x, y, { buttons: 1 })
    await sleep(350)
    const snapshot = await this.dragSnapshot()
    snapshot.scrollTop = await this.scrollTop()
    snapshot.outlineRect = outline
    if (leaveBeforeRelease) {
      const target = await this.lineRect(source)
      await this.cdp.mouse('mouseMoved', target.x + 40, target.y + target.height / 2, { buttons: 1 })
      await sleep(300)
      snapshot.afterLeave = await this.dragSnapshot()
    }
    if (release) {
      const releaseX = leaveBeforeRelease ? 0 : x
      const releaseY = leaveBeforeRelease ? 0 : y
      await this.cdp.mouse('mouseReleased', releaseX, releaseY, { buttons: 0 })
      await this.waitForNode(
        async () => (await this.cdp.eval(`document.body.classList.contains('cm-block-dragging')`)) === false,
        '拖拽结束'
      )
      await sleep(300)
    }
    return snapshot
  }

  // ── OS 文件拖入 ──

  /**
   * 让 CDP 把真实本地文件填进一个隐藏 input。页面里的 File 因此带本地路径,
   * preload 的 webUtils.getPathForFile 才拿得到 —— 纯 JS new File() 没有路径。
   * 随后把这些 File 原样搬进一个 DataTransfer,供 dragenter / dragover / drop 反复使用。
   */
  async prepareFileDrag(paths) {
    await this.cdp.send('DOM.enable')
    const objectId = await this.cdp.evalHandle(`(() => {
      let input = document.getElementById('launcher-e2e-files')
      if (input === null) {
        input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.id = 'launcher-e2e-files'
        input.style.position = 'fixed'
        input.style.left = '-1000px'
        input.style.opacity = '0'
        document.body.appendChild(input)
      }
      return input
    })()`)
    try {
      await this.cdp.send('DOM.setFileInputFiles', { files: paths, objectId })
    } finally {
      await this.cdp.send('Runtime.releaseObject', { objectId }).catch(() => {})
    }
    const count = await this.cdp.eval(`(() => {
      const input = document.getElementById('launcher-e2e-files')
      const dt = new DataTransfer()
      for (const file of input.files) dt.items.add(file)
      window.__e2eFileTransfer = dt
      return dt.files.length
    })()`)
    if (count !== paths.length) {
      throw new Error(`准备文件拖拽失败:期望 ${paths.length} 个,实际 ${count} 个`)
    }
  }

  /** 用同一份 DataTransfer 在目标元素上派发一次拖拽事件。 */
  async dispatchFileDrag(selector, type) {
    const found = await this.cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (el === null) return false
      const dt = window.__e2eFileTransfer
      if (!(dt instanceof DataTransfer)) return false
      el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, {
        bubbles: true, cancelable: true, dataTransfer: dt
      }))
      return true
    })()`)
    if (found !== true) throw new Error(`派发 ${type} 失败:找不到 ${selector}`)
    await sleep(30)
  }

  /**
   * 模拟从系统拖入本地文件/目录。hold=true 时只停在 dragover,
   * 用来检查目标高亮与提示;之后用 finishFileDrop() 松手。
   */
  async dropFiles(selector, paths, { hold = false } = {}) {
    await this.prepareFileDrag(paths)
    await this.dispatchFileDrag(selector, 'dragenter')
    await this.dispatchFileDrag(selector, 'dragover')
    if (!hold) await this.finishFileDrop(selector)
  }

  async finishFileDrop(selector) {
    await this.dispatchFileDrag(selector, 'drop')
    await sleep(80)
  }

  // ── 元素 / 双击 ──

  async elementRect(selector) {
    const rect = await this.cdp.json(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (el === null) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
    if (rect === null) throw new Error(`找不到元素:${selector}`)
    return rect
  }

  async doubleClick(selector) {
    const rect = await this.elementRect(selector)
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    await this.cdp.mouse('mousePressed', x, y, { buttons: 1, clickCount: 1 })
    await this.cdp.mouse('mouseReleased', x, y, { buttons: 0, clickCount: 1 })
    await this.cdp.mouse('mousePressed', x, y, { buttons: 1, clickCount: 2 })
    await this.cdp.mouse('mouseReleased', x, y, { buttons: 0, clickCount: 2 })
    await sleep(150)
  }

  /** 轮询应用日志里的某一行（main 的 console.log 会进 app.logs）。 */
  async waitForLog(needle, message, { timeout = 8000 } = {}) {
    await this.waitForNode(
      async () => this.logs.some((line) => line.includes(needle)),
      message,
      { timeout }
    )
  }

  // ── 键盘 ──

  async press(name, modifiers = 0) {
    const defs = {
      ArrowUp: ['ArrowUp', 'ArrowUp', 38],
      ArrowDown: ['ArrowDown', 'ArrowDown', 40],
      ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
      ArrowRight: ['ArrowRight', 'ArrowRight', 39],
      Enter: ['Enter', 'Enter', 13],
      Escape: ['Escape', 'Escape', 27],
      Home: ['Home', 'Home', 36],
      End: ['End', 'End', 35],
      Tab: ['Tab', 'Tab', 9],
      Backspace: ['Backspace', 'Backspace', 8],
      Delete: ['Delete', 'Delete', 46]
    }
    const def = defs[name]
    if (def === undefined) throw new Error(`未登记按键:${name}`)
    await this.cdp.key(def[0], def[1], def[2], modifiers)
    await sleep(80)
  }

  async pressLetter(letter, modifiers = 0) {
    const upper = letter.toUpperCase()
    await this.cdp.key(letter, `Key${upper}`, upper.charCodeAt(0), modifiers)
    await sleep(80)
  }

  async typeText(text) {
    for (const char of text) {
      await this.cdp.type(char)
      await sleep(30)
    }
    await sleep(120)
  }

  // ── 保存 / 等待 / 覆盖层 ──

  async waitSaved(timeout = 8000) {
    await this.cdp.waitFor(
      `(() => { const el = document.querySelector('.notes-save-state');
        return el !== null && !el.classList.contains('dirty') && !el.classList.contains('saving') })()`,
      { timeout, message: '自动保存完成' }
    )
  }

  async savedBody() {
    return readNoteBody(this.profileDir, this.noteFile)
  }

  async dismissOverlays() {
    await this.cdp.key('Escape', 'Escape', 27)
    await sleep(60)
    // Escape 会让 CodeMirror 进入 2 秒「Tab 交给浏览器」的无障碍模式(焦点会跑到工具栏)。
    // 用例紧接着按 Tab 时会被这个模式吞掉,所以关完覆盖层立刻退出该模式。
    // 只恢复输入状态,不改正文。
    await this.cdp.eval(`(() => { const v = ${VIEW}; v?.setTabFocusMode?.(false); return true })()`)
    await this.cdp.eval(`document.body.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: 2, clientY: 2, button: 0 }))`)
    await this.cdp.eval(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
    await sleep(120)
    await this.cdp.waitFor(
      `document.querySelector('.notes-block-menu') === null &&
       document.querySelector('.notes-move-picker') === null &&
       document.querySelector('.notes-find') === null &&
       document.querySelector('.cm-block-outline') === null`,
      { timeout: 3000, message: '覆盖层已关闭' }
    )
    // 目录树的新建/改名输入框不认 body 上的指针事件,只认自己的 Escape。
    // 上一条用例超时停在半开的输入框时,这里不收的话,下一条用例的点击会把它提交掉。
    // 不在输入框上点击:那一下会把编辑器焦点移走,后面的块手柄就不再出现。
    if ((await this.cdp.eval(`document.querySelector('.notes-create-fields, .notes-folder-input') !== null`)) === true) {
      await this.cdp.eval(`document.querySelector('.notes-create-name, .notes-folder-input')?.focus()`)
      await this.cdp.key('Escape', 'Escape', 27)
      await this.cdp.waitFor(
        `document.querySelector('.notes-create-fields, .notes-folder-input') === null`,
        { timeout: 3000, message: '目录树的新建/改名输入框已关闭' }
      )
    }
  }

  /** Node 侧的轮询等待（用于跨多次 CDP 调用才能判断的条件）。 */
  async waitForNode(predicate, message, { timeout = 8000, interval = 60 } = {}) {
    const started = Date.now()
    let lastError = null
    while (Date.now() - started < timeout) {
      try {
        if ((await predicate()) === true) return
      } catch (error) {
        lastError = error
      }
      await sleep(interval)
    }
    const suffix = lastError === null ? '' : `（最后一次错误：${lastError.message}）`
    throw new Error(`等待超时：${message}${suffix}`)
  }

  // ── 选区浮条 ──

  async bubbleVisible() {
    return this.cdp.eval(
      `(() => { const el = document.querySelector('.cm-selection-bubble');
        return el !== null && !el.classList.contains('cm-selection-bubble-hidden') })()`
    )
  }

  async waitBubble() {
    await this.cdp.waitFor(
      `(() => { const el = document.querySelector('.cm-selection-bubble');
        return el !== null && !el.classList.contains('cm-selection-bubble-hidden') })()`,
      { message: '选区浮条出现' }
    )
    return this.bubbleActions()
  }

  async bubbleActions() {
    return this.cdp.json(
      `[...document.querySelectorAll('.cm-selection-bubble .cm-bubble-btn')]
        .filter((el) => el.style.display !== 'none')
        .map((el) => el.dataset.mark)`
    )
  }

  async clickBubble(mark) {
    await this.cdp.eval(
      `document.querySelector('.cm-selection-bubble .cm-bubble-btn[data-mark="${mark}"]')?.click()`
    )
    await sleep(200)
  }

  // ── 工具栏 ──

  async toolbarGroup(index) {
    await this.cdp.eval(
      `document.querySelectorAll('.notes-toolbar .notes-fmt-group')[${index}]?.querySelector('.notes-fmt-btn')?.click()`
    )
    await sleep(120)
  }

  async previewHtml() {
    return this.cdp.eval(`document.querySelector('.notes-preview-body')?.innerHTML ?? ''`)
  }

  async previewText() {
    return this.cdp.eval(`document.querySelector('.notes-preview-body')?.innerText ?? ''`)
  }

  async previewExists() {
    return this.cdp.eval(`document.querySelector('.notes-preview-body') !== null`)
  }

  async editorVisible() {
    return this.cdp.eval(`(() => { const el = document.querySelector('.notes-editor-pane');
      return el !== null && getComputedStyle(el).display !== 'none' })()`)
  }

  async previewVisible() {
    return this.cdp.eval(`(() => { const el = document.querySelector('.notes-preview');
      return el !== null && getComputedStyle(el).display !== 'none' })()`)
  }

  // ── 预览大纲 / 折叠 ──

  async previewOutlineExists() {
    return this.cdp.eval(`(() => {
      const el = document.querySelector('.preview-outline-handle')
      if (el === null) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })()`)
  }

  async previewOutlineTicks() {
    return this.cdp.json(
      `[...document.querySelectorAll('.preview-outline-tick')].map((el) => ({
        level: Number(el.dataset.level), active: el.classList.contains('is-active')
      }))`
    )
  }

  async previewOutlineRows() {
    return this.cdp.json(`[...document.querySelectorAll('.preview-outline-row')].map((el) => ({
      text: el.querySelector('.preview-outline-jump')?.textContent?.trim() ?? '',
      level: Number(el.dataset.level),
      depth: Number(el.dataset.depth),
      active: el.classList.contains('is-active'),
      marker: el.querySelector('.preview-outline-mark') !== null,
      current: el.querySelector('.preview-outline-jump')?.getAttribute('aria-current') ?? null,
      indent: Number.parseFloat(el.style.paddingLeft) || 0
    }))`)
  }

  /**
   * 目录条的定位:刻度条应在预览右上角,画出来的白底面板应在其左侧 1px、顶边对齐。
   * 量的是 .preview-outline-card-inner(有背景的那一层),不是透明外框 ——
   * 外框贴住刻度条时,白底仍可能缩在槽的左边。
   * 不用 elementRect —— 它会 scrollIntoView,把预览滚走。
   */
  async previewOutlineGeometry() {
    return this.cdp.json(`(() => {
      const pane = document.querySelector('.notes-preview')
      const handle = document.querySelector('.preview-outline-handle')
      const card = document.querySelector('.preview-outline-card')
      const inner = document.querySelector('.preview-outline-card-inner')
      if (pane === null || handle === null || card === null || inner === null) return null
      const p = pane.getBoundingClientRect()
      const h = handle.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      const i = inner.getBoundingClientRect()
      return {
        paneHeight: p.height,
        // 卡片外框的 CSS 宽度(最宽 200px; 窄栏会被 min() 再压一截)
        cardWidth: c.width,
        handleTop: h.top - p.top,
        handleRight: p.right - h.right,
        handleLeft: h.left,
        cardTop: i.top - p.top,
        cardLeft: i.left - p.left,
        cardHeight: i.height,
        // 白底面板右缘与刻度条左缘之间的水平间隙(目标 1px)
        gap: h.left - i.right,
        // 外框右缘超出白底面板的宽度;面板没铺满槽时这里会是几十像素
        slotSlack: c.right - i.right
      }
    })()`)
  }

  /** 当前行的标识与当前刻度:颜色应一致,标识要落在卡片里。 */
  async previewOutlineMarker() {
    return this.cdp.json(`(() => {
      const row = document.querySelector('.preview-outline-row.is-active')
      const mark = row?.querySelector('.preview-outline-mark')
      const tick = document.querySelector('.preview-outline-tick.is-active')
      const inner = document.querySelector('.preview-outline-card-inner')
      if (!mark || !tick || !inner) return null
      const m = mark.getBoundingClientRect()
      const c = inner.getBoundingClientRect()
      return {
        inCard: m.left >= c.left - 1 && m.right <= c.right + 1 &&
          m.top >= c.top - 1 && m.bottom <= c.bottom + 1,
        width: m.width,
        height: m.height,
        markColor: getComputedStyle(mark).backgroundColor,
        tickColor: getComputedStyle(document.querySelector('.preview-outline-thumb') ?? tick).backgroundColor
      }
    })()`)
  }

  async previewOutlineActive() {
    return this.cdp.eval(
      `document.querySelector('.preview-outline-row.is-active .preview-outline-jump')?.textContent?.trim() ?? null`
    )
  }

  async previewOutlineCardOpacity() {
    return this.cdp.eval(
      `(() => { const el = document.querySelector('.preview-outline-card'); return el === null ? null : getComputedStyle(el).opacity })()`
    )
  }

  async hoverPreviewOutline() {
    const point = await this.cdp.json(`(() => {
      const el = document.querySelector('.preview-outline-handle')
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    if (point === null) throw new Error('找不到预览大纲刻度')
    await this.cdp.mouse('mouseMoved', point.x, point.y)
    await this.cdp.waitFor(
      `(() => { const el = document.querySelector('.preview-outline-card');
        return el !== null && getComputedStyle(el).opacity === '1' })()`,
      { message: '预览大纲卡片展开' }
    )
    return point
  }

  async leavePreviewOutline() {
    const point = await this.cdp.json(`(() => {
      const el = document.querySelector('.notes-preview')
      const r = el.getBoundingClientRect()
      return { x: r.x + Math.min(80, r.width / 2), y: r.y + 40 }
    })()`)
    await this.cdp.mouse('mouseMoved', point.x, point.y)
    await this.cdp.waitFor(
      `(() => { const el = document.querySelector('.preview-outline-card');
        return el === null || getComputedStyle(el).opacity === '0' })()`,
      { message: '预览大纲卡片收起' }
    )
  }

  async clickPreviewOutline(text) {
    await this.hoverPreviewOutline()
    const clicked = await this.cdp.eval(`(() => {
      const row = [...document.querySelectorAll('.preview-outline-row')]
        .find((el) => (el.querySelector('.preview-outline-jump')?.textContent ?? '').trim() === ${JSON.stringify(text)})
      if (row === undefined) return false
      row.querySelector('.preview-outline-jump')?.click()
      return true
    })()`)
    if (clicked !== true) throw new Error(`预览目录里找不到:${text}`)
    await sleep(200)
  }

  /** 当前行是否落在浮层列表的可见矩形内，以及列表本身是否真的溢出可滚。 */
  async previewOutlineActiveInView() {
    return this.cdp.json(`(() => {
      const list = document.querySelector('.preview-outline-list')
      const row = document.querySelector('.preview-outline-row.is-active')
      if (list === null || row === null) return null
      const l = list.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      return {
        visible: r.top >= l.top - 1 && r.bottom <= l.bottom + 1,
        scrollable: list.scrollHeight > list.clientHeight + 1,
        rowTop: r.top,
        rowBottom: r.bottom,
        listTop: l.top,
        listBottom: l.bottom
      }
    })()`)
  }

  async previewScrollTop() {
    return this.cdp.eval(`document.querySelector('.notes-preview')?.scrollTop ?? -1`)
  }

  async previewScrollTo(value) {
    await this.cdp.eval(`(() => { const el = document.querySelector('.notes-preview');
      if (el === null) return false; el.scrollTop = ${Number(value)};
      el.dispatchEvent(new Event('scroll')); return true })()`)
    await sleep(150)
  }

  /** 标题相对滚动内容顶部的偏移(= 跳到它需要设置的 scrollTop)。 */
  async previewHeadingOffset(text) {
    return this.cdp.json(`(() => {
      const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
        .find((h) => (h.textContent ?? '').trim().startsWith(${JSON.stringify(text)}))
      const pv = document.querySelector('.notes-preview')
      if (el === undefined || pv === null) return null
      return el.getBoundingClientRect().top - pv.getBoundingClientRect().top + pv.scrollTop
    })()`)
  }

  /** 标题顶边相对预览容器顶部的可视位置。 */
  async previewHeadingTop(text) {
    return this.cdp.json(`(() => {
      const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
        .find((h) => (h.textContent ?? '').trim().startsWith(${JSON.stringify(text)}))
      const pv = document.querySelector('.notes-preview')
      if (el === undefined || pv === null) return null
      return el.getBoundingClientRect().top - pv.getBoundingClientRect().top
    })()`)
  }

  async previewFoldState(text) {
    return this.cdp.json(`(() => {
      const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
        .find((h) => (h.textContent ?? '').trim().startsWith(${JSON.stringify(text)}))
      if (el === undefined) return null
      const btn = el.querySelector(':scope > .md-h-fold-btn')
      const icon = btn?.querySelector('i') ?? null
      const level = btn?.querySelector('.md-h-level') ?? null
      // 两层叠在一起交叉淡入,display 一直是可见的,只能看透明度。
      return {
        folded: el.dataset.folded === 'true',
        expanded: btn?.getAttribute('aria-expanded') ?? null,
        button: btn !== null && btn !== undefined,
        opacity: btn === null || btn === undefined ? null : getComputedStyle(btn).opacity,
        level: level?.textContent ?? null,
        levelShown: level === null ? null : Number.parseFloat(getComputedStyle(level).opacity) > 0.5,
        caretShown: icon === null ? false : Number.parseFloat(getComputedStyle(icon).opacity) > 0.5
      }
    })()`)
  }

  /** 标题前方那枚标签与标题之间的间隙,以及预览有没有被撑出水平滚动。 */
  async previewHeadingBadge(text) {
    return this.cdp.json(`(() => {
      const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
        .find((h) => (h.textContent ?? '').trim().startsWith(${JSON.stringify(text)}))
      const pv = document.querySelector('.notes-preview')
      const btn = el?.querySelector(':scope > .md-h-fold-btn')
      if (el === undefined || btn === null || btn === undefined || pv === null) return null
      const h = el.getBoundingClientRect()
      const b = btn.getBoundingClientRect()
      // 比的是字的下沿,不是盒子底边:盒子底边对齐时 H 的脚仍会低出一截。
      const text = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim() !== '')
      const probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;padding:0;margin:0'
      el.insertBefore(probe, btn)
      const canvas = document.createElement('canvas').getContext('2d')
      const cs = getComputedStyle(el)
      canvas.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
      const descent = canvas.measureText(text?.textContent?.trim()?.[0] ?? '用').actualBoundingBoxDescent || 0
      const charBottom = probe.getBoundingClientRect().bottom + descent
      probe.remove()
      const hprobe = document.createElement('span')
      hprobe.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;padding:0;margin:0'
      const mark = btn.querySelector('.md-h-mark')
      mark?.appendChild(hprobe)
      const hBottom = hprobe.getBoundingClientRect().bottom
      hprobe.remove()
      return {
        gap: h.left - b.right,
        badgeLeft: b.left,
        paneLeft: pv.getBoundingClientRect().left,
        // H 的基线与标题字下沿的差。正值表示 H 更低。
        bottomGap: hBottom - charBottom,
        scrollSlack: pv.scrollWidth - pv.clientWidth
      }
    })()`)
  }

  /** 把鼠标移到标题文字上(左缘再往右 offset 像素)。 */
  async hoverHeadingText(text, offset = 8) {
    const point = await this.cdp.json(`(() => {
      const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
        .find((h) => (h.textContent ?? '').trim().startsWith(${JSON.stringify(text)}))
      if (el === undefined) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + ${Number(offset)}, y: r.top + r.height / 2 }
    })()`)
    if (point === null) throw new Error(`找不到标题:${text}`)
    await this.cdp.mouse('mouseMoved', point.x, point.y)
  }

  /** 把鼠标移到标题前方那枚 H 的中心。H 在标题盒子外面,不能按标题左缘估算。 */
  async hoverHeadingBadge(text) {
    const point = await this.cdp.json(`(() => {
      const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
        .find((h) => (h.textContent ?? '').trim().startsWith(${JSON.stringify(text)}))
      const badge = el?.querySelector(':scope > .md-h-fold-btn')
      if (badge === null || badge === undefined) return null
      const r = badge.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (point === null) throw new Error(`找不到标题前方的层级标:${text}`)
    await this.cdp.mouse('mouseMoved', point.x, point.y)
  }

  async previewFoldButtonCount() {
    return this.cdp.eval(`document.querySelectorAll('.md-h-fold-btn').length`)
  }

  async clickPreviewFold(text) {
    // 按标题找按钮再派发,不按屏幕坐标点。页面滚动后,上一次鼠标停着的位置
    // 已经不是这个标题的箭头了。
    const clicked = await this.cdp.eval(`(() => {
      const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
        .find((h) => (h.textContent ?? '').trim().startsWith(${JSON.stringify(text)}))
      const btn = el?.querySelector(':scope > .md-h-fold-btn')
      if (btn === null || btn === undefined) return false
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    if (clicked !== true) throw new Error(`标题旁没有折叠箭头:${text}`)
    await sleep(200)
  }
}
