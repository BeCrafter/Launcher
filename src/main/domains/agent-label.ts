// Agent 身份(Label)校验(纯函数)。
// Label 同时是文件名与 launchctl 目标串的一部分:允许任意字符会让路径逃逸(save 的 pathFor)
// 与命令注入(提权 mv/rm)成为可能。只接受 [A-Za-z0-9._-]+。
// 磁盘上已有的不规范 label 仍可展示(见 migration-map 第 37 条),但不能作为新建/改名的输入。
const LABEL_RE = /^[A-Za-z0-9._-]+$/

/** launchd Label 的实用上限(文件名 + .plist 需落在 255 字节内) */
const MAX_LEN = 200

export type LabelCheck = { ok: true } | { ok: false; reason: string }

export function validateAgentLabel(label: string): LabelCheck {
  if (label === '') return { ok: false, reason: 'Label 不能为空' }
  if (label.length > MAX_LEN) return { ok: false, reason: `Label 过长(上限 ${MAX_LEN} 字符)` }
  if (!LABEL_RE.test(label)) {
    return {
      ok: false,
      reason: 'Label 只能包含字母、数字、点、下划线与连字符(不能含空格、路径分隔符、控制字符或 shell 元字符)'
    }
  }
  if (label === '.' || label === '..') return { ok: false, reason: 'Label 不能是 . 或 ..' }
  return { ok: true }
}

/** 校验失败即抛可读中文错误(main 侧统一口径) */
export function assertValidAgentLabel(label: string): void {
  const r = validateAgentLabel(label)
  if (!r.ok) throw new Error(`Label 不合法:${r.reason}`)
}
