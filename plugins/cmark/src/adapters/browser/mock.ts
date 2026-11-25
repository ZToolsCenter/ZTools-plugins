/**
 * 浏览器预览用的 mock 层
 *
 * 只有在没有 ZTools preload（即 window.__CMARK 不存在）时才安装，
 * 数据存在 localStorage，刷新不丢。装了真插件时这段完全不生效。
 */
import type { CMarkBridge, OpResult, TreeResult, TreeNode } from '../../types/global.d.ts'

const KEY = 'cmark-mock-v1'

const SEED: Record<string, string> = {
  '欢迎.md': [
    '# 欢迎使用 CMark',
    '',
    '这是浏览器预览模式，数据存在 localStorage 里，不会碰磁盘。',
    '',
    '## 能试的操作',
    '',
    '- 左侧新建笔记 / 新建文件夹 / 右键重命名、删除',
    '- 编辑区改内容，600ms 后自动"保存"',
    '- 右侧实时预览：**粗体**、*斜体*、~~删除线~~、`行内代码`',
    '',
    '## 表格',
    '',
    '| 项目 | 状态 | 说明 |',
    '| --- | --- | --- |',
    '| 目录树 | 完成 | 递归、展开、右键 |',
    '| 编辑器 | 完成 | CodeMirror 6 |',
    '| 预览 | 完成 | marked + KaTeX |',
    '',
    '## 代码块',
    '',
    '```js',
    'const note = {',
    '  rel: "欢迎.md",',
    '  readonly: false,',
    '}',
    '',
    "console.log('saving', note.rel)",
    '```',
    '',
    '## 公式',
    '',
    '行内公式 $E = mc^2$，块级公式：',
    '',
    '$$',
    '\\int_{0}^{\\infty} e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}',
    '$$',
    '',
    '> 引用块：段落之间恰好空一行，反复保存不会累积空白。',
    '',
  ].join('\n'),

  '技术/CodeMirror 6.md': [
    '# CodeMirror 6',
    '',
    'V1.1.0 用它替代了原版的 Ace Editor。',
    '',
    '## 为什么换',
    '',
    '1. 体积小得多（488 KB vs 8.4 MB）',
    '2. 扩展体系现代，markdown 语言包开箱可用',
    '3. 直接编辑源码，保存零风险',
    '',
    '## 已挂的扩展',
    '',
    '- `lineNumbers()` 行号',
    '- `markdown()` 语法高亮与标题折叠',
    '- `history()` 撤销重做',
    '- `searchKeymap` 查找替换（Ctrl+F）',
    '- `EditorView.lineWrapping` 软换行',
    '',
  ].join('\n'),

  '技术/git 工作流.md': [
    '# git 工作流',
    '',
    '同步 = 提交 + 拉取 + 推送；推送 = 提交 + 推送；拉取 = 仅拉取。',
    '',
    '## 元数据在仓库根',
    '',
    '```',
    '.cmark/',
    '├── order.txt      目录顺序，一行一个 id',
    '├── locked.txt     只读标记，一行一个 md5(id)',
    '└── attachments/   图片附件，文件名是内容 md5',
    '```',
    '',
    '## 提交范围',
    '',
    '`git add` 必须同时包含工作区子目录**和**仓库根的 `.cmark/`，',
    '否则排序和只读状态永远提交不上去。',
    '',
  ].join('\n'),

  '生活/清单.md': [
    '# 待办清单',
    '',
    '- [x] 工程骨架',
    '- [x] 目录树',
    '- [x] 编辑器 + 预览',
    '- [ ] git 界面接线',
    '- [ ] 工具栏与表格操作',
    '- [ ] 图片附件粘贴',
    '- [ ] 全局搜索',
    '- [ ] 设置面板',
    '',
  ].join('\n'),
}

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {}
  const init = Object.assign({}, SEED)
  localStorage.setItem(KEY, JSON.stringify(init))
  return init
}

function save(fs: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(fs))
  } catch (e) {}
}

let store = load()

function buildTree(fs: Record<string, string>): TreeNode[] {
  const root: TreeNode[] = []
  const folders = new Map<string, TreeNode[]>()

  const ensureFolder = (path: string): TreeNode[] => {
    if (folders.has(path)) return folders.get(path)!
    const parts = path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const list = parentPath ? ensureFolder(parentPath) : root
    const node: TreeNode = { id: path, name, type: 'folder', rel: path, children: [] }
    list.push(node)
    folders.set(path, node.children!)
    return node.children!
  }

  for (const rel of Object.keys(fs)) {
    const parts = rel.split('/')
    const dir = parts.slice(0, -1).join('/')
    const list = dir ? ensureFolder(dir) : root
    list.push({
      id: rel,
      name: rel.split('/').pop()!.replace(/\.(md|markdown)$/i, ''),
      type: 'note',
      rel,
    })
  }

  const sortRec = (list: TreeNode[]): TreeNode[] => {
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh')
    })
    list.forEach((n) => n.children && sortRec(n.children))
    return list
  }
  return sortRec(root)
}

function ok(extra?: Partial<OpResult>): OpResult {
  return Object.assign({ ok: true }, extra)
}

