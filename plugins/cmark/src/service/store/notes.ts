import { create } from 'zustand'
import type { TreeNode } from '../../types/global.d.ts'
import type { Editor as SlateEditor } from 'slate'
import { db, hostApi, noteState, notes } from '../../runtime/legacy-bridge'
import { getPorts } from '../../runtime/ports'

/** 编辑器命令面（Slate 语义）：工具栏和快捷键都走这里 */
export type EditorApi = {
  /** 给选区加/去行内标记，如 bold / italic / code / strike / highlight / underline */
  toggleMark: (mark: 'bold' | 'italic' | 'code' | 'strike' | 'highlight' | 'underline') => void
  /** 给选区加链接 */
  setLink: (href: string) => void
  /** 切换块类型：heading(level) / paragraph / blockquote / list */
  toggleBlock: (kind: 'paragraph' | 'blockquote' | 'bulleted-list' | 'numbered-list' | 'task-list' | 'heading', level?: number) => void
  /** 插入独立节点：代码块 / 表格 / 分割线 / 公式块 */
  insertNode: (kind: 'codeblock' | 'table' | 'hr' | 'math') => void
  /** 在光标处插入一段文本（内联公式等） */
  insertText: (text: string) => void
  /** 插入图片：rel 是工作区内的相对路径（assets/xxx.png） */
  insertImage: (rel: string, alt?: string) => void
  /** 把一段 Markdown 解析成块级节点后插入（AI 生成的图表/表格用它） */
  insertMarkdown: (md: string) => void
  focus: () => void
}

interface NoteState {
  workspace: string
  tree: TreeNode[]
  truncated: boolean
  currentRel: string
  content: string
  savedContent: string
  saving: boolean
  message: string
  editorApi: EditorApi | null
  /** 当前编辑器实例（搜索定位需要它） */
  editor: SlateEditor | null
  /** 光标处的行内标记，工具栏据此显示激活态 */
  activeMarks: Record<string, boolean>
  /** 光标所在的块类型 */
  activeBlock: { type: string; level?: number; checked?: boolean; lang?: string }
  /** 当前笔记是否只读（locked.txt） */
  locked: boolean
  /** 每次 openNote 自增，用于强制编辑器重新灌入（同一 rel 重载时 effect 也要跑） */
  loadRevision: number
  /** 当前笔记是否已设为全局搜索指令（near.txt） */
  near: boolean
  /** 是否隐藏编辑工具栏 */
  toolbarHidden: boolean
  /** 源码模式：直接编辑 Markdown 原文 */
  sourceMode: boolean
  /** 正文字号档位 */
  /** 正文字号 12..16（V1.0.0 五档：紧凑/偏小/默认/偏大/舒适） */
  bodyFontSize: number
  /** AI 面板开关（工具栏触发） */
  aiOpen: boolean
  /** 搜索词：非空时编辑器里高亮所有命中 */
  /**
   * 唯一搜索词。
   * 目录树过滤、正文高亮、命中游标全部从它派生——之前拆成 searchTerm/noteFindTerm 两个词，
   * 每加一个入口就要手写一次同步，漏一处就出现「搜到了但正文不高亮」。
   */
  searchTerm: string
  /**
   * 正文高亮词，只作用于编辑器（.search-hit-mark），不参与目录树过滤。
   * 平时由 searchNotes 与 searchTerm 一起写（唯一同步点）；「笔记内查找」只写它。
   */
  findTerm: string
  /** 全文索引：搜索要能命中正文，必须先把内容读进内存（对应 V1.0.0 的 NOTES_DIC） */
  notesIndex: { rel: string; text: string }[]
  /** 命中表：rel -> 命中字段与片段 */
  searchHits: Record<string, { field: 'title' | 'content'; snippet: string }>
  /** 命中文件的顺序：严格按目录树（受 order.txt 影响），上下键与默认命中都按它走 */
  hitOrder: string[]
  /** 打开时磁盘文件的 mtime，用于检测外部改动 */
  diskMtime: number
  /** 外部改动冲突：非空时表示磁盘被别的程序改过，暂停自动保存 */
  conflict: string

