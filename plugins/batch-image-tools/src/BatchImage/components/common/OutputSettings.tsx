import type { OutputMode } from '../../types'
import { FieldRow } from './FieldRow'

interface OutputSettingsProps {
  outputMode: OutputMode
  outputDir: string
  suffix: string
  disabled?: boolean
  onOutputModeChange: (mode: OutputMode) => void
  onOutputDirChange: (dir: string) => void
  onSuffixChange: (suffix: string) => void
  onPickOutputDir: () => void
}

export default function OutputSettings({
  outputMode,
  outputDir,
  suffix,
  disabled,
  onOutputModeChange,
  onOutputDirChange,
  onSuffixChange,
  onPickOutputDir
}: OutputSettingsProps) {
  return (
    <>
      <FieldRow label="保存方式">
        <select
          value={outputMode}
          onChange={(e) => onOutputModeChange(e.target.value as OutputMode)}
          disabled={disabled}
        >
          <option value="same-folder">同目录另存</option>
          <option value="overwrite">覆盖原图</option>
          <option value="output-dir">指定目录</option>
        </select>
      </FieldRow>

      {outputMode === 'same-folder' && (
        <FieldRow label="文件名后缀">
          <input
            type="text"
            value={suffix}
            onChange={(e) => onSuffixChange(e.target.value)}
            disabled={disabled}
          />
        </FieldRow>
      )}

      {outputMode === 'output-dir' && (
        <FieldRow label="输出目录" wide>
          <div className="dir-picker">
            <input
              type="text"
              value={outputDir}
              readOnly
              placeholder="点击选择目录"
              onChange={(e) => onOutputDirChange(e.target.value)}
            />
            <button type="button" onClick={onPickOutputDir} disabled={disabled}>
              选择
            </button>
          </div>
        </FieldRow>
      )}
    </>
  )
}
