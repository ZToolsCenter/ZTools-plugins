import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function UnicodeEscapeUI({ direction = 'encode', onDirectionChange }: AlgorithmProps) {
  const dir = direction
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.unicodeEscape.encode({ input })
        : window.services.crypt.unicodeEscape.decode({ input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encode' ? '原文' : 'Unicode 转义'
  const inputHelp = dir === 'encode'
    ? '待编码的 UTF-8 文本'
    : '待解码的 \\uXXXX 转义字符串'
  const outputLabel = dir === 'encode' ? 'Unicode 转义' : '原文'
  const outputHelp = dir === 'encode'
    ? '编码后的 \\uXXXX 转义字符串'
    : '解码后的原始文本'

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label={inputLabel}
            help={inputHelp}
            type="textarea"
            value={input}
            onChange={setInput}
            copyable
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          执行
        </button>
        {output && onDirectionChange ? (
          <button
            type="button"
            className="ct-btn ct-btn-ghost"
            onClick={() => {
              setInput(output)
              setOutput('')
              setError('')
              onDirectionChange(dir === 'encode' ? 'decode' : 'encode')
            }}
            title={dir === 'encode' ? '切换到解码并把当前结果作为输入' : '切换到编码并把当前结果作为输入'}
          >
            {dir === 'encode' ? '转入解码' : '转入编码'}
          </button>
        ) : null}
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label={outputLabel}
          help={outputHelp}
          type="textarea"
          value={output}
          onChange={() => {}}
          readOnly
          variant="output"
          copyable
        />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
