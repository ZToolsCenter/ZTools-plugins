import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function RsaUI({ direction = 'encrypt' }: AlgorithmProps) {
  const dir = direction
  const [publicKey, setPublicKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const keygen = () => {
    const r = runCodec(() => window.services.crypt.rsa.generateKeyPair())
    if (!r.ok) {
      setError(r.error)
      return
    }
    try {
      const pair = JSON.parse(r.data) as { publicKey: string; privateKey: string }
      setPublicKey(pair.publicKey)
      setPrivateKey(pair.privateKey)
      setNotice('已生成 2048 位密钥对')
      setError('')
    } catch {
      setError('密钥对解析失败')
    }
  }

  const run = () => {
    const r = runCodec(() =>
      dir === 'encrypt'
        ? window.services.crypt.rsa.encrypt({ publicKey, plaintext: input })
        : window.services.crypt.rsa.decrypt({ privateKey, ciphertext: input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const primaryKey = dir === 'encrypt'
    ? { label: '公钥 Public Key', hint: 'PEM', help: '用于加密；可粘贴或点击「生成密钥对」获取', value: publicKey, setter: setPublicKey }
    : { label: '私钥 Private Key', hint: 'PEM', help: '用于解密；请勿泄露', value: privateKey, setter: setPrivateKey }
  const secondaryKey = dir === 'encrypt'
    ? { label: '私钥 Private Key (可选)', hint: 'PEM', help: '如已有密钥对，可一并粘贴以便轮换使用', value: privateKey, setter: setPrivateKey }
    : { label: '公钥 Public Key (可选)', hint: 'PEM', help: '如已有密钥对，可一并粘贴以便轮换使用', value: publicKey, setter: setPublicKey }

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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button
          type="button"
          className="ct-tab ct-tab-ghost"
          onClick={keygen}
        >
          生成密钥对
        </button>
      </div>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label={primaryKey.label}
            hint={primaryKey.hint}
            help={primaryKey.help}
            type="textarea"
            rows={4}
            value={primaryKey.value}
            onChange={primaryKey.setter}
            copyable
          />
          <Field
            label={secondaryKey.label}
            hint={secondaryKey.hint}
            help={secondaryKey.help}
            type="textarea"
            rows={4}
            value={secondaryKey.value}
            onChange={secondaryKey.setter}
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
      {notice ? <div className="ct-field-help">{notice}</div> : null}
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
