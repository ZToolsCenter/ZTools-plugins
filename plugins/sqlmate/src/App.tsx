import { useEffect, useState } from 'react'
import Merge   from './pages/Merge'
import Split   from './pages/Split'
import Segment from './pages/Segment'
import Stats   from './pages/Stats'
import Dedupe  from './pages/Dedupe'
import Mask    from './pages/Mask'
import Rename  from './pages/Rename'
import Offset  from './pages/Offset'
import Convert from './pages/Convert'
import Extract from './pages/Extract'
import Diff     from './pages/Diff'
import DdlDiff  from './pages/DdlDiff'
import SqlToCsv from './pages/SqlToCsv'
import CsvToSql from './pages/CsvToSql'
import Format  from './pages/Format'
import './App.css'

interface NavItem {
  id: string
  label: string
  group: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'merge',     label: '合并',     group: '基础处理' },
  { id: 'split',     label: '拆分',     group: '基础处理' },
  { id: 'segment',   label: '分割',     group: '基础处理' },
  { id: 'extract',   label: '抽取',     group: '基础处理' },
  { id: 'stats',     label: '统计',     group: '基础处理' },
  { id: 'sqltoCsv',  label: 'SQL→CSV',  group: '格式转换' },
  { id: 'csvToSql',  label: 'CSV→SQL',  group: '格式转换' },
  { id: 'format',    label: '格式化',   group: '格式转换' },
  { id: 'dedupe',    label: '去重',     group: '数据治理' },
  { id: 'mask',      label: '脱敏',     group: '数据治理' },
  { id: 'rename',    label: '替换',     group: '数据治理' },
  { id: 'offset',    label: 'ID偏移',   group: '数据治理' },
  { id: 'convert',   label: '改写',     group: '数据治理' },
  { id: 'diff',      label: '数据Diff', group: '对比分析' },
  { id: 'ddldiff',   label: 'DDL对比',  group: '对比分析' },
]

const PAGES: Record<string, React.ComponentType<{ enterAction: any }>> = {
  merge:    Merge,
  split:    Split,
  segment:  Segment,
  stats:    Stats,
  dedupe:   Dedupe,
  mask:     Mask,
  rename:   Rename,
  offset:   Offset,
  convert:  Convert,
  extract:  Extract,
  diff:     Diff,
  ddldiff:  DdlDiff,
  sqltoCsv: SqlToCsv,
  csvToSql: CsvToSql,
  format:   Format,
}

const GROUPS = ['基础处理', '格式转换', '数据治理', '对比分析']

export default function App() {
  const [enterAction, setEnterAction] = useState<any>({})
  const [route, setRoute] = useState('merge')

  useEffect(() => {
    window.ztools.onPluginEnter((action) => {
      setRoute(action.code)
      setEnterAction(action)
    })
    window.ztools.onPluginOut(() => {
      setEnterAction({})
    })
  }, [])

  const Page = PAGES[route]

  return (
    <div className="app-layout">
      {/* 侧边导航 */}
      <nav className="app-nav">
        {GROUPS.map((group) => (
          <div key={group} className="app-nav__group">
            <div className="app-nav__group-label">{group}</div>
            {NAV_ITEMS.filter((i) => i.group === group).map((item) => (
              <button
                key={item.id}
                className={`app-nav__item ${route === item.id ? 'app-nav__item--active' : ''}`}
                onClick={() => setRoute(item.id)}
                title={item.label}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* 内容区 */}
      <main className="app-main">
        {Page && <Page enterAction={enterAction} />}
      </main>
    </div>
  )
}
