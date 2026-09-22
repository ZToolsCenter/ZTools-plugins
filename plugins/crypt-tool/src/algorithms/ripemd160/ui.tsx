import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function Ripemd160UI({ enterPayload }: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const run = () => {
    const r = runCodec(() => window.services.crypt.ripemd160.digest(input))
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field label="明文" help="参与摘要的 UTF-8 文本" type="textarea" value={input} onChange={setInput} copyable />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          计算
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field label="摘要 Hex" help="40 位十六进制，不可逆" type="textarea" value={output} onChange={() => {}} readOnly variant="output" copyable />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