  refreshTree: () => void
  openNote: (rel: string) => void
  setContent: (text: string) => void
  save: () => Promise<void>
  setMessage: (msg: string, ms?: number) => void
  setEditorApi: (api: EditorApi | null) => void
  setEditor: (ed: SlateEditor | null) => void
  /** 把当前内容记为「已保存」，用于打开笔记后建立基准，避免未编辑就落盘 */
  markClean: (text: string) => void
  setActive: (
    marks: Record<string, boolean>,
    block: { type: string; level?: number; checked?: boolean; lang?: string }
  ) => void
  toggleLocked: () => Promise<void>
  toggleNear: () => Promise<void>
  /** 启动时校准已注册的「全局搜索指令」：修正旧版本写坏的 icon 路径（缺扩展名会 404） */
  syncNearFeatures: () => Promise<number | void>
  toggleToolbar: () => void
  toggleSourceMode: () => void
  setBodyFontSize: (v: number) => void
  setAiOpen: (v: boolean) => void
  /** 关掉当前笔记（删除它之前调用，避免自动保存把它写回来） */
  clearCurrent: () => void
  /** 目录树过滤词：只该由「全部笔记搜索」写它，当前没有这个入口，实际恒为空 */
  setSearchTerm: (v: string) => void
  /** 当前笔记内查找词：只驱动编辑器里的命中高亮与跳转，不参与目录树过滤 */
  /**
   * ↑↓ 切换笔记。
   * 搜索态下在命中列表里走；没有搜索词时按目录树顺序走全部笔记。
   */
  stepNote: (dir: 1 | -1) => void
  /** 只设置正文高亮词（笔记内查找用，不动目录树过滤） */
  setFindTerm: (v: string) => void
  /** 切到下一个/上一个命中（上下键），会自动打开对应笔记 */
  nextHit: () => void
  prevHit: () => void
  /** 退出搜索态：清词、清命中、清游标 */
  clearSearch: () => void
  /** 重建全文索引 */
  buildIndex: () => Promise<void>
  /** 按关键词搜索标题与正文，结果写入 searchHits */
  searchNotes: (kw: string) => void
  /** 冲突时用户选择覆盖磁盘 */
  forceSave: () => Promise<void>
  /** 冲突时用户选择重新载入磁盘 */
  reloadFromDisk: () => void
}

let messageTimer: number | undefined

/**
 * 命中切换：当前位置不再单独存状态，直接用「当前笔记在 hitOrder 里的下标」算。
 *
 * 之前用一个 hitCursor 字段记录游标，openNote 与游标写入是两次 set，
 * 一旦某处漏写就会出现「正文切了、计数不动」的错位。命中列表本身就是唯一的真相，
 * 从这里派生不会不一致；当前笔记不在命中集内（下标 -1）时，↓ 直接落到第一条。
 */
/**
 * 按目录树顺序（深度优先）拍平所有笔记。
 * ↑↓ 在没有搜索词时就是按这个顺序走，和用户在树里看到的先后一致。
 */
function flattenNotes(list: TreeNode[] | undefined, out: string[] = []): string[] {
  for (const n of list || []) {
    if (n.type === 'folder') flattenNotes(n.children, out)
    else if (n.rel) out.push(n.rel)
  }
  return out
}

function shiftHit(step: number, get: () => { hitOrder: string[]; currentRel: string; openNote: (rel: string) => unknown }) {
  const order = get().hitOrder || []
  if (!order.length) return
  const curRel = String(get().currentRel || '').toLowerCase()
  const cur = order.findIndex((r) => String(r).toLowerCase() === curRel)
  const next = cur < 0 ? (step > 0 ? 0 : order.length - 1) : (cur + step + order.length) % order.length
  const rel = order[next]
  if (!rel) return
  try {
    void get().openNote(rel)
  } catch (e) {}
}

