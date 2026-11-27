import { FORMAT_OPTIONS } from '../../config/tools'
import type { StyleOptions } from '../../types'
import { FieldRow } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: StyleOptions
  disabled?: boolean
  onChange: (options: StyleOptions) => void
  onPickOutputDir: () => void
}

export default function StylePanel({ options, disabled, onChange, onPickOutputDir }: PanelProps) {
  const patch = (partial: Partial<StyleOptions>) => onChange({ ...options, ...partial })

  return (
    <div className="tool-panel">
      <FieldRow label="圆角">
        <input
          type="range"
          min={0}
          max={50}
          value={options.borderRadius ?? 0}
          onChange={(e) => patch({ borderRadius: Number(e.target.value) })}
          disabled={disabled}
        />
        <span className="value-tag">{options.borderRadius ?? 0}%</span>
      </FieldRow>

      <FieldRow label="边框">
        <input
          type="number"
          min={0}
          max={100}
          value={options.borderWidth ?? 0}
          onChange={(e) => patch({ borderWidth: Number(e.target.value) })}
          disabled={disabled}
        />
        <input
          type="color"
          value={options.borderColor || '#333333'}
          onChange={(e) => patch({ borderColor: e.target.value })}
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow label="边距">
        <input
          type="number"
          min={0}
          max={200}
          value={options.padding ?? 0}
          onChange={(e) => patch({ padding: Number(e.target.value) })}
          disabled={disabled}
        />
        <span className="value-tag">px</span>
      </FieldRow>

      <FieldRow label="边距颜色">
        <input
          type="color"
          value={options.paddingColor || '#ffffff'}
          onChange={(e) => patch({ paddingColor: e.target.value })}
          disabled={disabled}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={options.paddingOpacity ?? 100}
          onChange={(e) => patch({ paddingOpacity: Number(e.target.value) })}
          disabled={disabled}
        />
        <span className="value-tag">{options.paddingOpacity ?? 100}%</span>
      </FieldRow>

      <FieldRow label="输出格式">
        <select
          value={options.format}
          onChange={(e) => patch({ format: e.target.value as StyleOptions['format'] })}
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
