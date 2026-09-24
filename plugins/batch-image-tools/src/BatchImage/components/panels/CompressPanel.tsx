import { FORMAT_OPTIONS } from '../../config/tools'
import type { CompressOptions } from '../../types'
import { FieldRow } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: CompressOptions
  disabled?: boolean
  onChange: (options: CompressOptions) => void
  onPickOutputDir: () => void
}

export default function CompressPanel({ options, disabled, onChange, onPickOutputDir }: PanelProps) {
  const patch = (partial: Partial<CompressOptions>) => onChange({ ...options, ...partial })

  return (
    <div className="tool-panel">
      <FieldRow label="压缩质量">
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

      <FieldRow label="目标体积">
        <input
          type="number"
          min={0}
          placeholder="留空按质量压缩"
          value={options.targetSizeKb ?? ''}
          onChange={(e) =>
            patch({ targetSizeKb: e.target.value ? Number(e.target.value) : null })
          }
          disabled={disabled}
        />
        <span className="value-tag">KB</span>
      </FieldRow>

      <FieldRow label="输出格式">
        <select
          value={options.format}
          onChange={(e) => patch({ format: e.target.value as CompressOptions['format'] })}
          disabled={disabled}
        >
          {FORMAT_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
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
