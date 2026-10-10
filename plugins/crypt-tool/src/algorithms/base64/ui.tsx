import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function Base64UI({ direction = 'encode' }: AlgorithmProps) {
  const dir = direction
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.base64.encode(input)
        : window.services.crypt.base64.decode(input)
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encode' ? '明文' : 'Base64'
  const inputHelp = dir === 'encode'
    ? '待编码的 UTF-8 文本'
    : '待解码的 Base64 字符串'
  const outputLabel = dir === 'encode' ? 'Base64' : '明文'
  const outputHelp = dir === 'encode'
    ? '编码后的 Base64 字符串'
    : '解码后的 UTF-8 明文'

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
