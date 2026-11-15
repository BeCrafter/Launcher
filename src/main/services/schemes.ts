// 特权 scheme 的登记点。
//
// protocol.registerSchemesAsPrivileged 必须在 app ready **之前**调用,而且**只登记一次**:
// 后一次调用会覆盖前一次的清单(E2E 里发现:分两次登记 launcher-note 后再登记 launcher-drawio,
// launcher-note 会退回普通 scheme,fetch 全部变成 "Failed to fetch",图片/视频却还能加载)。
// 所以所有本地 scheme 都在这里合并成一次调用。

import { protocol } from 'electron'
import { drawioSchemePrivileges } from './drawio-protocol'
import { notesSchemePrivileges } from './notes-protocol'

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([notesSchemePrivileges(), drawioSchemePrivileges()])
}
