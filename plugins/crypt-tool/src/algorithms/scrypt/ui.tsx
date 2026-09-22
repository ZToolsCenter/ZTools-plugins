import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function ScryptUI({ enterPayload }: AlgorithmProps) {
  const [password, setPassword] = useState('')
  const [salt, setSalt] = useState('')
  const [keylen, setKeylen] = useState('32')
  const [N, setN] = useState('16384')
  const [r, setR] = useState('8')
  const [p, setP] = useState('1')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (enterPayload) setPassword(enterPayload)
  }, [enterPayload])

  const generateSalt = () => {
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    setSalt(Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join(''))
  }

  const run = () => {
    const r1 = runCodec(() =>
      window.services.crypt.scrypt.derive({
        password,
        salt,
        keylen: Number(keylen) || 32,
        N: Number(N) || 16384,
        r: Number(r) || 8,
        p: Number(p) || 1
      })
    )
    setError(showError(r1))
    setOutput(showData(r1))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="口令 Password"
            help="用户口令"
            type="secret"
            value={password}
            onChange={setPassword}
            copyable
          />
          <Field
            label="盐 Salt"
            help="十六进制编码的随机盐，建议随机生成"
            value={salt}
            onChange={setSalt}
            copyable
          />
          <div className="ct-field">
            <div className="ct-actions" style={{ marginTop: '18px' }}>
              <button type="button" className="ct-btn ct-btn-ghost" onClick={generateSalt}>
                生成随机盐
              </button>
            </div>
          </div>
          <Field label="密钥长度（字节）" help="输出密钥字节数，常用 32 / 64" value={keylen} onChange={setKeylen} />
          <Field label="N（成本）" hint="2 的幂" help="CPU/成本因子，常用 16384" value={N} onChange={setN} />
          <Field label="r（块大小）" help="块大小参数，常用 8" value={r} onChange={setR} />
          <Field label="p（并行度）" help="并行参数，常用 1" value={p} onChange={setP} />
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
