import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function PunycodeUI({ direction = 'encode' }: AlgorithmProps) {
  const dir = direction
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.punycode.encode({ input })
        : window.services.crypt.punycode.decode({ input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encode' ? 'Unicode 域名' : 'Punycode 域名'
  const inputHelp = dir === 'encode'
    ? '待编码的国际化域名（如 中文.cn）'
    : '待解码的 Punycode 域名（如 xn--fiq228c.cn）'
  const outputLabel = dir === 'encode' ? 'Punycode 域名' : 'Unicode 域名'
  const outputHelp = dir === 'encode'
    ? '编码后的 ASCII 兼容域名'
    : '解码后的 Unicode 域名'

  return (
    <>
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
