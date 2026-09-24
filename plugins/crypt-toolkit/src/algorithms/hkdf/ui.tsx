import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function HkdfUI({}: AlgorithmProps) {
  const [ikm, setIkm] = useState('')
  const [salt, setSalt] = useState('')
  const [info, setInfo] = useState('')
  const [keylen, setKeylen] = useState('32')
  const [hash, setHash] = useState('sha256')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      window.services.crypt.hkdf.derive({
        ikm: ikm.trim(),
        salt: salt.trim(),
        info: info.trim(),
        keylen: Number(keylen) || 32,
        hash
      })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="IKM（输入密钥材料）"
            help="十六进制编码的主密钥材料"
            placeholder="如 ECDH 共享秘密"
            value={ikm}
            onChange={setIkm}
            copyable
          />
                    <Field
            label="盐 Salt Hex（可选）"
            help="十六进制编码的盐；用于抽取阶段增加随机性"
            value={salt}
            onChange={setSalt}
            copyable
          />
          <Field
            label="Info Hex（可选）"
            help="十六进制编码的上下文；绑定到具体应用或用途"
            placeholder="如 73657373696f6e2d6b6579"
            value={info}
            onChange={setInfo}
            copyable
          />
          <Field label="哈希算法" help="抽取/扩展使用的 HMAC 算法" type="select" value={hash} onChange={setHash} options={[
            { value: 'sha256', label: 'SHA-256' },
            { value: 'sha512', label: 'SHA-512' },
            { value: 'sha1', label: 'SHA-1' }
          ]} />
          <Field label="密钥长度（字节）" help="输出密钥字节数" value={keylen} onChange={setKeylen} />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          派生
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field label="派生密钥 Hex" help="十六进制编码的输出密钥材料" type="textarea" value={output} onChange={() => {}} readOnly variant="output" copyable />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
