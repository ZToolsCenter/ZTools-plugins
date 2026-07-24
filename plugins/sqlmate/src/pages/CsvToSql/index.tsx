import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { ResultPanel } from '../../components/ResultPanel'
import { ProgressBar } from '../../components/ProgressBar'

type InputFormat = 'csv' | 'xlsx'

export default function CsvToSql({ enterAction }: { enterAction?: any }) {
  const [inputFormat, setInputFormat] = useState<InputFormat>('csv')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [tableName, setTableName] = useState('')
  const [noHeader, setNoHeader] = useState(false)
  const [batchSize, setBatchSize] = useState(0)
  const [detectNumeric, setDetectNumeric] = useState(true)
  const [result, setResult] = useState<{ sql: string; rowCount: number; tableCount?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [progressInfo, setProgressInfo] = useState<{ rowsRead: number; totalRows?: number; pct?: number } | null>(null)

  function handleSelectFile() {
    const ext = inputFormat === 'csv' ? ['csv', 'txt'] : ['xlsx', 'xls']
    const paths = window.ztools.showOpenDialog({
      filters: [{ name: inputFormat === 'csv' ? 'CSV' : 'Excel', extensions: ext }],
    })
    if (paths && paths.length > 0) {
      setFilePath(paths[0])
      setResult(null)
      setError(null)
      // 自动用文件名（去扩展名）作为表名
      if (!tableName) {
        const name = paths[0].split(/[\\/]/).pop()?.replace(/\.\w+$/, '') ?? ''
        setTableName(name)
      }
    }
  }

  const canRun = !!filePath && (inputFormat === 'xlsx' || !!tableName.trim())

  async function handleExecute() {
    if (!filePath) return
    setProcessing(true); setError(null); setResult(null); setProgressInfo(null)
    try {
      if (inputFormat === 'csv') {
        const res = await window.services.csvToSql(filePath, {
          tableName: tableName.trim(),
          noHeader,
          batchSize: batchSize > 0 ? batchSize : 0,
          detectNumeric,
          onProgress: (info: { rowsRead: number; totalRows: number; pct: number }) => setProgressInfo(info),
        })
        setResult(res)
      } else {
        const res = await window.services.xlsxToSql(filePath, {
          noHeader,
          batchSize: batchSize > 0 ? batchSize : 0,
          detectNumeric,
          tableNameOverride: tableName.trim() || undefined,
          onProgress: (info: { rowsRead: number; totalRows: number; pct: number }) => setProgressInfo(info),
        })
        setResult(res)
      }
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(msg)
      window.ztools.showNotification(`转换失败: ${msg}`)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <PageLayout title="CSV / Excel → SQL" description="将 CSV 或 xlsx 文件转换为 INSERT 语句，支持批量插入和数值自动检测。">
      <div className="section">
        <div className="label">输入格式</div>
        <div className="row">
          {(['csv', 'xlsx'] as InputFormat[]).map((f) => (
            <label key={f} className="row" style={{ cursor: 'pointer' }}>
              <input type="radio" name="inputFormat" checked={inputFormat === f}
                onChange={() => { setInputFormat(f); setFilePath(null); setResult(null) }}
                style={{ accentColor: 'var(--accent)' }} />
              <span>{f === 'csv' ? 'CSV' : 'Excel xlsx'}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="label">选择文件</div>
        <div className="row">
          <button onClick={handleSelectFile} style={{ flexShrink: 0 }}>选择文件</button>
          {filePath && (
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filePath.split(/[\\/]/).pop()}
            </span>
          )}
        </div>
      </div>

      <div className="section">
        <div className="label">目标表名{inputFormat === 'xlsx' ? '（xlsx 多 Sheet 时留空则用 Sheet 名）' : '（必填）'}</div>
        <input type="text" value={tableName} onChange={(e) => setTableName(e.target.value)}
          placeholder={inputFormat === 'xlsx' ? '留空使用 Sheet 名' : '例如: users'}
          style={{ width: '240px' }} />
      </div>

      <div className="section">
        <div className="label">选项</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={noHeader} onChange={(e) => setNoHeader(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }} />
            <span>无列名行（第一行作为数据，列名自动生成 col1, col2...）</span>
          </label>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={detectNumeric} onChange={(e) => setDetectNumeric(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }} />
            <span>数值列自动检测（纯数字列不加引号）</span>
          </label>
          <div className="row">
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', flexShrink: 0 }}>批量 INSERT 每批行数</span>
            <input type="number" min={0} value={batchSize}
              onChange={(e) => setBatchSize(parseInt(e.target.value, 10) || 0)}
              style={{ width: 100 }} />
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>（0 = 单行模式）</span>
          </div>
        </div>
      </div>

      <div className="row">
        <button onClick={handleExecute} disabled={!canRun || processing}>
          {processing ? '转换中...' : '执行转换'}
        </button>
      </div>

      {processing && (
        progressInfo && progressInfo.totalRows
          ? <ProgressBar
              pct={progressInfo.pct ?? 50}
              label={`已处理 ${progressInfo.rowsRead.toLocaleString()} / ${progressInfo.totalRows.toLocaleString()} 行`}
            />
          : progressInfo
          ? <ProgressBar indeterminate label={`已读取 ${progressInfo.rowsRead.toLocaleString()} 行`} />
          : <ProgressBar indeterminate />
      )}

      {error && <p className="error">{error}</p>}

      {result && result.sql && (
        <ResultPanel
          content={result.sql}
          filename="output.sql"
          meta={
            <span>
              {result.tableCount !== undefined ? `${result.tableCount} 张表，` : ''}
              共 {result.rowCount} 行数据
            </span>
          }
        />
      )}
    </PageLayout>
  )
}
