// 应用更新 store:镜像 main 的状态机 + 自动重启倒计时。
//
// 状态本身归 main(UpdateController),这里只做三件事:
//   1. 订阅 appUpdateChanged / 首帧拉一次 getState
//   2. ready 后 10s 自动重启;笔记、AI 输入框、Agent 抽屉/内联编辑有未保存内容时暂停
//      (绝不把用户正在写的内容带走)
//   3. 把上次升级的结果(installed / rolled-back / failed)提示一次
//
// 倒计时放在 store 而不是设置页组件里:用户点完检查就切走时,升级也应该能完成。
// 窗口不可见时倒计时暂停,等用户回来再继续 —— 否则用户在其他页面/后台时会毫无提示地被重启。

import { create } from 'zustand'
import { IPC_EVENTS, type UpdateResultInfo, type UpdateState } from '@shared/ipc'
import { getCurrentLang, makeT } from '../i18n'
import { showToast } from '../lib/utils'
import { useAiStore } from './ai-store'
import { useDrawerStore } from './drawer-store'
import { useNotesStore } from './notes-store'
import { useUnsavedStore } from './unsaved-store'

const t = (): ((k: string) => string) => makeT(getCurrentLang())

/** ready 后自动重启的等待秒数(用户可点「稍后」取消) */
const AUTO_RESTART_SECONDS = 10

interface UpdateStore {
  state: UpdateState | null
  result: UpdateResultInfo | null
  /** 自动重启剩余秒数;null = 没有在倒计时 */
  countdown: number | null
  /** 用户点了「稍后」 */
  postponed: boolean
  /** 倒计时因笔记/输入框未保存内容而暂停 */
  dirtyBlocked: boolean
  init: () => void
  check: () => Promise<void>
  retryDownload: () => Promise<void>
  apply: () => Promise<void>
  cancel: () => Promise<void>
  postpone: () => void
  revealLog: () => Promise<void>
  dismissResult: () => void
}

let initialized = false
let tickTimer: ReturnType<typeof setInterval> | null = null

