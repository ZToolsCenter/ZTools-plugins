import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { runCodec, showError, showData } from '../codec'

const PRESET_HASH = '$2b$12$KIXxKzKzKIXxKzKzKzKzKu0uEYQ7V1p9XwY6ZbN8mDcFqJ3rHtC'

export default function BcryptUI({ enterPayload }: AlgorithmProps) {
  const [password, setPassword] = useState('')
  const [cost, setCost] = useState('12')
  const [hashInput, setHashInput] = useState('')
  const [saltHash, setSaltHash] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [isVerifyMode, setIsVerifyMode] = useState(false)

  useEffect(() => {
    if (enterPayload) {
      setPassword(enterPayload)
    }
  }, [enterPayload])

  const generate = () => {
    const r = runCodec(() =>
      window.services.crypt.bcrypt.hash({
        password,
        cost: Number(cost) || 12
      })
    )
    const err = showError(r)
    setError(err)
    if (!err) {
      const data = showData(r)
      setOutput(data)
      setSaltHash(data)
    }
  }

  const verify = () => {
    const r = runCodec(() =>
      window.services.crypt.bcrypt.verify({
        password,
        hash: hashInput || saltHash
      })
    )
    const err = showError(r)
    setError(err)
    if (!err && r.ok) {
      setOutput(r.data ? '✅ 密码匹配' : '❌ 密码不匹配')
    }
  }

  const loadPreset = () => {
    setSaltHash(PRESET_HASH)
    setHashInput(PRESET_HASH)
  }

  return (
    <>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="密码"
            help="待哈希或验证的密码（bcrypt 限制 72 字节）"
            value={password}
            onChange={setPassword}
            copyable
          />
          {!isVerifyMode ? (
            <Field
              label="计算成本 Cost"
              hint="4–31"
              help="每增加 1，计算量翻倍；12 约 0.3s，14 约 1s"
              value={cost}
              onChange={setCost}
            />
          ) : (
            <Field
              label="哈希值"
              help="待比对的 bcrypt 哈希（$2b$...）"
              type="textarea"
              value={hashInput || saltHash}
              onChange={setHashInput}
              rows={2}
              copyable
            />
          )}
        </div>
      </div>

      <div className="ct-actions">
        <button
          type="button"
          className="ct-btn ct-btn-primary"
          onClick={isVerifyMode ? verify : generate}
        >
          {isVerifyMode ? '验证' : '哈希'}
        </button>
        <button
          type="button"
          className="ct-btn ct-btn-ghost"
          onClick={() => setIsVerifyMode(!isVerifyMode)}
        >
          {isVerifyMode ? '↩ 哈希模式' : '→ 验证模式'}
        </button>
        {isVerifyMode && (
          <button
            type="button"
            className="ct-btn ct-btn-ghost"
            onClick={loadPreset}
          >
            载入示例
          </button>
        )}
      </div>

      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        <Field
          label={isVerifyMode ? '验证结果' : 'bcrypt 哈希'}
          help={isVerifyMode ? '是否匹配' : '可直接存入数据库的哈希字符串'}
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
