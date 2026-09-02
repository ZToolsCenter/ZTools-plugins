import { TOOLS } from '../../config/tools'
import type { ToolId } from '../../types'

interface SidebarProps {
  activeTool: ToolId
  disabled?: boolean
  onChange: (tool: ToolId) => void
}

export default function Sidebar({ activeTool, disabled, onChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__title">处理工具</div>
      <nav className="sidebar__nav">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`sidebar__item${activeTool === tool.id ? ' is-active' : ''}`}
            onClick={() => onChange(tool.id)}
            disabled={disabled}
            title={tool.description}
          >
            <span className="sidebar__icon">{tool.icon}</span>
            <span className="sidebar__label">{tool.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
