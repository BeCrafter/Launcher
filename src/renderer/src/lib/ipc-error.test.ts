import { describe, expect, it } from 'vitest'
import { cleanIpcErrorMessage } from './ipc-error'

describe('cleanIpcErrorMessage', () => {
  it('剥掉 Electron invoke 前缀与内层 Error: 前缀', () => {
    const err = new Error(
      "Error invoking remote method 'agents:save': Error: 该 plist 含表单不支持的键:Sockets;为避免静默丢键已阻止保存,请切到 XML 编辑并保存"
    )
    expect(cleanIpcErrorMessage(err)).toBe(
      '该 plist 含表单不支持的键:Sockets;为避免静默丢键已阻止保存,请切到 XML 编辑并保存'
    )
  })

  it('无前缀时原样返回;非 Error 输入取字符串', () => {
    expect(cleanIpcErrorMessage(new Error('该文件未定义任务:请填写 Label 后再保存'))).toBe(
      '该文件未定义任务:请填写 Label 后再保存'
    )
    expect(cleanIpcErrorMessage('boom')).toBe('boom')
  })
})
