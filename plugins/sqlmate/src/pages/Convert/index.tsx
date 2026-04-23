import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { ProgressBar } from '../../components/ProgressBar'
import { ResultPanel } from '../../components/ResultPanel'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

type ConvertMode = 'update' | 'mysql_upsert' | 'pg_upsert' | 'insert_ignore'

const MODE_LABELS: { value: ConvertMode; label: string; desc: string }[] = [
  { value: 'update',        label: 'UPDATE',              desc: 'UPDATE t SET ... WHERE pk=val' },
  { value: 'mysql_upsert',  label: 'MySQL UPSERT',        desc: 'INSERT ... ON DUPLICATE KEY UPDATE' },
  { value: 'pg_upsert',     label: 'PostgreSQL UPSERT',   desc: 'INSERT ... ON CONFLICT DO UPDATE' },
  { value: 'insert_ignore', label: 'INSERT IGNORE',       desc: '无需主键配置' },
]

export default function Convert({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })
  const [mode, setMode] = useState<ConvertMode>('update')
  const [pkType, setPkType] = useState<'name' | 'index'>('name')
  const [pkColumn, setPkColumn] = useState('')
  const [pkColIndex, setPkColIndex] = useState(1)
  const [excludeColumns, setExcludeColumns] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ sql?: string; convertedCount: number; skippedCount: number } | null>(null)

  const needsPk = mode !== 'insert_ignore'
  const canRun = (!!sql || !!filePath) &&
    (!needsPk || (pkType === 'name' ? !!pkColumn.trim() : pkColIndex >= 1))

  async function handleExecute() {
    setProcessing(true); setProgress(0); setResult(null)
    try {
      let outputPath: string | null = null
      if (isLarge) {
        const p = window.ztools.showSaveDialog({ defaultPath: 'converted.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] })
        if (!p) { setProcessing(false); return }
        outputPath = p
      }

      const excludeArr = excludeColumns.split(',').map((s) => s.trim()).filter(Boolean)

      const res = await window.services.convert(
        isLarge ? filePath! : sql,
        outputPath,
        {
          mode,
          pkColumn: needsPk && pkType === 'name' ? pkColumn.trim() : undefined,
          pkColIndex: needsPk && pkType === 'index' ? pkColIndex : undefined,
          excludeColumns: excludeArr.length > 0 ? excludeArr : undefined,
          onProgress: (pct) => setProgress(pct),
        }
      )
      setResult(res)
      if (isLarge) window.ztools.showNotification('处理完成，已保存')
    } catch (err: any) {
      window.ztools.showNotification(`处理失败: ${err.message || err}`)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <PageLayout title="语句改写" description="将 INSERT 语句改写为 UPDATE / UPSERT / INSERT IGNORE">
      <div className="section">
        <FileInput value={sql} filePath={filePath} isLarge={isLarge}
          onChange={(v, p, l) => { setSql(v); setFilePath(p); setIsLarge(l); setResult(null) }} />
      </div>

      <div className="section">
        <div className="label">改写模式</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MODE_LABELS.map(({ value, label, desc }) => (
            <label key={value} className="row" style={{ cursor: 'pointer' }}>
              <input type="radio" name="mode" value={value} checked={mode === value}
                onChange={() => setMode(value)} style={{ accentColor: 'var(--accent)' }} />
              <span style={{ fontWeight: 500 }}>{label}</span>
              <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{desc}</span>
            </label>
          ))}
        </div>
      </div>

      {needsPk && (
        <div className="section">
          <div className="label">主键配置</div>
          <div className="row">
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="radio" checked={pkType === 'name'} onChange={() => setPkType('name')} style={{ accentColor: 'var(--accent)' }} />
              <span>列名</span>
            </label>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="radio" checked={pkType === 'index'} onChange={() => setPkType('index')} style={{ accentColor: 'var(--accent)' }} />
              <span>列序号</span>
            </label>
            {pkType === 'name'
              ? <input type="text" placeholder="例如: id" value={pkColumn} onChange={(e) => setPkColumn(e.target.value)} />
              : <input type="number" min={1} value={pkColIndex} onChange={(e) => setPkColIndex(parseInt(e.target.value, 10))} style={{ width: 80 }} />
            }
          </div>
        </div>
      )}

      <div className="section">
        <div className="label">排除列（SET 子句中忽略，逗号分隔，可选）</div>
        <input type="text" placeholder="例如: created_at, updated_at" value={excludeColumns}
          onChange={(e) => setExcludeColumns(e.target.value)} style={{ width: '100%' }} />
      </div>

      <div className="row">
        <button onClick={handleExecute} disabled={!canRun || processing}>
          {processing ? '处理中...' : '执行改写'}
        </button>
      </div>

      {processing && <ProgressBar pct={progress} />}

      {result && !isLarge && result.sql && (
        <ResultPanel content={result.sql} filename="converted.sql"
          meta={<span>成功转换 <b>{result.convertedCount}</b> 行，跳过 {result.skippedCount} 行</span>} />
      )}
      {result && isLarge && (
        <p className="success">处理完成！成功转换 {result.convertedCount} 行，跳过 {result.skippedCount} 行</p>
      )}
    </PageLayout>
  )
}
