import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function AesUI({ direction = 'encrypt' }: AlgorithmProps) {
  const dir = direction
  const [key, setKey] = useState('my-secret-key-16b')
  const [iv, setIv] = useState('random-iv-16bytes')
  const [mode, setMode] = useState('CBC')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encrypt'
        ? window.services.crypt.aes.encrypt({ key, iv, mode, plaintext: input })
        : window.services.crypt.aes.decrypt({ key, iv, mode, ciphertext: input })
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
            hint="16 / 24 / 32 字节"
            help="加密解密共用；UTF-8 字节长度决定 AES-128 / 192 / 256"
            value={key}
            onChange={setKey}
            copyable
          />
          <Field
            label="模式 Mode"
            help="CBC 需相同 IV；GCM 含认证标签更安全"
            type="select"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'CBC', label: 'CBC' },
              { value: 'GCM', label: 'GCM' }
            ]}
          />
          <Field
            label="IV"
            hint="16 字节"
            help="初始化向量；建议随机，需与密文一并保存"
            value={iv}
            onChange={setIv}
            copyable
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
