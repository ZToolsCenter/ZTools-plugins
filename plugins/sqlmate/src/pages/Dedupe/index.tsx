import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { ProgressBar } from '../../components/ProgressBar'
import { ResultPanel } from '../../components/ResultPanel'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

export default function Dedupe({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })

  const [keyType, setKeyType] = useState<'name' | 'index'>('name')
  const [keyColumn, setKeyColumn] = useState('')
  const [keyColIndex, setKeyColIndex] = useState<number>(1)
  const [keepLast, setKeepLast] = useState(true)

  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [result, setResult] = useState<{
    sql?: string
    originalCount: number
    keptCount: number
    removedCount: number
  } | null>(null)

  async function handleExecute() {
    if (!sql && !filePath) {
      window.ztools.showNotification('请先输入 SQL 或选择文件')
      return
    }
    if (keyType === 'name' && !keyColumn.trim()) {
      window.ztools.showNotification('请输入去重列名')
      return
    }
    if (keyType === 'index' && (keyColIndex < 1 || isNaN(keyColIndex))) {
      window.ztools.showNotification('请输入有效的列序号（>=1）')
      return
    }

    setProcessing(true)
    setProgress(0)
    setSavedPath(null)
    setResult(null)

    try {
      let outputPath: string | null = null
      if (isLarge) {
        const p = window.ztools.showSaveDialog({
          defaultPath: 'deduped.sql',
          filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }],
        })
        if (!p) {
          setProcessing(false)
          return
        }
        outputPath = p
      }

      const res = await window.services.dedupe(
        isLarge ? filePath! : sql,
        outputPath,
        {
          keyColumn: keyType === 'name' ? keyColumn.trim() : undefined,
          keyColIndex: keyType === 'index' ? keyColIndex : undefined,
          keepLast,
          onProgress: (pct) => setProgress(pct),
        }
      )

      setResult(res)
      if (isLarge && outputPath) {
        setSavedPath(outputPath)
        window.ztools.showNotification('大文件处理完成，已保存到指定路径')
      }
    } catch (err: any) {
      window.ztools.showNotification(`处理失败: ${err.message || err}`)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <PageLayout title="数据去重" description="根据指定列对 INSERT 语句进行去重">
      <div className="section">
        <FileInput
          value={sql}
          filePath={filePath}
          isLarge={isLarge}
          onChange={(v, p, large) => {
            setSql(v)
            setFilePath(p)
            setIsLarge(large)
            setResult(null)
          }}
        />
      </div>

      <div className="section">
        <div className="row">
          <label className="label">去重依据</label>
          <select
            value={keyType}
            onChange={(e) => setKeyType(e.target.value as 'name' | 'index')}
            style={{ marginRight: '8px' }}
          >
            <option value="name">按列名</option>
            <option value="index">按列序号</option>
          </select>

          {keyType === 'name' ? (
            <input
              type="text"
              placeholder="例如: id"
              value={keyColumn}
              onChange={(e) => setKeyColumn(e.target.value)}
            />
          ) : (
            <input
              type="number"
              min="1"
              placeholder="例如: 1"
              value={keyColIndex}
              onChange={(e) => setKeyColIndex(parseInt(e.target.value, 10))}
            />
          )}
        </div>

        <div className="row" style={{ marginTop: '12px' }}>
          <label className="label">保留策略</label>
          <select
            value={keepLast ? 'last' : 'first'}
            onChange={(e) => setKeepLast(e.target.value === 'last')}
          >
            <option value="last">保留最后一条</option>
            <option value="first">保留第一条</option>
          </select>
        </div>

        <div className="row" style={{ marginTop: '16px' }}>
          <button onClick={handleExecute} disabled={processing || (!sql && !filePath)}>
            {processing ? '处理中...' : '开始去重'}
          </button>
        </div>
      </div>

      {processing && (
        <div className="section">
          <ProgressBar pct={progress} label={`处理中 ${progress.toFixed(1)}%`} />
        </div>
      )}

      {result && !isLarge && result.sql && (
        <div className="section">
          <ResultPanel
            content={result.sql}
            filename="deduped.sql"
            meta={
              <div style={{ display: 'flex', gap: '16px' }}>
                <span>原始行数: {result.originalCount}</span>
                <span className="success">保留行数: {result.keptCount}</span>
                <span className="error">删除行数: {result.removedCount}</span>
              </div>
            }
          />
        </div>
      )}

      {result && isLarge && (
        <div className="section">
          <div className="row">
            <span className="success">处理完成！</span>
            <span style={{ marginLeft: '16px' }}>原始行数: {result.originalCount}</span>
            <span style={{ marginLeft: '16px' }} className="success">保留行数: {result.keptCount}</span>
            <span style={{ marginLeft: '16px' }} className="error">删除行数: {result.removedCount}</span>
          </div>
          {savedPath && (
            <button className="file-input__btn file-input__btn--ghost" style={{ marginTop: 8 }}
              onClick={() => window.ztools.shellShowItemInFolder(savedPath)}>
              在文件管理器中显示
            </button>
          )}
        </div>
      )}
    </PageLayout>
  )
}
