// 首次运行时生成的「随心手记示例」笔记。
//
// 只在笔记目录**完全为空**(一篇笔记、一个目录都没有)时写入一次 —— 这是个不需要记住
// 任何状态的规则:用户删掉它之后目录就不空了,不会再被重建;而真把整个目录清空的人,
// 本来就等于回到了「第一次用」。
//
// 正文是两份真实的 .md 文件(按语言选一份),用 `?raw` 在构建期内联。
// 为什么不写成 TS 里的模板串:这份文档满篇都是反引号,转义几十次既难写也难读,
// 而且写在 .md 里还能直接被编辑器的 markdown 工具链检查。

import zh from '../../../resources/note-sample/zh.md?raw'
import en from '../../../resources/note-sample/en.md?raw'

/**
 * 示例笔记的标题(= 文件名)。
 *
 * ⚠ 示例是**按标题认出来的**(见 notes-service 的 ensureSample:换语言时拿另一种语言的标题去找),
 * 没有单独的 id 常量 —— 改这里就等于改文件名,记得同步改:
 *   · resources/note-sample/*.md 的第一行 `# …`
 *   · docs/help.md 与 docs/help.en.md 里提到它的地方
 *   · note-sample.test.ts 的文案
 */
export const SAMPLE_NOTE_TITLE_ZH = '随心手记示例'
export const SAMPLE_NOTE_TITLE_EN = 'Notes feature tour'

export function sampleNoteBody(language: string): string {
  return language.startsWith('zh') ? zh : en
}

export function sampleNoteTitle(language: string): string {
  return language.startsWith('zh') ? SAMPLE_NOTE_TITLE_ZH : SAMPLE_NOTE_TITLE_EN
}

/** 另一门语言。示例笔记换语言时要用它来认出「那篇是我们生成的、且用户没动过」 */
export function otherLang(language: string): string {
  return language.startsWith('zh') ? 'en-US' : 'zh-CN'
}
