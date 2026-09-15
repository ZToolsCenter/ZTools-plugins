import './FileList.css'

interface FileListProps {
  files: { name: string }[]
  onRemove: (index: number) => void
}

export default function FileList({ files, onRemove }: FileListProps) {
  if (files.length === 0) return null
  return (
    <div className="file-list">
      {files.map((f, i) => (
        <div key={i} className="file-item">
          <span className="file-name">{f.name}</span>
          <button className="file-remove" onClick={() => onRemove(i)} title="移除">×</button>
        </div>
      ))}
    </div>
  )
}
