// 应用更新 store:镜像 main 的状态机 + 自动重启倒计时。
//
// 状态本身归 main(UpdateController),这里只做三件事:
//   1. 订阅 appUpdateChanged / 首帧拉一次 getState
//   2. ready 后 10s 自动重启;笔记有未保存改动时暂停(绝不把用户正在写的字带走)
//   3. 把上次升级的结果(installed / rolled-back / failed)提示一次
//
// 倒计时放在 store 而不是设置页组件里:用户点完检查就切走时,升级也应该能完成。

import { create } from 'zustand'
import { IPC_EVENTS, type UpdateResultInfo, type UpdateState } from '@shared/ipc'
import { getCurrentLang, makeT } from '../i18n'
import { showToast } from '../lib/utils'
import { useNotesStore } from './notes-store'

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
  /** 倒计时因笔记未保存而暂停 */
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

  const startCountdown = (): void => {
    stopCountdown()
    if (get().postponed) return
    let remaining = AUTO_RESTART_SECONDS
    set({ countdown: remaining, dirtyBlocked: false })
    tickTimer = setInterval(() => {
      if (get().state?.phase !== 'ready') {
        stopCountdown()
        return
      }
      // 笔记有未保存内容(或在保存中)—— 暂停倒计时,不让升级吞掉正在敲的字
      const notes = useNotesStore.getState()
      if (notes.dirty || notes.saving) {
        stopCountdown()
        set({ dirtyBlocked: true })
        return
      }
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
      // 倒计时因笔记有未保存内容暂停后,保存完成时恢复 —— 否则「暂停」会变成永久停止,
      // 用户还得再点一次按钮
      useNotesStore.subscribe((notes) => {
        if (!get().dirtyBlocked || notes.dirty || notes.saving) return
        if (get().state?.phase !== 'ready') return
        set({ dirtyBlocked: false })
        startCountdown()
      })
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
        showToast(t()('toast.update.notesPending'), '#f59e0b', 'fa-floppy-disk')
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
