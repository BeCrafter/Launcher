// 标题 → 文件名片段(主进程与渲染层共用)。
//
// 为什么在 shared:主进程用它决定文件落到哪,渲染层用它判断「标题改了之后文件名是不是也该改」——
// 两边必须是同一套规则,否则渲染层会做出错误判断(以为要改、实际不用,或反过来)。
//
// 注意:不得引入 node:* 依赖(shared 同时被 renderer 打包)。

import { NOTE_SLUG_MAX } from './notes'

/** 文件名非法字符(macOS 上 `:` 是 HFS 的路径分隔符遗留)+ 控制字符 */
const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f\u007f]/g

/** 兜底文件名:标题全是不合法字符时用它,而不是产出空文件名 */
const FALLBACK_SLUG = 'note'

/**
 * 标题 → 文件名。
 *
 * **文件名就是标题**:只替换真正不能进文件名的字符(`/ \ : * ? " < > |` 与控制字符),
 * **空白原样保留**。以前把空白换成连字符,于是「test 2」存成 `test-2.md` ——
 * 界面上显示 `test 2`、磁盘上却是 `test-2`,标题栏又把标题摆在文件名的位置上,
 * 看起来就是「显示的路径与真实文件对不上」。文件名与标题一致之后这个歧义就不存在了。
 *
 * **保留 CJK**:中文标题得到中文文件名(Obsidian 用户的预期)。
 */
export function slugifyNoteTitle(title: string): string {
  const cleaned = title
    .replace(ILLEGAL, '-')
    .replace(/-{2,}/g, '-') // 连续替换符收成一个
    .replace(/^[.\-\s]+/, '') // 前导点 = 隐藏文件(也会和 .trash/ 撞);前导连字符/空白无意义

  // 按**码点**截断:直接 slice 会把 emoji 的代理对切成孤立代理,产出非法文件名
  const capped = Array.from(cleaned).slice(0, NOTE_SLUG_MAX).join('')

  // 尾部点/连字符/空白:macOS 允许,但在别的工具里是出名的坑,去掉
  const trimmed = capped.replace(/[.\-\s]+$/, '')
  return trimmed === '' ? FALLBACK_SLUG : trimmed
}
