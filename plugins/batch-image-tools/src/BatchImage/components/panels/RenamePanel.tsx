import { useMemo } from 'react'
import type { RenameOptions } from '../../types'
import { FieldRow, SegmentedButtons } from '../common/FieldRow'
import { pathBasename } from '../../utils'

interface PanelProps {
  options: RenameOptions
  sampleName?: string
  disabled?: boolean
  onChange: (options: RenameOptions) => void
}

function previewName(options: RenameOptions, sampleName: string, index: number) {
  const extMatch = /\.[^.]+$/.exec(sampleName)
  const ext = extMatch ? extMatch[0] : ''
  const base = sampleName.slice(0, sampleName.length - ext.length)

  if (options.renameMode === 'replace') {
    const findText = options.findText || ''
    if (!findText) return `${base || '文件名'}${ext || '.jpg'}`
    return `${base.split(findText).join(options.replaceText || '')}${ext || '.jpg'}`
  }

  const pad = Math.max(1, options.padLength || 3)
  const start = Number.isFinite(options.startIndex) ? options.startIndex : 1
  const number = String(start + index).padStart(pad, '0')
  const prefix = options.prefix || ''
  const separator = options.separator ?? '_'
  const nextBase = prefix ? `${prefix}${separator}${number}` : number
  return `${nextBase}${ext || '.jpg'}`
}

export default function RenamePanel({ options, sampleName, disabled, onChange }: PanelProps) {
  const patch = (partial: Partial<RenameOptions>) => onChange({ ...options, ...partial })
  const sample = sampleName || 'example.jpg'

  const previews = useMemo(
    () => [0, 1, 2].map((index) => previewName(options, sample, index)),
    [options, sample]
  )

  return (
    <div className="tool-panel">
      <FieldRow label="重命名方式">
        <SegmentedButtons
          value={options.renameMode}
          options={[
            { value: 'sequence', label: '序号模板' },
            { value: 'replace', label: '查找替换' }
          ]}
          onChange={(renameMode) => patch({ renameMode })}
          disabled={disabled}
        />
      </FieldRow>

      {options.renameMode === 'sequence' ? (
        <>
          <FieldRow label="前缀">
            <input
              type="text"
              value={options.prefix}
              placeholder="可选，如 photo"
              onChange={(e) => patch({ prefix: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
          <FieldRow label="起始序号">
            <input
              type="number"
              min={0}
              value={options.startIndex}
              onChange={(e) => patch({ startIndex: Number(e.target.value) })}
              disabled={disabled}
            />
          </FieldRow>
          <FieldRow label="位数">
            <input
              type="number"
              min={1}
              max={10}
              value={options.padLength}
              onChange={(e) => patch({ padLength: Number(e.target.value) })}
              disabled={disabled}
            />
          </FieldRow>
          <FieldRow label="分隔符">
            <input
              type="text"
              value={options.separator}
              placeholder="_"
              onChange={(e) => patch({ separator: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
        </>
      ) : (
        <>
          <FieldRow label="查找">
            <input
              type="text"
              value={options.findText}
              placeholder="要替换的文字"
              onChange={(e) => patch({ findText: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
          <FieldRow label="替换为">
            <input
              type="text"
              value={options.replaceText}
              placeholder="可留空表示删除"
              onChange={(e) => patch({ replaceText: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
        </>
      )}

      <FieldRow label="预览" wide>
        <div className="rename-preview">
          <div className="rename-preview__sample">示例：{pathBasename(sample)}</div>
          <ul>
            {previews.map((name, index) => (
              <li key={`${name}-${index}`}>
                {index + 1}. {name}
              </li>
            ))}
          </ul>
          <p className="rename-preview__hint">原地改名，保留扩展名；目标名已存在则跳过该文件。</p>
        </div>
      </FieldRow>
    </div>
  )
}
