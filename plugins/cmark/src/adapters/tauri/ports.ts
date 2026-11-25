/**
 * Tauri 2 适配器：把 Rust commands 实现成 contracts 里的 6 个端口。
 *
 * 与 electron 适配器的差别：
 *  - 这里是真异步（IPC），Electron 那边是「同步桥包一层 Promise」
 *  - git 走系统 git（Rust Command），与插件端行为一致，保留 SSH 与凭据管理器
 *  - 没有宿主搜索框 / 子输入框 / 宿主 AI，caps 里相应为 false
 */
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { openUrl as pluginOpenUrl } from '@tauri-apps/plugin-opener'

import type {
  Capabilities,
  ChangeSet,
  CommitInfo,
  ExportPort,
  FileDiff,
  HostKind,
  LogOptions,
  NoteState,
  Platform,
  Ports,
  PrefsPort,
  PrefNs,
  PrefValue,
  Result,
  ShellPort,
  TreeNode,
  VcsPort,
  WorkspacePort,
  DiffOptions,
  InitOptions,
  AdoptOptions,
  ProbeResult,
  RemoteInfo,
  RepoState,
  StatusResult,
} from '../../contracts'
import { fail, ok } from '../../contracts'

const invokeSafe = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  return (await invoke(cmd, args)) as T
}

/** Rust 侧返回 Err(String)，invoke 会 reject；统一转成 Result */
async function call<T>(cmd: string, args?: Record<string, unknown>, label?: string): Promise<Result<T>> {
  try {
    const v = await invokeSafe<T>(cmd, args)
    return ok(v)
  } catch (e) {
    const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
    // release 版没有控制台：把失败落到 exe 同级的 cmark-errors.log，
    // 否则「保存失败」这类提示消失后完全无从定位
    void invoke('app_log_error', { msg: `[${cmd}] ${msg}` }).catch(() => {})
    return fail(classify(msg), label ? `${label}：${msg}` : msg, msg)
  }
}

