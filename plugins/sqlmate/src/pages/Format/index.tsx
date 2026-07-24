import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { ResultPanel } from '../../components/ResultPanel'
import { ProgressBar } from '../../components/ProgressBar'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

type Mode = 'format' | 'compress'
type KeywordCase = 'upper' | 'lower' | 'preserve'

export default function Format({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })

  const [mode, setMode] = useState<Mode>('format')
  const [keywordCase, setKeywordCase] = useState<KeywordCase>('upper')
  const [indent, setIndent] = useState<'2' | '4'>('2')
  const [removeComments, setRemoveComments] = useState(false)

  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canRun = !!sql || !!filePath

  async function handleExecute() {
    setError(null)
    setResult(null)
    setSavedPath(null)
    setProgress(null)
    setProcessing(true)

    try {
      // 大文件模式
      if (isLarge && filePath) {
        const outputPath = window.ztools.showSaveDialog({
          defaultPath: mode === 'format' ? 'formatted.sql' : 'compressed.sql',
          filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }],
        })
        if (!outputPath) { setProcessing(false); return }

        if (mode === 'format') {
          await window.services.formatSql(filePath, outputPath, {
            indent: indent === '2' ? '  ' : '    ',
            keywordCase,
            linesBetweenStatements: 1,
            onProgress: (pct: number) => setProgress(pct),
          })
        } else {
          await window.services.compressSql(filePath, outputPath, {
            removeComments,
            onProgress: (pct: number) => setProgress(pct),
          })
        }
        setSavedPath(outputPath)
        window.ztools.showNotification(`${mode === 'format' ? '格式化' : '压缩'}完成，文件已保存`)
      } else {
        // 小文件 / 粘贴文本
        const input = sql
        if (!input.trim()) { setError('请输入 SQL'); setProcessing(false); return }

        if (mode === 'format') {
          const res = await window.services.formatSql(input, null, {
            indent: indent === '2' ? '  ' : '    ',
            keywordCase,
            linesBetweenStatements: 1,
          })
          setResult(res.sql ?? '')
        } else {
          const res = await window.services.compressSql(input, null, { removeComments })
          setResult(res.sql ?? '')
        }
      }
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <PageLayout
      title="SQL 格式化 / 压缩"
      description="美化 SQL 代码使其易于阅读，或压缩成单行以便传输。支持大文件流式处理。"
    >
      <div className="section">
        <FileInput
          value={sql}
          filePath={filePath}
          isLarge={isLarge}
          onChange={(v, p, l) => { setSql(v); setFilePath(p); setIsLarge(l); setResult(null); setSavedPath(null) }}
        />
      </div>

      <div className="section">
        <div className="label">操作模式</div>
        <div className="row">
          {(['format', 'compress'] as Mode[]).map((m) => (
            <label key={m} className="row" style={{ cursor: 'pointer' }}>
              <input type="radio" name="mode" checked={mode === m}
                onChange={() => { setMode(m); setResult(null) }}
                style={{ accentColor: 'var(--accent)' }} />
              <span>{m === 'format' ? '格式化（美化）' : '压缩（单行）'}</span>
            </label>
          ))}
        </div>
      </div>

      {mode === 'format' && (
        <div className="section">
          <div className="label">格式化选项</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row">
              <span style={{ fontSize: 13, color: 'var(--fg-muted)', minWidth: 64 }}>关键字</span>
              {(['upper', 'lower', 'preserve'] as KeywordCase[]).map((c) => (
                <label key={c} className="row" style={{ cursor: 'pointer' }}>
                  <input type="radio" name="kcase" checked={keywordCase === c}
                    onChange={() => setKeywordCase(c)}
                    style={{ accentColor: 'var(--accent)' }} />
                  <span>{c === 'upper' ? '大写 SELECT' : c === 'lower' ? '小写 select' : '保持原样'}</span>
                </label>
              ))}
            </div>
            <div className="row">
              <span style={{ fontSize: 13, color: 'var(--fg-muted)', minWidth: 64 }}>缩进</span>
              {(['2', '4'] as const).map((n) => (
                <label key={n} className="row" style={{ cursor: 'pointer' }}>
                  <input type="radio" name="indent" checked={indent === n}
                    onChange={() => setIndent(n)}
                    style={{ accentColor: 'var(--accent)' }} />
                  <span>{n} 空格</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === 'compress' && (
        <div className="section">
          <div className="label">压缩选项</div>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={removeComments}
              onChange={(e) => setRemoveComments(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }} />
            <span>移除注释（-- 行注释 和 /* */ 块注释）</span>
          </label>
        </div>
      )}

      <div className="row">
        <button onClick={handleExecute} disabled={!canRun || processing}>
          {processing ? '处理中...' : isLarge ? '选择保存位置并执行' : mode === 'format' ? '格式化' : '压缩'}
        </button>
      </div>

      {processing && progress !== null && <ProgressBar pct={progress} />}

      {error && <p className="error">{error}</p>}

      {savedPath && !processing && (
        <div className="section">
          <p className="success">{mode === 'format' ? '格式化' : '压缩'}完成！</p>
          <button className="file-input__btn file-input__btn--ghost" style={{ marginTop: 8 }}
            onClick={() => window.ztools.shellShowItemInFolder(savedPath)}>
            在文件管理器中显示
          </button>
        </div>
      )}

      {result !== null && (
        <ResultPanel
          content={result}
          filename={mode === 'format' ? 'formatted.sql' : 'compressed.sql'}
          meta={<span>{mode === 'format' ? '格式化完成' : '压缩完成'} · {result.split('\n').length} 行</span>}
        />
      )}
    </PageLayout>
  )
}
