import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function DesUI({ enterPayload, direction = 'encrypt' }: AlgorithmProps) {
  const dir = direction
  const [key, setKey] = useState('')
  const [iv, setIv] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setInput(enterPayload)
  }, [enterPayload])

  const keygen = () => {
    const r = runCodec(() => window.services.crypt.des.keygen())
    if (r.ok) setKey(r.data)
  }

  const ivgen = () => {
    const r = runCodec(() => window.services.crypt.des.ivgen())
    if (r.ok) setIv(r.data)
  }

  const run = () => {
    const r = runCodec(() =>
      dir === 'encrypt'
        ? window.services.crypt.des.encrypt({ key, iv, plaintext: input })
        : window.services.crypt.des.decrypt({ key, iv, ciphertext: input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encrypt' ? '明文' : '密文'
  const inputHelp = dir === 'encrypt'
    ? '待加密的 UTF-8 明文'
    : '待解密的 Base64 密文'
  const outputLabel = dir === 'encrypt' ? '密文' : '明文'
  const outputHelp = dir === 'encrypt'
    ? '加密后的 Base64 密文'
    : '解密后的 UTF-8 明文'

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="密钥 Key"
            hint="24 字节 Base64"
            help="加密解密共用；推荐先生成随机密钥"
            value={key}
            onChange={setKey}
            copyable
          />
          <div className="ct-field">
            <div className="ct-actions" style={{ marginTop: '18px' }}>
              <button type="button" className="ct-btn ct-btn-ghost" onClick={keygen}>
                生成密钥
              </button>
            </div>
          </div>
          <Field
            label="IV"
            hint="8 字节 Base64"
            help="初始化向量；建议随机，需与密文一并保存"
            value={iv}
            onChange={setIv}
            copyable
          />
          <div className="ct-field">
            <div className="ct-actions" style={{ marginTop: '18px' }}>
              <button type="button" className="ct-btn ct-btn-ghost" onClick={ivgen}>
                生成 IV
              </button>
            </div>
          </div>
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
        <button
          type="button"
          className="ct-btn ct-btn-ghost"
          onClick={() => {
            setInput(output)
            setOutput('')
            setError('')
          }}
        >
          互换输入输出
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
