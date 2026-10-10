import { useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError } from '../codec'

export default function PasswordStrengthUI({}: AlgorithmProps) {
  const [password, setPassword] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const analyze = () => {
    const r = runCodec(() => window.services.crypt.passwordStrength.analyze({ password }))
    setError(showError(r))
    if (r.ok) {
      const { score, label, length, hasLower, hasUpper, hasDigit, hasSymbol } = r.data
      const lines = [
        `强度: ${label} (${score}分)`,
        `长度: ${length}`,
        `包含小写字母: ${hasLower ? '是' : '否'}`,
        `包含大写字母: ${hasUpper ? '是' : '否'}`,
        `包含数字: ${hasDigit ? '是' : '否'}`,
        `包含符号: ${hasSymbol ? '是' : '否'}`
      ]
      setOutput(lines.join('\n'))
    } else {
      setOutput('')
    }
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="密码"
            help="待分析强度的密码内容"
            type="secret"
            value={password}
            onChange={setPassword}
          />
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={analyze}>
          分析
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label="分析结果"
        help="密码强度评分、标签及字符组成信息"
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
