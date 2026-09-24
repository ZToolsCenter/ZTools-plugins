import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function SafeBase64UI({ direction = 'encode' }: AlgorithmProps) {
  const dir = direction
  const [input, setInput] = useState('')
  const [stripPadding, setStripPadding] = useState('false')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.safeBase64.encode({ input, stripPadding: stripPadding === 'true' })
        : window.services.crypt.safeBase64.decode({ input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encode' ? '明文' : 'Safe Base64'
  const inputHelp = dir === 'encode'
    ? '待编码的 UTF-8 文本'
    : '待解码的 URL 安全 Base64 字符串'
  const outputLabel = dir === 'encode' ? 'Safe Base64' : '明文'
  const outputHelp = dir === 'encode'
    ? '编码后的 URL 安全 Base64 字符串'
    : '解码后的 UTF-8 明文'

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          {dir === 'encode' ? (
            <Field
              label="去除 Padding"
              help="是否去除尾部的 = 填充字符；去除后更紧凑但不便于部分解码器处理"
              type="select"
              value={stripPadding}
              onChange={setStripPadding}
              options={[
                { value: 'false', label: '保留 =' },
                { value: 'true', label: '去除 =' }
              ]}
            />
          ) : null}
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
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
