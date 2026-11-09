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

export const EMPTY_SECTION = ['# A', '', 'p', '', '# B', '', '# C', '', 'c'].join('\n')
