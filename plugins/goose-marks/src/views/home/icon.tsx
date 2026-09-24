import type React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Search, List, LayoutGrid, Plus, Settings, MoonStar, Sun, Trash2, Pin, X,
  ArrowLeft, FileText, Sparkles, WandSparkles, Lightbulb, Check, ExternalLink,
  Globe, Copy, Pencil, Folder, Database, RefreshCw, Info, MessageSquare,
  Upload, Download, Cpu, ChevronDown, ChevronRight, Inbox, Loader, AlertCircle,
  RotateCcw, CheckCircle, SearchX, MoreHorizontal, ChevronUp, ArrowRight,
  ArrowUpToLine, Link2, ClipboardPaste, GitMerge, Layers, Bookmark, Eye, EyeOff,
  RotateCw, ArrowUpRight, ArrowUp, Square, Minus, Monitor, ChevronLeft, ArrowRightLeft, FolderOpen, Zap
} from 'lucide-react'

/**
 * 图标助手 —— 把设计稿 app.js 里的 data-lucide="xxx" 名称映射到 lucide-react 组件。
 * 统一给每个图标加上 className="lucide"，匹配 home.css 里 `.goose-home svg.lucide`
 * 的字号/线宽规则（stroke-width 1.75），还原设计稿的图标观感。
 */
const MAP: Record<string, LucideIcon> = {
  search: Search,
  list: List,
  'layout-grid': LayoutGrid,
  plus: Plus,
  minus: Minus,
  settings: Settings,
  'moon-star': MoonStar,
  sun: Sun,
  'trash-2': Trash2,
  pin: Pin,
  x: X,
  'arrow-left': ArrowLeft,
  'file-text': FileText,
  sparkles: Sparkles,
  'wand-sparkles': WandSparkles,
  lightbulb: Lightbulb,
  check: Check,
  'external-link': ExternalLink,
  globe: Globe,
  copy: Copy,
  pencil: Pencil,
  folder: Folder,
  database: Database,
  'refresh-cw': RefreshCw,
  info: Info,
  'message-square': MessageSquare,
  upload: Upload,
  download: Download,
  cpu: Cpu,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft,
  'arrow-right-left': ArrowRightLeft,
  'folder-open': FolderOpen,
  inbox: Inbox,
  loader: Loader,
  'alert-circle': AlertCircle,
  'rotate-ccw': RotateCcw,
  'check-circle': CheckCircle,
  'search-x': SearchX,
  'more-horizontal': MoreHorizontal,
  'chevron-up': ChevronUp,
  'arrow-right': ArrowRight,
  'arrow-up-to-line': ArrowUpToLine,
  link: Link2,
  paste: ClipboardPaste,
  clipboard: ClipboardPaste,
  zap: Zap,
  merge: GitMerge,
  layers: Layers,
  bookmark: Bookmark,
  eye: Eye,
  'eye-off': EyeOff,
  rotate: RotateCw,
  'arrow-up-right': ArrowUpRight,
  'arrow-up': ArrowUp,
  square: Square,
  message: MessageSquare,
  monitor: Monitor,
}

export interface IcoProps {
  name: keyof typeof MAP | string
  className?: string
  style?: React.CSSProperties
}

/** 渲染一个 lucide 图标，尺寸继承父级 font-size（width/height = 1em，见 home.css）。 */
export function Ico({ name, className, style }: IcoProps) {
  const Cmp = MAP[name]
  if (!Cmp) return null
  return <Cmp className={['lucide', className].filter(Boolean).join(' ')} style={style} />
}
