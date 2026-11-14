// 用例共用夹具。所有行文本都带唯一标记,方便在编辑器里按 textContent 找行。
// 夹具只描述正文;frontmatter 由 app.mjs 的 seedNotes 写。

export const MAIN_NOTE = {
  file: 'E2E 主笔记.md',
  title: 'E2E 主笔记',
  body: '# E2E 主笔记\n\n初始正文。\n'
}

export const LINK_NOTE = {
  file: 'E2E 链接目标.md',
  title: 'E2E 链接目标',
  body: '# E2E 链接目标\n\n这是被链接的笔记。\n'
}

export const BASIC = [
  '# 第一节 甲',
  '',
  '第一节第一段。',
  '',
  '第一节第二段。',
  '',
  '## 一小节 甲一',
  '',
  '甲一正文。',
  '',
  '# 第二节 乙',
  '',
  '第二节第一段。',
  '',
  '第二节第二段。'
].join('\n')

/** 12 节 × 6 段,撑到 1.6 个视口以上,用来验证大纲与贴边自动滚动。 */
export const LONG = (() => {
  const lines = ['# 长文档标题']
  for (let section = 1; section <= 12; section += 1) {
    lines.push('', `## 第${section}节`, '')
    for (let paragraph = 1; paragraph <= 6; paragraph += 1) {
      lines.push(`第${section}节第${paragraph}段。这是一段用来撑长度的正文。`, '')
    }
  }
  return lines.join('\n')
})()

export const NESTED = [
  '# 嵌套列表',
  '',
  '- 外层甲',
  '  - 内层甲一',
  '  - 内层甲二',
  '- 外层乙',
  '',
  '结尾段落。'
].join('\n')

export const TABLE_AND_DIAGRAM = [
  '# 表格与图表',
  '',
  '表格前的段落。',
  '',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| 甲 | 乙 |',
  '',
  '表格后的段落。',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```',
  '',
  '图表后的段落。'
].join('\n')

export const MARKS = [
  '# 行内标记',
  '',
  '普通文字。',
  '',
  '**加粗** *斜体* ~~删除~~ ==高亮== `代码`',
  '',
  'H~2~O 与 x^2^ 与 [[E2E 链接目标]] 与 #e2e标签',
  '',
  '![[sample.png]]',
  '',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| 甲 | 乙 |',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```'
].join('\n')

export const FOLD = [
  '# 可折叠节',
  '',
  '折叠节正文。',
  '',
  '## 子节',
  '',
  '子节正文。',
  '',
  '# 另一个节',
  '',
  '另一个节正文。'
].join('\n')

/** FOLD 加末尾填充:正文够长,点目录里的「另一个节」能真正滚到顶部、当前项才切得过去。 */
export const FOLD_SCROLLABLE = [
  ...FOLD.split('\n'),
  '',
  ...Array.from({ length: 30 }, () => ['末尾填充段落，让最后那个节能滚到预览顶部。', '']).flat()
].join('\n')

export const EMPTY_SECTION = ['# A', '', 'p', '', '# B', '', '# C', '', 'c'].join('\n')

/** 预览大纲:三级标题 + 每节正文,用来验层级缩进、跳转与两处折叠。 */
export const OUTLINE_TREE = [
  '# 概览',
  '',
  '概览正文。',
  '',
  '## 安装',
  '',
  '安装正文。',
  '',
  '### 前置条件',
  '',
  '前置正文。',
  '',
  '## 使用',
  '',
  '使用正文。',
  '',
  '# 附录',
  '',
  '附录正文。'
].join('\n')

/** 预览大纲的陷阱:围栏与引用里的 `#` 都不能进目录。甲节先垫足够长,第二节才滚得动。 */
export const OUTLINE_TRAPS = [
  '# 甲节',
  '',
  '甲正文。',
  '',
  ...Array.from({ length: 30 }, () => ['填充段落，用来把第二节推到视口以下。', '']).flat(),
  '```md',
  '# 代码里的标题',
  '```',
  '',
  '> ## 引用里的标题',
  '',
  '## 乙节',
  '',
  '乙正文。',
  '',
  '## 丙节',
  '',
  '丙正文。',
  '',
  // 末尾也垫长:乙节能滚到预览顶部,「当前节」才能真正切过去
  ...Array.from({ length: 30 }, () => ['末尾填充段落，让中间那节能滚到顶部。', '']).flat()
].join('\n')

/** 长目录:40 个二级标题,用来验证浮层内部滚动、当前项自动滚进可视范围。 */
export const OUTLINE_MANY = (() => {
  const lines = ['# 长目录']
  for (let section = 1; section <= 40; section += 1) {
    lines.push('', `## 第${section}节`, '', `第${section}节正文甲。`, '', `第${section}节正文乙。`)
  }
  // 末尾再垫长:倒数几节也要能滚到预览顶部,「当前节」才切得过去。
  for (let filler = 1; filler <= 24; filler += 1) lines.push('', `末尾填充${filler}。`)
  return lines.join('\n')
})()

/**
 * 查找 / 替换用例的计数夹具。默认(大小写不敏感)下 `alpha` 精确出现 5 次:
 *   · `alpha alpha alpha` —— 3 次全词
 *   · `Alpha` —— 1 次,只受大小写开关影响
 *   · `alphabet` —— 1 次,只受全词开关影响
 * 因此:Aa → 4,全词(不区分大小写)→ 4,Aa + 全词 → 3。
 * `hello hallo` 供正则 `h(a|e)llo` 命中两处。
 */
export const FIND = ['# 查找替换', '', 'alpha alpha alpha', 'Alpha alphabet', '', 'hello hallo'].join('\n')

/** 替换用例:三处可替换的 `cat`,不掺其它命中,便于断言「一次撤销整体退回」。 */
export const FIND_REPLACE = ['# 查找替换', '', 'cat cat cat'].join('\n')