function fail(message: string): OpResult {
  return { ok: false, message }
}

export function installMockIfNeeded(): void {
  if (typeof window === 'undefined' || window.__CMARK) return

  const listeners: Array<() => void> = []
  const notify = () => listeners.forEach((fn) => fn())

  const mock: CMarkBridge = {
    configPath: '(浏览器预览模式)',

    getConfig() {
      return { workspace: 'browser://mock', initialized: true, workspaceExists: true }
    },

    pickWorkspace() {
      return fail('浏览器预览模式不支持更换目录')
    },

    countMarkdown() {
      const n = Object.keys(store).length
      return { markdown: n, folders: new Set(Object.keys(store).map((k) => k.split('/').slice(0, -1).join('/'))).size }
    },

    rescan() {
      notify()
      return { ok: true }
    },

    onWorkspaceChange(fn) {
      listeners.push(fn as () => void)
    },

    shellShowWorkspace() {},

    absOf(rel) {
      return 'browser://mock/' + rel
    },

    readNote(rel) {
      return store[rel] ?? ''
    },

    // store 的 openNote 优先走 readNoteEx，再退 exists + readNote。
    // 少一个就会把「笔记存在」判成「已不存在」，表现是点树没反应。
    exists(rel) {
      return Object.prototype.hasOwnProperty.call(store, rel)
    },

    readNoteEx(rel) {
      if (!Object.prototype.hasOwnProperty.call(store, rel)) {
        return { ok: false, code: 'ENOENT', message: '笔记不存在' }
      }
      const text = store[rel] ?? ''
      return { ok: true, text, mtime: Date.now(), size: text.length }
    },

    statNote(rel) {
      if (!Object.prototype.hasOwnProperty.call(store, rel)) return { ok: false, code: 'ENOENT' }
      return { ok: true, mtime: Date.now(), size: (store[rel] ?? '').length }
    },

    writeNote(rel, text) {
      if (!(rel in store)) return fail('笔记不存在')
      store[rel] = text
      save(store)
      return ok()
    },

    createNote(dirRel, name, text) {
      const base = String(name || '未命名').replace(/[\\/:*?"<>|]/g, '').trim() || '未命名'
      let rel = (dirRel ? dirRel + '/' : '') + base + '.md'
      let i = 2
      while (rel in store) {
        rel = (dirRel ? dirRel + '/' : '') + base + ' ' + i + '.md'
        i++
      }
      store[rel] = text == null ? '# ' + base + '\n' : text
      save(store)
      notify()
      return ok({ rel })
    },

    createFolder(dirRel, name) {
      const base = String(name || '新建文件夹').replace(/[\\/:*?"<>|]/g, '').trim() || '新建文件夹'
      const rel = (dirRel ? dirRel + '/' : '') + base
      // 用一篇占位笔记撑起空目录（预览模式下目录不能独立存在）
      const placeholder = rel + '/.keep.md'
      if (!(placeholder in store)) {
        store[placeholder] = '# ' + base + '\n'
        save(store)
      }
      notify()
      return ok({ rel })
    },

    renameNode(rel, newName) {
      const clean = String(newName || '').replace(/[\\/:*?"<>|]/g, '').trim()
      if (!clean) return fail('名称不能为空')
      const isNote = /\.(md|markdown)$/i.test(rel)
      const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      const targetRel = (dirRel ? dirRel + '/' : '') + clean + (isNote ? '.md' : '')
      if (targetRel === rel) return ok({ rel })
      if (targetRel in store) return fail('同名已存在')
      if (isNote) {
        store[targetRel] = store[rel]
        delete store[rel]
      } else {
        const moves = Object.keys(store).filter((k) => k.startsWith(rel + '/'))
        moves.forEach((k) => {
          store[targetRel + k.slice(rel.length)] = store[k]
          delete store[k]
        })
      }
      save(store)
      notify()
      return ok({ rel: targetRel })
    },

    deleteNode(rel) {
      if (rel in store) delete store[rel]
      else Object.keys(store).filter((k) => k.startsWith(rel + '/')).forEach((k) => delete store[k])
      save(store)
      notify()
      return ok()
    },

    countInDir(rel) {
      return Object.keys(store).filter((k) => (rel ? k.startsWith(rel + '/') : true) && /\.md$/i.test(k)).length
    },

    moveNode(rel, targetDirRel) {
      const base = rel.split('/').pop()!
      const targetRel = (targetDirRel ? targetDirRel + '/' : '') + base
      if (targetRel === rel) return ok({ rel })
      store[targetRel] = store[rel]
      delete store[rel]
      save(store)
      notify()
      return ok({ rel: targetRel })
    },

    listTree(): TreeResult {
      return {
        workspace: 'browser://mock',
        children: buildTree(store),
        truncated: false,
        count: Object.keys(store).length,
      }
    },
  }

  window.__CMARK = mock

  // 暴露一个重置入口，方便随时恢复示例数据
  ;(window as unknown as { __CMARK_RESET: () => void }).__CMARK_RESET = () => {
    store = Object.assign({}, SEED)
    save(store)
    notify()
    location.reload()
  }
}