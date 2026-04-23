import { useState, useEffect } from 'react'
import { FileInput } from '../../components/FileInput'
import { ResultPanel } from '../../components/ResultPanel'
import { ProgressBar } from '../../components/ProgressBar'
import { PageLayout } from '../../components/PageLayout'
import './index.css'

export default function Merge({ enterAction }: { enterAction: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  const [batchSize, setBatchSize] = useState(1000)
  
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<{ sql?: string, tableCount: number, statementCount: number } | null>(null)
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
      let outputPath: string | null = null
      if (isLarge) {
        outputPath = window.ztools.showSaveDialog({
          defaultPath: 'merged_output.sql',
          filters: [{ name: 'SQL Files', extensions: ['sql', 'txt'] }]
        })
        if (!outputPath) {
          setProcessing(false)
          setProgress(null)
          return
        }
      }

      const res = await window.services.merge(input, outputPath, {
        batchSize,
        onProgress: (pct) => setProgress(pct)
      })

      setResult(res)
      if (isLarge && outputPath) {
        window.ztools.showNotification('合并完成，文件已保存')
      }
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setProcessing(false)
      setProgress(null)
    }
  }

  return (
    <PageLayout title="合并 INSERT" description="将多条单行 INSERT 语句合并为批量插入，提升导入速度。">
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

      <div className="section merge-config">
        <div className="row">
          <div className="label" style={{ marginBottom: 0 }}>每批条数</div>
          <input
            type="number"
            value={batchSize}
            onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value)))}
            min={1}
            style={{ width: '100px' }}
          />
          <button onClick={handleExecute} disabled={processing || (!sql && !filePath)}>
            {processing ? '处理中...' : isLarge ? '选择保存位置并执行' : '执行合并'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {progress !== null && <ProgressBar pct={progress} />}
      </div>

      {result && (
        <div className="section">
          <div className="label">处理结果</div>
          {isLarge ? (
            <div className="success">
              合并完成！共处理 {result.tableCount} 张表，生成 {result.statementCount} 条语句。
            </div>
          ) : (
            <ResultPanel
              content={result.sql || ''}
              meta={`共处理 ${result.tableCount} 张表，生成 ${result.statementCount} 条语句`}
            />
          )}
        </div>
      )}
    </PageLayout>
  )
}
