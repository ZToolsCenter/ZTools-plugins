import { FORMAT_OPTIONS, WATERMARK_POSITIONS } from '../../config/tools'
import type { WatermarkOptions } from '../../types'
import { FieldRow, SegmentedButtons } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: WatermarkOptions
  disabled?: boolean
  onChange: (options: WatermarkOptions) => void
  onPickOutputDir: () => void
  onPickWatermarkImage: () => void
}

export default function WatermarkPanel({
  options,
  disabled,
  onChange,
  onPickOutputDir,
  onPickWatermarkImage
}: PanelProps) {
  const patch = (partial: Partial<WatermarkOptions>) => onChange({ ...options, ...partial })

  return (
    <div className="tool-panel">
      <FieldRow label="水印类型">
        <SegmentedButtons
          value={options.watermarkType}
          options={[
            { value: 'text', label: '文字' },
            { value: 'image', label: '图片' }
          ]}
          onChange={(watermarkType) => patch({ watermarkType })}
          disabled={disabled}
        />
      </FieldRow>

      {options.watermarkType === 'text' ? (
        <>
          <FieldRow label="文字内容">
            <input
              type="text"
              value={options.watermarkText || ''}
              onChange={(e) => patch({ watermarkText: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
          <FieldRow label="字号">
            <input
              type="number"
              min={12}
              max={200}
              value={options.watermarkFontSize ?? 32}
              onChange={(e) => patch({ watermarkFontSize: Number(e.target.value) })}
              disabled={disabled}
            />
          </FieldRow>
          <FieldRow label="文字颜色">
            <input
              type="color"
              value={options.watermarkColor || '#ffffff'}
              onChange={(e) => patch({ watermarkColor: e.target.value })}
              disabled={disabled}
            />
          </FieldRow>
        </>
      ) : (
        <FieldRow label="水印图片" wide>
          <div className="dir-picker">
            <input
              type="text"
              readOnly
              value={options.watermarkImagePath || ''}
              placeholder="选择 PNG/JPG 水印图"
            />
            <button type="button" onClick={onPickWatermarkImage} disabled={disabled}>
              选择
            </button>
          </div>
        </FieldRow>
      )}

      <FieldRow label="透明度">
        <input
          type="range"
          min={5}
          max={100}
          value={options.watermarkOpacity ?? 50}
          onChange={(e) => patch({ watermarkOpacity: Number(e.target.value) })}
          disabled={disabled}
        />
        <span className="value-tag">{options.watermarkOpacity ?? 50}%</span>
      </FieldRow>

      <FieldRow label="位置">
        <select
          value={options.watermarkPosition || 'southeast'}
          onChange={(e) => patch({ watermarkPosition: e.target.value })}
          disabled={disabled}
        >
          {WATERMARK_POSITIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="输出格式">
        <select
          value={options.format}
          onChange={(e) => patch({ format: e.target.value as WatermarkOptions['format'] })}
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
