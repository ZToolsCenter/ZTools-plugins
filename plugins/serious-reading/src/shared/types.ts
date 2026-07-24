/** 支持的书籍格式 */
export type BookFormat = 'txt' | 'epub' | 'pdf'

/** 单本书的书架元数据记录 */
export interface ShelfBook {
  id: string
  type: BookFormat
  name: string
  /** TXT/EPUB/PDF 的本地绝对路径；EPUB 解析后内容会缓存为附件，这里仍留源路径以便重新解析 */
  path: string
  /** 封面附件 id（EPUB 有，其它为空） */
  cover?: string
  /** 章节总数（用于章节跳转显示） */
  totalChapters?: number
  /** 上次阅读的章节索引（章节模型进度） */
  lastChapter?: number
  /** 上次阅读的章节标题（书架卡片显示用） */
  lastChapterTitle?: string
  /** 上次阅读的字符/页偏移（用于恢复进度） */
  progress?: number
  lastRead?: number
}

/** 全文章节（解析后内存模型，不入库） */
export interface Chapter {
  title: string
  index: number
  content: string
  /** 章节在全文字符流中的起始偏移（用于百分比跳转） */
  charOffset?: number
  /** 章节在全文字符流中的长度 */
  charLength?: number
}

/** 解析后的内存书籍对象 */
export interface ParsedBook {
  title: string
  filePath: string
  format: BookFormat
  chapters: Chapter[]
  totalChapters: number
  /** 全文拼接字符串（TXT 用，用于全文搜索与百分比跳转） */
  fullText?: string
  /** PDF 的总页数 */
  totalPdfPages?: number
}

/** 隐藏相关的触发动作标识 */
export type TriggerKey =
  | 'dblclick'
  | 'middleClick'
  | 'rightClick'
  | 'escape'
  | 'mouseenter'
  | 'mouseleave'

/** 三个隐藏/显示动作的可配置触发器集合 */
export interface HideActions {
  /** 隐身：阅读窗可见时触发，进入 stealth 透明状态 */
  stealthHide: TriggerKey[]
  /** 显示：阅读窗处于 stealth 状态时触发，恢复可见 */
  stealthShow: TriggerKey[]
  /** 真隐藏 win.hide()，彻底消失，需用命令恢复 */
  realHide: TriggerKey[]
}

/** 翻页方式开关 */
export interface PageActions {
  arrow: boolean
  wheel: boolean
  click: boolean
  pgupdn: boolean
  space: boolean
  /** 翻页过渡：'none' 无动画，'slide' 滑动 */
  transition: 'none' | 'slide'
}

/** 阅读窗外观配色（独立于 UI 明暗主题） */
export interface ReaderStyle {
  bgColor: string
  textColor: string
  opacity: number
  fontSize: number
  lineHeight: number
  fontFamily: string
  fontWeight: number
  cleanEmptyLines: boolean
}

/** 自动翻页设置 */
export interface AutoPageSetting {
  /** 间隔秒数，0 = 关闭 */
  interval: number
  /** stealth 隐藏时是否暂停 */
  pauseOnStealth: boolean
}

/** 完整设置对象 */
export interface Settings {
  theme: 'auto' | 'light' | 'dark'
  window: { width: number; height: number; x: number; y: number }
  reader: ReaderStyle
  page: PageActions
  hide: HideActions
  autoPage: AutoPageSetting
  /** 阅读窗底部进度条是否显示 */
  showProgressBar: boolean
}

/** 设置预设（多套配置保存与切换） */
export interface Preset {
  id: string
  name: string
  settings: Settings
}

/** 阅读进度记录（按书籍路径存储） */
export interface ReadingProgress {
  filePath: string
  format: BookFormat
  /** 章节索引或 PDF 页码 */
  chapterIndex: number
  /** 章节标题（书架卡片显示用） */
  chapterTitle?: string
  /** 章内页索引（TXT/EPUB 高度分页）或 0 */
  pageIndex: number
  /** 字符偏移（百分比跳转用，TXT） */
  charOffset?: number
  /** 章节总数（用于书架封面进度展示） */
  totalChapters?: number
  timestamp: number
}

/** 全文搜索结果项 */
export interface SearchResult {
  /** 关键字在全文字符流中的起始偏移 */
  index: number
  /** 含高亮标记的上下文片段 HTML */
  snippet: string
}

/** 最近阅读历史项 */
export interface RecentBook {
  filePath: string
  title: string
  format: BookFormat
  lastChapter?: number
  lastRead: number
}