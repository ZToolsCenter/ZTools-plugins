import { useState } from 'react'
import { FileInput } from '../../components/FileInput'
import { ResultPanel } from '../../components/ResultPanel'
import { ProgressBar } from '../../components/ProgressBar'
import { PageLayout } from '../../components/PageLayout'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

export default function Extract({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })

  const [tables, setTables] = useState<{ name: string; count: number }[]>([])
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ sql?: string; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleScan = async () => {
    if (!sql && !filePath) return
    setScanning(true)
    setProgress(0)
    setError(null)
    setTables([])
    setResult(null)
    try {
      const input = isLarge && filePath ? filePath : sql
      const res = await window.services.scanTables(input, setProgress)
      setTables(res)
      setSelectedTables(new Set())
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(`扫描失败: ${msg}`)
      window.ztools.showNotification(`扫描失败: ${msg}`)
    } finally {
      setScanning(false)
    }
  }

  const handleExtract = async () => {
    if (selectedTables.size === 0) return
    if (!sql && !filePath) return

    let outputPath: string | null = null
    if (isLarge) {
      outputPath = window.ztools.showSaveDialog({
        defaultPath: 'extracted.sql',
        filters: [{ name: 'SQL', extensions: ['sql'] }]
      })
      if (!outputPath) return
    }

    setExtracting(true)
    setProgress(0)
    setError(null)
    try {
      const input = isLarge && filePath ? filePath : sql
      const res = await window.services.extractTables(
        input,
        Array.from(selectedTables),
        outputPath,
        setProgress
      )
      setResult(res)
      if (isLarge) window.ztools.showNotification('抽取完成，文件已保存')
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(`抽取失败: ${msg}`)
      window.ztools.showNotification(`抽取失败: ${msg}`)
    } finally {
      setExtracting(false)
    }
  }

  const toggleAll = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set())
    } else {
      setSelectedTables(new Set(tables.map(t => t.name)))
    }
  }

  const toggleTable = (name: string) => {
    const next = new Set(selectedTables)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelectedTables(next)
  }

  return (
    <PageLayout title="抽取表" description="从 SQL 文件中提取指定表的语句">
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
            setTables([])
            setResult(null)
          }}
        />
        <button onClick={handleScan} disabled={scanning || (!sql && !filePath)}>
          {scanning ? '扫描中...' : '扫描表名'}
        </button>
        {scanning && <ProgressBar pct={progress} />}
        {error && <div className="error">{error}</div>}
      </div>

      {tables.length > 0 && (
        <div className="section" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">选择要抽取的表 ({selectedTables.size}/{tables.length})</div>
            <button onClick={toggleAll}>
              {selectedTables.size === tables.length ? '取消全选' : '全选'}
            </button>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
            {tables.map(t => (
              <label key={t.name} className="row" style={{ padding: '4px 0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedTables.has(t.name)}
                  onChange={() => toggleTable(t.name)}
                />
                <span style={{ flex: 1 }}>{t.name}</span>
                <span className="label" style={{ marginBottom: 0 }}>{t.count} 条语句</span>
              </label>
            ))}
          </div>
          <button onClick={handleExtract} disabled={extracting || selectedTables.size === 0}>
            {extracting ? '抽取中...' : '抽取所选表'}
          </button>
          {extracting && <ProgressBar pct={progress} />}
        </div>
      )}

      {result && (
        <div className="section" style={{ marginTop: 16 }}>
          <div className="success">抽取完成！共抽取 {result.count} 条语句。</div>
          {result.sql && (
            <ResultPanel
              content={result.sql}
              meta={`抽取了 ${selectedTables.size} 个表`}
            />
          )}
        </div>
      )}
    </PageLayout>
  )
}
