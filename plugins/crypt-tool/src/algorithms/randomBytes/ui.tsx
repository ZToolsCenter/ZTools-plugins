import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function RandomBytesUI({}: AlgorithmProps) {
  const [length, setLength] = useState('32')
  const [encoding, setEncoding] = useState('hex')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const generate = () => {
    const r = runCodec(() =>
      window.services.crypt.randomBytes.generate({
        length: Number(length) || 32,
        encoding
      })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">配置</div>
        <div className="ct-grid2">
          <Field
            label="长度 Length"
            hint="1-4096"
            help="生成随机字节的长度（字节数）"
            value={length}
            onChange={setLength}
          />
          <Field
            label="编码方式"
            help="输出结果的编码格式"
            type="select"
            value={encoding}
            onChange={setEncoding}
            options={[
              { value: 'hex', label: 'Hex（十六进制）' },
              { value: 'base64', label: 'Base64' },
              { value: 'base64url', label: 'Base64URL' }
            ]}
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={generate}>
          生成
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label="随机字符串"
          help="密码学安全的随机字节，按所选编码输出"
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
