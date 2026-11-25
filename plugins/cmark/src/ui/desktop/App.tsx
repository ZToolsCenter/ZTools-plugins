import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/EditorPlate'
import { Toolbar } from './components/Toolbar'
import { IconMenu } from '../shared/components/icons'
import { SearchDialog } from './components/SearchDialog'
import { MoreMenu } from './components/MoreMenu'
import { PushStatus } from './components/PushStatus'
import { Onboard } from './components/Onboard'
import { AiPanel } from './components/AiPanel'
import DesktopSettings from './components/DesktopSettings'
import { useNotes } from '../../service/store/notes'
import { hasNotes, notes } from '../../runtime/legacy-bridge'

/** 搜索态持久化键（sessionStorage）：同一次运行内有效，ZTools 重入后仍能恢复 */
const SEARCH_STORE_KEY = 'cmark.search.v1'

export default function App() {
  const currentRel = useNotes((s) => s.currentRel)
  const content = useNotes((s) => s.content)
  const savedContent = useNotes((s) => s.savedContent)
  const save = useNotes((s) => s.save)
  const message = useNotes((s) => s.message)
  const buildIndex = useNotes((s) => s.buildIndex)
  const searchNotes = useNotes((s) => s.searchNotes)
  const refreshTree = useNotes((s) => s.refreshTree)



  // 主题兜底：preload 在 document-start 写 data-theme，重载时可能早于 <html> 创建
  useEffect(() => {
    try { (window as unknown as { __CMARK_THEME?: { apply?: () => void } }).__CMARK_THEME?.apply?.() } catch (e) {}
  }, [])

  // Git 面板未初始化仓库时点「打开设置」：先收起 git 面板再开设置
  useEffect(() => {
    const h = () => {
      const g = (window as unknown as { __zgsOpen?: () => void }).__zgsOpen
      if (g) g()
    }
    window.addEventListener('cmark-open-settings', h)
    return () => window.removeEventListener('cmark-open-settings', h)
  }, [])

  const [searchOpen, setSearchOpen] = useState(false)
  const conflict = useNotes((s) => s.conflict)
  const forceSave = useNotes((s) => s.forceSave)
  const reloadFromDisk = useNotes((s) => s.reloadFromDisk)
  const sourceMode = useNotes((s) => s.sourceMode)
  const toggleSourceMode = useNotes((s) => s.toggleSourceMode)
  const aiOpen = useNotes((s) => s.aiOpen)
  const setAiOpen = useNotes((s) => s.setAiOpen)
  const bodyFontSize = useNotes((s) => s.bodyFontSize)
  const locked = useNotes((s) => s.locked)
  const toggleLocked = useNotes((s) => s.toggleLocked)
  const near = useNotes((s) => s.near)
  const toggleNear = useNotes((s) => s.toggleNear)
  const editorInstance = useNotes((s) => s.editor)
  const [sidebarHidden, setSidebarHidden] = useState(false)

  // 自动保存：输入停止 600ms 落盘
  useEffect(() => {
    if (!currentRel || content === savedContent) return
    const t = window.setTimeout(() => save(), 600)
    return () => window.clearTimeout(t)
  }, [content, savedContent, currentRel, save])

  // 关闭前必须落盘；失焦不写盘。
  // 原来失焦也写，切到别的编辑器看一眼就把内容落盘了，会放大与外部改动的覆盖碰撞。
  useEffect(() => {
    const flush = () => {
      const s = useNotes.getState()
      if (s.currentRel && s.content !== s.savedContent) s.save()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // 磁盘变化 → 刷新树
  useEffect(() => {
    if (hasNotes()) {
      notes().onWorkspaceChange(() => {
        window.setTimeout(() => refreshTree(), 250)
      })
    }
  }, [refreshTree])

  // Ctrl+Alt+, 折叠侧边栏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === ',') {
        e.preventDefault()
        setSidebarHidden((v) => !v)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (e.shiftKey) {
          // Ctrl+Shift+F：在当前笔记内查找（定位 + 高亮 + 上下跳）
          setSearchOpen(true)
          return
        }
        // Ctrl+F：聚焦宿主顶部搜索框（主搜索入口）
        try {
          const z = (window as unknown as { ztools?: { subInputFocus?: () => void } }).ztools
          z?.subInputFocus?.()
        } catch (err) {}
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 启动时恢复：先恢复搜索词，再落回上次打开的那一篇
  useEffect(() => {
    let v: { term?: string; rel?: string } | null = null
    try {
      v = JSON.parse(sessionStorage.getItem(SEARCH_STORE_KEY) || 'null')
    } catch (e) {
      v = null
    }
    if (!v || (!v.term && !v.rel)) return
    const term = v.term || ''
    const rel = v.rel || ''
    // 记一份"恢复开始前"的快照：用户在延时窗口里自己操作过，就不能再被覆盖。
    const t0Term = useNotes.getState().searchTerm
    const t0Rel = useNotes.getState().currentRel
    if (term) window.setTimeout(() => {
      const cur = useNotes.getState()
      if (cur.searchTerm !== t0Term) return
      if (!cur.searchTerm) cur.searchNotes(term)
    }, 300)
    if (rel) window.setTimeout(() => {
      const cur = useNotes.getState()
      if (cur.searchTerm !== t0Term) return
      if (cur.currentRel === t0Rel && cur.currentRel !== rel) void cur.openNote(rel)
    }, 800)
  }, [])

  /**
   * 冷启动走 note/<rel> 快捷指令时，preload 是最早收到 enter 的，
   * 那时 React 还没挂载、没有任何监听器，这次导航会丢。
   * preload 把最后一次 enter 存在 __CMARK_LAST_ENTER，这里补消费一次。
   */
  useEffect(() => {
    const box = window as unknown as { __CMARK_LAST_ENTER?: { code?: string } }
    const last = box.__CMARK_LAST_ENTER
    if (!last) return
    box.__CMARK_LAST_ENTER = undefined
    const code = String(last.code || '')
    if (code.startsWith('note/')) {
      const rel = code.slice('note/'.length)
      if (rel) window.setTimeout(() => { void useNotes.getState().openNote(rel) }, 260)
    }
  }, [])

  /**
   * 排障出口：宿主顶部输入框是宿主渲染的受控输入，自动化很难稳定驱动，
   * 排查「搜索链路」问题时需要一个直接打到 store 的入口。
   * 只读 + 只调既有 action，不引入任何新状态。
   */
  useEffect(() => {
    console.log('[cmark] debug')
    ;(window as unknown as Record<string, unknown>).__CMARK_SEARCH__ = {
      search: (kw: string) => useNotes.getState().searchNotes(kw),
      clear: () => useNotes.getState().clearSearch(),
      next: () => useNotes.getState().nextHit(),
      prev: () => useNotes.getState().prevHit(),
      state: () => {
        const st = useNotes.getState()
        return {
          searchTerm: st.searchTerm,
          findTerm: st.findTerm,
          hits: st.hitOrder.length,
          currentRel: st.currentRel,
          rows: document.querySelectorAll('.tree .label').length,
          marks: document.querySelectorAll('.search-hit-mark').length,
          bar: (document.querySelector('.tree-hitbar') as HTMLElement | null)?.innerText || '',
          focus: String((document.activeElement as HTMLElement | null)?.className || ''),
        }
      },
    }
  }, [])

  /**
   * 搜索态持久化。
   *
   * 宿主重新唤起插件时会先清一次 sub-input（值变化会回调到插件），
   * 这一下就能把「搜索词」清成空，目录树立刻恢复全量——用户看到的就是「搜索状态丢了」。
   * 这里把搜索词和当前笔记存进 sessionStorage（同一次运行内有效），
   * 无论中间被清空、还是页面重载，都能恢复到用户离开时的样子。
   */
  useEffect(() => {
    // 节流：subscribe 会在每次 store 变化时触发，编辑器输入路径上没必要同步写
    let timer = 0
    const save = () => {
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        const st = useNotes.getState()
        try {
          sessionStorage.setItem(
            SEARCH_STORE_KEY,
            JSON.stringify({ term: st.searchTerm || '', rel: st.currentRel || '' }),
          )
        } catch (e) {}
      }, 200)
    }
    save()
    const unsub = useNotes.subscribe(save)
    return () => {
      unsub()
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  /**
   * 搜索态下 ↑↓ 在目录树里切换上下文档。
   *
   * 只在「该由搜索接管」的场景响应，其余一律放行：
   *   - 没有搜索词 / 没有命中：不管
   *   - 焦点在正文编辑器（.plate-content / contenteditable）：↑↓ 是移动光标，必须放行
   *   - 焦点在 input / textarea：交给输入框自己
   *   - 带了 Alt/Ctrl/Shift：是别的快捷键
   * 位置越界时首尾循环，连按不会卡住。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useNotes.getState()
      const ae = document.activeElement as HTMLElement | null
      if (e.key === 'Escape' && s.searchTerm && !searchOpen) {
        // 退出搜索态：清词、清树过滤、清正文高亮，并且一定要清宿主框。
        // 不清的话框里还留着上次的关键词，看起来像「搜索还在」，用户会以为是 bug。
        try {
          const z = (window as unknown as { ztools?: { setSubInputValue?: (v: string) => void } }).ztools
          ;(window as unknown as { __cmarkSyncing?: boolean }).__cmarkSyncing = true
          z?.setSubInputValue?.('')
          window.setTimeout(() => {
            ;(window as unknown as { __cmarkSyncing?: boolean }).__cmarkSyncing = false
          }, 120)
        } catch (err) {}
        s.clearSearch()
        if (ae && ae.blur) {
          try {
            ae.blur()
          } catch (err) {}
        }
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (ae) {
        if (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) return
        if (ae.closest && ae.closest('.plate-content')) return
      }
      // 没有搜索词时也走：按目录树顺序切换到上一篇/下一篇。
      // 搜索态由 stepNote 内部改用命中列表，两者对外是同一个键位。
      if (!s.tree.length) return
      e.preventDefault()
      s.stepNote(e.key === 'ArrowDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen])

  /**
   * 顶部搜索框来自宿主：zTools 的 setSubInput 在窗口顶部渲染子输入框。
   * 签名沿用 uTools 顺序 setSubInput(callback, placeholder)，
   * 回调参数是 { text: string }，取值必须走 .text。
   */
  useEffect(() => {
    const z = (
      window as unknown as {
        ztools?: {
          setSubInput?: (cb: (arg: unknown) => void, ph?: string) => void
          removeSubInput?: () => void
          subInputFocus?: () => void
        }
      }
    ).ztools
    if (!z?.setSubInput) return

    /**
     * 唤起插件时输入的那个词是「命令词」，不是笔记搜索词。
     * 例如 Alt+空格 → 输入 cmark → 回车，宿主会把 "cmark" 一并塞进 sub-input，
     * 若当成搜索词，目录树立刻被筛成 0 篇，用户会以为笔记全没了。
     * 进入插件后的这段时间内一律忽略输入，随后由 alignHostSearch 把上次的搜索词写回去。
     */
    let ignoreSubInputUntil = 0
    /**
     * 待确认的「清空搜索」定时器。
     *
     * 宿主重新唤起插件时会先把搜索框清空一次（回调空串），紧接着又把缓存的值填回来
     * —— 那个空值只是中间态，不能当成「用户删空了搜索」。
     * 反过来，用户真的删到空时，空值之后不会再有任何输入。
     *
     * 所以空值不当场处理，而是等一小段时间：期间来了非空值就撤销，一直没来才清空。
     * （之前靠「上一次回调的间隔」猜，用户先切了几篇命中再回来删最后一个字符时间线就断了，
     *   那个字符被写回框，表现就是「删不掉」。）
     */
    let blankTimer = 0
    /** 最近一次识别到「唤起命令词」的时间：那个场景下宿主也会清空框，但搜索态要保住 */
    let lastCmdAt = 0

    /**
     * 插件的唤起命令词。出现在 sub-input 里时是「进入插件用的」，
     * 不能当成笔记搜索词（会把目录树筛成 0 篇，并冲掉上次的搜索状态）。
     */
    const CMARK_CMD_WORDS = new Set(['cmark', 'markdown', 'md', 'cm'])


    const handler = (arg: unknown) => {
      // 我们自己调 setSubInputValue 时宿主会回调一次，跳过它免得形成循环
      if ((window as unknown as { __cmarkSyncing?: boolean }).__cmarkSyncing) return
      if (Date.now() < ignoreSubInputUntil) return
      const raw = arg as { text?: unknown } | string | undefined
      let text = ''
      if (typeof raw === 'string') text = raw
      else if (raw && typeof raw === 'object' && 'text' in raw) text = String((raw as { text?: unknown }).text ?? '')
      // 插件的唤起命令词不是笔记搜索词。
      // 实测 ZTools 只是把主窗口 hide 掉，插件页面的 visibilityState / hasFocus()
      // 仍然是 visible/true，onPluginOut 也不触发，没法用"前台与否"判断；
      // 唯一可靠的判据是词本身：用户在主搜索框里敲 cmark/markdown/md/cm 是为了进插件，
      // 把它当搜索词会把目录树筛成 0 篇，并冲掉上次的搜索状态。
      const lowered = text.trim().toLowerCase()
      /**
       * 命令词 vs 真实搜索词的判定。
       *
       * 只按词本身判断会误伤（正文里确实可能出现 md、cm）；
       * 只按「当前有没有搜索词」判断会漏掉（唤起插件时上一次的搜索态还在，
       * 于是 cmark 被当成搜索词，树被筛成 0 篇 —— 这就是之前的 bug）。
       *
       * 用内容判断最稳：命令词几乎不会出现在笔记正文/路径里。
       * 在索引里查一下，查不到才当命令词吞掉。
       */
      if (lowered && CMARK_CMD_WORDS.has(lowered)) {
        const idx = useNotes.getState().notesIndex || []
        const inNotes = idx.some(
          (n) =>
            String(n.text || '').toLowerCase().includes(lowered) ||
            String(n.rel || '').toLowerCase().includes(lowered),
        )
        if (!inNotes) {
          // 这是唤起命令词，不是搜索词：把插件里真实的搜索词写回框。
          // 宿主在 enter 之后会把它缓存的命令词显示在框里，不纠正就是
          // 「框里 cmark、树按 honghuihf 筛着」。
          lastCmdAt = Date.now()
          const keep = useNotes.getState().searchTerm
          if (keep) {
            window.setTimeout(() => syncHostSearch(keep), 300)
            window.setTimeout(() => syncHostSearch(keep), 900)
          }
          return
        }
      }
      const st = useNotes.getState()


      /**
       * 空值有两种来源：
       *   a) 用户把搜索词删到空 —— 上一次回调就在几百毫秒内，且当时还有值；
       *   b) 宿主重新唤起时清空框 —— 上一次回调是很久以前的一次跳变。
       *
       * 不区分就会出 bug：用户删掉最后一个字符时被当成宿主抖动，
       * 于是把那个字符写回框里，每次唤起都复现。
       */
      if (!lowered && st.searchTerm) {
        // 空值先挂起，等 400ms：期间若有非空值进来就撤销（宿主清空后的回填），
        // 一直没来才认定为「用户删到空」并彻底退出搜索态。
        if (blankTimer) window.clearTimeout(blankTimer)
        blankTimer = window.setTimeout(() => {
          blankTimer = 0
          const cur = useNotes.getState()
          if (!cur.searchTerm) return
          // 刚才是「输入命令词唤起插件」：宿主也会清框，但这不是用户删搜索词，
          // 保留搜索态并把词写回框。
          if (Date.now() - lastCmdAt < 3000) {
            const keep = cur.searchTerm
            syncHostSearch(keep)
            window.setTimeout(() => syncHostSearch(keep), 700)
            return
          }
          // 用户真的删到空：彻底退出搜索态
          cur.clearSearch()
        }, 400)
        return
      }

      // 收到非空值：撤销待确认的清空
      if (blankTimer) {
        window.clearTimeout(blankTimer)
        blankTimer = 0
      }
      searchNotes(text)
    }

    try {
      z.setSubInput(handler, '搜索所有笔记')
      window.setTimeout(() => {
        try {
          z.subInputFocus?.()
        } catch (e) {}
      }, 150)
    } catch (e) {}

    /**
     * 唤醒时把焦点还给搜索框。
     *
     * 这里必须非常克制：subInputFocus 是宿主级的，一调就把焦点从编辑器抢走。
     *   - 只挂在 onPluginEnter（真正的插件进入事件），不挂 window.focus
     *     （window.focus 在点编辑器时也会触发，会把光标一直拽回搜索框）
     *   - 焦点已经在插件内部（编辑器/文本框）时直接跳过
     *   - 最多试两次，避免在窗口还没激活时反复抢
     */
    const refocus = () => {
      const ae = document.activeElement as HTMLElement | null
      if (ae) {
        if (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') return
        if (ae.closest && ae.closest('.plate-content')) return
      }
      let tries = 0
      const tick = () => {
        tries++
        const cur = document.activeElement as HTMLElement | null
        if (cur && (cur.tagName === 'TEXTAREA' || (cur.closest && cur.closest('.plate-content')))) return
        try {
          z.subInputFocus?.()
        } catch (e) {}
        if (tries < 2) window.setTimeout(tick, 220)
      }
      tick()
    }

    /**
     * 进入参数的形状（宿主实测）：
     *   { code: 'note/宏辉/City.md' | 'cmark', type: 'text', payload: '用户输入', inputState: {...} }
     *
     * 「设为全局搜索」注册的动态指令，code 就是 note/<rel>，此时必须直接把那篇笔记打开，
     * 否则点了指令只是把面板唤起来、停在上次那篇上，看着像没反应。
     * 普通指令（cmark / markdown / md / cm）仍走原来的 refocus。
     */
    const openNoteByFeature = (rel: string) => {
      try {
        useNotes.getState().openNote(rel)
      } catch (e) {}
      // 刚启动时 ndb 可能还没扫完，一次重试兜底
      window.setTimeout(() => {
        try {
          if (useNotes.getState().currentRel !== rel) useNotes.getState().openNote(rel)
        } catch (e) {}
      }, 400)
    }

    const onEnter = (enter?: { code?: string }) => {
      const code = String(enter?.code || '')
      // 只挡宿主在 enter 那一瞬间的残留回调；给长了会吞掉用户进插件后立刻打的字
      ignoreSubInputUntil = Date.now() + 150
      if (code.startsWith('note/')) {
        const rel = code.slice('note/'.length)
        if (rel) {
          openNoteByFeature(rel)
          // 快捷指令是「打开这一篇」的明确意图：退出搜索态。
          // 否则目录树还按上次关键词筛着，用户看不到刚打开的那篇在哪。
          try {
            useNotes.getState().clearSearch()
          } catch (e) {}
          // 搜索态已退出，宿主框里也不能留着旧词，否则框里显示的词和树对不上
          window.setTimeout(() => syncHostSearch(''), 120)
          return
        }
      }
      refocus()
      // 宿主在「自定义快捷键」这条路径上会在 enter 之后才清空搜索框，
      // 立即写会被随后的清空覆盖，所以延后一点再对齐一次。
      window.setTimeout(alignHostSearch, 260)
    }

    // 宿主只支持一个 onPluginEnter：统一由 preload 注册后广播成事件（见 preload.js wirePluginEnter）
    const onEnterEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ code?: string }>).detail
      onEnter(detail)
    }
    window.addEventListener('cmark-plugin-enter', onEnterEvent)
    const offEnter = () => window.removeEventListener('cmark-plugin-enter', onEnterEvent)

    /**
     * 把插件侧的搜索词写回宿主顶部搜索框（标题栏那个 input）。
     *
     * 为什么要写：搜索词存在插件 store 里，框的值存在宿主标题栏里，两边没有同步事件。
     * 实测两条唤起路径行为不同：
     *   主搜索框（Alt+空格）进入 → 宿主会把上次的输入回填到框里，看起来一致；
     *   插件自定义快捷键唤起      → 宿主把框清空却不通知插件，插件里 searchTerm 还是旧值，
     *                              于是「框里没字、目录树却还按上次关键词筛着」，用户无从恢复。
     * 这里以插件状态为准把词写回去，保证「框里显示什么 = 树按什么筛」，用户删字或 Esc 即可恢复。
     * 写回会触发一次 onChange 回调，用 __cmarkSyncing 挡住，避免又绕回 searchNotes。
     */
    const syncHostSearch = (value: string) => {
      try {
        const z = (window as unknown as { ztools?: { setSubInputValue?: (v: string) => void } }).ztools
        if (!z?.setSubInputValue) return
        ;(window as unknown as { __cmarkSyncing?: boolean }).__cmarkSyncing = true
        z.setSubInputValue(value)
        window.setTimeout(() => {
          ;(window as unknown as { __cmarkSyncing?: boolean }).__cmarkSyncing = false
        }, 80)
      } catch (e) {}
    }
    /**
     * 只在「有搜索词」时才把值写回宿主输入框。
     *
     * 之前的实现挂的是 window 的 focus 事件：用户点一次编辑器、窗口 focus 一次，
     * 就会调 ztools.setSubInputValue 去写宿主那个 input，宿主会顺势把焦点给它的
     * 搜索框 —— 结果就是光标被强行抢走，笔记根本没法编辑。
     * 现在改为：无搜索词直接不碰宿主；对齐只发生在进入插件时（onEnter）和首帧。
     */
    function alignHostSearch() {
      const term = useNotes.getState().searchTerm || ''
      if (!term) return
      window.setTimeout(() => {
        try {
          syncHostSearch(term)
        } catch (e) {}
      }, 120)
    }
    // 首帧对齐一次：宿主可能还留着上一次会话的框内容
    window.setTimeout(alignHostSearch, 400)

    return () => {
      offEnter()
      if (blankTimer) window.clearTimeout(blankTimer)
      try {
        z.removeSubInput?.()
      } catch (e) {}
    }
  }, [searchNotes])

  // 全文索引：正文搜索的前提，先把所有笔记读进内存
  useEffect(() => {
    buildIndex()
  }, [buildIndex])

  // 校准「全局搜索指令」的图标：旧版本注册动态指令时把 icon 写成 'logo'（缺扩展名），
  // ZTools 拼出来是 .../cmark-x.y.z.asar/logo，文件不存在 —— 目标指令列表里就是破图。
  // 注册记录在 ZTools 的库里，改代码不会自动更新，所以每次启动按 near.txt 重注册一遍。
  // 延时是因为要先等 ndb 扫描完成，否则 readNoteState 拿不到 near 标记。
  useEffect(() => {
    // 第一次 2.5s：多数情况下 ndb 已扫完。
    // 第二次 6s：笔记多/磁盘慢时第一次会注册 0 条（readNoteState 还读不到 near 标记），
    //             必须补一次，否则「设为全局搜索」的指令在重启后一直是丢的。
    const run = async () => {
      try {
        const n = await useNotes.getState().syncNearFeatures()
        if (typeof n === 'number' && n > 0) return true
      } catch (e) {}
      return false
    }
    const t1 = window.setTimeout(() => {
      void run().then((ok) => {
        if (!ok) window.setTimeout(() => void run(), 3500)
      })
    }, 2500)
    return () => window.clearTimeout(t1)
  }, [])

  // 字数：中文按字、英文按词，代码块不计

  // 字号档位挂到根节点，CSS 用变量控制
  useEffect(() => {
    document.documentElement.style.setProperty('--body-font-size', bodyFontSize + 'px')
    try {
      window.localStorage.setItem('cmark-dev-body-font-size', String(bodyFontSize))
    } catch (e) {}
  }, [bodyFontSize])

  /**
   * 面板由 preload 注入（git-panel.js / settings-panel.js）。
   * 万一某个模块在宿主里挂载失败，这里必须给出可见原因，不能点了没反应。
   */
  const reportPanelFail = useCallback((name: string) => {
    let detail = ''
    try {
      const errs = (window as unknown as { __CMARK_BOOT_ERRORS?: string[] }).__CMARK_BOOT_ERRORS
      if (Array.isArray(errs) && errs.length) detail = '：' + String(errs[0]).split('\n')[0].slice(0, 120)
      else detail = '（控制台可查 window.__CMARK_BOOT_ERRORS）'
    } catch (e) {}
    try {
      useNotes.getState().setMessage(name + ' 没有加载成功' + detail, 8000)
    } catch (e) {}
  }, [])

  /** 打开 V1.0.0 原版 git 面板（global = 工作区 / file = 当前笔记） */
  const openGit = useCallback((mode: 'global' | 'file') => {
    const fn = (window as unknown as { __zgpToggle?: (m: string) => void }).__zgpToggle
    if (typeof fn === 'function') { fn(mode); return }
    reportPanelFail('Git 面板')
  }, [reportPanelFail])

  /** 设置面板：插件端用 preload 注入的原版面板，独立端用 React 版 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => {
    const fn = (window as unknown as { __zgsToggle?: () => void }).__zgsToggle
    if (typeof fn === 'function') { fn(); return }
    setSettingsOpen(true)
  }, [])

  /** 给 preload 里的原版模块提供宿主钩子 */
  useEffect(() => {
    ;(window as unknown as { __cmarkHost?: () => unknown }).__cmarkHost = () => ({
      currentRel,
      flushSave: () => useNotes.getState().save(),
      reloadNote: (rel: string) => useNotes.getState().openNote(rel),
      refreshTree: () => useNotes.getState().refreshTree(),
      pickDir: () => {
        const r = notes().pickWorkspace?.()
        if (r?.ok) window.setTimeout(() => window.location.reload(), 400)
      },
    })
  }, [currentRel])

  const noteName = currentRel ? currentRel.split('/').pop()!.replace(/\.(md|markdown)$/i, '') : ''

  return (
    <div className={'app' + (sidebarHidden ? ' sidebar-hidden' : '')}>
      {!sidebarHidden ? <Sidebar onOpenGitPanel={() => openGit('global')} onOpenSettings={openSettings} /> : null}
      <main className="main">
        {/* 未打开笔记时不渲染整条头部：所有操作都在侧边栏 */}
        {currentRel ? (
        <div className="header">
          <div className="menu-toggle">
            <button
              className="iconbtn"
              title="隐藏侧边栏 Ctrl+Alt+,"
              onClick={() => setSidebarHidden((v) => !v)}
            >
              <IconMenu />
            </button>
          </div>
          <div className="title">
            {currentRel ? (
              <input
                type="text"
                readOnly
                value={noteName}
                placeholder=""
                spellCheck={false}
                title="文件名请在左侧目录树中右键重命名"
              />
            ) : (
              <span className="title-empty">未打开笔记</span>
            )}
          </div>
          {/* 头部右侧按钮：只在打开了笔记时出现（V1.0.0 的 !r && 判断） */}
          <div className="handle" style={currentRel ? undefined : { display: 'none' }}>
            <PushStatus
              onOpen={() => openGit('file')}
            />
            <button
              className={'iconbtn' + (locked ? ' on' : '')}
              title={locked ? '笔记当前只读，点击恢复编辑' : '禁止编辑(设为只读)'}
              onClick={toggleLocked}
            >
              {locked ? (
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4" />
                  <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4" />
                  <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.7-.6" />
                </svg>
              )}
            </button>
            <button
              className={'iconbtn' + (near ? ' on' : '')}
              title={near ? '已是全局搜索指令，点击取消' : '设为全局搜索'}
              onClick={toggleNear}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.6 1.9 8.3 3.2l.6.6-3.4 3.4H3.4l-.7.7 2.9 2.9-3.3 3.3a.5.5 0 0 0 .7.7l3.3-3.3 2.9 2.9.7-.7v-2.1l3.4-3.4.6.6 1.3-1.3z" />
              </svg>
            </button>
            <button
              className={'iconbtn' + (sourceMode ? ' on' : '')}
              title={sourceMode ? '源码模式（点击回到富文本）' : '源码模式（直接编辑 Markdown）'}
              onClick={toggleSourceMode}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m18 16 4-4-4-4" />
                <path d="m6 8-4 4 4 4" />
                <path d="m14.5 4-5 16" />
              </svg>
            </button>
            <MoreMenu />
          </div>
        </div>
        ) : null}

        {/* 外部改动冲突：暂停自动保存，把选择权交给用户 */}
        {conflict ? (
          <div className="conflict-bar">
            <svg
              className="cf-ico"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 2.1 1.5 13.5h13z" />
              <path d="M8 6.2v3.1" />
              <path d="M8 11.5v.1" />
            </svg>
            <span className="cf-text">{conflict}，自动保存已暂停</span>
            <span className="cf-actions">
              <button type="button" className="cf-btn" onClick={reloadFromDisk}>
                载入磁盘版本
              </button>
              <button type="button" className="cf-btn danger" onClick={forceSave}>
                用当前内容覆盖磁盘
              </button>
            </span>
          </div>
        ) : null}

        {/* 工具栏 35px：没打开笔记时不渲染 */}
        {currentRel ? <Toolbar /> : null}

        {/* content：灰底 + 白卡片 */}
        <div className="content">
          {currentRel ? (
            <div className="editor-card">
              <Editor />
            </div>
          ) : (
            <div className="note-empty">
              <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 7h18l8 8v26a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
                <path d="M29 7v8h8" />
                <path d="M16 24h16M16 31h11" />
              </svg>
              <div className="note-empty-title">还没有打开笔记</div>
              <div className="note-empty-desc">从左侧目录树里选一篇，或者右键新建</div>
            </div>
          )}
        </div>
      </main>

      <Onboard />
      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      {editorInstance ? (
        <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} editor={editorInstance} />
      ) : null}

      <DesktopSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {message && <div className="toast">{message}</div>}
    </div>
  )
}
