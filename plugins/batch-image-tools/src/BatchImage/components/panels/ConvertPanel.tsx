import { FORMAT_OPTIONS } from '../../config/tools'
import type { ConvertOptions } from '../../types'
import { FieldRow } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: ConvertOptions
  disabled?: boolean
  onChange: (options: ConvertOptions) => void
  onPickOutputDir: () => void
}

export default function ConvertPanel({ options, disabled, onChange, onPickOutputDir }: PanelProps) {
  const patch = (partial: Partial<ConvertOptions>) => onChange({ ...options, ...partial })
  const formats = FORMAT_OPTIONS.filter((item) => item.value !== 'original')

  return (
    <div className="tool-panel">
      <FieldRow label="目标格式">
        <select
          value={options.format}
          onChange={(e) => patch({ format: e.target.value as ConvertOptions['format'] })}
          disabled={disabled}
        >
          {formats.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="输出质量">
        <input
          type="range"
          min={10}
          max={100}
          value={options.quality}
          onChange={(e) => patch({ quality: Number(e.target.value) })}
          disabled={disabled}
        />
        <span className="value-tag">{options.quality}</span>
      </FieldRow>

      <OutputSettings
        outputMode={options.outputMode}
        outputDir={options.outputDir || ''}
        suffix={options.suffix || '_processed'}
        disabled={disabled}
        onOutputModeChange={(outputMode) => patch({ outputMode })}
        onOutputDirChange={(outputDir) => patch({ outputDir })}
        onSuffixChange={(suffix) => patch({ suffix })}
        onPickOutputDir={onPickOutputDir}
      />
    </div>
  )
}
