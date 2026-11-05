import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function ChachaUI({ direction = 'encrypt', onDirectionChange }: AlgorithmProps) {
  const dir = direction
  const [key, setKey] = useState('')
  const [nonce, setNonce] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const keygen = () => {
    const r = runCodec(() => window.services.crypt.chacha.keygen())
    if (r.ok) setKey(r.data)
  }

  const noncegen = () => {
    const r = runCodec(() => window.services.crypt.chacha.noncegen())
    if (r.ok) setNonce(r.data)
  }

  const run = () => {
    const r = runCodec(() =>
      dir === 'encrypt'
        ? window.services.crypt.chacha.encrypt({ key, nonce, plaintext: input })
        : window.services.crypt.chacha.decrypt({ key, nonce, ciphertext: input })
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
    ? '加密后的 Base64 密文（含认证标签）'
    : '解密后的 UTF-8 明文'

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="密钥 Key"
            hint="32 字节 Base64"
            help="加密解密共用；推荐先生成随机密钥"
            value={key}
            onChange={setKey}
            copyable
            action={
              <button type="button" className="ct-inline-btn" onClick={keygen} title="生成随机密钥" aria-label="生成随机密钥">
                生成
              </button>
            }
          />
          <Field
            label="Nonce"
            hint="12 字节 Base64"
            help="必须每次加密随机生成，需与密文一并保存"
            value={nonce}
            onChange={setNonce}
            copyable
            action={
              <button type="button" className="ct-inline-btn" onClick={noncegen} title="生成随机 Nonce" aria-label="生成随机 Nonce">
                生成
              </button>
            }
          />
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
              onDirectionChange(dir === 'encrypt' ? 'decrypt' : 'encrypt')
            }}
            title={dir === 'encrypt' ? '切换到解密并把当前结果作为输入' : '切换到加密并把当前结果作为输入'}
          >
            {dir === 'encrypt' ? '转入解密' : '转入加密'}
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
