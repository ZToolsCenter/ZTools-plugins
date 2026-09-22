import { useEffect, useState } from 'react'
import type { AlgorithmProps } from '../../registry/types'
import { Field } from '../../shared'
import { showError, showData } from '../codec'

type Mode = 'hash' | 'verify'

export default function Argon2UI({ enterPayload }: AlgorithmProps) {
  const [mode, setMode] = useState<Mode>('hash')
  const [password, setPassword] = useState('')
  const [hashString, setHashString] = useState('')
  const [type, setType] = useState('argon2id')
  const [timeCost, setTimeCost] = useState('3')
  const [memoryCost, setMemoryCost] = useState('65536')
  const [parallelism, setParallelism] = useState('1')
  const [salt, setSalt] = useState('')
  const [hashLength, setHashLength] = useState('32')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (enterPayload) setPassword(enterPayload)
  }, [enterPayload])

  const run = async () => {
    setBusy(true)
    try {
      if (mode === 'hash') {
        const r = await window.services.crypt.argon2.hash({
          password,
          type,
          timeCost: Number(timeCost) || 3,
          memoryCost: Number(memoryCost) || 65536,
          parallelism: Number(parallelism) || 1,
          salt,
          hashLength: Number(hashLength) || 32
        })
        setError(showError(r))
        setOutput(showData(r))
      } else {
        const r = await window.services.crypt.argon2.verify({ password, hash: hashString })
        setError(showError(r))
        if (r.ok) {
          setOutput(r.data ? '✅ 密码匹配' : '❌ 密码不匹配')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '计算失败')
      setOutput('')
    }
    setBusy(false)
  }

  const isHash = mode === 'hash'

  return (
    <>
      <div className="ct-tabs">
        <button
          className={`ct-tab ${isHash ? 'on' : ''}`}
          onClick={() => { setMode('hash'); setOutput('') }}
        >
          哈希
        </button>
        <button
          className={`ct-tab ${!isHash ? 'on' : ''}`}
          onClick={() => { setMode('verify'); setOutput('') }}
        >
          验证
        </button>
      </div>
      <div className="ct-input-zone">
        <div className="ct-zone-label">输入</div>
        <div className="ct-grid2">
          <Field
            label="口令 Password"
            help="用户口令"
            type="secret"
            value={password}
            onChange={setPassword}
            copyable
          />
          {!isHash ? (
            <Field
              label="Argon2 哈希"
              help="完整 Argon2 哈希字符串（含参数、盐、摘要）"
              type="textarea"
              value={hashString}
              onChange={setHashString}
              copyable
            />
          ) : (
            <>
              <Field
                label="类型 Type"
                help="argon2id 最通用；argon2i 抗 GPU；argon2d 抗侧信道"
                type="select"
                value={type}
                onChange={setType}
                options={[
                  { value: 'argon2id', label: 'argon2id' },
                  { value: 'argon2i', label: 'argon2i' },
                  { value: 'argon2d', label: 'argon2d' }
                ]}
              />
              <Field label="时间成本" help="迭代次数，常用 2-4" value={timeCost} onChange={setTimeCost} />
              <Field label="内存成本（KiB）" help="内存占用，常用 65536（64 MiB）" value={memoryCost} onChange={setMemoryCost} />
              <Field label="并行度" help="线程数，常用 1" value={parallelism} onChange={setParallelism} />
              <Field label="自定义盐（可选）" help="留空则自动生成" value={salt} onChange={setSalt} />
              <Field label="哈希长度（字节）" help="输出摘要字节数" value={hashLength} onChange={setHashLength} />
            </>
          )}
        </div>
      </div>
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn-primary" onClick={run} disabled={busy}>
          {busy ? '计算中…' : (isHash ? '哈希' : '验证')}
        </button>
      </div>
      <div className="ct-output-zone">
        <div className="ct-zone-label">输出</div>
        {isHash ? (
          <Field
            label="Argon2 哈希"
            help="标准 PHC 字符串格式，可存库用于后续验证"
            type="textarea"
            value={output}
            onChange={() => {}}
            readOnly
            variant="output"
            copyable
          />
        ) : (
          <Field
            label="验证结果"
            type="textarea"
            value={output}
            onChange={() => {}}
            readOnly
            variant="output"
            copyable
          />
        )}
      </div>
      {error ? <div className="ct-field-error">{error}</div> : null}
    </>
  )
}
