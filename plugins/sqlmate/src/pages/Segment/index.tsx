import { useState, useEffect } from 'react'
import { FileInput } from '../../components/FileInput'
import { ResultPanel } from '../../components/ResultPanel'
import { ProgressBar } from '../../components/ProgressBar'
import { PageLayout } from '../../components/PageLayout'
import './index.css'

export default function Segment({ enterAction }: { enterAction: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  
  const [mode, setMode] = useState<'count' | 'size'>('count')
  const [count, setCount] = useState(10000)
  const [sizeMB, setSizeMB] = useState(10)

  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<{ files?: { name: string, content: string }[], fileCount: number, fileNames?: string[] } | null>(null)
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
      let outputDir: string | null = null
      if (isLarge) {
        const dirs = window.ztools.showOpenDialog({
          properties: ['openDirectory']
        })
        if (!dirs || dirs.length === 0) {
          setProcessing(false)
          setProgress(null)
          return
        }
        outputDir = dirs[0]
      }

      const res = await window.services.segment(input, outputDir, {
        mode,
        count: mode === 'count' ? count : undefined,
        sizeMB: mode === 'size' ? sizeMB : undefined,
        onProgress: (pct) => setProgress(pct)
      })

      setResult(res)
      if (isLarge && outputDir) {
        window.ztools.showNotification('分割完成，文件已保存')
      }
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setProcessing(false)
      setProgress(null)
    }
  }

  function handleSaveAll() {
    if (!result?.files) return
    const dirs = window.ztools.showOpenDialog({
      properties: ['openDirectory']
    })
    if (!dirs || dirs.length === 0) return
    
    try {
      window.services.writeFiles(dirs[0], result.files)
      window.ztools.showNotification('全部文件已保存')
    } catch (err: any) {
      setError(err.message || String(err))
    }
  }

  return (
    <PageLayout title="分割文件" description="将大 SQL 文件按行数或大小分割为多个小文件。">
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

      <div className="section segment-config">
        <div className="row">
          <label className="row" style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'count'}
              onChange={() => setMode('count')}
            />
            按行数
          </label>
          <label className="row" style={{ cursor: 'pointer', marginLeft: '12px' }}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'size'}
              onChange={() => setMode('size')}
            />
            按大小
          </label>
        </div>

        <div className="row" style={{ marginTop: '8px' }}>
          {mode === 'count' ? (
            <>
              <div className="label" style={{ marginBottom: 0 }}>每文件行数</div>
              <input
                type="number"
                value={count}
                onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
                min={1}
                style={{ width: '120px' }}
              />
            </>
          ) : (
            <>
              <div className="label" style={{ marginBottom: 0 }}>每文件大小 (MB)</div>
              <input
                type="number"
                value={sizeMB}
                onChange={(e) => setSizeMB(Math.max(1, Number(e.target.value)))}
                min={1}
                style={{ width: '120px' }}
              />
            </>
          )}
          <button onClick={handleExecute} disabled={processing || (!sql && !filePath)}>
            {processing ? '处理中...' : isLarge ? '选择保存目录并执行' : '执行分割'}
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
              分割完成！共生成 {result.fileCount} 个文件。
            </div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: '8px' }}>
                <span className="success">共生成 {result.fileCount} 个文件</span>
                <button onClick={handleSaveAll}>全部保存到目录</button>
              </div>
              {result.files && result.files.length > 0 && (
                <ResultPanel
                  content={result.files[0].content}
                  meta={`预览第一个文件: ${result.files[0].name}`}
                  filename={result.files[0].name}
                />
              )}
            </>
          )}
        </div>
      )}
    </PageLayout>
  )
}