function classify(msg: string): 'auth' | 'network' | 'nonfastforward' | 'conflict' | 'lock' | 'notrepo' | 'notfound' | 'permission' | 'unsupported' | 'canceled' | 'unknown' {
  if (/Authentication failed|Permission denied \(publickey|401|403|token username/i.test(msg)) return 'auth'
  if (/Could not resolve|timed out|Failed to connect|network/i.test(msg)) return 'network'
  if (/non-fast-forward|rejected|fetch first/i.test(msg)) return 'nonfastforward'
  if (/CONFLICT|冲突/i.test(msg)) return 'conflict'
  if (/index\.lock|Unable to create .*lock/i.test(msg)) return 'lock'
  if (/not a git repository/i.test(msg)) return 'notrepo'
  if (/No such file|ENOENT|不存在/i.test(msg)) return 'notfound'
  if (/拒绝访问|Permission denied|EPERM|EACCES/i.test(msg)) return 'permission'
  return 'unknown'
}

const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

/** Tauri 桌面：本地目录可自由选、有文件监听（暂用轮询）、git 全协议 */
const TAURI_DESKTOP_CAPS: Capabilities = {
  fs: { pickDirectory: true, watch: false, absolutePaths: true, trash: true },
  vcs: { protocols: ['https', 'ssh', 'file'], credentialHelper: true, globalConfig: true, renameDetection: true, inProcess: false },
  export: { pdf: false, longImage: false, shareSheet: false, saveDialog: true },
  shell: { globalSearch: false, subInput: false, ai: false, clipboardImage: false, revealInFolder: true },
}

/* ---------------- WorkspacePort ---------------- */

const wsPort: WorkspacePort = {
  root() {
    return (window as unknown as { __CMARK_WS?: string }).__CMARK_WS || null
  },
  async isReady() {
    const r = await call<{ ready: boolean }>('ws_info')
    return r.ok && r.value.ready
  },
  async pick() {
    const picked = await openDialog({ directory: true, multiple: false, title: '选择笔记目录' })
    if (!picked || Array.isArray(picked)) return ok(null)
    return ok(picked as string)
  },
  async adopt(root: string) {
    const r = await call<{ workspace: string; ready: boolean }>('ws_adopt', { path: root }, '绑定工作区')
    if (r.ok) {
      ;(window as unknown as { __CMARK_WS?: string }).__CMARK_WS = r.value.workspace
    }
    return r.ok ? ok(undefined) : r
  },

  async listTree(opts) {
    const r = await call<{ children: TreeNode[]; count: number; truncated: boolean; workspace: string }>('ws_list_tree', {
      maxEntries: opts?.maxEntries ?? null,
    })
    if (!r.ok) return { children: [], count: 0, truncated: false, workspace: '' }
    ;(window as unknown as { __CMARK_WS?: string }).__CMARK_WS = r.value.workspace
    return r.value
  },
  async readAll() {
    const r = await call<{ rel: string; text: string }[]>('ws_read_all')
    return r.ok ? r.value : []
  },
  async read(rel: string) {
    return call<{ text: string; mtime: number; size: number }>('ws_read', { rel }, '读取笔记')
  },
  async stat(rel: string) {
    const r = await call<number | null>('ws_stat', { rel })
    if (!r.ok) return r
    if (r.value === null) return fail('notfound', '文件不存在')
    const sizeR = await call<number | null>('ws_stat', { rel })
    return ok({ rel, mtime: r.value, size: typeof sizeR === 'number' ? sizeR : 0 }) as unknown as Result<{ rel: string; mtime: number; size: number }>
  },
  async write(rel: string, text: string) {
    return call<{ changed: boolean; mtime: number }>('ws_write', { rel, text }, '保存')
  },
  async create(rel: string, kind: 'note' | 'folder', text?: string) {
    const r = await call<string>('ws_create', { rel, kind, text: text ?? null }, '新建')
    return r.ok ? ok({ rel: r.value }) : r
  },
  async rename(rel: string, newName: string) {
    const r = await call<string>('ws_rename', { rel, newName }, '重命名')
    return r.ok ? ok({ rel: r.value }) : r
  },
  async move(rel: string, targetDirRel: string) {
    const r = await call<string>('ws_move', { rel, targetDirRel }, '移动')
    return r.ok ? ok({ rel: r.value }) : r
  },
  async remove(rel: string) {
    return call<void>('ws_remove', { rel }, '删除')
  },
  async duplicate(rel: string) {
    const r = await call<string>('ws_duplicate', { rel }, '复制')
    return r.ok ? ok({ rel: r.value }) : r
  },
  async exists(rel: string) {
    const r = await call<boolean>('ws_exists', { rel })
    return r.ok ? r.value : false
  },
  watch(_cb: (c: ChangeSet) => void) {
    // Tauri 侧暂不接原生监听：由 service 层定时重扫（caps.fs.watch=false）
    return () => {}
  },

  async putAttachment(bytes: Uint8Array, ext: string) {
    const b64 = bytesToBase64(bytes)
    const r = await call<{ url: string; rel: string }>('ws_att_put', { base64Data: b64, ext }, '保存附件')
    return r.ok ? ok({ url: r.value.url, rel: r.value.rel }) : r
  },
  async readAttachment(ref: string) {
    const digest = ref.replace(/^attachment:/, '')
    const r = await call<string>('ws_att_read', { digest }, '读取附件')
    if (!r.ok) return r
    return ok(base64ToBytes(r.value))
  },
  async pickImage() {
    const picked = await openDialog({
      multiple: false,
      title: '选择图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
    })
    if (!picked || Array.isArray(picked)) return ok(null)
    const bytes = await readFileViaWebview(picked as string)
    return ok({ bytes, name: String(picked).split(/[\\/]/).pop() || 'image.png' })
  },
  async readClipboardImage() {
    return fail('unsupported', '桌面版暂不支持读剪贴板图片')
  },

  async noteState(rel: string) {
    const r = await call<NoteState>('ws_note_state', { rel })
    return r.ok ? ok(r.value) : r
  },
  async setNoteLocked(rel: string, on: boolean) {
    return call<void>('ws_set_locked', { rel, on }, '设置只读')
  },
  async setNoteNear(rel: string, on: boolean) {
    return call<void>('ws_set_near', { rel, on }, '设置全局搜索')
  },
  async saveOrder(tree: TreeNode[]) {
    return call<void>('ws_save_order', { tree }, '保存顺序')
  },
  async readOnboard() {
    const r = await call<Record<string, unknown>>('ws_onboard_get')
    return r.ok ? r.value : {}
  },
  async writeOnboard(data: Record<string, unknown>) {
    return call<void>('ws_onboard_set', { data }, '保存引导状态')
  },
}

/* ---------------- VcsPort ---------------- */

const vcsPort: VcsPort = {
  protocols: ['https', 'ssh', 'file'],
  async detect() {
    return call<RepoState>('git_detect')
  },
  async init(o?: InitOptions) {
    const r = await call<string>('git_init', { branch: o?.branch ?? 'main' }, '初始化仓库')
    return r.ok ? ok({ branch: r.value }) : r
  },
  async adopt(o: AdoptOptions) {
    const r = await call<void>('git_set_remote', { url: o.remoteUrl }, '绑定远程')
    if (!r.ok) return r
    const f = await call<void>('git_fetch', { prune: true }, '拉取')
    if (!f.ok) return f
    const p = await call<{ fastForwarded: boolean; diverged: boolean }>('git_pull')
    if (!p.ok) return p
    return ok({ branch: o.branch ?? 'main' })
  },
  async status() {
    return call<StatusResult>('git_status')
  },
  async log(o?: LogOptions) {
    const r = await call<{ commits: CommitInfo[]; total: number }>('git_log', {
      depth: o?.depth ?? 20,
      skip: o?.skip ?? 0,
      path: o?.path ?? null,
    })
    return r.ok ? ok({ commits: r.value.commits, total: r.value.total }) : r
  },
  async show(oid: string, path?: string) {
    const r = await call<string>('git_show', { oid, path: path ?? null })
    if (!r.ok) return r
    return ok(base64ToBytes(r.value))
  },
  async diff(o?: DiffOptions) {
    const r = await call<{ path: string; patch: string }[]>('git_diff', {
      staged: o?.staged ?? false,
      from: o?.from ?? null,
      to: o?.to ?? null,
      path: o?.path ?? null,
    })
    if (!r.ok) return r
    // Rust 返回 patch 文本，这里转成结构化 hunks（面板渲染用）
    return ok(r.value.map((f) => parsePatch(f.path, f.patch)))
  },
  async stage(paths) {
    return call<void>('git_stage', { paths: paths === 'all' ? ['all'] : paths }, '暂存')
  },
  async unstage(paths) {
    return call<void>('git_unstage', { paths }, '取消暂存')
  },
  async discard(paths) {
    return call<void>('git_discard', { paths }, '还原')
  },
  async restore(oid: string, path: string) {
    const r = await call<string>('git_show', { oid, path })
    if (!r.ok) return r
    const bytes = base64ToBytes(r.value)
    const text = new TextDecoder().decode(bytes)
    const w = await wsPort.write(path, text)
    return w.ok ? ok(undefined) : w
  },
  async commit(message: string) {
    const r = await call<string>('git_commit', { message }, '提交')
    return r.ok ? ok({ oid: r.value }) : r
  },
  async remotes() {
    return call<RemoteInfo[]>('git_remotes')
  },
  async setRemote(url: string, name?: string) {
    return call<void>('git_set_remote', { url, name: name ?? null }, '设置远程')
  },
  async probeRemote(url: string) {
    return call<ProbeResult>('git_probe_remote', { url }, '探测远端')
  },
  async fetch(o?: { prune?: boolean }) {
    return call<void>('git_fetch', { prune: o?.prune ?? true }, '拉取')
  },
  async push() {
    const r = await call<void>('git_push', undefined, '推送')
    return r.ok ? ok({ rejected: false }) : r
  },
  async pull() {
    const r = await call<{ fastForwarded: boolean; diverged: boolean }>('git_pull', undefined, '拉取')
    return r.ok ? ok({ strategy: 'ff-only', fastForwarded: r.value.fastForwarded, diverged: r.value.diverged }) : r
  },
  setCredential() {
    // 桌面端沿用系统凭据管理器，令牌由 git 自己处理
  },
}

/** 把 git diff 的 patch 文本解析成结构化 hunks */
function parsePatch(path: string, patch: string): FileDiff {
  const hunks: FileDiff['hunks'] = []
  let added = 0
  let removed = 0
  let binary = /^Binary files /m.test(patch)
  let cur: FileDiff['hunks'][number] | null = null
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (m) {
      cur = {
        oldStart: Number(m[1]),
        oldLines: Number(m[2] ?? 1),
        newStart: Number(m[3]),
        newLines: Number(m[4] ?? 1),
        lines: [],
      }
      hunks.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ')) continue
    if (line.startsWith('+')) {
      added++
      cur.lines.push({ type: '+', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      removed++
      cur.lines.push({ type: '-', text: line.slice(1) })
    } else if (line.startsWith(' ')) {
      cur.lines.push({ type: ' ', text: line.slice(1) })
    }
  }
  return { path, binary, added, removed, hunks }
}

/* ---------------- PrefsPort（第一版：localStorage，后续换 Rust 配置） ---------------- */

const prefsPort: PrefsPort = {
  async get<T extends PrefValue>(ns: PrefNs, key: string) {
    try {
      const raw = localStorage.getItem(`cmark:${ns}:${key}`)
      return raw === null ? undefined : (JSON.parse(raw) as T)
    } catch {
      return undefined
    }
  },
  async set(ns: PrefNs, key: string, value: PrefValue) {
    try {
      localStorage.setItem(`cmark:${ns}:${key}`, JSON.stringify(value))
      window.dispatchEvent(new CustomEvent('cmark:prefs', { detail: { ns, key } }))
      return ok(undefined)
    } catch (e) {
      return fail('unknown', String(e))
    }
  },
  async patch(ns: PrefNs, obj: Record<string, PrefValue>) {
    for (const [k, v] of Object.entries(obj)) await prefsPort.set(ns, k, v)
    return ok(undefined)
  },
  async all(ns: PrefNs) {
    const out: Record<string, PrefValue> = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || ''
        if (k.startsWith(`cmark:${ns}:`)) {
          out[k.slice(`cmark:${ns}:`.length)] = JSON.parse(localStorage.getItem(k) || 'null')
        }
      }
    } catch {}
    return out
  },
  onChange(_ns: PrefNs, cb: () => void) {
    const h = () => cb()
    window.addEventListener('cmark:prefs', h)
    return () => window.removeEventListener('cmark:prefs', h)
  },
}

/* ---------------- ShellPort ---------------- */

const shellPort: ShellPort = {
  notify(o) {
    // 桌面版用系统通知需要插件；先用窗口标题闪一下太吵，直接 console
    console.info('[cmark]', o.title, o.body || '')
  },
  async pickDirectory(o) {
    const picked = await openDialog({ directory: true, multiple: false, title: o?.title ?? '选择目录' })
    if (!picked || Array.isArray(picked)) return ok(null)
    return ok(picked as string)
  },
  async pickFile(o) {
    const picked = await openDialog({
      multiple: o?.multiple ?? false,
      title: o?.title ?? '选择文件',
      filters: o?.accept ? [{ name: '文件', extensions: o.accept }] : undefined,
    })
    if (!picked) return ok(null)
    return ok(Array.isArray(picked) ? (picked as string[]) : [picked as string])
  },
  async saveFile(o) {
    const picked = await saveDialog({ defaultPath: o.defaultName, filters: [{ name: o.ext, extensions: [o.ext] }] })
    return ok((picked as string) || null)
  },
  async copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      return ok(undefined)
    } catch (e) {
      return fail('unsupported', '剪贴板不可用：' + String(e))
    }
  },
  async openUrl(url: string) {
    try {
      await pluginOpenUrl(url)
      return ok(undefined)
    } catch (e) {
      return fail('unknown', String(e))
    }
  },
  async revealInFolder(rel: string) {
    const r = await call<string>('ws_abs_of', { rel })
    if (!r.ok) return r
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
      await revealItemInDir(r.value)
      return ok(undefined)
    } catch (e) {
      return fail('unsupported', String(e))
    }
  },
  ai: null,
  setSearchKeyword() {
    return () => {}
  },
  onEnter(cb) {
    // Tauri 没有宿主唤起概念；保留接口，深链后续接
    void cb
    return () => {}
  },
}

