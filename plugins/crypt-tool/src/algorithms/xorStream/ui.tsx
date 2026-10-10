import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function XorStreamUI({ direction = 'encrypt' }: AlgorithmProps) {
  const dir = direction
  const [key, setKey] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encrypt'
        ? window.services.crypt.xorStream.encrypt({ key, plaintext: input })
        : window.services.crypt.xorStream.decrypt({ key, ciphertext: input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputHelp = dir === 'encrypt'
    ? '待加密的 UTF-8 明文'
    : '待解密的十六进制密文'
  const outputHelp = dir === 'encrypt'
    ? '加密后的十六进制密文'
    : '解密后的 UTF-8 明文'

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="密钥 Key"
            hint="UTF-8 字符串"
            help="加解密共用相同密钥"
            value={key}
            onChange={setKey}
            copyable
          />
          {dir === 'encrypt' ? (
            <Field
              label="明文"
              help={inputHelp}
              type="textarea"
              value={input}
              onChange={setInput}
              copyable
            />
          ) : (
            <Field
              label="密文 Hex"
              placeholder="十六进制，如 1a2b3c"
              help={inputHelp}
              type="textarea"
              value={input}
              onChange={setInput}
              copyable
            />
          )}
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          {dir === 'encrypt' ? '加密' : '解密'}
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
        {dir === 'encrypt' ? (
          <Field
            label="密文 Hex"
            help={outputHelp}
            type="textarea"
            value={output}
            onChange={() => {}}
            readOnly
            variant="output"
            copyable
          />
        ) : (
          <Field
            label="明文"
            help={outputHelp}
            type="textarea"
            value={output}
            onChange={() => {}}
            readOnly
            variant="output"
            copyable
          />
        )}
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
