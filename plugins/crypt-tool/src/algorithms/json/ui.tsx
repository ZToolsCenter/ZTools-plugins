import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function JsonUI({}: AlgorithmProps) {
  const [input, setInput] = useState('')
  const [indent, setIndent] = useState('2')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const formatJson = () => {
    const r = runCodec(() => {
      const ind = indent === 'none' ? 0 : Number(indent)
      return window.services.crypt.json.format({ input, indent: ind })
    })
    setError(showError(r))
    setOutput(showData(r))
  }

  const minifyJson = () => {
    const r = runCodec(() => window.services.crypt.json.minify({ input }))
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="缩进 Indent"
            help="格式化时每级的缩进空格数"
            type="select"
            value={indent}
            onChange={setIndent}
            options={[
              { value: '2', label: '2 空格' },
              { value: '4', label: '4 空格' },
              { value: 'none', label: '无缩进' }
            ]}
          />
          <Field
            label="JSON 原文"
            help="待格式化或压缩的 JSON 字符串"
            type="textarea"
            value={input}
            onChange={setInput}
            copyable
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={formatJson}>
          格式化
        </button>
        <button type="button" className="ct-btn ct-btn-ghost" onClick={minifyJson}>
          压缩
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label="结果"
          help="格式化或压缩后的 JSON 字符串"
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
