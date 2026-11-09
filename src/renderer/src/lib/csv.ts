// RFC 4180 风格的分隔文本解析(CSV / TSV),只用于表格预览。
//
// 只解析**当前编辑文本**的前一段:表格预览是辅助视图,不是数据导入器。
// 引号内的分隔符与换行按规范处理;`""` 是转义的双引号;行尾 CRLF / LF / CR 都算换行。
// 超出上限时停在正好能判断「还有更多」的位置,并如实回报两个 truncated 标志。

export interface DelimitedTable {
  rows: string[][]
  truncatedRows: boolean
  truncatedCols: boolean
}

export function parseDelimited(
  text: string,
  delimiter: string,
  maxRows: number,
  maxCols: number
): DelimitedTable {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let truncatedCols = false
  let truncatedRows = false

  const pushCell = (): void => {
    if (row.length < maxCols) row.push(cell)
    else truncatedCols = true
    cell = ''
  }
  const pushRow = (): boolean => {
    pushCell()
    rows.push(row)
    row = []
    return rows.length >= maxRows
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      pushCell()
      continue
    }
    if (ch === '\n' || ch === '\r') {
      const stop = pushRow()
      if (ch === '\r' && text[i + 1] === '\n') i++
      if (stop) {
        // 还有剩余内容才算截断;正好结束则不算
        if (i < text.length - 1) truncatedRows = true
        return { rows, truncatedRows, truncatedCols }
      }
      continue
    }
    cell += ch
  }

  // 没有以换行结尾的最后一行
  if (cell !== '' || row.length > 0) {
    if (rows.length < maxRows) {
      pushCell()
      rows.push(row)
    } else {
      truncatedRows = true
    }
  }

  return { rows, truncatedRows, truncatedCols }
}
