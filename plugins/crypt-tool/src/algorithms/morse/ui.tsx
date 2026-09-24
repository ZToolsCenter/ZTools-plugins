import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function MorseUI({ direction = 'encode' }: AlgorithmProps) {
  const dir = direction
  const [input, setInput] = useState('')
  const [separator, setSeparator] = useState(' ')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const run = () => {
    const r = runCodec(() =>
      dir === 'encode'
        ? window.services.crypt.morse.encode({ input, separator })
        : window.services.crypt.morse.decode({ input, separator })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  const inputLabel = dir === 'encode' ? '原文' : '摩尔斯电码'
  const inputHelp = dir === 'encode'
    ? '待编码的英文字母、数字或标点'
    : '待解码的摩尔斯电码（点划字符串）'
  const outputLabel = dir === 'encode' ? '摩尔斯电码' : '原文'
  const outputHelp = dir === 'encode'
    ? '编码后的摩尔斯码字符串'
    : '解码后的原始文本'

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="分隔符"
            hint="默认空格"
            help="摩尔斯码字符之间的分隔符，通常为单个空格；解码时需与编码时一致"
            value={separator}
            onChange={setSeparator}
          />
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
