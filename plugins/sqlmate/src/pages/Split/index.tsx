import { useState, useEffect } from 'react'
import { FileInput } from '../../components/FileInput'
import { ResultPanel } from '../../components/ResultPanel'
import { ProgressBar } from '../../components/ProgressBar'
import { PageLayout } from '../../components/PageLayout'
import './index.css'

export default function Split({ enterAction }: { enterAction: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<{ sql?: string, statementCount: number } | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
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
    setSavedPath(null)
    setProgress(0)
    setProcessing(true)

    try {
      let outputPath: string | null = null
      if (isLarge) {
        outputPath = window.ztools.showSaveDialog({
          defaultPath: 'split_output.sql',
          filters: [{ name: 'SQL Files', extensions: ['sql', 'txt'] }]
        }) ?? null
        if (!outputPath) {
          setProcessing(false)
          setProgress(null)
          return
        }
      }

      const res = await window.services.split(input, outputPath, {
        onProgress: (pct) => setProgress(pct)
      })

      setResult(res)
      if (isLarge && outputPath) {
        setSavedPath(outputPath)
        window.ztools.showNotification('拆分完成，文件已保存')
      }
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setProcessing(false)
      setProgress(null)
    }
  }

  return (
    <PageLayout title="拆分 INSERT" description="将批量 INSERT 语句拆分为单行插入，便于排查错误数据。">
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

      <div className="section split-config">
        <div className="row">
          <button onClick={handleExecute} disabled={processing || (!sql && !filePath)}>
            {processing ? '处理中...' : isLarge ? '选择保存位置并执行' : '执行拆分'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {progress !== null && <ProgressBar pct={progress} />}
      </div>

      {result && (
        <div className="section">
          <div className="label">处理结果</div>
          {isLarge ? (
            <div>
              <p className="success">拆分完成！共生成 {result.statementCount} 条语句。</p>
              {savedPath && (
                <button className="file-input__btn file-input__btn--ghost" style={{ marginTop: 8 }}
                  onClick={() => window.ztools.shellShowItemInFolder(savedPath)}>
                  在文件管理器中显示
                </button>
              )}
            </div>
          ) : (
            <ResultPanel
              content={result.sql || ''}
              meta={`共生成 ${result.statementCount} 条语句`}
            />
          )}
        </div>
      )}
    </PageLayout>
  )
}
