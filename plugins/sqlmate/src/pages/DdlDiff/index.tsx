import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { ResultPanel } from '../../components/ResultPanel'

export default function DdlDiff() {
  const [srcDdl, setSrcDdl] = useState('')
  const [dstDdl, setDstDdl] = useState('')
  const [dialect, setDialect] = useState<DdlDialect>('mysql')
  const [includeIndexes, setIncludeIndexes] = useState(true)
  const [result, setResult] = useState<{ diff: DdlDiffResult; alterSql: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleDiff = () => {
    if (!srcDdl || !dstDdl) return
    setError(null)
    try {
      const res = window.services.ddlDiff(srcDdl, dstDdl, dialect, includeIndexes)
      setResult(res)
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(msg)
      window.ztools.showNotification(`对比失败: ${msg}`)
    }
  }

  const getStatusColor = (kind: string) => {
    switch (kind) {
      case 'added': return 'var(--success)'
      case 'removed': return 'var(--danger)'
      case 'modified': return '#f0a500'
      default: return 'var(--fg)'
    }
  }

  const getStatusText = (kind: string) => {
    switch (kind) {
      case 'added': return '新增'
      case 'removed': return '删除'
      case 'modified': return '修改'
      default: return kind
    }
  }

  return (
    <PageLayout title="结构对比" description="对比两个表的 DDL 结构差异并生成 ALTER 语句">
      <div className="section">
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="label">源表 DDL (基准)</div>
            <textarea
              value={srcDdl}
              onChange={e => {
                setSrcDdl(e.target.value)
                setResult(null)
              }}
              placeholder="CREATE TABLE src_table ..."
              style={{ width: '100%', height: 200, resize: 'vertical', fontFamily: 'monospace' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">目标表 DDL (待修改)</div>
            <textarea
              value={dstDdl}
              onChange={e => {
                setDstDdl(e.target.value)
                setResult(null)
              }}
              placeholder="CREATE TABLE dst_table ..."
              style={{ width: '100%', height: 200, resize: 'vertical', fontFamily: 'monospace' }}
            />
          </div>
        </div>

        <div className="section" style={{ marginTop: 16 }}>
          <div className="label">配置</div>
          <div className="row" style={{ gap: 24 }}>
            <div className="row">
              <span className="label" style={{ marginBottom: 0, marginRight: 8 }}>目标方言:</span>
              <label className="row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={dialect === 'mysql'}
                  onChange={() => setDialect('mysql')}
                />
                MySQL
              </label>
              <label className="row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={dialect === 'postgresql'}
                  onChange={() => setDialect('postgresql')}
                />
                PostgreSQL
              </label>
              <label className="row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={dialect === 'oracle'}
                  onChange={() => setDialect('oracle')}
                />
                Oracle
              </label>
            </div>

            <label className="row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeIndexes}
                onChange={e => setIncludeIndexes(e.target.checked)}
              />
              包含索引对比
            </label>
          </div>
        </div>

        <button
          onClick={handleDiff}
          disabled={!srcDdl || !dstDdl}
          style={{ marginTop: 16 }}
        >
          执行对比
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="section" style={{ marginTop: 24 }}>
          {!result.diff.hasChanges ? (
            <div className="success" style={{ fontSize: 14, padding: 16, background: 'var(--bg-subtle)', borderRadius: 6, textAlign: 'center' }}>
              两表结构完全相同
            </div>
          ) : (
            <>
              <div className="label" style={{ fontSize: 14, color: 'var(--fg)' }}>差异列表</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                {result.diff.columnChanges.map((change, i) => (
                  <div
                    key={`col-${i}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderLeft: `3px solid ${getStatusColor(change.kind)}`,
                      borderRadius: 6,
                      padding: 12,
                      background: 'var(--bg)'
                    }}
                  >
                    <div className="row" style={{ marginBottom: change.kind === 'modified' ? 8 : 0 }}>
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 12,
                          background: getStatusColor(change.kind),
                          color: '#fff'
                        }}
                      >
                        {getStatusText(change.kind)}字段
                      </span>
                      <span style={{ fontWeight: 500 }}>{change.column.name}</span>
                    </div>

                    {change.kind === 'modified' && change.fromColumn ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontFamily: 'monospace' }}>
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                          <span style={{ color: 'var(--fg-muted)', width: 40 }}>旧:</span>
                          <span style={{ textDecoration: 'line-through', color: 'var(--danger)' }}>
                            {change.fromColumn.fullDef}
                          </span>
                        </div>
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                          <span style={{ color: 'var(--fg-muted)', width: 40 }}>新:</span>
                          <span style={{ color: 'var(--success)' }}>
                            {change.column.fullDef}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--fg-muted)', marginTop: 4 }}>
                        {change.column.fullDef}
                      </div>
                    )}
                  </div>
                ))}

                {result.diff.indexChanges.map((change, i) => (
                  <div
                    key={`idx-${i}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderLeft: `3px solid ${getStatusColor(change.kind)}`,
                      borderRadius: 6,
                      padding: 12,
                      background: 'var(--bg)'
                    }}
                  >
                    <div className="row" style={{ marginBottom: change.kind === 'modified' ? 8 : 0 }}>
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 12,
                          background: getStatusColor(change.kind),
                          color: '#fff'
                        }}
                      >
                        {getStatusText(change.kind)}索引
                      </span>
                      <span style={{ fontWeight: 500 }}>{change.index.name}</span>
                      <span className="label" style={{ marginBottom: 0 }}>({change.index.type})</span>
                    </div>

                    {change.kind === 'modified' && change.fromIndex ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontFamily: 'monospace' }}>
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                          <span style={{ color: 'var(--fg-muted)', width: 40 }}>旧:</span>
                          <span style={{ textDecoration: 'line-through', color: 'var(--danger)' }}>
                            {change.fromIndex.columns.join(', ')}
                          </span>
                        </div>
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                          <span style={{ color: 'var(--fg-muted)', width: 40 }}>新:</span>
                          <span style={{ color: 'var(--success)' }}>
                            {change.index.columns.join(', ')}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--fg-muted)', marginTop: 4 }}>
                        {change.index.columns.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="label" style={{ fontSize: 14, color: 'var(--fg)' }}>生成的 ALTER SQL</div>
              <ResultPanel
                content={result.alterSql}
                meta={`从 ${result.diff.fromTableName} 到 ${result.diff.toTableName}`}
              />
            </>
          )}
        </div>
      )}
    </PageLayout>
  )
}
