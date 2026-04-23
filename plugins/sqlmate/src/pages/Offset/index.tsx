import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { ProgressBar } from '../../components/ProgressBar'
import { ResultPanel } from '../../components/ResultPanel'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

interface Rule {
  id: number
  column: string
  offset: number
}

let uid = 0

export default function Offset({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })
  const [rules, setRules] = useState<Rule[]>([{ id: ++uid, column: '', offset: 1000000 }])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ sql?: string; modifiedCount: number; skippedCount: number; warnings: string[] } | null>(null)

  function addRule() {
    setRules((r) => [...r, { id: ++uid, column: '', offset: 1000000 }])
  }

  function removeRule(id: number) {
    setRules((r) => r.filter((x) => x.id !== id))
  }

  function updateRule(id: number, patch: Partial<Rule>) {
    setRules((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  const canRun = (!!sql || !!filePath) && rules.length > 0 && rules.every((r) => r.column && !isNaN(r.offset))

  async function handleExecute() {
    setProcessing(true); setProgress(0); setResult(null)
    try {
      let outputPath: string | null = null
      if (isLarge) {
        const p = window.ztools.showSaveDialog({ defaultPath: 'offset.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] })
        if (!p) { setProcessing(false); return }
        outputPath = p
      }
      const res = await window.services.offset(
        isLarge ? filePath! : sql,
        outputPath,
        rules.map(({ column, offset }) => ({ column, offset })),
        (pct) => setProgress(pct)
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
    <PageLayout title="主键 ID 偏移" description="对指定数值列加上固定偏移量，避免合库主键冲突">
      <div className="section">
        <FileInput value={sql} filePath={filePath} isLarge={isLarge}
          onChange={(v, p, l) => { setSql(v); setFilePath(p); setIsLarge(l); setResult(null) }} />
      </div>

      <div className="section">
        <div className="label">偏移规则</div>
        {rules.map((rule) => (
          <div key={rule.id} className="row" style={{ marginBottom: 6 }}>
            <input type="text" placeholder="列名（如 id）" value={rule.column}
              onChange={(e) => updateRule(rule.id, { column: e.target.value })} style={{ flex: 1 }} />
            <span style={{ color: 'var(--fg-muted)', flexShrink: 0 }}>偏移量</span>
            <input type="number" value={rule.offset}
              onChange={(e) => updateRule(rule.id, { offset: parseInt(e.target.value, 10) })}
              style={{ width: 120 }} />
            <button onClick={() => removeRule(rule.id)} style={{ background: 'var(--danger)', padding: '4px 8px', fontSize: 12 }}>✕</button>
          </div>
        ))}
        <button onClick={addRule} style={{ background: 'transparent', color: 'var(--accent)', border: '1px dashed var(--accent)', marginTop: 4 }}>+ 添加规则</button>
      </div>

      <div className="row">
        <button onClick={handleExecute} disabled={!canRun || processing}>
          {processing ? '处理中...' : '执行偏移'}
        </button>
      </div>

      {processing && <ProgressBar pct={progress} />}

      {result && !isLarge && result.sql && (
        <ResultPanel content={result.sql} filename="offset.sql"
          meta={
            <span>修改 <b>{result.modifiedCount}</b> 行，跳过 {result.skippedCount} 行
              {result.warnings.length > 0 && <span className="error"> · {result.warnings.join('; ')}</span>}
            </span>
          } />
      )}
      {result && isLarge && (
        <div>
          <p className="success">处理完成！修改 {result.modifiedCount} 行，跳过 {result.skippedCount} 行</p>
          {result.warnings.map((w, i) => <p key={i} className="error">{w}</p>)}
        </div>
      )}
    </PageLayout>
  )
}
