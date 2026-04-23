import { useState } from 'react'
import { FileInput } from '../../components/FileInput'
import { PageLayout } from '../../components/PageLayout'

export default function Diff() {
  const [leftSql, setLeftSql] = useState('')
  const [leftPath, setLeftPath] = useState<string | null>(null)
  const [leftLarge, setLeftLarge] = useState(false)

  const [rightSql, setRightSql] = useState('')
  const [rightPath, setRightPath] = useState<string | null>(null)
  const [rightLarge, setRightLarge] = useState(false)

  const [keyType, setKeyType] = useState<'name' | 'index'>('name')
  const [keyColumn, setKeyColumn] = useState('id')
  const [keyColIndex, setKeyColIndex] = useState(0)

  const [result, setResult] = useState<DiffResult | null>(null)
  const [showUnchanged, setShowUnchanged] = useState(false)

  const handleDiff = () => {
    const leftInput = leftLarge && leftPath ? leftPath : leftSql
    const rightInput = rightLarge && rightPath ? rightPath : rightSql
    if (!leftInput || !rightInput) return

    try {
      const res = window.services.diffData(leftInput, rightInput, {
        keyColumn: keyType === 'name' ? keyColumn : undefined,
        keyColIndex: keyType === 'index' ? keyColIndex : undefined
      })
      setResult(res)
    } catch (err) {
      console.error(err)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'added': return 'var(--success)'
      case 'removed': return 'var(--danger)'
      case 'modified': return '#f0a500'
      case 'unchanged': return 'var(--fg-muted)'
      default: return 'var(--fg)'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'added': return '新增'
      case 'removed': return '删除'
      case 'modified': return '修改'
      case 'unchanged': return '未变'
      default: return status
    }
  }

  return (
    <PageLayout title="数据对比" description="对比两个 SQL 文件中的数据行差异">
      <div className="section">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="label">旧数据 (左)</div>
            <FileInput
              value={leftSql}
              filePath={leftPath}
              isLarge={leftLarge}
              onChange={(v, p, large) => {
                setLeftSql(v)
                setLeftPath(p)
                setLeftLarge(large)
                setResult(null)
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">新数据 (右)</div>
            <FileInput
              value={rightSql}
              filePath={rightPath}
              isLarge={rightLarge}
              onChange={(v, p, large) => {
                setRightSql(v)
                setRightPath(p)
                setRightLarge(large)
                setResult(null)
              }}
            />
          </div>
        </div>

        <div className="section" style={{ marginTop: 16 }}>
          <div className="label">主键配置</div>
          <div className="row">
            <label className="row" style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                checked={keyType === 'name'}
                onChange={() => setKeyType('name')}
              />
              按列名
            </label>
            {keyType === 'name' && (
              <input
                type="text"
                value={keyColumn}
                onChange={e => setKeyColumn(e.target.value)}
                placeholder="例如: id"
                style={{ width: 120 }}
              />
            )}

            <label className="row" style={{ cursor: 'pointer', marginLeft: 16 }}>
              <input
                type="radio"
                checked={keyType === 'index'}
                onChange={() => setKeyType('index')}
              />
              按列序号
            </label>
            {keyType === 'index' && (
              <input
                type="number"
                value={keyColIndex}
                onChange={e => setKeyColIndex(Number(e.target.value))}
                min={0}
                style={{ width: 80 }}
              />
            )}
          </div>
        </div>

        <button
          onClick={handleDiff}
          disabled={(!leftSql && !leftPath) || (!rightSql && !rightPath)}
          style={{ marginTop: 16 }}
        >
          执行对比
        </button>
      </div>

      {result && (
        <div className="section" style={{ marginTop: 24 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 16, fontWeight: 500 }}>
              <span style={{ color: getStatusColor('added') }}>新增: {result.addedCount}</span>
              <span style={{ color: getStatusColor('removed') }}>删除: {result.removedCount}</span>
              <span style={{ color: getStatusColor('modified') }}>修改: {result.modifiedCount}</span>
              <span style={{ color: getStatusColor('unchanged') }}>未变: {result.unchangedCount}</span>
            </div>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showUnchanged}
                onChange={e => setShowUnchanged(e.target.checked)}
              />
              显示未变行
            </label>
          </div>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {result.rows
              .filter(row => showUnchanged || row.status !== 'unchanged')
              .map((row, i) => (
                <div
                  key={i}
                  style={{
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${getStatusColor(row.status)}`,
                    borderRadius: 6,
                    padding: 12,
                    background: 'var(--bg)'
                  }}
                >
                  <div className="row" style={{ marginBottom: row.status === 'modified' ? 8 : 0 }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 12,
                        background: getStatusColor(row.status),
                        color: '#fff'
                      }}
                    >
                      {getStatusText(row.status)}
                    </span>
                    <span style={{ fontWeight: 500 }}>{row.tableName}</span>
                    <span className="label" style={{ marginBottom: 0 }}>主键: {row.keyValue}</span>
                  </div>

                  {row.status === 'modified' && row.columns && row.leftValues && row.rightValues && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                      {row.changedColumns.map(col => {
                        const colIdx = row.columns!.indexOf(col)
                        if (colIdx === -1) return null
                        return (
                          <div key={col} className="row" style={{ alignItems: 'flex-start' }}>
                            <span style={{ color: 'var(--fg-muted)', width: 100 }}>{col}:</span>
                            <span style={{ textDecoration: 'line-through', color: 'var(--danger)' }}>
                              {row.leftValues![colIdx]}
                            </span>
                            <span style={{ color: 'var(--fg-muted)' }}>→</span>
                            <span style={{ color: 'var(--success)' }}>
                              {row.rightValues![colIdx]}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            {result.rows.filter(row => showUnchanged || row.status !== 'unchanged').length === 0 && (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-muted)' }}>
                没有差异数据
              </div>
            )}
          </div>
        </div>
      )}
    </PageLayout>
  )
}
