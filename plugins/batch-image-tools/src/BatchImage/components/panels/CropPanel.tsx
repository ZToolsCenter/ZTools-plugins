import { CROP_PRESETS, FORMAT_OPTIONS } from '../../config/tools'
import type { CropOptions, ImageItem } from '../../types'
import CropEditor from '../common/CropEditor'
import { FieldRow, SegmentedButtons } from '../common/FieldRow'
import OutputSettings from '../common/OutputSettings'

interface PanelProps {
  options: CropOptions
  previewImage?: ImageItem | null
  disabled?: boolean
  onChange: (options: CropOptions) => void
  onPickOutputDir: () => void
}

export default function CropPanel({
  options,
  previewImage,
  disabled,
  onChange,
  onPickOutputDir
}: PanelProps) {
  const patch = (partial: Partial<CropOptions>) => onChange({ ...options, ...partial })

  const applyPreset = (w: number, h: number) => {
    const ratio = w / h
    let cropWidth = 0.8
    let cropHeight = cropWidth / ratio
    if (cropHeight > 0.8) {
      cropHeight = 0.8
      cropWidth = cropHeight * ratio
    }
    patch({
      cropMode: 'manual',
      cropRatioW: w,
      cropRatioH: h,
      cropLeft: (1 - cropWidth) / 2,
      cropTop: (1 - cropHeight) / 2,
      cropWidth,
      cropHeight
    })
  }

  return (
    <div className="tool-panel tool-panel--crop">
      <FieldRow label="裁剪方式" wide>
        <SegmentedButtons
          value={options.cropMode || 'manual'}
          options={[
            { value: 'manual', label: '拖拽裁剪' },
            { value: 'ratio', label: '比例居中' }
          ]}
          onChange={(cropMode) => patch({ cropMode })}
          disabled={disabled}
        />
      </FieldRow>

      {(options.cropMode || 'manual') === 'manual' ? (
        <>
          <FieldRow label="快捷比例" wide>
            <div className="chip-group">
              {CROP_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={
                    options.cropRatioW === preset.w && options.cropRatioH === preset.h
                      ? 'chip-btn is-active'
                      : 'chip-btn'
                  }
                  onClick={() => applyPreset(preset.w, preset.h)}
                  disabled={disabled}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className="chip-btn"
                onClick={() =>
                  patch({
                    cropLeft: 0.1,
                    cropTop: 0.1,
                    cropWidth: 0.8,
                    cropHeight: 0.8,
                    cropRatioW: 0,
                    cropRatioH: 0
                  })
                }
                disabled={disabled}
              >
                自由
              </button>
            </div>
          </FieldRow>

          <div className="field-row field-row--wide">
            <CropEditor
              imagePath={previewImage?.path}
              imageWidth={previewImage?.width}
              imageHeight={previewImage?.height}
              value={{
                left: options.cropLeft ?? 0.1,
                top: options.cropTop ?? 0.1,
                width: options.cropWidth ?? 0.8,
                height: options.cropHeight ?? 0.8
              }}
              aspectRatio={
                options.cropRatioW > 0 && options.cropRatioH > 0
                  ? options.cropRatioW / options.cropRatioH
                  : null
              }
              disabled={disabled}
              onChange={(rect) =>
                patch({
                  cropLeft: rect.left,
                  cropTop: rect.top,
                  cropWidth: rect.width,
                  cropHeight: rect.height
                })
              }
            />
          </div>
        </>
      ) : (
        <>
          <FieldRow label="裁剪比例">
            <div className="chip-group">
              {CROP_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={
                    options.cropRatioW === preset.w && options.cropRatioH === preset.h
                      ? 'chip-btn is-active'
                      : 'chip-btn'
                  }
                  onClick={() => patch({ cropRatioW: preset.w, cropRatioH: preset.h })}
                  disabled={disabled}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="自定义">
            <input
              type="number"
              min={1}
              value={options.cropRatioW}
              onChange={(e) => patch({ cropRatioW: Number(e.target.value) })}
              disabled={disabled}
            />
            <span>:</span>
            <input
              type="number"
              min={1}
              value={options.cropRatioH}
              onChange={(e) => patch({ cropRatioH: Number(e.target.value) })}
              disabled={disabled}
            />
          </FieldRow>
        </>
      )}

      <FieldRow label="输出格式">
        <select
          value={options.format}
          onChange={(e) => patch({ format: e.target.value as CropOptions['format'] })}
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
