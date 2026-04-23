import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

type OutputFormat = 'csv' | 'xlsx'

export default function SqlToCsv({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })

  const [format, setFormat] = useState<OutputFormat>('csv')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ tableCount: number; rowCount: number; files?: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canRun = !!sql || !!filePath

  async function handleExecute() {
    setProcessing(true); setError(null); setResult(null)
    try {
      const input = isLarge && filePath ? filePath : sql

      if (format === 'csv') {
        // 弹出保存对话框（单表 → .csv 文件，多表 → 选目录）
        const savePath = window.ztools.showSaveDialog({
          defaultPath: 'output.csv',
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        })
        if (!savePath) { setProcessing(false); return }
        const res = window.services.sqlToCsv(input, savePath)
        setResult(res)
        window.ztools.showNotification(`导出完成，共 ${res.tableCount} 张表 ${res.rowCount} 行`)
      } else {
        const savePath = window.ztools.showSaveDialog({
          defaultPath: 'output.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        })
        if (!savePath) { setProcessing(false); return }
        const res = window.services.sqlToXlsx(input, savePath)
        setResult(res)
        window.ztools.showNotification(`导出完成，共 ${res.tableCount} 张表 ${res.rowCount} 行`)
      }
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(msg)
      window.ztools.showNotification(`导出失败: ${msg}`)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <PageLayout title="SQL → CSV / Excel" description="将 INSERT 语句中的数据导出为 CSV 或 xlsx 文件，多表自动分 Sheet。">
      <div className="section">
        <FileInput
          value={sql}
          filePath={filePath}
          isLarge={isLarge}
          onChange={(v, p, l) => { setSql(v); setFilePath(p); setIsLarge(l); setResult(null) }}
        />
      </div>

      <div className="section">
        <div className="label">输出格式</div>
        <div className="row">
          {(['csv', 'xlsx'] as OutputFormat[]).map((f) => (
            <label key={f} className="row" style={{ cursor: 'pointer' }}>
              <input type="radio" name="format" checked={format === f}
                onChange={() => setFormat(f)} style={{ accentColor: 'var(--accent)' }} />
              <span>{f === 'csv' ? 'CSV（单表一个文件）' : 'Excel xlsx（多表多 Sheet）'}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="row">
        <button onClick={handleExecute} disabled={!canRun || processing}>
          {processing ? '导出中...' : '选择保存位置并导出'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="section">
          <p className="success">
            导出成功！{result.tableCount} 张表，共 {result.rowCount} 行数据
          </p>
          {result.files && result.files.length > 1 && (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
              {result.files.map((f) => <div key={f}>{f}</div>)}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  )
}