export const useUpdateStore = create<UpdateStore>((set, get) => {
  const stopCountdown = (): void => {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    if (get().countdown !== null) set({ countdown: null })
  }

  type UnsavedReason = 'notes' | 'aiDraft' | 'aiRun' | 'editor'

  /** 未保存内容的原因;null = 可以立即重启。顺序决定提示优先级。 */
  const unsavedReason = (): UnsavedReason | null => {
    const notes = useNotesStore.getState()
    if (notes.dirty || notes.saving) return 'notes'
    const ai = useAiStore.getState()
    if (ai.composerHasDraft || ai.composerDraft !== null) return 'aiDraft'
    if (ai.runSessionId !== null) return 'aiRun'
    // Agent 抽屉:表单触碰过字段,或 XML 原文偏离最后一次读/写的版本
    const drawer = useDrawerStore.getState()
    if (
      drawer.open &&
      (drawer.dirtyFields.length > 0 ||
        (drawer.document !== null && drawer.xml !== drawer.document.sourceXml))
    ) {
      return 'editor'
    }
    // crontab 内联编辑 / 服务覆写浮层等组件内联草稿
    if (useUnsavedStore.getState().hasUnsaved()) return 'editor'
    return null
  }

  /** 笔记、AI、编辑器草稿都只活在渲染进程,重启会丢 */
  const hasUnsavedContent = (): boolean => unsavedReason() !== null

  const showUnsavedToast = (reason: UnsavedReason): void => {
    const key =
      reason === 'notes'
        ? 'toast.update.notesPending'
        : reason === 'aiDraft'
          ? 'toast.update.draftPending'
          : reason === 'aiRun'
            ? 'toast.update.aiPending'
            : 'toast.update.editorPending'
    showToast(t()(key), '#f59e0b', reason === 'notes' ? 'fa-floppy-disk' : 'fa-keyboard')
  }

  const startCountdown = (): void => {
    stopCountdown()
    if (get().postponed) return
    // ready 时用户已经在写东西:先暂停,等内容清空/保存后由订阅恢复
    if (hasUnsavedContent()) {
      set({ dirtyBlocked: true })
      return
    }
    let remaining = AUTO_RESTART_SECONDS
    set({ countdown: remaining, dirtyBlocked: false })
    tickTimer = setInterval(() => {
      if (get().state?.phase !== 'ready') {
        stopCountdown()
        return
      }
      // 笔记、AI 或内联编辑尚未保存 —— 暂停倒计时,不让升级吞掉正在敲的内容
      if (hasUnsavedContent()) {
        stopCountdown()
        set({ dirtyBlocked: true })
        return
      }
      // 窗口在后台/最小化时暂停倒计时:用户看不到全局提示,重启会像「应用自己退了」。
      // 等窗口重新可见后从当前秒数继续。
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      remaining -= 1
      if (remaining <= 0) {
        stopCountdown()
        void get().apply()
        return
      }
      set({ countdown: remaining })
    }, 1000)
  }

  const applyState = (next: UpdateState): void => {
    const prev = get().state
    set({ state: next })
    if (next.phase === 'ready' && prev?.phase !== 'ready') {
      set({ postponed: false, dirtyBlocked: false })
      startCountdown()
    } else if (next.phase !== 'ready') {
      stopCountdown()
      set({ postponed: false, dirtyBlocked: false })
    }
  }

  const invoke = async (
    fn: () => Promise<UpdateState>,
    onErrorKey: string
  ): Promise<void> => {
    try {
      applyState(await fn())
    } catch (err) {
      console.error('[update]', err)
      showToast(t()(onErrorKey), '#f87171', 'fa-circle-exclamation')
    }
  }

  return {
    state: null,
    result: null,
    countdown: null,
    postponed: false,
    dirtyBlocked: false,

    init: () => {
      if (initialized) return
      initialized = true
      window.launcher.onEvent(IPC_EVENTS.appUpdateChanged, (payload) => {
        if (payload) applyState(payload as UpdateState)
      })
      void window.launcher.updates
        .getState()
        .then((s) => applyState(s))
        .catch((err) => console.error('[update] getState', err))
      // 倒计时因未保存内容暂停后,保存/清空时恢复 —— 否则「暂停」会变成永久停止,
      // 用户还得再点一次按钮
      const resumeIfUnblocked = (): void => {
        if (!get().dirtyBlocked || hasUnsavedContent()) return
        if (get().state?.phase !== 'ready') return
        set({ dirtyBlocked: false })
        startCountdown()
      }
      useNotesStore.subscribe(resumeIfUnblocked)
      useAiStore.subscribe(resumeIfUnblocked)
      useDrawerStore.subscribe(resumeIfUnblocked)
      useUnsavedStore.subscribe(resumeIfUnblocked)
      void window.launcher.updates
        .consumeResult()
        .then((r) => {
          if (!r) return
          set({ result: r })
          const tr = t()
          const icon = r.status === 'installed' ? 'fa-circle-check' : 'fa-triangle-exclamation'
          const color = r.status === 'installed' ? '#4ade80' : '#f87171'
          const key =
            r.status === 'installed'
              ? 'toast.update.result.installed'
              : r.status === 'rolled-back'
                ? 'toast.update.result.rolledBack'
                : 'toast.update.result.failed'
          showToast(
            tr(key).replace(/\{FROM\}/g, r.from).replace(/\{TO\}/g, r.to),
            color,
            icon
          )
        })
        .catch((err) => console.error('[update] consumeResult', err))
    },

    check: async () => {
      stopCountdown()
      set({ postponed: false })
      await invoke(() => window.launcher.updates.check(), 'toast.update.error')
    },

    retryDownload: async () => {
      await invoke(() => window.launcher.updates.download(), 'toast.update.error')
    },

    apply: async () => {
      stopCountdown()
      // 先把笔记落盘:升级会退出应用,before-quit 会直接销毁窗口
      try {
        await useNotesStore.getState().flush()
      } catch {
        /* flush 内部已 toast;下面按 dirty 判定 */
      }
      if (useNotesStore.getState().dirty) {
        set({ dirtyBlocked: true })
        showUnsavedToast('notes')
        return
      }
      // 输入框草稿/进行中的回复/内联编辑没有统一的落盘通道:只能明确拦住,让用户先处理完
      const reason = unsavedReason()
      if (reason !== null) {
        set({ dirtyBlocked: true })
        showUnsavedToast(reason)
        return
      }
      await invoke(() => window.launcher.updates.apply(), 'toast.update.applyError')
    },

    cancel: async () => {
      stopCountdown()
      await invoke(() => window.launcher.updates.cancel(), 'toast.update.error')
    },

    postpone: () => {
      stopCountdown()
      set({ postponed: true, dirtyBlocked: false })
    },

    revealLog: async () => {
      try {
        const path = await window.launcher.updates.revealLog()
        if (!path) showToast(t()('toast.update.noLog'), '#8888aa', 'fa-circle-info')
      } catch (err) {
        console.error('[update] revealLog', err)
      }
    },

    dismissResult: () => set({ result: null })
  }
})
