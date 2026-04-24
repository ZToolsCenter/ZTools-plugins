import { useState, useEffect } from 'react'
import { FileInput } from '../../components/FileInput'
import { ProgressBar } from '../../components/ProgressBar'
import { PageLayout } from '../../components/PageLayout'
import './index.css'

export default function Stats({ enterAction }: { enterAction: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (enterAction?.type === 'files' && enterAction.payload?.length > 0) {
      const file = enterAction.payload[0]
      const path = window.ztools.getPathForFile(file)
      const large = file.size > 10 * 1024 * 1024
      if (large) {
        setSql('')
        setFilePath(path)
        setIsLarge(true)
      } else {
        const reader = new FileReader()
        reader.onload = (e) => {
          setSql(e.target?.result as string)
          setFilePath(path)
          setIsLarge(false)
        }
        reader.readAsText(file, 'utf-8')
      }
    }
  }, [enterAction])

  async function handleExecute() {
    const input = filePath || sql
    if (!input) return

    setError(null)
    setResult(null)
    setProgress(0)
    setProcessing(true)

    try {
      const res = await window.services.analyze(input, (pct) => setProgress(pct))
      setResult(res)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setProcessing(false)
      setProgress(null)
    }
  }

  function handleCopyMarkdown() {
    if (!result) return
    const md = window.services.statsToMarkdown(result)
    window.ztools.copyText(md)
    window.ztools.showNotification('Markdown 已复制')
  }

  function handleCopyCsv() {
    if (!result) return
    const csv = window.services.statsToCsv(result)
    window.ztools.copyText(csv)
    window.ztools.showNotification('CSV 已复制')
  }

  return (
    <PageLayout title="SQL 统计" description="分析 SQL 文件中的表、行数、大小等信息。">
      <div className="section">
        <div className="label">输入 SQL</div>
        <FileInput
          value={sql}
          filePath={filePath}
          isLarge={isLarge}
          onChange={(v, p, large) => {
            setSql(v)
            setFilePath(p)
            setIsLarge(large)
            setResult(null)
            setError(null)
          }}
        />
      </div>

      <div className="section stats-config">
        <div className="row">
          <button onClick={handleExecute} disabled={processing || (!sql && !filePath)}>
            {processing ? '分析中...' : '执行分析'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {progress !== null && <ProgressBar pct={progress} />}
      </div>

      {result && (
        <div className="section">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
            <div className="label" style={{ marginBottom: 0 }}>分析结果</div>
            <div className="row">
              <button onClick={handleCopyMarkdown} className="stats-btn-ghost">复制 Markdown</button>
              <button onClick={handleCopyCsv} className="stats-btn-ghost">复制 CSV</button>
            </div>
          </div>
          
          <div className="stats-summary">
            <div className="stats-summary-item">
              <div className="stats-summary-label">总行数</div>
              <div className="stats-summary-value">{result.totalRows.toLocaleString()}</div>
            </div>
            <div className="stats-summary-item">
              <div className="stats-summary-label">总语句数</div>
              <div className="stats-summary-value">{result.totalStatements.toLocaleString()}</div>
            </div>
            <div className="stats-summary-item">
              <div className="stats-summary-label">输入大小</div>
              <div className="stats-summary-value">{window.services.formatBytes(result.inputBytes)}</div>
            </div>
            <div className="stats-summary-item">
              <div className="stats-summary-label">耗时</div>
              <div className="stats-summary-value">{result.durationMs} ms</div>
            </div>
          </div>

          <div className="stats-table-container">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>表名</th>
                  <th style={{ textAlign: 'right' }}>行数</th>
                  <th style={{ textAlign: 'right' }}>预估大小</th>
                </tr>
              </thead>
              <tbody>
                {result.tables.map((t: any, i: number) => (
                  <tr key={i}>
                    <td>{t.tableName}</td>
                    <td style={{ textAlign: 'right' }}>{t.rowCount.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{window.services.formatBytes(t.estimatedBytes)}</td>
                  </tr>
                ))}
                {result.tables.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>
                      未找到表数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
