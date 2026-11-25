/**
 * Electron 适配器（ZTools / uTools 插件端）：把现有同步桥包装成 contracts 端口。
 *
 * 为什么还要包一层：store 要改成「只认端口」的异步写法，两端才能共用同一套业务代码。
 * 插件端的桥是同步的（preload 在同进程里直接调 fs），所以这里绝大多数方法是
 * `Promise.resolve(...)` 立即完成，行为与改造前完全一致，没有时序风险。
 *
 * 尚未映射的部分（如实返回 unsupported，不用假实现糊过去）：
 *  - readAttachment / pickImage / readClipboardImage：渲染层拿不到文件字节，
 *    插件端走的是「路径直传」的 saveImageToWorkspace，等图片链路统一后再补
 *  - export.saveBytes / renderPdf / renderImage：插件端导出走 __CMARK 上的专用方法
 *    （writeMarkdownFile / writeHtmlFile / exportFile），契约化留在阶段 2
 *  - vcs 全量：插件端 git 面板目前直接用 __znotesGit（1500 行），迁移按阶段 1 逐步做
 */
import type {
  Capabilities,
  ChangeSet,
  CommitInfo,
  ExportPort,
  HostKind,
  LogOptions,
  Ports,
  PrefsPort,
  PrefNs,
  PrefValue,
  Result,
  ShellPort,
  TreeNode,
  VcsPort,
  WorkspacePort,
} from '../../contracts'
import { fail, ok } from '../../contracts'
import { db, gitBridge, hasNotes, hostApi, noteState, notes, workspacePath } from '../../runtime/legacy-bridge'

const ELECTRON_CAPS: Capabilities = {
  fs: { pickDirectory: true, watch: true, absolutePaths: true, trash: true },
  vcs: { protocols: ['https', 'ssh', 'file'], credentialHelper: true, globalConfig: true, renameDetection: true, inProcess: false },
  export: { pdf: true, longImage: true, shareSheet: false, saveDialog: true },
  shell: { globalSearch: true, subInput: true, ai: false, clipboardImage: true, revealInFolder: true },
}

/** 把桥的 { ok, message } 结果转成契约的 Result */
function toResult(r: { ok?: boolean; message?: string } | undefined | null, fallbackMsg = '操作失败'): Result<void> {
  if (!r) return ok(undefined)
  if (r.ok === false) return fail('unknown', r.message || fallbackMsg)
  return ok(undefined)
}

function splitRel(rel: string): { dir: string; name: string } {
  const clean = rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '')
  const i = clean.lastIndexOf('/')
  return i < 0 ? { dir: '', name: clean } : { dir: clean.slice(0, i), name: clean.slice(i + 1) }
}

