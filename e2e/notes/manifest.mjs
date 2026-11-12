import basics from './cases/basics.mjs'
import markdown from './cases/markdown.mjs'
import toolbar from './cases/toolbar.mjs'
import blockUi from './cases/block-ui.mjs'
import input from './cases/input.mjs'
import drag from './cases/drag.mjs'
import picker from './cases/picker.mjs'
import keyboard from './cases/keyboard.mjs'
import meta from './cases/meta.mjs'
import fileImport from './cases/import.mjs'
import files from './cases/files.mjs'
import find from './cases/find.mjs'
import railMove from './cases/rail-move.mjs'
import pin from './cases/pin.mjs'
import canvas from './cases/canvas.mjs'

/**
 * 编辑器端到端用例的唯一清单。
 *
 * 规则（见仓库根 CLAUDE.md）:改编辑器的任何交互,必须在对应分组里补充 / 更新用例;
 * 这个清单就是验收来源。新增分组时在这里注册,并在 README 的覆盖表里补一行。
 */
export const CASES = [
  ...basics,
  ...markdown,
  ...toolbar,
  ...blockUi,
  ...input,
  ...drag,
  ...picker,
  ...keyboard,
  ...meta,
  ...fileImport,
  ...files,
  ...find,
  ...railMove,
  ...pin,
  ...canvas
]

export const AREA_TITLES = {
  basics: '打开 / 编辑 / 保存 / 撤销 / 视图模式',
  markdown: 'Markdown 渲染与链接、标签、媒体、任务项',
  toolbar: '选区浮条与底部工具栏',
  'block-ui': '块手柄、块菜单、折叠、表格设置',
  input: '输入自动化:补全、围栏、列表续行、缩进、列选择',
  drag: '自由拖拽、自动滚动、右侧大纲',
  picker: '「移动到…」选择器',
  keyboard: 'Alt / Shift+Alt 键盘移动',
  meta: '笔记列表、标签、关联',
  import: '拖入本地文件 / 文件夹批量导入、文件行',
  files: '文件查看与编辑:代码、HTML、CSV、图片、PDF/音视频、Office、压缩包、3D、占位与图标',
  find: '编辑器内查找替换、匹配导航、选项与撤销',
  'rail-move': '左侧目录树拖动移动文件夹、文件和笔记',
  pin: '置顶:置顶区与目录树双份呈现、交互与移动',
  canvas: '白板:Excalidraw 场景文件,文字、画笔、缩放、删除与嵌入'
}
