import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

export default function UUIDUI({}: AlgorithmProps) {
  const [version, setVersion] = useState('v4')
  const [count, setCount] = useState('1')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const generate = () => {
    const r = runCodec(() =>
      window.services.crypt.uuid.generate({
        version,
        count: Number(count) || 1
      })
    )
    setError(showError(r))
    setOutput(showData(r))
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">配置</div>
        <div className="ct-grid2">
          <Field
            label="版本"
            help="v4：完全随机｜v7：时间戳排序（推荐用于数据库主键）"
            type="select"
            value={version}
            onChange={setVersion}
            options={[
              { value: 'v4', label: 'UUID v4（随机）' },
              { value: 'v7', label: 'UUID v7（时间排序）' }
            ]}
          />
          <Field label="数量" hint="1-100" help="一次生成的 UUID 数量" value={count} onChange={setCount} />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={generate}>
          生成
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label="UUID"
          help="每行一个"
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