export const useNotes = create<NoteState>((set, get) => ({
  workspace: '',
  tree: [],
  truncated: false,
  currentRel: '',
  content: '',
  savedContent: '',
  saving: false,
  message: '',
  editorApi: null,
  editor: null,
  activeMarks: {},
  activeBlock: { type: 'paragraph' },
  locked: false,
  loadRevision: 0,
  near: false,
  toolbarHidden: false,
  sourceMode: false,
  bodyFontSize: 14,
  aiOpen: false,
  searchTerm: '',
  findTerm: '',
  notesIndex: [],
  searchHits: {},
  hitOrder: [],
  diskMtime: 0,
  conflict: '',

  refreshTree() {
    void (async () => {
      const r = await getPorts().ws.listTree()
      set({ workspace: r.workspace ?? undefined, tree: r.children, truncated: r.truncated })
    })()
  },

  openNote(relRaw) {
    // 统一分隔符 / 去掉 ./ 前缀：rel 可能来自 LMDB 里的旧 feature、AI 传的 id、手改的 near.txt，
    // 格式不一致会让 hitOrder.indexOf(currentRel) 失配，表现为「按↓回到第一条」。
    const rel = String(relRaw ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
    if (!rel) return
    // 每次打开都自增：同一 rel 重新载入（git 面板还原、冲突后重读）时，
    // 编辑器 effect 只依赖 currentRel 的话不会重跑，会拿旧文档覆盖磁盘新内容
    const rev = (get().loadRevision || 0) + 1
    set({ loadRevision: rev })

    void (async () => {
      // 切文件前先把当前改动落盘；失败就停，否则内存里没保存的改动直接蒸发
      const before = get()
      if (before.currentRel && before.content !== before.savedContent) {
        await before.save()
        const after = get()
        if (after.content !== after.savedContent) {
          after.setMessage('当前笔记未保存，已暂停切换', 3600)
          return
        }
      }

      // 读失败不能当空笔记：否则用户一敲字就把整篇原正文覆盖成几个字
      const r = await getPorts().ws.read(rel)
      if (get().loadRevision !== rev) return // 期间又切了别的笔记，丢弃这次结果
      if (!r.ok) {
        // 文件已经不在了（典型场景：git 丢弃改动把未跟踪的新文件直接删掉，
        // 随后 git 面板回调 reloadNote 重新打开它）——这不是错误，静默收场即可
        const gone = String(r.code) === 'ENOENT' || /ENOENT/i.test(String(r.message || ''))
        if (gone) {
          set({ currentRel: '', content: '', savedContent: '', conflict: '', message: '这篇笔记已不存在' })
          try {
            get().refreshTree()
          } catch (e) {}
          return
        }
        set({ conflict: '', message: `打开失败：${r.message || r.code || '无法读取文件'}` })
        return
      }

      // 只读状态由数据层决定（locked.txt），界面据此禁写
      const st = await getPorts().ws.noteState(rel)
      if (get().loadRevision !== rev) return
      set({
        currentRel: rel,
        content: r.value.text,
        savedContent: r.value.text,
        diskMtime: r.value.mtime,
        conflict: '',
        locked: !!(st.ok && st.value.locked),
        near: !!(st.ok && st.value.near),
      })
    })()
  },

  setContent(text) {
    set({ content: text })
  },

  async save() {
    const { currentRel, content, savedContent, locked } = get()
    if (!currentRel || content === savedContent) return
    if (locked) {
      get().setMessage('该笔记已设为只读，未保存', 2600)
      return
    }
    const ws = getPorts().ws
    // 文件在磁盘上已经没了（被删除、被重命名、被拖走）→ 不能补写，否则会复活一篇旧笔记，
    // 但必须告诉用户，否则他会以为一直在保存，实际编辑了十几分钟全丢
    if (!(await ws.exists(currentRel))) {
      set({ savedContent: content, conflict: '文件已不在原位置（可能被移动或删除）' })
      get().setMessage('这篇笔记已不在原位置，内容未保存', 5000)
      return
    }

    // 外部改动检测：磁盘 mtime 变了说明被别的编辑器/同步工具改过，
    // 直接写会覆盖别人的改动，停下来把选择权交给用户
    const now = await ws.stat(currentRel)
    const diskMtime = get().diskMtime
    if (now.ok && diskMtime && now.value.mtime && now.value.mtime !== diskMtime) {
      set({ conflict: '磁盘上的文件已被其它程序修改' })
      get().setMessage('这篇笔记在磁盘上被改过，已暂停保存', 5000)
      return
    }

    set({ saving: true })
    const r = await ws.write(currentRel, content)
    set({ saving: false })
    if (!r.ok) {
      get().setMessage('保存失败：' + (r.message || '未知错误'), 4000)
      return
    }
    const st = await ws.stat(currentRel)
    set({ savedContent: content, diskMtime: st.ok ? st.value.mtime : diskMtime, conflict: '' })
    // 索引就地更新：全文索引只在启动时建一次，不 patch 的话刚写的内容搜不到，
    // 用户会以为「搜索坏了」。
    try {
      const idx = get().notesIndex || []
      const i = idx.findIndex((n) => n.rel === currentRel)
      if (i >= 0) {
        const next = idx.slice()
        next[i] = { rel: currentRel, text: content }
        set({ notesIndex: next })
      } else {
        set({ notesIndex: idx.concat([{ rel: currentRel, text: content }]) })
      }
    } catch (e) {}
  },

  setMessage(msg, ms = 2500) {
    set({ message: msg })
    if (messageTimer) window.clearTimeout(messageTimer)
    messageTimer = window.setTimeout(() => set({ message: '' }), ms)
  },

  setEditorApi(api) {
    set({ editorApi: api })
  },

  setEditor(ed) {
    set({ editor: ed })
  },

  markClean(text) {
    set({ content: text, savedContent: text })
  },

  setActive(marks, block) {
    set({ activeMarks: marks, activeBlock: block })
  },

  toggleToolbar() {
    set({ toolbarHidden: !get().toolbarHidden })
  },

  toggleSourceMode() {
    set({ sourceMode: !get().sourceMode })
  },

  async forceSave() {
    const { currentRel, content } = get()
    if (!currentRel) return
    const r = await getPorts().ws.write(currentRel, content)
    if (!r.ok) {
      get().setMessage('保存失败：' + (r.message || ''), 4000)
      return
    }
    const st = await getPorts().ws.stat(currentRel)
    set({ conflict: '', savedContent: content, diskMtime: st.ok ? st.value.mtime : 0 })
  },

  reloadFromDisk() {
    const { currentRel } = get()
    if (!currentRel) return
    set({ conflict: '' })
    get().openNote(currentRel)
    get().setMessage('已重新载入磁盘上的版本', 2400)
  },

  async buildIndex() {
    try {
      set({ notesIndex: await getPorts().ws.readAll() })
    } catch (e) {
      set({ notesIndex: [] })
    }
  },

  searchNotes(kw) {
    const q = String(kw ?? '').trim().toLowerCase()
    if (!q) {
      set({ searchTerm: '', searchHits: {}, hitOrder: [], findTerm: '' })
      // 不要在这里 setSubInputValue：宿主会把它当成一次输入变化回调回来，
      // 于是 searchNotes('') -> setSubInputValue('') -> 回调 -> searchNotes('') 无限循环，
      // 表现就是搜索框一直闪、打不进字。同步只在 Esc 那种「框里还有字」的场景做。
      return
    }
    const hits: Record<string, { field: 'title' | 'content'; snippet: string }> = {}
    // 索引为空时先建一次（首次搜索时兜底）
    const index = get().notesIndex.length ? get().notesIndex : (() => {
      const bridge = notes() as unknown as { loadAllNotes?: () => { rel: string; text: string }[] }
      let l: { rel: string; text: string }[] = []
      try {
        l = bridge?.loadAllNotes?.() || []
      } catch (e) {}
      if (l.length) set({ notesIndex: l })
      return l
    })()

    for (const n of index) {
      const fileName = n.rel.split('/').pop() || n.rel
      const title = fileName.replace(/\.md$/i, '')
      if (title.toLowerCase().includes(q)) {
        hits[n.rel] = { field: 'title', snippet: '' }
        continue
      }
      const idx = n.text.toLowerCase().indexOf(q)
      if (idx >= 0) {
        const start = Math.max(0, idx - 30)
        const snippet = n.text.slice(start, idx + q.length + 40).replace(/\s+/g, ' ').trim()
        hits[n.rel] = { field: 'content', snippet }
      }
    }
    // 命中顺序必须跟目录树一致：索引是文件系统遍历序，树是 order.txt 排过的序，
    // 直接用 Object.keys 会出现「上下键跳着走」的问题
    const ordered: string[] = []
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        if (n.type === 'folder') walk(n.children || [])
        else if (Object.prototype.hasOwnProperty.call(hits, n.rel)) ordered.push(n.rel)
      }
    }
    walk(get().tree || [])
    // 兜底：索引里有、但树里暂时没有的（比如刚建还没刷新），按原顺序补在后面
    for (const rel of Object.keys(hits)) {
      if (!ordered.includes(rel)) ordered.push(rel)
    }

    // 一次写全：搜索词、命中、顺序、游标、正文高亮词。
    // 这里是 searchTerm 与 findTerm 唯一的同步点，其他入口只写其中一个，
    // 不会出现「搜到了但正文不高亮」。
    set({ searchTerm: kw, searchHits: hits, hitOrder: ordered, findTerm: kw })

    // 自动打开第一个命中（用户要求：搜索后默认落在排第一的那条）。
    // 加一点延迟，避免每敲一个字就切一次文件。
    const keys = ordered
    if (keys.length) {
      const target = keys[0]
      // 记下此刻打开的笔记：350ms 内用户自己点了树/按了上下键，就不能再被拽回首条
      const relAtSearch = get().currentRel
      setTimeout(() => {
        if (get().searchTerm !== kw) return
        if (get().currentRel !== relAtSearch) return
        try {
          void get().openNote(target)
          // 焦点交给目录树，而不是抢回宿主搜索框。
          // 宿主顶部输入框是宿主渲染的独立元素，插件收不到它的按键——只要焦点在框里，
          // 上下键就永远到不了插件，命中切换就是死的。把焦点放到树上，↑↓ 立刻可用；
          // 用户想改关键词按 Ctrl+F 即可回到搜索框。
          window.setTimeout(() => {
            try {
              window.dispatchEvent(new CustomEvent('cmark-focus-tree'))
            } catch (e) {}
          }, 60)
        } catch (e) {}
      }, 350)
    }
  },

  setSearchTerm(v) {
    set({ searchTerm: v })
  },

  stepNote(dir) {
    const { hitOrder, searchTerm, tree, currentRel, openNote } = get()
    const searching = String(searchTerm || '').trim().length > 0
    const list = searching ? hitOrder : flattenNotes(tree)
    if (!list.length) return
    const curRel = String(currentRel || '').toLowerCase()
    const cur = list.findIndex((r) => String(r).toLowerCase() === curRel)
    const next = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length
    const rel = list[next]
    if (!rel) return
    // 非搜索态切到折叠目录里的笔记时，让目录树把祖先展开，否则用户看不到当前在哪
    if (!searching) {
      try {
        window.dispatchEvent(new CustomEvent('cmark-reveal-note', { detail: rel }))
      } catch (e) {}
    }
    try {
      void openNote(rel)
    } catch (e) {}
  },

  nextHit() {
    shiftHit(1, get)
  },

  prevHit() {
    shiftHit(-1, get)
  },

  clearSearch() {
    set({ searchTerm: '', searchHits: {}, hitOrder: [], findTerm: '' })
  },

  setFindTerm(v) {
    set({ findTerm: v })
  },

  clearCurrent() {
    set({ currentRel: '', content: '', savedContent: '', locked: false, near: false })
  },

  /** 设为全局搜索指令：写 near.txt + 向 ZTools 注册 feature */
  async toggleNear() {
    const { currentRel, near, setMessage } = get()
    if (!currentRel) return
    const next = !near
    const r = await getPorts().ws.setNoteNear(currentRel, next)
    if (!r.ok) {
      setMessage('设置失败：' + (r.message || '未知原因'), 3200)
      return
    }
    const title = currentRel.split('/').pop()!.replace(/\.(md|markdown)$/i, '')
    try {
      const z = hostApi() as unknown as {
        setFeature?: (o: { code: string; icon?: string; explain?: string; cmds?: string[] }) => void
        removeFeature?: (code: string) => void
      }
      const code = 'note/' + currentRel
      if (next) {
        // icon 必须带扩展名：ZTools 会把相对路径拼成 <插件目录>/<icon>，
        // 写成 'logo' 得到 ...cmark-1.1.0.asar/logo（文件不存在），列表里就是破图
        z?.setFeature?.({ code, icon: 'logo.png', explain: '打开笔记「' + title + '」', cmds: [title] })
      } else {
        z?.removeFeature?.(code)
      }
    } catch (e) {}
    set({ near: next })
    setMessage(next ? '已设为全局搜索：「' + title + '」' : '已取消全局搜索', 2400)
  },

  /**
   * 启动时校准「全局搜索指令」。
   *
   * 旧版本把动态指令的 icon 写成 'logo'（没有扩展名），ZTools 拼出来的地址是
   * …/cmark-x.y.z.asar/logo，文件不存在 —— 在「快捷键 → 目标指令」这类列表里就是破图。
   * 注册记录存在 ZTools 的 LMDB 里，只改代码不会更新它，所以每次启动按 near.txt
   * 重新 setFeature 一遍（同 code 会覆盖），把老记录纠正过来。
   */
  async syncNearFeatures() {
    try {
      // allDocs 在 __NDB（数据层）上，不在 __ZNOTES；readNoteState 反过来在 __ZNOTES 上。
      // 这两个混用会静默失效（可选链吞掉 undefined），踩过一次。
      const D = db() as unknown as { allDocs?: (s?: string) => Array<{ _id?: string }> } | undefined
      const Z = noteState() as unknown as { readNoteState?: (rel: string) => { near?: boolean } } | undefined
      const z = hostApi() as unknown as { setFeature?: (o: unknown) => void } | undefined
      if (!D?.allDocs || !z?.setFeature) return
      const docs = D.allDocs('note/') || []
      let n = 0
      for (const doc of docs) {
        const id = String(doc?._id || '')
        if (!id.startsWith('note/')) continue
        const rel = id.slice('note/'.length)
        if (!Z?.readNoteState?.(rel)?.near) continue
        const title = rel.split('/').pop()!.replace(/\.(md|markdown)$/i, '')
        z.setFeature({ code: id, icon: 'logo.png', explain: '打开笔记「' + title + '」', cmds: [title] })
        n++
      }
      // 注册条数打到控制台：为 0 通常是 ndb 还没扫完（readNoteState 读不到 near 标记），
      // 调用方会延时再补一次。
      try { console.log('[cmark] syncNearFeatures 注册 ' + n + ' 条（共 ' + docs.length + ' 篇候选）') } catch (e) {}
      return n
    } catch (e) {}
  },

  setAiOpen(v) {
    set({ aiOpen: v })
  },

  setBodyFontSize(v: number) {
    const n = Math.min(16, Math.max(12, Math.round(Number(v) || 14)))
    set({ bodyFontSize: n })
    try {
      window.localStorage.setItem('cmark-dev-body-font-size', String(n))
    } catch (e) {}
  },

  async toggleLocked() {
    const { currentRel, locked, setMessage } = get()
    if (!currentRel) return
    const r = await getPorts().ws.setNoteLocked(currentRel, !locked)
    if (r.ok) {
      set({ locked: !locked })
      setMessage(!locked ? '已设为只读' : '已取消只读', 1800)
    } else {
      // 失败不能静默：用户会以为已经锁上了
      setMessage('设置只读失败：' + (r.message || '接口不可用'), 3600)
    }
  },
}))

// 开发期调试出口：便于用 CDP 直接驱动 store。
// 必须包在 DEV 里 —— 生产构建时 Vite 会把整块静态剔除，
// 发布产物里不能留任何可以从 DevTools 直接改文档状态的入口。
if (import.meta.env.DEV) {
  try {
    const w = window as unknown as { __cmarkStore?: unknown; __notesStore?: unknown }
    w.__cmarkStore = useNotes
    w.__notesStore = useNotes
  } catch (e) {}
}
