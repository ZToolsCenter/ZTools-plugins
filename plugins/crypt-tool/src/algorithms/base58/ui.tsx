import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

type Variant = 'base58' | 'base58check'

export default function Base58UI({}: AlgorithmProps) {
  const [variant, setVariant] = useState<Variant>('base58')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    if (variant === 'base58') {
      const r = runCodec(() => window.services.crypt.base58.encode({ input }))
      setError(showError(r))
      setOutput(showData(r))
    } else {
      const r = runCodec(() => window.services.crypt.base58check.encode({ input }))
      setError(showError(r))
      setOutput(showData(r))
    }
  }

  const decode = () => {
    if (variant === 'base58') {
      const r = runCodec(() => window.services.crypt.base58.decode({ input }))
      setError(showError(r))
      setOutput(showData(r))
    } else {
      const r = runCodec(() => window.services.crypt.base58check.decode({ input })) as {
        ok: true; data: { valid: boolean; data: string }
      } | { ok: false; error: string }
      setError(showError(r))
      if (r.ok) {
        setOutput(`校验: ${r.data.valid ? '✅ 通过' : '❌ 失败'}\n数据 Hex: ${r.data.data}`)
      } else {
        setOutput('')
      }
    }
  }

  const isCheck = variant === 'base58check'

  return (
    <>
      <div className="ct-tabs">
        <button
          className={`ct-tab ${variant === 'base58' ? 'on' : ''}`}
          onClick={() => setVariant('base58')}
        >
          Base58
        </button>
        <button
          className={`ct-tab ${variant === 'base58check' ? 'on' : ''}`}
          onClick={() => setVariant('base58check')}
        >
          Base58check
        </button>
      </div>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label={isCheck ? 'Hex 数据' : '明文'}
            help={isCheck ? '十六进制编码的 payload（含可选版本前缀）' : '待编码的 UTF-8 文本'}
            type="textarea"
            value={input}
            onChange={setInput}
            copyable
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run}>
          编码
        </button>
        <button type="button" className="ct-btn ct-btn-ghost" onClick={decode}>
          解码
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label={isCheck ? 'Base58check 地址' : 'Base58'}
          help={isCheck ? '含 4 字节校验和的 Base58 编码' : 'Base58 编码字符串'}
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
