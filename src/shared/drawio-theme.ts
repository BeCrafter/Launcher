// draw.io 编辑器界面的配色桥。
//
// draw.io 的 chrome 颜色全部走它自己 :root 上的一套 CSS 变量,按
// `light-dark(var(--x), var(--dark-x))` 使用;它自带的 systemColors 开关也是这么做的。
// 这里把应用的色板映射过去,只覆盖界面变量:
//   · 不碰 --ge-dark-color / --ge-light-color —— 那是图形填充/文字的默认色,属于图表内容;
//   · 不碰页面底色、错误/提及等语义色 —— 保持 draw.io 自己的语义。
// 两侧变量都写成当前主题的值,再给 :root 设 color-scheme,菜单/对话框挂在编辑器容器外
// 也总能取到同一套颜色。选择器用 :root:root 压过 drawio 后注入的同级 :root 规则。

export interface DrawioThemeColors {
  /** 面板/菜单栏底 */
  surface: string
  surface2: string
  surface3: string
  surface4: string
  border2: string
  text: string
  muted: string
  dim: string
  accent: string
  accent2: string
  /** 编辑器/工作区底色 */
  editorBg: string
  /** 强调色的淡底 */
  washAccent: string
  /** 中性 hover 底 */
  hover: string
}

/** draw.io 主题变量 → 当前主题的应用色值。导出给单测直接比对。 */
export function drawioThemeVars(colors: DrawioThemeColors, dark: boolean): Record<string, string> {
  const panel = colors.surface
  const toolbar = dark ? colors.surface2 : colors.surface3
  const field = dark ? colors.surface3 : colors.surface
  const card = dark ? colors.surface3 : colors.surface
  const dialog = dark ? colors.surface2 : colors.surface
  const header = dark ? colors.surface : colors.surface2
  const scrollbar = dark ? colors.surface3 : colors.surface4
  // 淡色底上的字:深色用更亮的 accent2,浅色用更深的 accent
  const accentText = dark ? colors.accent2 : colors.accent

  return {
    // light-dark() 的浅色一侧
    '--ge-panel-color': panel,
    '--toolbar-color': toolbar,
    '--workspace-color': colors.editorBg,
    '--border-color': colors.border2,
    '--text-color': colors.text,
    '--strong-text-color': colors.text,
    '--secondary-text-color': colors.muted,
    '--faint-text-color': colors.dim,
    '--accent-color': colors.washAccent,
    '--accent-hover-color': colors.washAccent,
    '--accent-text-color': accentText,
    '--focus-color': colors.accent,
    '--field-color': field,
    '--field-border-color': colors.border2,
    '--strong-border-color': colors.dim,
    '--card-color': card,
    '--dialog-color': dialog,
    '--soft-color': colors.surface3,
    '--soft-hover-color': colors.surface4,
    '--highlight-color': colors.hover,
    '--selected-color': colors.washAccent,
    '--selected-hover-color': colors.washAccent,
    '--primary-color': colors.washAccent,
    '--primary-hover-color': colors.washAccent,
    '--active-color': colors.surface4,
    '--inactive-color': colors.surface3,
    '--active-item-color': colors.washAccent,
    '--scrollbar-color': scrollbar,
    '--scrollbar-hover-color': colors.muted,

    // light-dark() 的深色一侧:同样写当前主题的值
    '--ge-dark-panel-color': panel,
    '--dark-toolbar-color': toolbar,
    '--dark-color': colors.editorBg,
    '--dark-border-color': colors.border2,
    '--dark-button-border-color': colors.border2,
    '--dark-text-color': colors.text,
    '--dark-strong-text-color': colors.text,
    '--dark-secondary-text-color': colors.muted,
    '--dark-faint-text-color': colors.dim,
    '--dark-accent-color': colors.washAccent,
    '--dark-accent-text-color': accentText,
    '--dark-focus-color': colors.accent,
    '--dark-field-color': field,
    '--dark-field-border-color': colors.border2,
    '--dark-strong-border-color': colors.dim,
    '--dark-card-color': card,
    '--dark-dialog-color': dialog,
    '--dark-soft-color': colors.surface3,
    '--dark-soft-hover-color': colors.surface4,
    '--dark-highlight-color': colors.hover,
    '--dark-active-item-color': colors.washAccent,
    '--dark-scrollbar-color': scrollbar,
    '--dark-header-color': header,
    '--dark-inverse-active-color': '#ffffff'
  }
}

/** 生成交给 draw.io configure.customCss 的样式表。 */
export function drawioThemeCss(colors: DrawioThemeColors, dark: boolean): string {
  const vars = drawioThemeVars(colors, dark)
  return [
    ':root:root {',
    `  color-scheme: ${dark ? 'dark' : 'light'};`,
    ...Object.entries(vars).map(([name, value]) => `  ${name}: ${value};`),
    '}',
    ''
  ].join('\n')
}
