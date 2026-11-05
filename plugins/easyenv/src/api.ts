// 领域类型与纯函数工具（不放 UI 逻辑）
import { ElMessage } from 'element-plus'

export type Scope = 'user' | 'machine'

export interface EnvVar {
  name: string
  kind: string
  value: string
}

export interface EnvOp {
  op: 'set' | 'delete'
  name: string
  value?: string
  kind?: string
}

export interface SnapshotChange {
  scope: Scope
  name: string
  before: string
  after: string
  existed: boolean
  kindBefore: string
  kindAfter: string
}

// 快照：diff 只记被改动项（默认），full 是手动整份备份
export interface Snapshot {
  id: string
  ts: number
  reason: string
  kind?: 'diff' | 'full'
  changes?: SnapshotChange[]
  user?: EnvVar[]
  machine?: EnvVar[]
}

export interface DiffItem {
  name: string
  state: 'add' | 'update' | 'delete'
  before?: string
  after?: string
}

// 注册表值类型 → 界面显示名。前缀统一是 REG_，直接给用户看这串字母毫无信息量，
// 所以界面只说人话，REG_ 全名放进说明里备查
const KIND_LABEL: Record<string, string> = {
  String: '普通文本',
  ExpandString: '可展开文本',
  DWord: '数字',
  QWord: '数字（64 位）',
  MultiString: '多行文本',
  Binary: '二进制'
}

const KIND_REG_NAME: Record<string, string> = {
  String: 'REG_SZ',
  ExpandString: 'REG_EXPAND_SZ',
  DWord: 'REG_DWORD',
  QWord: 'REG_QWORD',
  MultiString: 'REG_MULTI_SZ',
  Binary: 'REG_BINARY'
}

function hasVarRef(value: string): boolean {
  return /%[^%]+%/.test(String(value || ''))
}

// 每种类型的通俗解释（含 REG_ 全名，供排查时对号入座）。
// 类型描述的是「允许不允许展开」，与值里当前有没有 % 无关，所以带上值做上下文说明：
// 可展开但没写 % 时行为等同普通文本（nvm 这类安装器经常一律写成可展开）
export function kindExplain(kind: string, value?: string): string {
  const withRef = hasVarRef(value || '')
  switch (kind) {
    case 'String':
      return withRef
        ? '普通文本（REG_SZ）：值里有 %引用%，但这个类型不会展开，程序拿到的是字面量。需要生效请改成「可展开文本」。'
        : '普通文本（REG_SZ）：值原样保存。写 %JAVA_HOME%\\bin，程序拿到的就是这串字符本身。'
    case 'ExpandString':
      return withRef
        ? '可展开文本（REG_EXPAND_SZ）：读取时才替换 %变量%。写 %JAVA_HOME%\\bin，程序拿到的是 C:\\devTools\\jdk\\jdk8\\bin。'
        : '可展开文本（REG_EXPAND_SZ）：这个类型允许展开 %变量%，但当前值里没有引用，效果和普通文本一样。类型由写入它的安装程序决定（如 nvm 一律写成可展开）。'
    case 'DWord':
      return '数字（REG_DWORD）：32 位整数，环境变量里很少用到。'
    case 'QWord':
      return '数字（REG_QWORD）：64 位整数，环境变量里很少用到。'
    case 'MultiString':
      return '多行文本（REG_MULTI_SZ）：每行一个字符串，环境变量里很少用到。'
    case 'Binary':
      return '二进制（REG_BINARY）：原始字节数据，本插件不提供编辑。'
    default:
      return kind || ''
  }
}

// 新建/编辑时可选的类型：环境变量实际只有这两种有编辑意义
export const KIND_OPTIONS = [
  { value: 'String', label: '普通文本（REG_SZ）' },
  { value: 'ExpandString', label: '可展开文本（REG_EXPAND_SZ）' }
]

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] || kind || '-'
}

export function kindRegName(kind: string): string {
  return KIND_REG_NAME[kind] || kind || ''
}

