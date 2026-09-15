import WorkspaceFiles from '../components/WorkspaceFiles'
import OperationResult from '../components/OperationResult'
import FeatureLayout from '../components/FeatureLayout'
import { useOperation } from '../hooks/useOperation'
import { useSharedFiles } from '../context/SharedFilesContext'
import { generateTaskId, buildTaskOutputPath } from '../hooks/useTaskFolder'
import { withInputPaths } from '../utils/fileFromShared'
import './index.css'

interface MergeProps { onBack?: () => void }

export default function Merge(_props: MergeProps) {
  const { files } = useSharedFiles()
  const { processing, result, error, execute, cancel } = useOperation<string>()

  const handleMerge = () => {
    if (files.length < 2) {
      window.ztools.showNotification('请至少添加 2 个文件')
      return
    }
    const taskId = generateTaskId('merged')
    execute(async () => {
      const outputPath = buildTaskOutputPath(
        window.ztools.getPath('downloads'),
        'merge',
        'merged_' + Date.now() + '.pdf',
        taskId,
      )
      await withInputPaths(files, (inputPaths) =>
        window.services.mergePdfs(inputPaths, outputPath),
      )
      window.ztools.showNotification('合并完成')
      return outputPath
    })
  }

  return (
    <FeatureLayout
      title="PDF 合并"
      subtitle="列表中的全部文件将按顺序合并为一个 PDF（可拖拽排序）"
      action={
        files.length > 0 ? (
          <div className="merge-options">
            {!processing ? (
              <button className="action-btn" onClick={handleMerge}>
                确认合并（{files.length}）
              </button>
            ) : (
              <button className="action-btn" onClick={cancel} style={{ background: '#e74c3c' }}>停止</button>
            )}
            {error && <p className="error-text">合并失败：{error}</p>}
          </div>
        ) : null
      }
      result={<OperationResult result={result} onReset={() => {}} />}
    >
      <WorkspaceFiles
        title="PDF 合并"
        subtitle="添加至少 2 个 PDF，拖拽调整顺序"
        multiple
        layout="list"
        selectable={false}
        multiSelect={false}
      />
    </FeatureLayout>
  )
}
