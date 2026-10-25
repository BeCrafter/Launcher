// AI 输入框的 Enter 判定。
//
// 关键场景:中文输入法组词时按 Enter 是「确认候选词」,不是发送。
// Chromium 在组词期间的 keydown 带 isComposing=true(部分旧内核用 keyCode 229),
// 必须原样交给输入法;否则用户每选一次词就会把半成品发出去。
// compositionend 与 keydown 同任务到达的 WebKit 变体,再用 justComposed 兜底一拍。

export interface EnterKeyLike {
  key: string
  shiftKey: boolean
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
}

export function shouldSendOnEnter(
  e: EnterKeyLike,
  composing: boolean,
  justComposed: boolean
): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false
  if (composing || justComposed) return false
  if (e.nativeEvent?.isComposing) return false
  if (e.keyCode === 229 || e.nativeEvent?.keyCode === 229) return false
  return true
}