// 值是否可以当成单条路径：非空、不含分号，且形态像路径
// （盘符开头、UNC 开头、或以 %变量% 引用开头，否则 "23210"、"Windows_NT" 这类也会被误判）
export function pathCandidate(value: string): string {
  const v = String(value || '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
  if (!v || v.includes(';')) return ''
  const looksLikePath =
    /^[a-zA-Z]:[\\/]/.test(v) || // C:\ 或 C:/
    /^[a-zA-Z]:$/.test(v) || // 盘符本身
    /^\\\\[^\\]/.test(v) || // \\server\share
    /^%[^%]+%[\\/]?/.test(v) // %USERPROFILE%\... 或无后续分隔的 %VAR%
  return looksLikePath ? v : ''
}

// 备选值的存储键：作用域 + 变量名（大小写不敏感）
export function presetKey(scope: Scope, name: string): string {
  return scope + ':' + String(name || '').trim().toUpperCase()
}

export function sameValue(a: string, b: string): boolean {
  const norm = (s: string) =>
    String(s == null ? '' : s)
      .trim()
      .replace(/[/\\]+$/, '')
      .toUpperCase()
  return norm(a) === norm(b)
}

// 循环切换到下一个备选值：当前值命中则取下一个，否则从第一个开始
export function nextPreset(values: string[], current: string): string {
  const list = (values || []).filter((v) => String(v || '').trim())
  if (!list.length) return ''
  const idx = list.findIndex((v) => sameValue(v, current))
  if (idx < 0) return list[0]
  return list[(idx + 1) % list.length]
}

// 芯片上显示用的短文本：路径列表只说条数，其它过长的截断（完整值放 title 里）
export function chipText(value: string): string {
  const v = String(value || '')
  const parts = v.split(';').filter((s) => s.trim())
  if (parts.length > 1) return `${parts.length} 条路径`
  return v.length > 34 ? v.slice(0, 34) + '…' : v
}

// 在资源管理器中打开（目录打开、文件定位），统一提示，避免三个调用点各写一遍
export function openInExplorer(target: string, envMap?: Record<string, string>): boolean {
  if (typeof window.services?.openPath !== 'function') {
    ElMessage.error('插件服务未更新，请重启 ZTools 后重试')
    return false
  }
  const r = window.services.openPath(target, envMap || {})
  if (!r.ok) {
    ElMessage.error(r.error || '打开失败')
    return false
  }
  return true
}

// 系统文件/文件夹选择框（Electron dialog，取消返回 ''）
export function pickPath(kind: 'file' | 'folder', title: string): string {
  const properties = kind === 'folder' ? ['openDirectory', 'createDirectory'] : ['openFile']
  const res = window.ztools.showOpenDialog({ title, properties } as any)
  return res && res.length ? res[0] : ''
}

// 把选中的路径并进现有值：空值直接填，否则用分号追加（PATH 类变量的常见用法）
export function appendPickedPath(current: string, picked: string): string {
  const value = String(current || '').trim()
  if (!value) return picked
  if (value.split(';').some((s) => s.trim().toUpperCase() === picked.toUpperCase())) return value
  return /;$/.test(value) ? value + picked : value + ';' + picked
}

export function scopeLabel(scope: Scope): string {
  return scope === 'user' ? '用户变量' : '系统变量'
}

export function isPathVar(name: string): boolean {
  return String(name || '').trim().toUpperCase() === 'PATH'
}

// PATH 按分号拆条：保留原始顺序，空串（连续分号）丢弃
export function splitPath(value: string): string[] {
  return String(value || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export function joinPath(entries: string[]): string {
  return entries
    .map((s) => String(s == null ? '' : s).trim())
    .filter((s) => s !== '')
    .join(';')
}

// 大小写不敏感去重，保留首次出现的顺序
export function dedupePath(entries: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of entries) {
    const key = e.replace(/\\+$/, '').toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`
}

// 变量名合法性：非空、不含 = 与 %，不能是空白
export function validateVarName(name: string): string {
  const n = String(name || '').trim()
  if (!n) return '变量名不能为空'
  if (n.includes('=')) return '变量名不能包含等号 ='
  if (/[\s]/.test(n)) return '变量名不能包含空格'
  if (n.length > 255) return '变量名过长'
  return ''
}
