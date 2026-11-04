// 把组件内联编辑的「有未保存内容」状态注册到 useUnsavedStore。
// dirty 变化只更新当前 key;卸载或 key 变化时才清理,避免一次正常的 dirty 更新
// 先注销再注册,让 update-store 的订阅者误以为「已无未保存内容」而提前恢复倒计时。

import { useEffect } from 'react'
import { useUnsavedStore } from '../state/unsaved-store'

export function useUnsavedEditor(key: string, dirty: boolean): void {
  const setEditor = useUnsavedStore((s) => s.setEditor)

  useEffect(() => {
    setEditor(key, dirty)
  }, [dirty, key, setEditor])

  useEffect(() => {
    return () => setEditor(key, false)
  }, [key, setEditor])
}
