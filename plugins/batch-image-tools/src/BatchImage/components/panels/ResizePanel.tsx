import { FORMAT_OPTIONS } from '../../config/tools'
import type { ResizeOptions } from '../../types'
import { FieldRow, SegmentedButtons } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: ResizeOptions
  disabled?: boolean
  onChange: (options: ResizeOptions) => void
  onPickOutputDir: () => void
}

export default function ResizePanel({ options, disabled, onChange, onPickOutputDir }: PanelProps) {
  const patch = (partial: Partial<ResizeOptions>) => onChange({ ...options, ...partial })

  return (
    <div className="tool-panel">
      <FieldRow label="缩放模式">
        <SegmentedButtons
          value={options.resizeMode}
          options={[
            { value: 'pixel', label: '像素' },
            { value: 'percent', label: '百分比' }
          ]}
          onChange={(resizeMode) => patch({ resizeMode })}
          disabled={disabled}
        />
      </FieldRow>

      {options.resizeMode === 'percent' ? (
        <FieldRow label="缩放比例">
          <input
            type="number"
            min={1}
            max={500}
            value={options.scalePercent ?? 100}
            onChange={(e) => patch({ scalePercent: Number(e.target.value) })}
            disabled={disabled}
          />
          <span className="value-tag">%</span>
        </FieldRow>
      ) : (
        <>
          <FieldRow label="宽度">
            <input
              type="number"
              min={1}
              placeholder="自动"
              value={options.width ?? ''}
              onChange={(e) => patch({ width: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
          <FieldRow label="高度">
            <input
              type="number"
              min={1}
              placeholder="自动"
              value={options.height ?? ''}
              onChange={(e) => patch({ height: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
        </>
      )}

      <FieldRow label="选项">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={options.keepAspectRatio}
            onChange={(e) => patch({ keepAspectRatio: e.target.checked })}
            disabled={disabled}
          />
          保持宽高比
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={options.withoutEnlargement}
            onChange={(e) => patch({ withoutEnlargement: e.target.checked })}
            disabled={disabled}
          />
          不放大
        </label>
      </FieldRow>

      <FieldRow label="输出格式">
        <select
          value={options.format}
          onChange={(e) => patch({ format: e.target.value as ResizeOptions['format'] })}
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
