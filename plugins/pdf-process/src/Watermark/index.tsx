import { useState } from 'react'
import WorkspaceFiles from '../components/WorkspaceFiles'
import OperationResult from '../components/OperationResult'
import FeatureLayout from '../components/FeatureLayout'
import { useOperation } from '../hooks/useOperation'
import { useSharedFiles } from '../context/SharedFilesContext'
import { generateTaskId, buildTaskOutputPath, buildConvertedFilename } from '../hooks/useTaskFolder'
import { withInputPath } from '../utils/fileFromShared'
import './index.css'

interface WatermarkProps {
  onBack?: () => void
}

type PosKey =
  | 'tl'
  | 'tc'
  | 'tr'
  | 'ml'
  | 'mc'
  | 'mr'
  | 'bl'
  | 'bc'
  | 'br'

const POSITIONS: { key: PosKey; label: string }[] = [
  { key: 'tl', label: '左上' },
  { key: 'tc', label: '上' },
  { key: 'tr', label: '右上' },
  { key: 'ml', label: '左' },
  { key: 'mc', label: '中' },
  { key: 'mr', label: '右' },
  { key: 'bl', label: '左下' },
  { key: 'bc', label: '下' },
  { key: 'br', label: '右下' },
]

const DENSITY_LABELS = ['疏', '较疏', '中', '较密', '密']

export default function Watermark(_props: WatermarkProps) {
  const [text, setText] = useState('机密文件')
  const [fontSize, setFontSize] = useState(20)
  const [color, setColor] = useState('#ff4d4f')
  const [margin, setMargin] = useState(24)
  const [rotation, setRotation] = useState(0)
  const [opacity, setOpacity] = useState(50) // UI 0-100
  const [tile, setTile] = useState(false)
  const [density, setDensity] = useState(3) // 1..5
  const [position, setPosition] = useState<PosKey>('mc')

  const { files, selectedFiles } = useSharedFiles()
  const { processing, result, error, execute, cancel } = useOperation<string[]>()
  const targets = selectedFiles.length > 0 ? selectedFiles : files

  const handleWatermark = () => {
    if (targets.length === 0) return
    if (!text.trim()) {
      window.ztools.showNotification('请输入水印文本')
      return
    }
    execute(async () => {
      const outputs: string[] = []
      for (const file of targets) {
        const srcName = file.name || file.path
        const taskId = generateTaskId(srcName)
        const outputPath = buildTaskOutputPath(
          window.ztools.getPath('downloads'),
          'watermark',
          buildConvertedFilename(srcName, '.pdf'),
          taskId,
        )
        await withInputPath(file, (inputPath) =>
          window.services.addWatermark(inputPath, outputPath, {
            text: text.trim(),
            opacity: Math.min(1, Math.max(0.05, opacity / 100)),
            points: fontSize,
            rotation,
            position: tile ? 'c' : position,
            margin,
            color,
            tile,
            density,
          }),
        )
        outputs.push(outputPath)
      }
      window.ztools.showNotification('水印添加完成（' + outputs.length + ' 个）')
      return outputs
    })
  }

  return (
    <FeatureLayout
      title="PDF 水印"
      subtitle="可多选多个 PDF，按任务批量加水印"
      action={
        files.length > 0 ? (
          <div className="watermark-panel">
            <div className="wm-section">
              <div className="wm-field">
                <label>水印文本</label>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="输入水印文字"
                />
              </div>

              <div className="wm-grid-2">
                <div className="wm-field">
                  <label>字体大小</label>
                  <div className="wm-inline">
                    <input
                      type="range"
                      min={8}
                      max={120}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value) || 20)}
                    />
                    <input
                      className="wm-num-sm"
                      type="number"
                      min={8}
                      max={120}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value) || 20)}
                    />
                  </div>
                </div>
                <div className="wm-field">
                  <label>字体颜色</label>
                  <div className="wm-color-wrap">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      aria-label="字体颜色"
                    />
                    <span className="wm-color-hex">{color.toUpperCase()}</span>
                  </div>
                </div>
              </div>

              <div className="wm-field">
                <label>
                  不透明度
                  <span className="wm-label-val">{opacity}%</span>
                </label>
                <div className="wm-inline">
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                  />
                  <input
                    className="wm-num-sm"
                    type="number"
                    min={5}
                    max={100}
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value) || 50)}
                  />
                </div>
              </div>
            </div>

            <div className="wm-section">
              <div className="wm-field">
                <label>
                  旋转角度
                  <span className="wm-label-val">{rotation}°</span>
                </label>
                <div className="wm-inline">
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={rotation}
                    onChange={(e) => setRotation(Number(e.target.value))}
                  />
                  <input
                    className="wm-num-sm"
                    type="number"
                    min={-180}
                    max={180}
                    value={rotation}
                    onChange={(e) => setRotation(Number(e.target.value) || 0)}
                  />
                </div>
                <p className="wm-hint">靠边位置旋转时会自动内缩，保证文字完整显示在页内。</p>
              </div>

              <div className="wm-field">
                <label>
                  页边距
                  <span className="wm-label-val">{margin} px</span>
                </label>
                <div className="wm-inline">
                  <input
                    type="range"
                    min={0}
                    max={120}
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value))}
                  />
                  <input
                    className="wm-num-sm"
                    type="number"
                    min={0}
                    max={200}
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value) || 0)}
                  />
                </div>
                <p className="wm-hint">
                  水印与页面四边的最小间距。靠边放置时生效；居中时主要作安全区，旋转后也不会贴边裁切。
                </p>
              </div>
            </div>

            <div className="wm-section">
              <div className="wm-field wm-switch-row">
                <label className="wm-switch">
                  <input
                    type="checkbox"
                    checked={tile}
                    onChange={(e) => setTile(e.target.checked)}
                  />
                  <span className="wm-switch-ui" />
                  平铺水印
                </label>
                <span className="wm-switch-desc">在整页重复排布水印文字</span>
              </div>

              {tile ? (
                <div className="wm-field">
                  <label>
                    平铺密度
                    <span className="wm-label-val">
                      {DENSITY_LABELS[density - 1] || '中'}（{density}）
                    </span>
                  </label>
                  <div className="wm-inline">
                    <span className="wm-range-end">疏</span>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={density}
                      onChange={(e) => setDensity(Number(e.target.value) || 3)}
                    />
                    <span className="wm-range-end">密</span>
                  </div>
                </div>
              ) : (
                <div className="wm-field">
                  <label>水印位置</label>
                  <div className="wm-pos-grid">
                    {POSITIONS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        className={'wm-pos-btn' + (position === p.key ? ' active' : '')}
                        onClick={() => setPosition(p.key)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="wm-actions">
              {!processing ? (
                <button
                  className="action-btn wm-start"
                  onClick={handleWatermark}
                  disabled={targets.length === 0}
                >
                  开始处理（{targets.length}）
                </button>
              ) : (
                <button className="action-btn" onClick={cancel} style={{ background: '#e74c3c' }}>
                  停止
                </button>
              )}
            </div>
            {error && <p className="error-text">添加水印失败：{error}</p>}
          </div>
        ) : null
      }
      result={<OperationResult result={result} onReset={() => {}} />}
    >
      <WorkspaceFiles
        title="PDF 水印"
        subtitle="选择要加水印的 PDF（可多选）"
        multiple
        layout="list"
        selectable
        multiSelect
      />
    </FeatureLayout>
  )
}
