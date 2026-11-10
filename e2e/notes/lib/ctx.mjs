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
      Backspace: ['Backspace', 'Backspace', 8]
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
}