/* ---------------- ExportPort ---------------- */

const exportPort: ExportPort = {
  async saveBytes(o) {
    const target = o.dir && o.dir !== 'ask' ? `${o.dir}/${o.name}` : null
    const path = target || ((await saveDialog({ defaultPath: o.name })) as string | null)
    if (!path) return ok(null)
    const r = await call<void>('ws_export_write', { path, base64Data: bytesToBase64(o.bytes) }, '导出')
    return r.ok ? ok({ path }) : r
  },
  async renderPdf() {
    return fail('unsupported', '桌面版 PDF 导出待接入（计划前端 html2canvas + jsPDF）')
  },
  async renderImage() {
    return fail('unsupported', '桌面版长图导出待接入（计划前端 html2canvas）')
  },
  async share() {
    return fail('unsupported', '桌面端没有系统分享面板')
  },
}

/* ---------------- EnvPort ---------------- */

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'win32'
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad/i.test(ua)) return 'ios'
  return 'linux'
}

const envPort = {
  platform: detectPlatform(),
  host: 'tauri-desktop' as HostKind,
  caps: TAURI_DESKTOP_CAPS,
  paths: { config: null, temp: null, downloads: null },
  onActivate() {
    return () => {}
  },
  onVisibilityChange(cb: (v: boolean) => void) {
    const h = () => cb(!document.hidden)
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  },
  onBeforeQuit(cb: () => Promise<void>) {
    const h = (e: BeforeUnloadEvent) => {
      void cb()
      void e
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  },
}

export function createTauriPorts(): Ports {
  return {
    env: envPort,
    ws: wsPort,
    vcs: vcsPort,
    prefs: prefsPort,
    shell: shellPort,
    export: exportPort,
  }
}

export { isTauri }

/* ---------------- 小工具 ---------------- */

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[])
  }
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function readFileViaWebview(path: string): Promise<Uint8Array> {
  // Tauri 的 asset 协议可以直接读本地文件
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  const url = convertFileSrc(path)
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}