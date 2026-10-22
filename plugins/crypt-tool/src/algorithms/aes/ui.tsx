import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function AesUI({ direction = 'encrypt', onDirectionChange }: AlgorithmProps) {
  const dir = direction
  const [key, setKey] = useState('')
  const [iv, setIv] = useState('')
  const [mode, setMode] = useState('CBC')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const keygen = () => {
    const r = runCodec(() => window.services.crypt.aes.keygen())
    if (r.ok) setKey(r.data)
  }

  const ivgen = () => {
    const r = runCodec(() => window.services.crypt.aes.ivgen())
    if (r.ok) setIv(r.data)
  }

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
            help="加密解密共用；UTF-8 字节长度决定 AES-128 / 192 / 256。点右上角「生成」可创建 32 字节随机密钥"
            value={key}
            onChange={setKey}
            copyable
            action={
              <button type="button" className="ct-inline-btn" onClick={keygen} title="生成 32 字节随机密钥" aria-label="生成随机密钥">
                生成
              </button>
            }
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
            help="初始化向量；建议随机，需与密文一并保存。点右上角「生成」可创建 16 字节随机 IV"
            value={iv}
            onChange={setIv}
            copyable
            action={
              <button type="button" className="ct-inline-btn" onClick={ivgen} title="生成 16 字节随机 IV" aria-label="生成随机 IV">
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
