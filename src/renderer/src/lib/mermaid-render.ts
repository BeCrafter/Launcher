// Mermaid 渲染 —— 全项目**唯一**一处把字符串当标记注入 DOM 的地方。
//
// 为什么躲不开:mermaid 的公开 API 只有「源码 → SVG 字符串」这一条路,
// 它内部用 d3 直接操作 DOM,没有产 React 节点的入口。要真 mermaid 就只能注入。
//
// 于是把它关在这里,并叠三道闸:
//   ① `securityLevel: 'strict'` —— mermaid 自己会净化标签里的 HTML、禁掉 click 回调
//      与 `javascript:` 链接(GitHub / Obsidian 用的就是这一档);
//   ② 再走一遍 DOMPurify —— mermaid 之外的第二层,防的是它某个渲染器漏掉一处;
//   ③ 注入目标是**离屏**容器,不是 React 树 —— React 全程不知道这棵子树存在,
//      也就不会有人往它里面塞用户输入。
//
// 另外两件事也在这一层收口:
//   · 主题跟随应用:从 `--*` CSS 变量现读,喂给 mermaid 的 themeVariables,
//     所以深浅色切换、换强调色,图会跟着变(且**不写进笔记文件**)。
//   · 动态 import:不用图表就永远不加载 mermaid(它有好几 MB)。

import type { DOMPurify } from 'dompurify'

/** mermaid 的配置是全局单例,initialize 会整份覆盖 —— 主题没变就不必重来 */
let appliedThemeKey = ''
let mermaidMod: typeof import('mermaid').default | null = null
// dompurify 的类型导出在 `import('dompurify').default` 上会退化成「可调用的工厂」那一支,
// 命名类型 `DOMPurify` 才是实例本身(sanitize 的重载都在它上面)
let purify: DOMPurify | null = null

let seq = 0

async function load(): Promise<{ mermaid: typeof import('mermaid').default; purify: DOMPurify }> {
  if (mermaidMod === null || purify === null) {
    const [m, d] = await Promise.all([import('mermaid'), import('dompurify')])
    mermaidMod = m.default
    purify = d.default
  }
  return { mermaid: mermaidMod, purify }
}

/**
 * 读一个主题变量。
 *
 * ⚠ 必须读 **body** 而不是 documentElement:`light-theme` 类挂在 body 上,
 * 浅色那套变量因此只覆盖到 body 及其后代 —— 从 `<html>` 读会拿到深色 `:root` 的值,
 * 结果是「浅色主题下画出一张深色的图」。
 */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim()
  return v === '' ? fallback : v
}

/** 与编辑器/预览正文同一套字体栈 —— 图里的字和笔记里的字不该是两个样子 */
const FONT = "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

function themeVariables(theme: 'light' | 'dark'): Record<string, string | boolean> {
  const surface = cssVar('--surface', theme === 'dark' ? '#15151f' : '#ffffff')
  const surface2 = cssVar('--surface2', surface)
  const surface3 = cssVar('--surface3', surface2)
  const text = cssVar('--text', theme === 'dark' ? '#e6e6f0' : '#1b1b28')
  const muted = cssVar('--muted', text)
  const border = cssVar('--border', '#888')
  const border2 = cssVar('--border2', border)
  const accent = cssVar('--accent', '#6a58e0')
  // 节点底色用 accent 的 wash,而不是 --surface3:
  // 后者在浅色下是 #f1f3f9,而图表的卡片底是 #fafbfe —— 两者几乎同色,
  // 结果是「一张只剩几根细线的图」,节点本身看不见。
  const nodeBg = cssVar('--wash-accent', surface3)

  return {
    darkMode: theme === 'dark',
    background: surface,
    fontFamily: FONT,
    fontSize: '13px',

    primaryColor: nodeBg,
    primaryTextColor: text,
    primaryBorderColor: accent,
    secondaryColor: surface3,
    tertiaryColor: surface2,
    mainBkg: nodeBg,
    nodeBorder: accent,
    nodeTextColor: text,
    lineColor: muted,
    textColor: text,
    titleColor: text,
    edgeLabelBackground: surface,
    clusterBkg: surface2,
    clusterBorder: border2,
    // 序列图
    actorBkg: surface3,
    actorBorder: border2,
    actorTextColor: text,
    actorLineColor: border2,
    signalColor: text,
    signalTextColor: muted,
    labelBoxBkgColor: surface3,
    labelBoxBorderColor: border2,
    labelTextColor: text,
    loopTextColor: text,
    noteBkgColor: cssVar('--wash-yellow', surface2),
    noteBorderColor: cssVar('--yellow', border2),
    noteTextColor: text,
    activationBkgColor: cssVar('--wash-accent', surface2),
    activationBorderColor: accent,
    sequenceNumberColor: surface,
    // 类图 / 状态图
    classText: text,
    labelBackgroundColor: surface3,
    // 饼图 / 象限图
    pie1: accent,
    pie2: cssVar('--blue', '#4c8dff'),
    pie3: cssVar('--green', '#3fb950'),
    pie4: cssVar('--orange', '#e3923b'),
    pie5: cssVar('--cyan', '#39c5cf'),
    pie6: cssVar('--red', '#f85149'),
    pie7: cssVar('--yellow', '#d9b036'),
    pie8: cssVar('--accent2', accent),
    pieTitleTextColor: text,
    pieSectionTextColor: surface,
    pieLegendTextColor: text,
    pieStrokeColor: surface,
    pieOuterStrokeColor: border2,
    // 脑图 / 甘特等按 cScale 取色
    cScale0: accent,
    cScale1: cssVar('--blue', '#4c8dff'),
    cScale2: cssVar('--green', '#3fb950'),
    cScale3: cssVar('--orange', '#e3923b'),
    cScale4: cssVar('--cyan', '#39c5cf'),
    cScale5: cssVar('--yellow', '#d9b036'),
    cScale6: cssVar('--red', '#f85149'),
    cScale7: cssVar('--accent2', accent),
    cScale8: accent,
    cScale9: cssVar('--blue', '#4c8dff'),
    cScale10: cssVar('--green', '#3fb950'),
    cScale11: cssVar('--orange', '#e3923b')
  }
}

