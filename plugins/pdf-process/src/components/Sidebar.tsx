import './Sidebar.css'

interface SidebarProps {
  activeCode: string
  onSelect: (code: string) => void
}

const menuGroups = [
  {
    title: 'PDF 操作',
    items: [
      { code: 'compress', label: 'PDF 压缩', icon: '🗜️' },
      { code: 'merge', label: 'PDF 合并', icon: '➕' },
      { code: 'split', label: 'PDF 拆分', icon: '✂️' },
      { code: 'watermark', label: 'PDF 水印', icon: '💧' },
      { code: 'pdfToImage', label: 'PDF 转图片', icon: '🌄' },
    ],
  },
  {
    title: 'PDF 格式转换',
    items: [
      { code: 'pdfToWord', label: 'PDF 转 Word', icon: '📝' },
      { code: 'pdfToPpt', label: 'PDF 转 PPT', icon: '📊' },
      { code: 'pdfToExcel', label: 'PDF 转 Excel', icon: '📗' },
    ],
  },
]

export default function Sidebar({ activeCode, onSelect }: SidebarProps) {
  return (
    <div className="sidebar">
      {menuGroups.map((group) => (
        <div key={group.title} className="sidebar-group">
          <div className="sidebar-group-title">{group.title}</div>
          {group.items.map((item) => (
            <div
              key={item.code}
              className={`sidebar-item ${activeCode === item.code ? 'active' : ''}`}
              onClick={() => onSelect(item.code)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="sidebar-bottom">
        <div
          className={`sidebar-item ${activeCode === 'settings' ? 'active' : ''}`}
          onClick={() => onSelect('settings')}
        >
          <span className="sidebar-icon">⚙️</span>
          <span className="sidebar-label">设置</span>
        </div>
      </div>
    </div>
  )
}
