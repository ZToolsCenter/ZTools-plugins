import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { ProgressBar } from '../../components/ProgressBar'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

type OutputFormat = 'csv' | 'xlsx'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function SqlToCsv({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })

  const [format, setFormat] = useState<OutputFormat>('csv')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<{ pct: number; bytesRead: number; totalBytes: number; rowCount?: number } | null>(null)
  const [result, setResult] = useState<{
    tableCount: number; sheetCount?: number; rowCount: number
    files?: string[]; outputDir?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // xlsx 格式内存限制：XLSX 库必须全量构建 workbook，超过此大小会 OOM
  const XLSX_MAX_BYTES = 200 * 1024 * 1024 // 200 MB

  const canRun = !!sql || !!filePath

  async function handleExecute() {
    setProcessing(true); setError(null); setResult(null); setProgress(null)
    try {
      const input = isLarge && filePath ? filePath : sql

      // xlsx 格式大文件拦截
      if (format === 'xlsx' && filePath) {
        const fileSize = window.services.getFileSize(filePath)
        if (fileSize > XLSX_MAX_BYTES) {
          setError(`文件过大（${formatBytes(fileSize)}），xlsx 格式最大支持 200MB。请改用 CSV 格式，CSV 支持任意大小文件。`)
          setProcessing(false)
          return
        }
      }

      const onProgress = (info: { bytesRead: number; totalBytes: number; pct: number; rowCount?: number }) => {
        setProgress(info)
      }

      if (format === 'csv') {
        // CSV 统一选目录：单表 / 多表 / 分片文件都直接输出到该目录
        const dirs = window.ztools.showOpenDialog({
          title: '选择输出目录',
          properties: ['openDirectory', 'createDirectory'],
        })
        if (!dirs || dirs.length === 0) { setProcessing(false); return }
        const outputDir = dirs[0]
        const res = await window.services.sqlToCsv(input, outputDir, { onProgress })
        setResult({ ...res, outputDir })
        window.ztools.showNotification(`导出完成，共 ${res.tableCount} 张表 ${res.rowCount.toLocaleString()} 行`)
      } else {
        const savePath = window.ztools.showSaveDialog({
          defaultPath: 'output.xlsx',
          filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        })
        if (!savePath) { setProcessing(false); return }
        const res = await window.services.sqlToXlsx(input, savePath, { onProgress })
        setResult({ ...res, files: [savePath], outputDir: savePath.replace(/[\\/][^\\/]+$/, '') })
        window.ztools.showNotification(`导出完成，共 ${res.tableCount} 张表 ${res.rowCount.toLocaleString()} 行`)
      }
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(msg)
      window.ztools.showNotification(`导出失败: ${msg}`)
    } finally {
      setProcessing(false)
    }
  }

  function handleShowInFolder() {
    if (!result) return
    // 优先显示第一个文件；无文件时显示目录
    const target = result.files?.[0] ?? result.outputDir
    if (target) window.ztools.shellShowItemInFolder(target)
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
              <span>{f === 'csv' ? 'CSV（选择输出目录）' : 'Excel xlsx（多表多 Sheet）'}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="row">
        <button onClick={handleExecute} disabled={!canRun || processing}>
          {processing ? '导出中...' : format === 'csv' ? '选择输出目录并导出' : '选择保存位置并导出'}
        </button>
      </div>

      {processing && (
        progress && progress.totalBytes > 0
          ? <ProgressBar
              pct={progress.pct}
              label={
                progress.rowCount !== undefined && progress.rowCount > 0
                  ? `已写出 ${progress.rowCount.toLocaleString()} 行 · ${formatBytes(progress.bytesRead)} / ${formatBytes(progress.totalBytes)}`
                  : `读取中 ${formatBytes(progress.bytesRead)} / ${formatBytes(progress.totalBytes)}`
              }
            />
          : <ProgressBar indeterminate />
      )}

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="section">
          <p className="success">
            导出成功！{result.tableCount} 张表，共 {result.rowCount.toLocaleString()} 行数据
            {result.sheetCount !== undefined && result.sheetCount > result.tableCount &&
              ` · 自动拆分为 ${result.sheetCount} 个 Sheet（每 Sheet ≤ 100 万行）`}
            {result.files && result.files.length > result.tableCount &&
              ` · 自动拆分为 ${result.files.length} 个文件（每文件 ≤ 100 万行）`}
          </p>
          {result.files && result.files.length > 1 && (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
              {result.files.map((f) => <div key={f}>{f.split(/[\\/]/).pop()}</div>)}
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="file-input__btn file-input__btn--ghost" onClick={handleShowInFolder}>
              在文件管理器中显示
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