const wsPort: WorkspacePort = {
  root() {
    return workspacePath() || notes().getConfig?.()?.workspace || null
  },
  async isReady() {
    return hasNotes()
  },
  async pick() {
    const r = notes().pickWorkspace?.()
    if (!r || r.ok === false) return fail('canceled', r?.message || '未选择目录')
    const cfg = notes().getConfig?.()
    return ok(cfg?.workspace || null)
  },
  async adopt() {
    return fail('unsupported', '插件端通过设置面板切换工作区（会写 ~/.cmark-config.json）')
  },

  async listTree(opts) {
    const t = notes().listTree()
    const max = opts?.maxEntries ?? 20000
    return { children: t.children || [], count: t.children?.length ?? 0, truncated: !!t.truncated && (t.children?.length ?? 0) >= max, workspace: t.workspace || workspacePath() }
  },
  async readAll() {
    const list = notes().loadAllNotes?.() || []
    return list.map((n) => ({ rel: n.rel, text: n.text }))
  },
  async read(rel: string) {
    const ex = notes().readNoteEx?.(rel)
    if (ex) {
      if (!ex.ok) return fail(ex.code === 'ENOENT' ? 'notfound' : 'unknown', ex.message || '读取失败')
      return ok({ text: ex.text ?? '', mtime: ex.mtime ?? 0, size: ex.size ?? 0 })
    }
    const text = notes().readNote(rel)
    return ok({ text, mtime: notes().statNote?.(rel)?.mtime ?? 0, size: text.length })
  },
  async stat(rel: string) {
    const st = notes().statNote?.(rel)
    if (!st || st.ok === false) return fail('notfound', '文件不存在')
    return ok({ rel, mtime: st.mtime ?? 0, size: st.size ?? 0 })
  },
  async write(rel: string, text: string) {
    const r = notes().writeNote(rel, text)
    if (r.ok === false) return fail('unknown', r.message || '保存失败')
    return ok({ changed: true, mtime: r.mtime ?? notes().statNote?.(rel)?.mtime ?? Date.now() })
  },
  async create(rel: string, kind: 'note' | 'folder', text?: string) {
    const { dir, name } = splitRel(rel)
    const r = kind === 'folder' ? notes().createFolder(dir, name) : notes().createNote(dir, name, text ?? '')
    if (r.ok === false) return fail('unknown', r.message || '新建失败')
    return ok({ rel: r.rel || rel })
  },
  async rename(rel: string, newName: string) {
    const r = notes().renameNode(rel, newName)
    if (r.ok === false) return fail('unknown', r.message || '重命名失败')
    return ok({ rel: r.rel || rel })
  },
  async move(rel: string, targetDirRel: string) {
    const r = notes().moveNode(rel, targetDirRel)
    if (r.ok === false) return fail('unknown', r.message || '移动失败')
    return ok({ rel: r.rel || rel })
  },
  async remove(rel: string) {
    return toResult(notes().deleteNode(rel), '删除失败')
  },
  async duplicate(rel: string) {
    const r = notes().duplicateNode?.(rel)
    if (!r || r.ok === false) return fail('unsupported', r?.message || '复制失败')
    return ok({ rel: r.rel || rel })
  },
  async exists(rel: string) {
    return !!notes().exists?.(rel)
  },
  watch(cb: (c: ChangeSet) => void) {
    if (!notes().onWorkspaceChange) return () => {}
    let first = true
    notes().onWorkspaceChange(() => {
      // 桥只告诉「有变化」，不给明细；首次回调当全量刷新
      cb({ changed: [], removed: [] })
      first = false
      void first
    })
    return () => {}
  },

  async putAttachment(bytes: Uint8Array, ext: string) {
    const b64 = bytesToBase64(bytes)
    const r = notes().saveImageToWorkspace?.(undefined, b64)
    if (!r || r.ok === false) return fail('unsupported', r?.message || '保存附件失败')
    const url = r.url || ''
    return ok({ url, rel: url.replace(/^attachment:/, '') + '.' + ext.replace(/^\./, '') })
  },
  async readAttachment() {
    return fail('unsupported', '插件端附件由渲染层用 resolveImageUrl 直接给 URL')
  },
  async pickImage() {
    const p = notes().pickImageFile?.()
    if (!p || p.ok === false) return ok(null)
    return fail('unsupported', '插件端请直接用 saveImageToWorkspace(srcPath) 拷贝文件')
  },
  async readClipboardImage() {
    return fail('unsupported', '插件端剪贴板图片走 saveClipboardImage')
  },

  async noteState(rel: string) {
    const st = noteState()?.readNoteState?.(rel)
    return ok({ locked: !!st?.locked, near: !!st?.near })
  },
  async setNoteLocked(rel: string, on: boolean) {
    return toResult(noteState()?.setNoteLocked?.(rel, on), '设置只读失败')
  },
  async setNoteNear(rel: string, on: boolean) {
    return toResult(noteState()?.setNoteNear?.(rel, on), '设置全局搜索失败')
  },
  async saveOrder(tree: TreeNode[]) {
    return toResult(notes().saveOrder?.(tree), '保存顺序失败')
  },
  async readOnboard() {
    return noteState()?.onboardGet?.() || {}
  },
  async writeOnboard(data: Record<string, unknown>) {
    noteState()?.onboardSet?.(data)
    return ok(undefined)
  },
}

