import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function HtmlEntityUI({ direction = 'encode' }: AlgorithmProps) {
  const dir = direction
  const [input, setInput] = useState('')
  const [useNamed, setUseNamed] = useState('true')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.htmlEntity.encode({ input, useNamed: useNamed === 'true' })
        : window.services.crypt.htmlEntity.decode({ input })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encode' ? '原文' : 'HTML 实体'
  const inputHelp = dir === 'encode'
    ? '待编码的 UTF-8 文本'
    : '待解码的 &amp;lt; / &#x4E2D; 实体字符串'
  const outputLabel = dir === 'encode' ? 'HTML 实体' : '原文'
  const outputHelp = dir === 'encode'
    ? '编码后的 HTML 实体字符串'
    : '解码后的原始文本'

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          {dir === 'encode' ? (
            <Field
              label="优先使用命名实体"
              help="开启后将尽可能使用 &amp;name; 形式，否则使用数字实体 &#xHHHH;"
              type="select"
              value={useNamed}
              onChange={setUseNamed}
              options={[
                { value: 'true', label: '是' },
                { value: 'false', label: '否' }
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