async function ensureInit(theme: 'light' | 'dark'): Promise<void> {
  const key = `${theme}:${cssVar('--accent', '')}:${cssVar('--surface', '')}`
  if (key === appliedThemeKey) return
  const { mermaid } = await load()
  mermaid.initialize({
    startOnLoad: false,
    // ① 第一道闸。'loose' 会放行 click 回调与原始 HTML,这里绝不使用。
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(theme),
    // 出错时不要把一张「错误图」注入页面 —— 我们自己渲染错误态
    suppressErrorRendering: true,
    /*
     * 标签走 SVG `<text>` 而不是 `<foreignObject>` 里嵌 HTML。
     *
     * 两个理由,第二个是硬性的:
     *   ① 导出的 SVG 不依赖 HTML 命名空间,粘到别处也长得一样;
     *   ② **DOMPurify 会把 foreignObject 的子节点清空**(它把这类节点当 HTML 集成点处理),
     *      结果是每个节点都变成一个没有文字的色块 —— 净化那一关和「能看见字」是冲突的。
     *      (v11 起 flowchart.htmlLabels 已废弃,统一读顶层这个。)
     */
    htmlLabels: false,
    // 病态输入不该把渲染线程拖死
    maxTextSize: 200_000,
    maxEdges: 800,
    flowchart: { useMaxWidth: true, curve: 'basis' },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    mindmap: { useMaxWidth: true }
  })
  appliedThemeKey = key
}

export interface MermaidResult {
  svg: string | null
  /** 渲染失败的原文(展示给用户,而不是吞掉) */
  error: string | null
}

/** 错误信息里常带一大段 mermaid 自己的位置标注,截短到能看就行 */
function tidyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const line = raw.split('\n').find((l) => l.trim() !== '') ?? raw
  return line.length > 300 ? `${line.slice(0, 300)}…` : line
}

/**
 * 渲染一张图。同一份源码 + 同一个主题只会真正渲染一次(调用方按 key 缓存结果)。
 *
 * 注意 `render` 的 id 参数:mermaid 用它生成 `#id` 作用域的 `<style>` 与内部引用,
 * 重复使用同一个 id 会让两张图互相串样式,所以这里给每次都不同的序号。
 */
export async function renderMermaid(code: string, theme: 'light' | 'dark'): Promise<MermaidResult> {
  const trimmed = code.trim()
  if (trimmed === '') return { svg: null, error: null }
  try {
    await ensureInit(theme)
    const { mermaid, purify } = await load()
    const id = `mmd-${++seq}`
    const { svg } = await mermaid.render(id, trimmed)
    // ② 第二道闸。保留 <style>(mermaid 的配色几乎全在里面),
    //    但脚本、外链、事件处理器一律清掉。
    //    只开 svg profile:标签走 <text>(见上面 htmlLabels),不需要 HTML 命名空间 ——
    //    开的门越少越好。
    const clean = purify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['style'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'audio', 'video', 'link', 'meta', 'base', 'form'],
      FORBID_ATTR: ['srcset', 'formaction', 'ping'],
      ALLOW_DATA_ATTR: false
    })
    return { svg: clean, error: null }
  } catch (err) {
    return { svg: null, error: tidyError(err) }
  }
}

/**
 * 主题变了(用户切换深浅色)要作废已渲染的图 ——
 * 缓存键由调用方带上主题,这里只负责把 mermaid 的全局配置标记为过期。
 */
export function invalidateMermaidTheme(): void {
  appliedThemeKey = ''
}
