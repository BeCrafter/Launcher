// 表格骨架的生成(纯函数)。
//
// 单独一个文件是为了能直接测:它是「用户点了 3×4 之后写进正文的东西」,
// 列数对不上、分隔行少一列,预览里就是一张错位的表 —— 而 TypeScript 看不出这种错。

/**
 * 生成一张 GFM 表格骨架。
 *
 * 表头给占位名而不是留空:全空的表头在预览里是一片没有边界感的格子,
 * 用户第一眼分不清哪一行是表头。
 *
 * @param rows 总行数(**含表头**),所以 3 行 = 1 表头 + 2 空行
 * @param cols 列数
 * @param colName 第 i 列(从 1 开始)的占位名,由调用方给(要走 i18n)
 */
export function tableSkeleton(rows: number, cols: number, colName: (i: number) => string): string {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  const cells = (n: number, fill: (i: number) => string): string =>
    `| ${Array.from({ length: c }, (_, i) => fill(i + 1)).join(' | ')} |`

  return [
    '',
    cells(c, colName),
    cells(c, () => '---'),
    // 表头已经占掉一行,正文行数要减掉它
    ...Array.from({ length: Math.max(0, r - 1) }, () => cells(c, () => '  ')),
    ''
  ].join('\n')
}
