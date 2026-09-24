import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function EcdhUI({}: AlgorithmProps) {
  const [curve, setCurve] = useState('prime256v1')
  const [privateKey, setPrivateKey] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [peerPublicKey, setPeerPublicKey] = useState('')
  const [sharedSecret, setSharedSecret] = useState('')
  const [error, setError] = useState('')

  const generateKeyPair = () => {
    const r = runCodec(() => window.services.crypt.ecdh.generateKeyPair({ curve }))
    if (r.ok) {
      setPrivateKey(r.data.privateKey)
      setPublicKey(r.data.publicKey)
    }
  }

  const deriveSecret = () => {
    const r = runCodec(() =>
      window.services.crypt.ecdh.deriveSharedSecret({ privateKey, peerPublicKey, curve })
    )
    setError(showError(r))
    setSharedSecret(showData(r))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">密钥生成</div>
        <div className="ct-grid2">
          <Field
            label="曲线 Curve"
            help="椭圆曲线名称，决定密钥长度与安全级别"
            type="select"
            value={curve}
            onChange={setCurve}
            options={[
              { value: 'prime256v1', label: 'prime256v1 (P-256)' },
              { value: 'secp384r1', label: 'secp384r1 (P-384)' }
            ]}
          />
          <div className="ct-field">
            <div className="ct-actions" style={{ marginTop: '18px' }}>
              <button type="button" className="ct-btn ct-btn-primary" onClick={generateKeyPair}>
                生成密钥对
              </button>
            </div>
          </div>
          <Field
            label="私钥 Private Key"
            help="您的私钥（十六进制）"
            type="textarea"
            value={privateKey}
            onChange={setPrivateKey}
            copyable
          />
          <Field
            label="公钥 Public Key"
            help="您的公钥（十六进制），需分享给对方"
            type="textarea"
            value={publicKey}
            onChange={setPublicKey}
            copyable
          />
        </div>
      </div>
      <div className="ct-input-zone">
        <div className="ct-zone-label">共享密钥计算</div>
        <div className="ct-grid2">
          <Field
            label="对方公钥 Peer Public Key"
            help="对方的十六进制公钥"
            type="textarea"
            value={peerPublicKey}
            onChange={setPeerPublicKey}
            copyable
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={deriveSecret}>
          计算共享密钥
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label="共享密钥 Shared Secret"
          help="基于 ECDH 协商出的共享密钥（十六进制）"
          type="textarea"
          value={sharedSecret}
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
