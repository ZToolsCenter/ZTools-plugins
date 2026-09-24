import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError } from '../codec'

export default function JwtUI({}: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() => window.services.crypt.jwt.decode({ token: input }))
    setError(showError(r))
    if (r.ok) {
      setOutput(JSON.stringify(r.data, null, 2))
    } else {
      setOutput('')
    }
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="JWT Token"
            help="三段式 JWT 字符串（header.payload.signature）"
            type="textarea"
            value={input}
            onChange={setInput}
            copyable
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          解码
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label="Decoded (Header + Payload)"
          help="header 与 payload 的 JSON 展开，签名已验证可单独处理"
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
