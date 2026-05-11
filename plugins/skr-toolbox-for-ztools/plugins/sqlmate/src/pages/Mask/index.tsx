import { useState } from 'react'
import { PageLayout } from '../../components/PageLayout'
import { FileInput } from '../../components/FileInput'
import { ProgressBar } from '../../components/ProgressBar'
import { ResultPanel } from '../../components/ResultPanel'
import { useFileEnterAction } from '../../hooks/useFileEnterAction'

export default function Mask({ enterAction }: { enterAction?: any }) {
  const [sql, setSql] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isLarge, setIsLarge] = useState(false)
  useFileEnterAction(enterAction, { setSql, setFilePath, setIsLarge })

  const [rules, setRules] = useState<MaskRule[]>([
    { column: '', type: 'phone' },
  ])

  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{
    sql?: string
    maskedCount: number
    warnings: string[]
  } | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  function addRule() {
    setRules([...rules, { column: '', type: 'phone' }])
  }

  function removeRule(index: number) {
    setRules(rules.filter((_, i) => i !== index))
  }

  function updateRule(index: number, updates: Partial<MaskRule>) {
    const newRules = [...rules]
    newRules[index] = { ...newRules[index], ...updates }
    setRules(newRules)
  }

  async function handleExecute() {
    if (!sql && !filePath) {
      window.ztools.showNotification('请先输入 SQL 或选择文件')
      return
    }
    if (rules.length === 0) {
      window.ztools.showNotification('请至少添加一条脱敏规则')
      return
    }
    for (const r of rules) {
      if (!r.column.trim()) {
        window.ztools.showNotification('列名不能为空')
        return
      }
      if (r.type === 'custom_mask' && !r.customValue) {
        window.ztools.showNotification('自定义脱敏必须填写固定值')
        return
      }
      if (r.type === 'regex_replace' && (!r.regexPattern || !r.regexReplace)) {
        window.ztools.showNotification('正则替换必须填写正则模式和替换模板')
        return
      }
    }

    setProcessing(true)
    setProgress(0)
    setResult(null)

    try {
      let outputPath: string | null = null
      if (isLarge) {
        const p = window.ztools.showSaveDialog({
          defaultPath: 'masked.sql',
          filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }],
        })
        if (!p) {
          setProcessing(false)
          return
        }
        outputPath = p
      }

      const res = await window.services.mask(
        isLarge ? filePath! : sql,
        outputPath,
        rules,
        (pct) => setProgress(pct)
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
    <PageLayout title="数据脱敏" description="对 INSERT 语句中的敏感数据进行脱敏处理">
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
        <h3 style={{ marginBottom: '12px' }}>脱敏规则</h3>
        {rules.map((rule, index) => (
          <div className="row" key={index} style={{ marginBottom: '8px', alignItems: 'flex-start' }}>
            <input
              type="text"
              placeholder="列名"
              value={rule.column}
              onChange={(e) => updateRule(index, { column: e.target.value })}
              style={{ width: '120px', marginRight: '8px' }}
            />
            <select
              value={rule.type}
              onChange={(e) => updateRule(index, { type: e.target.value as MaskType })}
              style={{ marginRight: '8px' }}
            >
              <option value="phone">手机号</option>
              <option value="id_card">身份证</option>
              <option value="email">邮箱</option>
              <option value="name">姓名</option>
              <option value="custom_mask">固定值</option>
              <option value="regex_replace">正则替换</option>
            </select>

            {rule.type === 'custom_mask' && (
              <input
                type="text"
                placeholder="固定值"
                value={rule.customValue || ''}
                onChange={(e) => updateRule(index, { customValue: e.target.value })}
                style={{ width: '120px', marginRight: '8px' }}
              />
            )}

            {rule.type === 'regex_replace' && (
              <>
                <input
                  type="text"
                  placeholder="正则模式"
                  value={rule.regexPattern || ''}
                  onChange={(e) => updateRule(index, { regexPattern: e.target.value })}
                  style={{ width: '120px', marginRight: '8px' }}
                />
                <input
                  type="text"
                  placeholder="替换模板"
                  value={rule.regexReplace || ''}
                  onChange={(e) => updateRule(index, { regexReplace: e.target.value })}
                  style={{ width: '120px', marginRight: '8px' }}
                />
              </>
            )}

            <button onClick={() => removeRule(index)} className="error" style={{ marginLeft: 'auto' }}>
              删除
            </button>
          </div>
        ))}

        <div className="row" style={{ marginTop: '12px' }}>
          <button onClick={addRule}>+ 添加规则</button>
        </div>

        <div className="row" style={{ marginTop: '16px' }}>
          <button onClick={handleExecute} disabled={processing || (!sql && !filePath) || rules.length === 0}>
            {processing ? '处理中...' : '开始脱敏'}
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
            filename="masked.sql"
            meta={
              <div style={{ display: 'flex', gap: '16px', flexDirection: 'column' }}>
                <div>
                  <span className="success">脱敏行数: {result.maskedCount}</span>
                </div>
                {result.warnings && result.warnings.length > 0 && (
                  <div className="error">
                    警告:
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {result.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            }
          />
        </div>
      )}

      {result && isLarge && (
        <div className="section">
          <div className="row">
            <span className="success">处理完成！</span>
            <span style={{ marginLeft: '16px' }} className="success">脱敏行数: {result.maskedCount}</span>
          </div>
          {result.warnings && result.warnings.length > 0 && (
            <div className="error" style={{ marginTop: '8px' }}>
              警告:
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
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
