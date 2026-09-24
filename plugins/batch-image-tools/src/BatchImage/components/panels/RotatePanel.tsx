import { FORMAT_OPTIONS } from '../../config/tools'
import type { RotateOptions } from '../../types'
import { FieldRow } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: RotateOptions
  disabled?: boolean
  onChange: (options: RotateOptions) => void
  onPickOutputDir: () => void
}

export default function RotatePanel({ options, disabled, onChange, onPickOutputDir }: PanelProps) {
  const patch = (partial: Partial<RotateOptions>) => onChange({ ...options, ...partial })

  return (
    <div className="tool-panel">
      <FieldRow label="旋转角度">
        <input
          type="number"
          min={-360}
          max={360}
          value={options.rotateAngle}
          onChange={(e) => patch({ rotateAngle: Number(e.target.value) })}
          disabled={disabled}
        />
        <span className="value-tag">°</span>
      </FieldRow>

      <FieldRow label="快捷旋转">
        {[90, 180, 270, -90].map((angle) => (
          <button
            key={angle}
            type="button"
            className="chip-btn"
            onClick={() => patch({ rotateAngle: angle })}
            disabled={disabled}
          >
            {angle}°
          </button>
        ))}
      </FieldRow>

      <FieldRow label="翻转">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={options.flipHorizontal}
            onChange={(e) => patch({ flipHorizontal: e.target.checked })}
            disabled={disabled}
          />
          水平翻转
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={options.flipVertical}
            onChange={(e) => patch({ flipVertical: e.target.checked })}
            disabled={disabled}
          />
          垂直翻转
        </label>
      </FieldRow>

      <FieldRow label="输出格式">
        <select
          value={options.format}
          onChange={(e) => patch({ format: e.target.value as RotateOptions['format'] })}
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
