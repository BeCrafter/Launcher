// CSV / TSV 表格视图:从**当前编辑文本**解析(不必等保存),截断到上限并如实提示。

import { useMemo } from 'react'
import { CSV_PREVIEW_BYTES, CSV_PREVIEW_COLS, CSV_PREVIEW_ROWS } from '@shared/notes'
import { useT } from '../../../hooks/useT'
import { parseDelimited } from '../../../lib/csv'

export function CsvView({ text, tsv }: { text: string; tsv: boolean }): React.JSX.Element {
  const t = useT()
  const table = useMemo(
    () =>
      parseDelimited(
        text.length > CSV_PREVIEW_BYTES ? text.slice(0, CSV_PREVIEW_BYTES) : text,
        tsv ? '\t' : ',',
        CSV_PREVIEW_ROWS,
        CSV_PREVIEW_COLS
      ),
    [text, tsv]
  )

  if (table.rows.length === 0) {
    return (
      <div className="file-placeholder">
        <i className="fa-solid fa-table-cells" />
        <div>{t('notes.file.csvEmpty')}</div>
      </div>
    )
  }

  const [head, ...body] = table.rows
  return (
    <div className="file-csv">
      {(table.truncatedRows || table.truncatedCols || text.length > CSV_PREVIEW_BYTES) && (
        <div className="file-csv-note">
          <i className="fa-solid fa-scissors" />
          {t('notes.file.csvTruncated')
            .replace('{ROWS}', String(CSV_PREVIEW_ROWS))
            .replace('{COLS}', String(CSV_PREVIEW_COLS))}
        </div>
      )}
      <div className="file-csv-scroll">
        <table className="file-csv-table" data-csv-table>
          <thead>
            <tr>
              <th className="file-csv-no" />
              {head.map((cell, i) => (
                <th key={i}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                <td className="file-csv-no">{r + 1}</td>
                {head.map((_, c) => (
                  <td key={c}>{row[c] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
