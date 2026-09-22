import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function Pbkdf2UI({ enterPayload }: AlgorithmProps) {
  const [password, setPassword] = useState('')
  const [salt, setSalt] = useState('salt')
  const [iterations, setIterations] = useState('100000')
  const [keyLength, setKeyLength] = useState('32')
  const [digest, setDigest] = useState('sha256')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setPassword(enterPayload)
  }, [enterPayload])

  const run = () => {
    const r = runCodec(() =>
      window.services.crypt.pbkdf2.derive({
        password,
        salt,
        iterations: Number(iterations) || 0,
        keylen: Number(keyLength) || 0,
        hash: digest
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
          <Field label="口令 Password" help="用户口令" type="secret" value={password} onChange={setPassword} copyable />
          <Field label="盐 Salt" help="随机盐；相同参数才得相同密钥" value={salt} onChange={setSalt} copyable />
          <Field label="迭代次数" hint="≥ 1" help="越大越慢越安全，常见 10 万+" value={iterations} onChange={setIterations} />
          <Field label="密钥长度（字节）" hint="1–1024" help="派生输出字节数" value={keyLength} onChange={setKeyLength} />
          <Field
            label="摘要"
            help="PBKDF2 内部 HMAC 算法"
            type="select"
            value={digest}
            onChange={setDigest}
            options={[
              { value: 'sha1', label: 'SHA-1' },
              { value: 'sha256', label: 'SHA-256' },
              { value: 'sha512', label: 'SHA-512' }
            ]}
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          派生
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field label="派生密钥 Hex" help="十六进制编码的密钥材料" type="textarea" value={output} onChange={() => {}} readOnly variant="output" copyable />
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
