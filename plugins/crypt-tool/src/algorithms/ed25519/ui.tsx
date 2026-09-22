import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

type Mode = 'sign' | 'verify'

export default function Ed25519UI({ enterPayload }: AlgorithmProps) {
  const [mode, setMode] = useState<Mode>('sign')
  const [privateKey, setPrivateKey] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [data, setData] = useState('')
  const [signature, setSignature] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [verifyResult, setVerifyResult] = useState<'' | 'true' | 'false'>('')

  useEffect(() => {
    if (enterPayload) setData(enterPayload)
  }, [enterPayload])

  const keygen = () => {
    const r = runCodec(() => window.services.crypt.ed25519.generateKeyPair())
    if (r.ok) {
      setPrivateKey(r.data.privateKey)
      setPublicKey(r.data.publicKey)
    }
  }

  const run = () => {
    if (mode === 'sign') {
      const r = runCodec(() =>
        window.services.crypt.ed25519.sign({ privateKey, data })
      )
      setError(showError(r))
      setOutput(showData(r))
    } else {
      const r = runCodec(() =>
        window.services.crypt.ed25519.verify({ publicKey, data, signature })
      )
      setError(showError(r))
      if (r.ok) {
        setVerifyResult(r.data ? 'true' : 'false')
        setOutput(r.data ? '✅ 签名验证通过' : '❌ 签名无效')
      } else {
        setVerifyResult('')
      }
    }
  }

  const isSign = mode === 'sign'

  return (
    <>
      <div className="ct-tabs">
        <button
          className={`ct-tab ${isSign ? 'on' : ''}`}
          onClick={() => { setMode('sign'); setVerifyResult(''); setOutput('') }}
        >
          签名
        </button>
        <button
          className={`ct-tab ${!isSign ? 'on' : ''}`}
          onClick={() => { setMode('verify'); setVerifyResult(''); setOutput('') }}
        >
          验证
        </button>
        <button className="ct-tab ct-tab-ghost" onClick={keygen}>
          生成密钥对
        </button>
      </div>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          {isSign ? (
            <Field
              label="私钥 Private Key"
              help="PEM 格式 Ed25519 私钥"
              type="textarea"
              value={privateKey}
              onChange={setPrivateKey}
              copyable
            />
          ) : (
            <Field
              label="公钥 Public Key"
              help="PEM 格式 Ed25519 公钥"
              type="textarea"
              value={publicKey}
              onChange={setPublicKey}
              copyable
            />
          )}
          <Field
            label="数据 Data"
            help="待签名/验证的 UTF-8 原文"
            type="textarea"
            value={data}
            onChange={setData}
            copyable
          />
          {!isSign ? (
            <Field
              label="签名 Signature"
              help="Base64 编码的签名值"
              type="textarea"
              value={signature}
              onChange={setSignature}
              copyable
            />
          ) : null}
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          {isSign ? '签名' : '验证'}
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        {isSign ? (
          <Field
            label="签名 Signature"
            help="Base64 编码签名，可复制到验证侧"
            type="textarea"
            value={output}
            onChange={() => {}}
            readOnly
            variant="output"
            copyable
          />
        ) : (
          <Field
            label="验证结果"
            help={verifyResult === 'true' ? '签名与公钥/数据匹配' : verifyResult === 'false' ? '签名不匹配' : ''}
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
