import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { ProgressBar } from '../../components/ProgressBar'
import { ResultPanel } from '../../components/ResultPanel'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

interface Rule {
  id: number
  type: 'table' | 'column' | 'prefix'
  from: string
  to: string
}

let uid = 0

export default function Rename({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })
  const [rules, setRules] = useState<Rule[]>([{ id: ++uid, type: 'table', from: '', to: '' }])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ sql?: string; replacedCount: number } | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  function addRule() {
    setRules((r) => [...r, { id: ++uid, type: 'table', from: '', to: '' }])
  }

  function removeRule(id: number) {
    setRules((r) => r.filter((x) => x.id !== id))
  }

  function updateRule(id: number, patch: Partial<Rule>) {
    setRules((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  const canRun = (!!sql || !!filePath) && rules.length > 0 && rules.every((r) => r.from && r.to)

  async function handleExecute() {
    setProcessing(true); setProgress(0); setResult(null)
    try {
      let outputPath: string | null = null
      if (isLarge) {
        const p = window.ztools.showSaveDialog({ defaultPath: 'renamed.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] })
        if (!p) { setProcessing(false); return }
        outputPath = p
      }
      const res = await window.services.rename(
        isLarge ? filePath! : sql,
        outputPath,
        rules.map(({ type, from, to }) => ({ type, from, to })),
        (pct) => setProgress(pct)
      )
      setResult(res)
      if (isLarge && outputPath) { setSavedPath(outputPath); window.ztools.showNotification('处理完成，已保存') }
    } catch (err: any) {
      window.ztools.showNotification(`处理失败: ${err.message || err}`)
    } finally {
      setProcessing(false)
    }
  }

  const TYPE_LABELS: Record<string, string> = { table: '表名（精确）', column: '列名', prefix: '表名前缀' }

  return (
    <PageLayout title="表名/列名替换" description="批量替换 INSERT 语句中的表名或列名">
      <div className="section">
        <FileInput value={sql} filePath={filePath} isLarge={isLarge}
          onChange={(v, p, l) => { setSql(v); setFilePath(p); setIsLarge(l); setResult(null) }} />
      </div>

      <div className="section">
        <div className="label">替换规则</div>
        {rules.map((rule) => (
          <div key={rule.id} className="row" style={{ marginBottom: 6 }}>
            <select value={rule.type} onChange={(e) => updateRule(rule.id, { type: e.target.value as any })} style={{ width: 110 }}>
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="text" placeholder="原名称" value={rule.from} onChange={(e) => updateRule(rule.id, { from: e.target.value })} style={{ flex: 1 }} />
            <span style={{ color: 'var(--fg-muted)' }}>→</span>
            <input type="text" placeholder="新名称" value={rule.to} onChange={(e) => updateRule(rule.id, { to: e.target.value })} style={{ flex: 1 }} />
            <button onClick={() => removeRule(rule.id)} style={{ background: 'var(--danger)', padding: '4px 8px', fontSize: 12 }}>✕</button>
          </div>
        ))}
        <button onClick={addRule} style={{ background: 'transparent', color: 'var(--accent)', border: '1px dashed var(--accent)', marginTop: 4 }}>+ 添加规则</button>
      </div>

      <div className="row">
        <button onClick={handleExecute} disabled={!canRun || processing}>
          {processing ? '处理中...' : '执行替换'}
        </button>
      </div>

      {processing && <ProgressBar pct={progress} />}

      {result && !isLarge && result.sql && (
        <ResultPanel content={result.sql} filename="renamed.sql"
          meta={<span>已替换 <b>{result.replacedCount}</b> 行</span>} />
      )}
      {result && isLarge && (
        <div>
          <p className="success">处理完成！共替换 {result.replacedCount} 行</p>
          {savedPath && <button className="file-input__btn file-input__btn--ghost" style={{ marginTop: 8 }}
            onClick={() => window.ztools.shellShowItemInFolder(savedPath)}>在文件管理器中显示</button>}
        </div>
      )}
    </PageLayout>
  )
}
