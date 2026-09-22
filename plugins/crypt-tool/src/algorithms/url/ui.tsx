import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function UrlUI({ direction = 'encode' }: AlgorithmProps) {
  const dir = direction
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.url.encode(input)
        : window.services.crypt.url.decode(input)
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encode' ? '原文' : 'URL 编码'
  const inputHelp = dir === 'encode'
    ? '待编码的原文（含中文或特殊字符）'
    : '待解码的 %XX 编码字符串'
  const outputLabel = dir === 'encode' ? 'URL 编码' : '原文'
  const outputHelp = dir === 'encode'
    ? '编码后的 %XX 字符串'
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
