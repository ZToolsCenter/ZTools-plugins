import type { ImageItem, ToolId, ToolOptions } from '../../types'
import CompressPanel from './CompressPanel'
import ConvertPanel from './ConvertPanel'
import CropPanel from './CropPanel'
import MergePanel from './MergePanel'
import RenamePanel from './RenamePanel'
import ResizePanel from './ResizePanel'
import RotatePanel from './RotatePanel'
import StylePanel from './StylePanel'
import WatermarkPanel from './WatermarkPanel'

interface ToolPanelProps {
  activeTool: ToolId
  options: ToolOptions
  previewImage?: ImageItem | null
  disabled?: boolean
  onChange: (options: ToolOptions) => void
  onPickOutputDir: () => void
  onPickWatermarkImage: () => void
}

export default function ToolPanel({
  activeTool,
  options,
  previewImage,
  disabled,
  onChange,
  onPickOutputDir,
  onPickWatermarkImage
}: ToolPanelProps) {
  switch (activeTool) {
    case 'compress':
      return (
        <CompressPanel
          options={options as Extract<ToolOptions, { tool: 'compress' }>}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
        />
      )
    case 'convert':
      return (
        <ConvertPanel
          options={options as Extract<ToolOptions, { tool: 'convert' }>}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
        />
      )
    case 'resize':
      return (
        <ResizePanel
          options={options as Extract<ToolOptions, { tool: 'resize' }>}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
        />
      )
    case 'rotate':
      return (
        <RotatePanel
          options={options as Extract<ToolOptions, { tool: 'rotate' }>}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
        />
      )
    case 'crop':
      return (
        <CropPanel
          options={options as Extract<ToolOptions, { tool: 'crop' }>}
          previewImage={previewImage}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
        />
      )
    case 'watermark':
      return (
        <WatermarkPanel
          options={options as Extract<ToolOptions, { tool: 'watermark' }>}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
          onPickWatermarkImage={onPickWatermarkImage}
        />
      )
    case 'style':
      return (
        <StylePanel
          options={options as Extract<ToolOptions, { tool: 'style' }>}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
        />
      )
    case 'merge':
      return (
        <MergePanel
          options={options as Extract<ToolOptions, { tool: 'merge' }>}
          disabled={disabled}
          onChange={onChange}
          onPickOutputDir={onPickOutputDir}
        />
      )
    case 'rename':
      return (
        <RenamePanel
          options={options as Extract<ToolOptions, { tool: 'rename' }>}
          sampleName={previewImage?.name}
          disabled={disabled}
          onChange={onChange}
        />
      )
    default:
      return null
  }
}
