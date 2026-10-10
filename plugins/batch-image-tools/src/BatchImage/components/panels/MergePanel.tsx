import { MERGE_MODE_OPTIONS } from '../../config/tools'
import type { MergeOptions } from '../../types'
import { FieldRow } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: MergeOptions
  disabled?: boolean
  onChange: (options: MergeOptions) => void
  onPickOutputDir: () => void
}

export default function MergePanel({ options, disabled, onChange, onPickOutputDir }: PanelProps) {
  const patch = (partial: Partial<MergeOptions>) => onChange({ ...options, ...partial })

  return (
    <div className="tool-panel">
      <FieldRow label="合并方式">
        <select
          value={options.mergeMode}
          onChange={(e) => patch({ mergeMode: e.target.value as MergeOptions['mergeMode'] })}
          disabled={disabled}
        >
          {MERGE_MODE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </FieldRow>

      {options.mergeMode === 'gif-animated' && (
        <FieldRow label="帧间隔">
          <input
            type="number"
            min={100}
            max={5000}
            step={100}
            value={options.gifDelay ?? 500}
            onChange={(e) => patch({ gifDelay: Number(e.target.value) })}
            disabled={disabled}
          />
          <span className="value-tag">ms</span>
        </FieldRow>
      )}

      {options.mergeMode !== 'pdf' && options.mergeMode !== 'gif-animated' && (
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
      )}

      <OutputSettings
        outputMode={options.outputMode}
        outputDir={options.outputDir || ''}
        suffix={options.suffix || '_merged'}
        disabled={disabled}
        onOutputModeChange={(outputMode) => patch({ outputMode })}
        onOutputDirChange={(outputDir) => patch({ outputDir })}
        onSuffixChange={(suffix) => patch({ suffix })}
        onPickOutputDir={onPickOutputDir}
      />
    </div>
  )
}
