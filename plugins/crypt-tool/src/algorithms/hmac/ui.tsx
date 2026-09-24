import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function HmacUI({}: AlgorithmProps) {
  const [key, setKey] = useState('')
  const [algorithm, setAlgorithm] = useState('sha256')
  const [message, setMessage] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      window.services.crypt.hmac.sign({ key, data: message, algo: algorithm })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field label="密钥 Key" help="参与运算的共享密钥，不能为空" value={key} onChange={setKey} copyable />
          <Field
            label="摘要算法"
            help="HMAC 内部使用的哈希"
            type="select"
            value={algorithm}
            onChange={setAlgorithm}
            options={[
              { value: 'sha256', label: 'SHA-256' },
              { value: 'sha512', label: 'SHA-512' }
            ]}
          />
          <Field label="消息 Message" help="待认证的 UTF-8 文本" type="textarea" value={message} onChange={setMessage} copyable />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          计算
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field label="认证码 Hex" help="比对可验证完整性" type="textarea" value={output} onChange={() => {}} readOnly variant="output" copyable />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