const vcsPort: VcsPort = {
  protocols: ['https', 'ssh', 'file'],
  async detect() {
    const g = gitBridge<{ detect?: () => Promise<{ repoRoot?: string; branch?: string; upstream?: string }> }>()
    if (!g?.detect) return fail('unsupported', '插件端 git 服务暂未接入契约')
    const r = await g.detect()
    return ok({ repoRoot: r.repoRoot ?? null, branch: r.branch ?? null, upstream: r.upstream ?? null })
  },
  async init() {
    return fail('unsupported', '插件端 git 走 __znotesGit.initRepo')
  },
  async adopt() {
    return fail('unsupported', '插件端 git 走 __znotesGit.adoptRepo')
  },
  async status() {
    const g = gitBridge<{ status?: () => Promise<unknown> }>()
    if (!g?.status) return fail('unsupported', '插件端 git 服务暂未接入契约')
    return fail('unsupported', '插件端 git 结果结构与契约尚未对齐')
  },
  async log(o?: LogOptions) {
    const g = gitBridge<{ repoLog?: (o: unknown) => Promise<{ commits?: CommitInfo[]; total?: number }> }>()
    if (!g?.repoLog) return fail('unsupported', '插件端历史走 __znotesGit.repoLog')
    const r = await g.repoLog(o || {})
    return ok({ commits: r.commits || [], total: r.total ?? (r.commits?.length || 0) })
  },
  async show() {
    return fail('unsupported', '待迁移')
  },
  async diff() {
    return fail('unsupported', '待迁移')
  },
  async stage() {
    return fail('unsupported', '待迁移')
  },
  async unstage() {
    return fail('unsupported', '待迁移')
  },
  async discard() {
    return fail('unsupported', '待迁移')
  },
  async restore() {
    return fail('unsupported', '待迁移')
  },
  async commit() {
    return fail('unsupported', '待迁移')
  },
  async remotes() {
    return fail('unsupported', '待迁移')
  },
  async setRemote() {
    return fail('unsupported', '待迁移')
  },
  async probeRemote() {
    return fail('unsupported', '待迁移')
  },
  async fetch() {
    return fail('unsupported', '待迁移')
  },
  async push() {
    return fail('unsupported', '待迁移')
  },
  async pull() {
    return fail('unsupported', '待迁移')
  },
  setCredential() {},
}

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
        if (k.startsWith(`cmark:${ns}:`)) out[k.slice(`cmark:${ns}:`.length)] = JSON.parse(localStorage.getItem(k) || 'null')
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

const shellPort: ShellPort = {
  notify(o) {
    hostApi()?.showNotification?.({ title: o.title, body: o.body })
  },
  async pickDirectory() {
    return fail('unsupported', '插件端目录选择走设置面板')
  },
  async pickFile() {
    const p = notes().pickImageFile?.()
    if (!p?.ok || !p.path) return ok(null)
    return ok([p.path])
  },
  async saveFile() {
    return fail('unsupported', '插件端导出走专用方法')
  },
  async copyText(text: string) {
    try {
      hostApi()?.copyText?.(text)
      return ok(undefined)
    } catch (e) {
      return fail('unknown', String(e))
    }
  },
  async openUrl(url: string) {
    notes().openExternal?.(url)
    return ok(undefined)
  },
  async revealInFolder(rel: string) {
    const r = notes().shellShowItem?.(rel)
    return toResult(r, '定位失败')
  },
  ai: null,
  setSearchKeyword(keyword: string, placeholder: string) {
    void placeholder
    hostApi()?.setSubInputValue?.(keyword)
    return () => {}
  },
  onEnter() {
    return () => {}
  },
}

const exportPort: ExportPort = {
  async saveBytes() {
    return fail('unsupported', '插件端导出走 __CMARK.writeMarkdownFile / writeHtmlFile / exportFile')
  },
  async renderPdf() {
    return fail('unsupported', '插件端 PDF 走 __CMARK.exportFile')
  },
  async renderImage() {
    return fail('unsupported', '插件端长图走 __CMARK.exportFile')
  },
  async share() {
    return fail('unsupported', '桌面端没有系统分享面板')
  },
}

export function createElectronPorts(): Ports {
  return {
    env: {
      platform: detectPlatform(),
      host: detectHost(),
      caps: ELECTRON_CAPS,
      paths: { config: null, temp: null, downloads: null },
      onActivate(cb) {
        hostApi()?.onPluginEnter?.((p: unknown) => cb({ raw: p }))
        return () => {}
      },
      onVisibilityChange(cb) {
        const h = () => cb(!document.hidden)
        document.addEventListener('visibilitychange', h)
        return () => document.removeEventListener('visibilitychange', h)
      },
      onBeforeQuit(cb) {
        const h = () => void cb()
        window.addEventListener('beforeunload', h)
        return () => window.removeEventListener('beforeunload', h)
      },
      diagnostics() {
        return {
          missing: [],
          bootErrors: (window as unknown as { __CMARK_BOOT_ERRORS?: string[] }).__CMARK_BOOT_ERRORS || [],
        }
      },
    },
    ws: wsPort,
    vcs: vcsPort,
    prefs: prefsPort,
    shell: shellPort,
    export: exportPort,
  }
}

function detectPlatform(): 'win32' | 'darwin' | 'linux' {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'win32'
  if (/Mac/i.test(ua)) return 'darwin'
  return 'linux'
}

function detectHost(): HostKind {
  const w = window as unknown as { __CMARK_HOST?: string }
  const h = w.__CMARK_HOST
  if (h === 'utools') return 'utools'
  if (h === 'ztools') return 'ztools'
  return 'ztools'
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[])
  }
  return btoa(s)
}

/** 供 store 判断走哪套端口（页面里有 __CMARK 就是插件端） */
export function isElectronHost(): boolean {
  return hasNotes()
}

export { db }