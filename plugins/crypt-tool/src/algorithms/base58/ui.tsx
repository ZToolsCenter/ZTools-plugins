import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

type Variant = 'base58' | 'base58check'

export default function Base58UI({ direction = 'encode' }: AlgorithmProps) {
  const [variant, setVariant] = useState<Variant>('base58')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const isCheck = variant === 'base58check'
  const isEncode = direction === 'encode'

  const run = () => {
    if (!isCheck) {
      const r = runCodec(() =>
        isEncode
          ? window.services.crypt.base58.encode({ input })
          : window.services.crypt.base58.decode({ input })
      )
      setError(showError(r))
      setOutput(showData(r))
      return
    }

    if (isEncode) {
      const r = runCodec(() => window.services.crypt.base58check.encode({ input }))
      setError(showError(r))
      setOutput(showData(r))
      return
    }

    const r = runCodec(() => window.services.crypt.base58check.decode({ input })) as
      | { ok: true; data: { valid: boolean; data: string } }
      | { ok: false; error: string }

    setError(showError(r))
    if (r.ok) {
      setOutput(`校验：${r.data.valid ? '通过' : '失败'}\n数据 Hex：${r.data.data}`)
    } else {
      setOutput('')
    }
  }

  const inputLabel = isCheck
    ? isEncode ? 'Hex 数据' : 'Base58check 地址'
    : isEncode ? '明文' : 'Base58'
  const inputHelp = isCheck
    ? isEncode
      ? '十六进制编码的 payload（含可选版本前缀）'
      : '含 4 字节校验和的 Base58check 编码'
    : isEncode
      ? '待编码的 UTF-8 文本'
      : '待解码的 Base58 字符串'
  const outputLabel = isCheck
    ? isEncode ? 'Base58check 地址' : '校验结果'
    : isEncode ? 'Base58' : '明文'
  const outputHelp = isCheck
    ? isEncode
      ? '含 4 字节校验和的 Base58 编码'
      : '校验结果与还原后的十六进制数据'
    : isEncode
      ? 'Base58 编码字符串'
      : '解码后的 UTF-8 明文'

  return (
    <>
      <div className="ct-tabs">
        <button
          type="button"
          className={`ct-tab ${variant === 'base58' ? 'on' : ''}`}
          onClick={() => { setVariant('base58'); setOutput(''); setError('') }}
        >
          Base58
        </button>
        <button
          type="button"
          className={`ct-tab ${variant === 'base58check' ? 'on' : ''}`}
          onClick={() => { setVariant('base58check'); setOutput(''); setError('') }}
        >
          Base58check
        </button>
      </div>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
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
          {isEncode ? '编码' : '解码'}
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
