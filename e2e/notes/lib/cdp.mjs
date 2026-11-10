// 极小的 CDP 客户端:只覆盖 E2E 需要的四类能力 —— 求值、等待、鼠标、键盘。
//
// 刻意不引 Playwright:整个应用只跑在一个 Electron 渲染进程里,CDP 就够用;
// 少一个测试依赖,也少一层「驱动方式与真实输入不一致」的差异。
// 连接方式与 `scripts/` 下的临时验证脚本一致:启动时传 `--remote-debugging-port`。

export class CDP {
  constructor(url) {
    this.url = url
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = false
  }

  async open() {
    this.ws = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.method) {
        const handlers = this.listeners.get(message.method)
        if (handlers !== undefined) {
          for (const handler of handlers) handler(message.params ?? {})
        }
      }
      if (message.id === undefined) return
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
    this.ws.onclose = () => {
      this.closed = true
      for (const waiter of this.pending.values()) waiter.reject(new Error('CDP 连接已关闭'))
      this.pending.clear()
    }
    await this.send('Runtime.enable')
    await this.send('Page.enable')
  }

  /** 订阅 CDP 事件。返回取消函数。 */
  on(method, handler) {
    let handlers = this.listeners.get(method)
    if (handlers === undefined) {
      handlers = new Set()
      this.listeners.set(method, handlers)
    }
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.closed) return Promise.reject(new Error('CDP 连接已关闭'))
    const id = ++this.id
    const message = { id, method, params }
    // 挂到 iframe / OOPIF 之后,消息要带 sessionId 才会路由到那个目标
    if (sessionId !== undefined) message.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(message))
    })
  }

  /** 在页面里求值。异常会带上页面侧描述,失败信息才看得懂。 */
  async eval(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true
    })
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? ''
      throw new Error(`页面求值失败: ${description}`)
    }
    return result.result?.value
  }

  /** 在某个已挂载的子目标里求值。 */
  async evalIn(sessionId, expression) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      sessionId
    )
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? ''
      throw new Error(`子目标求值失败: ${description}`)
    }
    return result.result?.value
  }

  /**
   * 等待并挂载 URL 含 `urlPart` 的子目标(iframe / OOPIF),返回
   * `[{ sessionId, targetId, url }]`。同一个 URL 可能对应多个目标(PDF 阅读器的包装页),
   * 调用方用 evalIn 各问一句、挑自己要的那个。
   */
  async attachFrame(urlPart, { timeout = 10_000 } = {}) {
    const started = Date.now()
    let lastError = null
    while (Date.now() - started < timeout) {
      try {
        const { targetInfos } = await this.send('Target.getTargets')
        const targets = targetInfos.filter((t) => t.url.includes(urlPart))
        if (targets.length > 0) {
          const handles = []
          for (const target of targets) {
            const { sessionId } = await this.send('Target.attachToTarget', {
              targetId: target.targetId,
              flatten: true
            })
            handles.push({ sessionId, targetId: target.targetId, url: target.url })
          }
          return handles
        }
      } catch (error) {
        lastError = error
      }
      await sleep(100)
    }
    const suffix = lastError === null ? '' : `（最后一次错误：${lastError.message}）`
    throw new Error(`等待子目标超时：${urlPart}${suffix}`)
  }

  /** 求值并拿回一个活对象句柄(objectId),供 DOM.* 这类按节点操作的命令使用。 */
  async evalHandle(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: false,
      awaitPromise: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? ''
      throw new Error(`页面求值失败: ${description}`)
    }
    const objectId = result.result?.objectId
    if (objectId === undefined) throw new Error('页面求值没有返回对象句柄')
    return objectId
  }

  /** 把一段可 JSON 化的数据从页面取回来。 */
  async json(expression) {
    return JSON.parse(await this.eval(`JSON.stringify(${expression})`))
  }

  async waitFor(expression, { timeout = 8000, interval = 50, message = expression } = {}) {
    const started = Date.now()
    let lastError = null
    while (Date.now() - started < timeout) {
      try {
        if ((await this.eval(expression)) === true) return
      } catch (error) {
        lastError = error
      }
      await sleep(interval)
    }
    const suffix = lastError === null ? '' : `（最后一次错误：${lastError.message}）`
    throw new Error(`等待超时：${message}${suffix}`)
  }

  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
      ...extra
    })
  }

  /**
   * 在 `gesture` 这一下按住移动里截住真实的 HTML5 拖拽。
   *
   * CDP 的 mouseMoved 能让 dragstart 发火(页面拿到的就是按钮上那一份载荷),
   * 但接下来的移动不会把 dragover 送进页面。Chromium 要先 `Input.setInterceptDrags`,
   * 用截住的 DragData 再 `Input.dispatchDragEvent` 才能继续这一次拖拽。
   * 这不是 `new DragEvent`:载荷来自页面自己的 dragstart。
   *
   * 没有开始拖拽时返回 null(按钮仍然按着,调用方要自己松开)。
   */
  async captureDrag(gesture) {
    let data = null
    const off = this.on('Input.dragIntercepted', (params) => {
      const payload = params?.data?.items ? params.data : params
      if (payload && Array.isArray(payload.items)) data = payload
    })
    await this.send('Input.setInterceptDrags', { enabled: true })
    try {
      await gesture()
      const started = Date.now()
      while (data === null && Date.now() - started < 3000) await sleep(20)
    } finally {
      off()
      await this.send('Input.setInterceptDrags', { enabled: false }).catch(() => {})
    }
    if (data === null) return null
    const session = this
    const drag = {
      data,
      async hover(x, y) {
        await session.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data })
        await session.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data })
      },
      async drop(x, y) {
        await session.send('Input.dispatchDragEvent', { type: 'drop', x, y, data })
      },
      async cancel() {
        await session
          .send('Input.dispatchDragEvent', {
            type: 'dragCancel',
            x: 0,
            y: 0,
            data: { items: [], dragOperationsMask: 65535 }
          })
          .catch(() => {})
      }
    }
    return drag
  }

  async click(x, y) {
    await this.mouse('mousePressed', x, y, { buttons: 1 })
    await this.mouse('mouseReleased', x, y, { buttons: 0 })
  }

  async wheel(x, y, deltaY) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY
    })
  }

  async key(key, code, keyCode, modifiers = 0) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers
    })
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers
    })
  }

  async type(text) {
    await this.send('Input.insertText', { text })
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, Buffer.from(data, 'base64'))
  }

  close() {
    this.closed = true
    try {
      this.ws?.close()
    } catch {
      // 已经断开
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
