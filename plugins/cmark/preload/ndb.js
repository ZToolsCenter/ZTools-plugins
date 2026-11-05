/**
 * ndb.js —— 让 Markdown 笔记 UI 直接跑在「指定目录 + 真实 .md 文件」上
 *
 * 原理：原插件的 UI 只通过 window.db 读写数据。我们把 bundle 里的
 * `db.*` 换成 `window.__NDB.*`，再在这里用 fs 实现同名接口：
 *   note/<relpath.md>  ->  <工作区>/<relpath.md>      正文就是磁盘上的 .md
 *   folder/<relpath>   ->  目录（扫描得出，children 内联）
 *   setting / rootsort / last_work_note/*  ->  <用户数据目录>/znotes-data/<hash>/meta/ui.json
 *   attachment/<digest> ->  <用户数据目录>/znotes-data/<hash>/assets/<digest>.<ext>
 * 删除直接从磁盘移除（不做回收站，误删靠 git 历史恢复）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

module.exports = function installNDB(win, externalCfg) {
  // ---------------- 工作区（优先级：环境变量 > 外部配置 > asar 内默认）----------------
  // 默认工作区不写死盘符（新机器未必有 E 盘）；真实路径由 preload 的配置传入
  let WS = process.env.ZNOTES_WORKSPACE || path.join(fs.existsSync(path.join(os.homedir(), 'Documents')) ? path.join(os.homedir(), 'Documents') : os.homedir(), 'CMark')
  const candidates = []
  if (externalCfg) candidates.push(externalCfg)
  candidates.push(path.join(__dirname, 'workspace.json'))
  for (const c of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(c, 'utf8'))
      if (j && j.workspace) { WS = j.workspace; break }
    } catch (e) {}
  }
  WS = path.resolve(WS)

  // 元数据与附件一律放在笔记库之外：笔记库是 git 仓库，任何多余文件都会被自动提交推送
  const __META_ROOT = (function () {
    try {
      const os = require('os')
      const crypto = require('crypto')
      const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      const h = crypto.createHash('md5').update(String(WS).toLowerCase()).digest('hex').slice(0, 12)
      return path.join(base, 'znotes-data', h)
    } catch (e) {
      const os = require('os')
      return path.join(os.tmpdir(), 'znotes-data')
    }
  })()
  const META = path.join(__META_ROOT, 'meta')
  const UIJSON = path.join(META, 'ui.json')
  const STOREJSON = path.join(META, 'storage.json')
  // 仓库内的状态目录：排序、只读锁定、图片附件都放这里，随 git 一起提交。
  // 点开头 → 目录树扫描会跳过，不会显示成一本书；.gitignore 里也不要忽略它。
  // （本机运行态仍然留在仓库外的 __META_ROOT：git 配置、界面偏好、备份、日志）
  // .cmark 是「仓库级」元数据（排序、只读标记、附件），放在仓库根而不是选中的子目录里：
  // 一是不污染笔记目录（比如 Obsidian 库的视图），二是同一个仓库下换子目录做工作区时
  // 元数据只有一份。没有 git 时仓库根就等于工作区本身。
  function detectRepoRoot (start) {
    let cur = start
    let depth = 0
    while (cur && cur !== path.dirname(cur) && depth < 5) {
      depth++
      try {
        if (fs.existsSync(path.join(cur, '.git'))) return cur
      } catch (e) {}
      cur = path.dirname(cur)
    }
    return ''
  }
  const REPO_ROOT = detectRepoRoot(WS) || WS
  const REPO_META = path.join(REPO_ROOT, '.cmark')
  const ASSETS = path.join(REPO_META, 'attachments')

  const mk = (p) => { try { fs.mkdirSync(p, { recursive: true }) } catch (e) {} }

  // ===================== 图片相对路径重写 =====================
  //
  // 正文里的图片是相对 md 文件位置的路径（这样 Typora / VSCode / Obsidian 都能显示）。
  // 一旦笔记被改名、拖到别的目录，或者整个目录被移动，原来算好的 ../ 层数就全错了，
  // 图片会集体失效。所以每次文件落位之后都要按新旧位置把引用重算一遍。

  const IMG_MD = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g

  /** 纯字符串版：把 txt 里所有图片相对路径按「旧目录 → 新目录」重算 */
  function rewriteRelInText(txt, oldDir, newDir) {
    if (!txt || oldDir === newDir) return txt
    // 代码块/行内代码里的只是示例，跳过
    const segs = String(txt).split(
      /(```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|`+[^`]*`+)/g,
    )
    return segs
      .map((seg, idx) => (idx % 2 === 1 ? seg : rewriteSeg(seg, oldDir, newDir)))
      .join('')
  }

  function rewriteSeg(seg, oldDir, newDir) {
    return String(seg).replace(IMG_MD, (whole, pre, url, post) => {
      if (/^(https?:|data:|file:|attachment:|#|mailto:)/i.test(url)) return whole
      let abs
      try { abs = path.resolve(oldDir, url) } catch (e) { return whole }
      // 只动仓库范围内的、确实存在的文件，避免误改外链和失效引用
      if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) return whole
      try { if (!fs.existsSync(abs)) return whole } catch (e) { return whole }
      let rel = path.relative(newDir, abs).split(path.sep).join('/')
      if (rel && !rel.startsWith('.')) rel = './' + rel
      return pre + rel + post
    })
  }

  /** 文件已经落位后，就地改写它内部的图片相对路径 */
  function rewriteImagePaths(absOld, absNew) {
    try {
      if (absOld === absNew) return
      const oldDir = path.dirname(absOld)
      const newDir = path.dirname(absNew)
      if (oldDir === newDir) return // 同目录改名，相对关系没变
      let txt
      try { txt = fs.readFileSync(absNew, 'utf8') } catch (e) { return }
      const next = rewriteRelInText(txt, oldDir, newDir)
      if (next !== txt) {
        const tmp = absNew + '.tmp-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8)
        fs.writeFileSync(tmp, next, 'utf8')
        fs.renameSync(tmp, absNew)
      }
    } catch (e) {}
  }

  /** 目录整体移位：逐篇按新旧路径重写 */
  function rewriteDirImagePaths(oldDirAbs, newDirAbs) {
    const walk = (dirNew, dirOld) => {
      let list = []
      try { list = fs.readdirSync(dirNew, { withFileTypes: true }) } catch (e) { return }
      for (const ent of list) {
        const nAbs = path.join(dirNew, ent.name)
        const oAbs = path.join(dirOld, ent.name)
        if (ent.isDirectory()) { walk(nAbs, oAbs); continue }
        if (!/\.(md|markdown)$/i.test(ent.name)) continue
        rewriteImagePaths(oAbs, nAbs)
      }
    }
    walk(newDirAbs, oldDirAbs)
  }

  ;[META, REPO_META, ASSETS].forEach(mk)

  const rj = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return d } }
  const wj = (p, v) => { mk(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(v, null, 1), 'utf8') }

  // ---------------- Slate <-> Markdown ----------------
  // <br> 与软换行互转：读 md 时 br 标签变换行符，写回时换行符变 br 标签
  const brToNl = (v) => String(v == null ? '' : v).replace(/<br\s*\/?>/gi, String.fromCharCode(10))
  const nlToBr = (v) => String(v == null ? '' : v).split(String.fromCharCode(10)).join('<br/>')

  const inlineText = (n) => {
    if (!n) return ''
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.children)) return n.children.map(inlineText).join(String.fromCharCode(10))
    return ''
  }

  function nodeToMd(n) {
    if (!n) return ''
    const t = n.type || 'paragraph'
    const kids = Array.isArray(n.children) ? n.children : []

    if (t === 'paragraph' || !t) {
      // 空段落代表一个 <br/>；非空段落原样输出，段落内的软换行保持为换行符
      // （不能转成 <br/>，否则会把普通的连续多行文本全部硬化为 <br/>）
      const txt = inlineText(n)
      return txt.trim() ? txt : ''
    }

    if (t === 'codeblock' || t === 'code-block' || t === 'code') {
      const lang = n.lang || n.language || ''
      const fromKids = kids.map((k) => inlineText(k)).join('')
      const body = fromKids !== '' ? fromKids : (typeof n.content === 'string' ? n.content : '')
      return '```' + lang + '\n' + body + '\n```'
    }

    if (t === 'table') {
      const rows = kids.filter((k) => /row/i.test(k.type || ''))
      const cells = (r) => (r.children || []).map((c) => nlToBr(inlineText(c)).replace(/\|/g, '\|').trim())
      if (!rows.length) return ''
      const head = cells(rows[0])
      const aligns = Array.isArray(n.align) ? n.align : []
      const sepAt = (idx) => {
        const a = aligns[idx] || ''
        if (a === 'center') return ':---:'
        if (a === 'left') return ':---'
        if (a === 'right') return '---:'
        return '---'
      }
      const out = [
        '| ' + head.join(' | ') + ' |',
        '| ' + head.map((_, idx) => sepAt(idx)).join(' | ') + ' |',
      ]
      rows.slice(1).forEach((r) => out.push('| ' + cells(r).join(' | ') + ' |'))
      return out.join('\n')
    }

    if (t === 'bulleted-list' || t === 'numbered-list' || t === 'unordered-list' || t === 'list') {
      const ordered = t === 'numbered-list'
      const LN = String.fromCharCode(10)
      const out = []
      let num = 0
      kids.forEach((k) => {
        // 子列表（嵌套）：整体缩进两格，接在上一项后面
        if (isListLike(k)) {
          const sub = nodeToMd(k)
          if (sub) sub.split(LN).forEach((l) => out.push('  ' + l))
          return
        }
        num++
        const mark = k.checked === true ? '- [x] ' : k.checked === false ? '- [ ] ' : ordered ? num + '. ' : '- '
        // 一项的 children 里可能既有文本、也有挂在它下面的子列表，
        // 不能用 inlineText（它会把子列表的文字一起揉进这一行）
        const parts = []
        ;(k.children || []).forEach((c) => {
          if (isListLike(c)) {
            const sub = nodeToMd(c)
            if (sub) sub.split(LN).forEach((l) => parts.push('  ' + l))
          } else if (c && typeof c.text === 'string') {
            parts.push(c.text.split(LN).join(' '))
          }
        })
        if (!parts.length) {
          out.push(mark.trimEnd())
          return
        }
        const [first, ...rest] = parts
        out.push(mark + first + (rest.length ? LN + rest.join(LN) : ''))
      })
      return out.join(LN)
    }

    if (t === 'list-item' || t === 'list_item') {
      const mark = n.checked === true ? '- [x] ' : n.checked === false ? '- [ ] ' : '- '
      const LN = String.fromCharCode(10)
      const parts = []
      ;(n.children || []).forEach((c) => {
        if (isListLike(c)) {
          // 子列表：整体缩进两格，接在这一项下面
          const sub = nodeToMd(c)
          if (sub) sub.split(LN).forEach((l) => parts.push('  ' + l))
        } else if (c && typeof c.text === 'string') {
          parts.push(c.text.split(LN).join(' '))
        }
      })
      // 第一段接在列表标记后面，后面的嵌套行单独成行
      if (!parts.length) return mark.trimEnd()
      const [first, ...rest] = parts
      return mark + first + (rest.length ? LN + rest.join(LN) : '')
    }

    if (t === 'blockquote') {
      const body = kids.map((k) => inlineText(k)).join('')
      return body.split(String.fromCharCode(10)).map((l) => '> ' + l).join(String.fromCharCode(10))
    }

    if (t === 'heading' || /^h[1-6]$/.test(t)) {
      const lvl = parseInt(n.level || t.replace(/\D/g, '') || 1, 10)
      return '#'.repeat(Math.min(6, Math.max(1, lvl))) + ' ' + inlineText(n).split(String.fromCharCode(10)).join(' ')
    }

    if (t === 'image' || t === 'img') {
      const url = n.url || n.src || (n._attachments && n._attachments[0] ? 'attachment:' + (n._attachments[0].digest || '') : '')
      if (!url) return ''
      const alt = typeof n.alt === 'string' ? n.alt : inlineText(n) || ''
      return '![' + alt + '](' + url + ')'
    }

    if (t === 'hr' || t === 'divider') return '---'

    if (t === 'math' || t === 'formula') {
      const v = typeof n.value === 'string' ? n.value : (typeof n.content === 'string' ? n.content : inlineText(n))
      return '$$' + String.fromCharCode(10) + v + String.fromCharCode(10) + '$$'
    }

    if (kids.length) return kids.map(nodeToMd).filter((s) => s !== '').join('\n')
    return ''
  }

  const nodesToMd = (nodes) => {
    // 标准 Markdown（Obsidian 口径）：段落之间空一行，段内不换行。
    // 这样在 Obsidian / Typora / GitHub 里打开都是正确分段；
    // 空段落不输出——Markdown 里多个空行没有语义，压缩成一个分隔即可，
    // 因此反复保存不会累积空白（git 里只有真正改动的内容行）。
    const LF = String.fromCharCode(10)
    const parts = (nodes || [])
      .map(nodeToMd)
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    return parts.join(LF + LF)
  }

  function isListLike (n) {
    const t = n && n.type
    return t === 'bulleted-list' || t === 'numbered-list' || t === 'unordered-list' || t === 'list'
  }

  function mdToNodes(md) {

    const lines = String(md || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    const nodes = []
    let i = 0
    let pendingBlank = 0
    while (i < lines.length) {
      const line = lines[i]

      // 代码块
      const fence = line.match(/^\s*```(\S*)\s*$/)
      if (fence) {
        const lang = fence[1] || ''
        const body = []
        i++
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++ }
        i++
        nodes.push({ type: 'codeblock', key: 'cb' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36), lang: lang || '', content: body.join('\n'), children: [{ text: '' }] })
        continue
      }

      // 分割线（--- / *** / ___ 独立成行）
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        nodes.push({ type: 'hr', key: 'hr' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36), children: [{ text: '' }] })
        i++
        continue
      }

      // 表格（首行 |...|，次行是 |---|---| 分隔）
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        const raw = []
        while (i < lines.length && /^\s*\|/.test(lines[i])) { raw.push(lines[i]); i++ }
        const cells = (r) =>
          r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
        const head = cells(raw[0])
        const body = raw.slice(2).map(cells)
        // 分隔行决定每列对齐，丢了这个信息往返就会把 :-- / :-: / --: 全变成 ---
        const align = cells(raw[1]).map((c) => {
          const t = c.trim()
          const left = t.startsWith(':')
          const right = t.endsWith(':')
          if (left && right) return 'center'
          if (left) return 'left'
          if (right) return 'right'
          return ''
        })
        nodes.push({
          type: 'table',
          align,
          children: [head, ...body].map((cs) => ({
            type: 'table-row',
            children: cs.map((c) => ({ type: 'table-cell', children: [{ text: brToNl(c) }] })),
          })),
        })
        continue
      }

      // 空行
      if (!line.trim()) { pendingBlank++; i++; continue }
      // <br/> 独立成行：按空行处理，笔记里不保留 br 标签
      if (/^[ \t]*<br[ \t]*\/?>[ \t]*$/i.test(line)) { pendingBlank++; i++; continue }
      // 连续空行里，第一个用于分隔段落，剩下的还原成空段落（保证往返一致）
      // 标准 Markdown：空行是段落分隔符，不产生空段落（连续多个空行效果等同）。
      pendingBlank = 0

      // 图片（独占一行）：![alt](url)
      const imgLine = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/)
      if (imgLine) {
        nodes.push({ type: 'image', url: imgLine[2], alt: imgLine[1], children: [{ text: '' }] })
        i++
        continue
      }

      // 公式块（独占两行的 $$）：$$ 开头到 $$ 结尾
      if (/^\s*\$\$\s*$/.test(line)) {
        const body = []
        i++
        while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) { body.push(lines[i]); i++ }
        i++
        nodes.push({ type: 'math', value: body.join(String.fromCharCode(10)), children: [{ text: '' }] })
        continue
      }

      // 列表
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line)
        // 按缩进还原嵌套：同一层归一组，缩进更深的挂到上一项的子列表里
        const flat = []
        let baseIndent = -1
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+)\.?\s+(.*)$/)
          if (!m) { i++; continue }
          const indent = m[1].replace(/\t/g, '  ').length
          if (baseIndent < 0) baseIndent = indent
          const depth = Math.max(0, Math.round((indent - baseIndent) / 2))
          const body = m[3]
          const checked = /^\[( |x|X)\]\s/.test(body) ? /^\[[xX]\]/.test(body) : undefined
          const text = body.replace(/^\[( |x|X)\]\s+/, '')
          flat.push({ depth, text, checked })
          i++
        }
        // 用栈把扁平项组装成嵌套
        const root = { type: ordered ? 'numbered-list' : 'bulleted-list', children: [] }
        const stack = [{ depth: 0, list: root }]
        flat.forEach((f) => {
          while (stack.length > 1 && f.depth < stack[stack.length - 1].depth) stack.pop()
          const top = stack[stack.length - 1]
          if (f.depth > top.depth) {
            // 更深 → 挂到上一项下面
            const prev = top.list.children[top.list.children.length - 1]
            if (prev) {
              const sub = { type: ordered ? 'numbered-list' : 'bulleted-list', children: [] }
              prev.children.push(sub)
              stack.push({ depth: f.depth, list: sub })
            }
          }
          const item = { type: 'list-item', children: [{ text: brToNl(f.text) }] }
          if (f.checked !== undefined) item.checked = f.checked
          stack[stack.length - 1].list.children.push(item)
        })
        nodes.push(root)
        continue
      }

      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/)
      if (h) {
        nodes.push({ type: 'heading', level: h[1].length, children: [{ text: brToNl(h[2]) }] })
        i++
        continue
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        const body = []
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
        nodes.push({ type: 'blockquote', children: [{ text: brToNl(body.join('\n')) }] })
        continue
      }

      // 普通段落：一行一个段落，不再把连续非空行合并。
      // 合并会让多行变成一个 Slate 段落（行与行之间是软换行），
      // 编辑器里看起来有好几行其实是一个 <p>：光标进去删不掉整行，
      // 空行也没地方安放，最后变成"源码有、编辑区没有"。
      nodes.push({ type: 'paragraph', children: [{ text: brToNl(line) }] })
      i++
    }

    // 末尾空行不生成空段落（标准 Markdown）；但编辑器需要一个空段落承接光标，
    // 序列化时会把它连同其它空段落一起过滤，不会写进文件。
    nodes.push({ type: 'paragraph', children: [{ text: '' }] })
    return nodes
  }

  // ---------------- 扫描工作区 ----------------
  // 认 .md 与 .markdown 两种后缀；标题一律去掉后缀，否则 .markdown 文件的
  // 标题会带着 ".markdown" 尾巴，改名判断也会误判。
  const MD_EXT = /\.(md|markdown)$/i
  const stripExt = (rel) => path.basename(String(rel)).replace(MD_EXT, '')
  // 遍历上限：不忽略任何目录（磁盘上有什么就显示什么），但目录/笔记数量
  // 超过阈值时停止深挖并标记，由界面提示「目录过多」，避免选到工程目录时
  // 每次扫描都卡住整个插件。
  const MAX_DIRS = 5000
  const MAX_FILES = 20000
  let LAST_TRUNCATED = false

  function walk(dir, rel, acc) {
    if (acc.dirs.length > MAX_DIRS || acc.files.length > MAX_FILES) { acc.truncated = true; return }
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue // 隐藏目录/文件（.git .obsidian .attachments 等）
      if (e.name === 'assets') continue // 图片附件目录，图片通过 assets/xxx.png 直接引用，不进笔记树
      const r = rel ? rel + '/' + e.name : e.name
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        acc.dirs.push(r)
        walk(full, r, acc)
      } else if (MD_EXT.test(e.name)) {
        acc.files.push({ rel: r, full })
      }
    }
  }

  let CACHE = null
  let CACHE_AT = 0
  const TTL = 800 // ms，避免每次交互全盘重扫

  function dirOf(rel) {
    const d = path.dirname(rel)
    return d === '.' ? '' : d.replace(/\\/g, '/')
  }

  function buildTree(dirList) {
    // 生成 {dir: children[]}，children 里子目录内联（自包含，UI 好渲染）
    const byParent = new Map()
    for (const d of dirList) {
      const p = dirOf(d) === '' ? '__root__' : dirOf(d)
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p).push(d)
    }
    const inline = (d) => {
      const kids = []
      const notesOf = NOTES_BY_DIR.get(d) || []
      for (const rel of notesOf) {
        const nd = NOTES_DOCS.get('note/' + rel)
        kids.push(nd ? { id: 'note/' + rel, data: { id: 'note/' + rel, title: nd.title, plain: nd.plain } } : { id: 'note/' + rel })
      }
      for (const sub of (byParent.get(d) || [])) {
            // id 用裸名（T3），必须和 folder doc 的 id 一致：bundle 的 _R() 会拿 folder id
            // 去 children 里认重复项，两边格式不同就会既保留又重挂，反复展开折叠后节点重叠。
            kids.push({ id: sub.split('/').pop(), name: sub.split('/').pop(), children: inline(sub) })
          }
      return sortKids(kids, TREE_ORDER[d])
    }
    return inline
  }

  let NOTES_BY_DIR = new Map()
  let NOTES_DOCS = new Map()

  function scan() {
    TREE_ORDER = readTreeOrder()
    const now = Date.now()
    if (CACHE && now - CACHE_AT < TTL) return CACHE
    const acc = { dirs: [], files: [], truncated: false }
    walk(WS, '', acc)
    LAST_TRUNCATED = !!acc.truncated

    NOTES_BY_DIR = new Map()
    NOTES_DOCS = new Map()
    const docs = new Map()

    for (const f of acc.files) {
      let st
      try { st = fs.statSync(f.full) } catch (e) { continue }
      const d = dirOf(f.rel)
      if (!NOTES_BY_DIR.has(d)) NOTES_BY_DIR.set(d, [])
      NOTES_BY_DIR.get(d).push(f.rel)

      const catId = 'category/' + d
      // 尽量复用缓存里已解析的 data（mtime 没变就不重读）
      const old = CACHE && CACHE.get ? CACHE.get('note/' + f.rel) : null
      let data
      let raw = ''
      if (old && old._rev === String(st.mtimeMs)) {
        data = old.data
        raw = old.plain || ''
      } else {
        try {
          raw = fs.readFileSync(f.full, 'utf8')
          data = mdToNodes(raw)
        } catch (e) {
          raw = ''
          data = [{ type: 'paragraph', children: [{ text: '' }] }]
        }
      }
      const roSet = (function () { try { return readNoteState().readonlyHashes } catch (e) { return new Set() } })()
      const _doc = {
        _id: 'note/' + f.rel,
        id: 'note/' + f.rel,
        _rev: String(st.mtimeMs),
        title: stripExt(f.rel),
        data,
        createAt: Math.round(st.birthtimeMs || st.mtimeMs),
        updateAt: Math.round(st.mtimeMs),
        categoryId: catId,
        plain: String(raw || '').slice(0, 8000),
      }
      if (roSet.has(idHash('note/' + f.rel))) _doc.readonly = true
      docs.set('note/' + f.rel, _doc)
      NOTES_DOCS.set('note/' + f.rel, docs.get('note/' + f.rel))
    }

    const inline = buildTree(acc.dirs)
    // 每个目录一个 folder doc
    for (const d of acc.dirs) {
      docs.set('folder/' + d, {
        _id: 'folder/' + d,
        // id 用裸名，和 children 里子目录项的 id 保持一致（bundle 靠它去重、重挂）
        id: d.split('/').pop(),
        name: d.split('/').pop(),
        children: inline(d),
      })
    }
    // 根目录（散落笔记 + 顶层目录）作为一个虚拟 folder，供 rootsort 用
    const rootChildren = []
    for (const rel of (NOTES_BY_DIR.get('') || [])) rootChildren.push({ id: 'note/' + rel })
    for (const d of acc.dirs) {
      if (dirOf(d) === '') rootChildren.push({ id: d, name: d.split('/').pop(), children: inline(d) })
    }
    docs.set('__root__', { _id: '__root__', id: '__root__', name: '', children: rootChildren })

    CACHE = docs
    CACHE_AT = now
    return docs
  }

  function invalidate() { CACHE = null; CACHE_AT = 0 }

  // ---- 监听工作区：外部新建/改名/删除文件时通知上层刷新 ----
  let fsWatcher = null
  const fsListeners = []
  let pendingNotify = null
  function notifyFsChange(name) {
    if (pendingNotify) return
    pendingNotify = setTimeout(function () {
      pendingNotify = null
      for (let i = 0; i < fsListeners.length; i++) {
        try { fsListeners[i](name) } catch (e) {}
      }
    }, 350)
    if (pendingNotify.unref) pendingNotify.unref()
  }
  function startWatch() {
    if (fsWatcher) return
    try {
      fsWatcher = fs.watch(WS, { recursive: true }, function (evt, filename) {
        if (!filename) return
        const rel = String(filename).split(path.sep).join('/')
        // 忽略点开头（.git / .attachments）与元数据
        if (rel.startsWith('.') || rel.indexOf('/.') >= 0) return
        invalidate()
        notifyFsChange(rel)
      })
      if (fsWatcher.on) fsWatcher.on('error', function () {})
      if (fsWatcher.unref) fsWatcher.unref()
    } catch (e) {
      try { console.log('[znotes] watch 启动失败', e && e.message) } catch (e2) {}
    }
  }

  // ---------------- 笔记附加状态（只读等，不进正文，避免污染 md） ----------------
  // 存成 .cmark/locked.txt：一行一个已锁定笔记 id 的哈希，文件为空/没有该行就是未锁定。
  // 这里只回答"这个 id 是否锁定"，读取时按 id 现算哈希比对即可，
  // 不需要保留可读路径，也不怕文件名里出现特殊字符。
  const LOCKEDTXT = path.join(REPO_META, 'locked.txt')
  // 设为全局搜索（ZTools feature）的笔记也记在这里，同样只存哈希
  const NEARTXT = path.join(REPO_META, 'near.txt')
  const idHash = function (id) {
    return crypto.createHash('md5').update('cmark-lock:' + String(id)).digest('hex').slice(0, 12)
  }
  function readHashFile (file) {
    const set = new Set()
    try {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
        const t = line.trim()
        if (t && t.charAt(0) !== '#') set.add(t)
      })
    } catch (e) {}
    return set
  }
  function writeHashFile (file, set) {
    try {
      mk(REPO_META)
      const arr = Array.from(set || []).filter(Boolean).sort()
      const next = arr.length ? arr.join('\n') + '\n' : ''
      let prev = ''
      try { prev = fs.readFileSync(file, 'utf8') } catch (e) {}
      // 内容没变不写盘，避免插件启动就刷新 mtime、把工作区标成"已修改"
      if (prev !== next) fs.writeFileSync(file, next, 'utf8')
    } catch (e) {}
  }
  function readNoteState () {
    return {
      readonlyHashes: readHashFile(LOCKEDTXT),
      nearHashes: readHashFile(NEARTXT)
    }
  }
  function setNoteFlag (id, flag, on) {
    if (flag !== 'readonly' && flag !== 'near') return
    const st = readNoteState()
    const h = idHash(id)
    const set = flag === 'readonly' ? st.readonlyHashes : st.nearHashes
    const file = flag === 'readonly' ? LOCKEDTXT : NEARTXT
    const has = set.has(h)
    if (!!on === has) return           // 状态没变就不写盘
    if (on) set.add(h)
    else set.delete(h)
    writeHashFile(file, set)
  }

  // ---------------- 上手引导状态 ----------------
  // 单独一个文件，不塞进 ui.json（那个结构被 bundle 依赖，字段缺失会让初始化中断）
  const ONBOARDJSON = path.join(META, 'onboard.json')
  function onboardGet () {
    try { return JSON.parse(fs.readFileSync(ONBOARDJSON, 'utf8')) || {} } catch (e) { return {} }
  }
  function onboardSet (o) {
    try { mk(META); fs.writeFileSync(ONBOARDJSON, JSON.stringify(o || {}), 'utf8') } catch (e) {}
    return o || {}
  }

  // ---------------- 目录树排序（拖拽结果持久化） ----------------
  // 磁盘只决定"有哪些节点"，人工拖拽决定的"顺序"记在 .cmark/order.txt，
  // 每次扫描按它重排，于是重开插件顺序不变。新出现的节点不在表里，排到末尾。
  // 顺序存成纯文本 .cmark/order.txt，一行一项，段头写目录：
  //
  //   # 根目录
  //   IWAN
  //   RN
  //
  //   # IWAN
  //   Cloudflare.md
  //   IKEX
  //
  // 行 = 条目的 id（笔记 note/…、目录裸名），和内存里排序用的键完全一致，
  // 读写两端都不做转换。段头仍保留：每个目录各有自己的内部顺序，必须分组。
  // 排序的改动没人会去读 diff，所以这里优先"少转换、少出错"，不追求可读性。
  const ORDERTXT = path.join(REPO_META, 'order.txt')
  function readTreeOrder () {
    const out = {}
    try {
      const raw = fs.readFileSync(ORDERTXT, 'utf8')
      let cur = ''
      raw.split(/\r?\n/).forEach(function (line) {
        const t = line.trim()
        if (!t) return
        if (t.charAt(0) === '#') {
          const name = t.slice(1).trim()
          cur = (name === '根目录' || name === '根' || name === '') ? '' : name.replace(/\/+$/, '')
          if (!out[cur]) out[cur] = []
          return
        }
        if (!out[cur]) out[cur] = []
        out[cur].push(t)
      })
    } catch (e) { return {} }
    return out
  }

  function writeTreeOrder (o) {
    try {
      mk(REPO_META)
      const keys = Object.keys(o || {}).filter(function (k) {
        return Array.isArray(o[k]) && o[k].length
      })
      // 根目录置顶、其余按路径字典序：同样的顺序永远生成同样的文件，diff 不会因抖动变大
      keys.sort(function (a, b) {
        if (a === b) return 0
        if (a === '') return -1
        if (b === '') return 1
        return a < b ? -1 : 1
      })
      const lines = []
      keys.forEach(function (k, i) {
        if (i) lines.push('')
        lines.push('# ' + (k === '' ? '根目录' : k))
        o[k].forEach(function (id) {
          // 直接写 id：匹配就是按 id 做的，没必要再裁成名字、读的时候又拼回去
          lines.push(String(id))
        })
      })
      const next = lines.join('\n') + '\n'
      let prev = ''
      try { prev = fs.readFileSync(ORDERTXT, 'utf8') } catch (e) {}
      // 内容没变就不写：否则每次扫描都刷新 mtime，git 工作区会一直挂着"已修改"
      if (prev !== next) fs.writeFileSync(ORDERTXT, next, 'utf8')
    } catch (e) {}
  }

  // 树与磁盘对账：以「用户拖拽后的树」为准，修正磁盘上的实际位置。
  // 解决两类残留：
  //   1) 拖到根级/别的目录后，原目录里留下空壳（bundle 只改树不动磁盘时会这样）
  //   2) 目标位置被先建了一个空目录，挡住真正的移动
  function reconcileTree (tree) {
    try {
      const want = new Set()
      const visit = (list, prefix) => {
        if (!Array.isArray(list)) return
        list.forEach((n) => {
          if (!n || !n.id) return
          const sid = String(n.id)
          if (sid.indexOf('note/') === 0) return
          const leaf = sid.split('/').pop()
          if (!leaf) return
          const full = prefix ? prefix + '/' + leaf : leaf
          want.add(full)
          if (n.children && n.children.length) visit(n.children, full)
        })
      }
      visit(tree, '')
      if (!want.size) return false

      const acc = { dirs: [], files: [], truncated: false }
      walk(WS, '', acc)
      let changed = false

      // A) 该在的位置还没有 → 把别处的同名目录挪过来（优先层级浅的）
      //    目标若被一个空壳占着（拖拽时先建的空目录），先清掉它再挪。
      want.forEach(function (toRel) {
        const toAbs = path.join(WS, toRel)
        const leaf = toRel.split('/').pop()
        const cands = acc.dirs.filter(function (d) {
          return d.split('/').pop() === leaf && d !== toRel
        })
        if (!cands.length) return
        cands.sort(function (a, b) { return a.split('/').length - b.split('/').length })
        if (fs.existsSync(toAbs)) {
          try {
            if (fs.readdirSync(toAbs).length === 0) fs.rmdirSync(toAbs)
            else return                       // 已有真实内容，不动
          } catch (e) { return }
        }
        for (let i = 0; i < cands.length; i++) {
          const fromAbs = path.join(WS, cands[i])
          try {
            if (fs.existsSync(fromAbs) && !fs.existsSync(toAbs)) {
              mk(path.dirname(toAbs))
              fs.renameSync(fromAbs, toAbs)
              changed = true
              break
            }
          } catch (e) {}
        }
      })

      // B) 磁盘上多出来的空目录（树里已经不在了）→ 清掉残留空壳。
      //    只删空目录：非空的一律不动，避免误伤。
      acc.dirs.forEach(function (d) {
        if (want.has(d)) return
        const abs = path.join(WS, d)
        try {
          if (fs.existsSync(abs) && fs.readdirSync(abs).length === 0) {
            fs.rmdirSync(abs)
            changed = true
          }
        } catch (e) {}
      })

      if (changed) { invalidate(); notifyFsChange('') }
      return changed
    } catch (e) { return false }
  }

  function sortKids (kids, seq) {
    if (!seq || !seq.length || !kids.length) return kids
    const idx = new Map()
    seq.forEach((id, i) => idx.set(id, i))
    return kids.slice().sort((a, b) => {
      const ia = idx.has(a.id) ? idx.get(a.id) : 1e9
      const ib = idx.has(b.id) ? idx.get(b.id) : 1e9
      return ia === ib ? 0 : ia - ib
    })
  }
  function saveTreeOrder (tree) {
    // key 与元素 id 统一用「相对仓库根的完整路径」（目录 T1/T3、笔记 note/a/b.md），
    // 因为 buildTree 重建时用的就是完整路径，两边格式不一致会永远匹配不上，
    // 表现就是拖进去的东西固定排在最下面。
    // 另外：bundle 移动目录时不会更新子笔记的 id，这里按文件名把它们对齐到磁盘实际路径，
    // 否则目录一移，里面笔记的顺序记录就全部失效。
    const out = {}
    const acc = { dirs: [], files: [], truncated: false }
    walk(WS, '', acc)
    const byBase = new Map()
    for (let fi = 0; fi < acc.files.length; fi++) {
      const b = path.basename(acc.files[fi].rel)
      if (!byBase.has(b)) byBase.set(b, [])
      byBase.get(b).push(acc.files[fi].rel)
    }
    const normNote = (sid) => {
      const rel = sid.slice('note/'.length)
      try { if (fs.existsSync(path.join(WS, rel))) return sid } catch (e) {}
      const cands = byBase.get(path.basename(rel)) || []
      return cands.length === 1 ? 'note/' + cands[0] : sid
    }
    const walk2 = (list, key, prefix) => {
      if (!Array.isArray(list) || !list.length) return
      out[key] = list.map((n) => {
        if (!n || !n.id) return null
        const sid = String(n.id)
        if (sid.indexOf('note/') === 0) return normNote(sid)
        const leaf = sid.split('/').pop()
        // 目录存裸名，和 folder id / buildTree 生成的 children id 保持一致
        return leaf || null
      }).filter(Boolean)
      list.forEach((n) => {
        if (!n || !n.children || !n.children.length) return
        const sid = String(n.id || '')
        if (!sid) return
        const leaf = sid.split('/').pop()
        if (!leaf) return
        const full = prefix ? prefix + '/' + leaf : leaf
        walk2(n.children, full, full)
      })
    }
    walk2(tree, '', '')
    writeTreeOrder(out)
    return out
  }
  let TREE_ORDER = {}

  // ---------------- ui.json / storage.json ----------------
  // ui.json 里存 setting / rootsort / lastNote。
  // 新目录首次使用时该文件不存在，必须就地补齐默认值并落盘：
  // bundle 的 initData 依赖这些 doc 存在，缺文件会导致初始化中断（界面卡在「读取中」）。
  const ui = () => {
    let u = rj(UIJSON, null)
    let dirty = false
    if (!u || typeof u !== 'object') { u = {}; dirty = true }
    if (!u.setting) { u.setting = { hideToolbar: false, bodyFontSize: 14 }; dirty = true }
    if (!Array.isArray(u.rootsort)) { u.rootsort = []; dirty = true }
    if (!u.lastNote || typeof u.lastNote !== 'object') { u.lastNote = {}; dirty = true }
    if (dirty) { try { wj(UIJSON, u) } catch (e) {} }
    return u
  }
  const setUi = (patch) => { const u = ui(); Object.assign(u, patch); wj(UIJSON, u) }

  // ---------------- __NDB ----------------
  const __NDB = {
    get(id) {
      if (!id) return null
      if (id === 'setting') {
        const u = ui()
        return u.setting ? { _id: 'setting', ...u.setting } : null
      }
      if (id === 'rootsort') return ui().rootsort || null
      if (id.startsWith('last_work_note/')) {
        const k = id.slice('last_work_note/'.length)
        const o = (ui().lastNote || {})[k]
        return o ? { _id: id, note: o } : null
      }
      if (id.startsWith('attachment/')) {
        // 附件按 digest 找实际文件
        const digest = id.slice('attachment/'.length)
        try {
          const f = fs.readdirSync(ASSETS).find((x) => x.startsWith(digest))
          if (f) return { _id: id, digest }
        } catch (e) {}
        return null
      }
      const docs = scan()
      return docs.get(id) || null
    },

    put(doc) {
      if (!doc || !doc._id) return { error: true, message: 'bad doc' }
      let id = doc._id

      if (id === 'setting') {
        const { _id, _rev, ...rest } = doc
        setUi({ setting: rest })
        return { ok: true, id, rev: String(Date.now()) }
      }
      if (id === 'rootsort') {
        setUi({ rootsort: doc.data !== undefined ? doc.data : doc })
        return { ok: true, id, rev: String(Date.now()) }
      }
      if (id.startsWith('last_work_note/')) {
        const k = id.slice('last_work_note/'.length)
        const u = ui()
        const m = Object.assign({}, u.lastNote || {})
        m[k] = doc.note !== undefined ? doc.note : doc
        setUi({ lastNote: m })
        return { ok: true, id, rev: String(Date.now()) }
      }

      if (id.startsWith('note/')) {
        const __oldId = id          // 改名后 id 会变，用于迁移附加状态
        // 移动前后 md 所在目录：写文件时要用它重算图片相对路径，
        // 否则 doc.data 序列化出的内容会带着旧位置的 ../ 层数，图全断
        let pathMovedFrom = null
        let rel = id.slice('note/'.length)
        const safeTitle = String(doc.title || '').replace(/[\/:*?"<>|]/g, '').trim()
        if (!MD_EXT.test(rel)) {
          // 新建笔记：上层用 note/<时间戳> 作临时 id，落盘要用标题作文件名。
          // 目录优先取 _id 里的前缀，其次取 doc.categoryId（在文件夹里新建时
          // bundle 只设置 categoryId，_id 仍是纯时间戳）
          let dirRel = dirOf(rel)
          if (!dirRel && doc.categoryId) {
            const cid = String(doc.categoryId)
            if (cid.indexOf('category/') === 0) dirRel = cid.slice('category/'.length).split('/').join('/')
          }
          const leaf = safeTitle || rel.split('/').pop()
          rel = (dirRel ? dirRel + '/' : '') + leaf + '.md'
          id = 'note/' + rel
          doc._id = id
        } else if (safeTitle && safeTitle !== stripExt(rel)) {
          // 改名：标题与磁盘文件名不一致时，把文件重命名到新标题（同目录内）。
          // 后缀沿用原文件的（.md / .markdown），不要因为改名就换掉用户的后缀。
          const dirRel = dirOf(rel)
          const ext = path.extname(rel) || '.md'
          const newRel = (dirRel ? dirRel + '/' : '') + safeTitle + ext
          const oldAbs = path.join(WS, rel)
          const newAbs = path.join(WS, newRel)
          try {
            if (rel !== newRel && fs.existsSync(oldAbs) && !fs.existsSync(newAbs)) {
              fs.renameSync(oldAbs, newAbs)
              rewriteImagePaths(oldAbs, newAbs)
              pathMovedFrom = path.dirname(oldAbs)
              rel = newRel
              id = 'note/' + rel
              doc._id = id
            }
          } catch (e) {}
        }
        // 拖拽移动：categoryId 指向的目录与文件当前所在目录不一致时，移动文件
        {
          let wantDir = ''
          if (doc.categoryId && String(doc.categoryId).indexOf('category/') === 0) {
            wantDir = String(doc.categoryId).slice('category/'.length)
          }
          const curDir = dirOf(rel)
          if (wantDir !== curDir) {
            const base = path.basename(rel)
            const newRel = (wantDir ? wantDir + '/' : '') + base
            const oldAbs = path.join(WS, rel)
            const newAbs = path.join(WS, newRel)
            try {
              if (fs.existsSync(oldAbs) && !fs.existsSync(newAbs)) {
                mk(path.dirname(newAbs))
                fs.renameSync(oldAbs, newAbs)
                rewriteImagePaths(oldAbs, newAbs)
                pathMovedFrom = path.dirname(oldAbs)
                rel = newRel
                id = 'note/' + rel
                doc._id = id
              }
            } catch (e) {}
          }
        }

        // 只读等附加状态：与正文无关，必须在“内容相同就早退”之前处理，
        // 否则切换只读（内容没变）不会被持久化
        try {
          setNoteFlag(__oldId, 'readonly', false)
          if (doc.readonly) setNoteFlag(id, 'readonly', true)
        } catch (e) {}

        const target = path.join(WS, rel)
        mk(path.dirname(target))
        let md = nodesToMd(doc.data || [])
        // 位置变过：按新目录重算一遍相对路径（rename 时改过的内容会被这里覆盖，所以必须在这里也做）
        if (pathMovedFrom && pathMovedFrom !== path.dirname(target)) {
          md = rewriteRelInText(md, pathMovedFrom, path.dirname(target))
        }
        // 内容与磁盘一致时不写盘：避免打开笔记就改写文件
        let _prev = null
        try { _prev = fs.readFileSync(target, 'utf8') } catch (e) {}
        // 保持原文件的末尾换行习惯：原来结尾有换行就补一个，没有就不加。
        // 否则改一个字会连带改变文件尾部，git diff 里多出一条空行改动。
        if (typeof _prev === 'string' && _prev.endsWith('\n') && !md.endsWith('\n')) md += '\n'
        if (typeof _prev === 'string' && _prev.replace(/\r\n/g, '\n').replace(/\s+$/, '') === md.replace(/\s+$/, '')) {
          return { ok: true, id, rev: String(Date.now()) }
        }
        fs.writeFileSync(target, md, 'utf8')
        // 通知 git 服务：用户产生了编辑，用于"停止编辑后自动同步"
        try { if (window.__znotesGit && window.__znotesGit.noteEditActivity) window.__znotesGit.noteEditActivity() } catch (e) {}
        invalidate()
        try {
          const st = fs.statSync(target)
          return { ok: true, id, rev: String(st.mtimeMs) }
        } catch (e) {
          return { ok: true, id, rev: String(Date.now()) }
        }
      }

      if (id.startsWith('folder/')) {
        // 目录：新建要真的建文件夹，改名要真的 rename
        const rel = id.slice('folder/'.length)
        const name = doc.name
        const parent = dirOf(rel)
        const abs = path.join(WS, rel)
        // 1) 新建目录（磁盘上还没有就创建）
        if (!fs.existsSync(abs)) {
          try { fs.mkdirSync(abs, { recursive: true }) } catch (e) {}
        }
        // 2) 改名（name 与当前目录名不同）
        if (name && name !== rel.split('/').pop()) {
          const to = path.join(WS, parent, name)
          try { if (fs.existsSync(abs) && !fs.existsSync(to)) fs.renameSync(abs, to) } catch (e) {}
        }
        // 2.5) 移出：本次 put 里被移除的旧 children，若文件还在本目录，移回根目录
        {
          invalidate()                                   // 丢弃 800ms 扫描缓存，拿到最新 children
          const prev = api.get ? api.get(id) : null
          const prevKids = (prev && Array.isArray(prev.children)) ? prev.children : []
          const nowIds = (Array.isArray(doc.children) ? doc.children : []).map(function (k) { return k && k.id })
          for (let pi = 0; pi < prevKids.length; pi++) {
            const pkId = prevKids[pi] && prevKids[pi].id
            if (!pkId || nowIds.indexOf(pkId) >= 0) continue
            if (pkId.indexOf('note/') === 0) {
              // children 里的 id 是相对本目录的（如 note/4456.md），不是仓库相对路径
              const pkRel = pkId.slice('note/'.length)
              const srcAbs = path.join(WS, rel, pkRel)
              const dstAbs = path.join(WS, path.basename(pkRel))
              try {
                if (fs.existsSync(srcAbs) && !fs.existsSync(dstAbs)) fs.renameSync(srcAbs, dstAbs)
              } catch (e) {}
            } else if (pkId.indexOf('folder/') !== 0) {
              // 子目录被拖出本目录：挪回根级。
              // 只在拖拽期间做 —— 启动时 bundle 也会 put 各 folder doc，
              // 那时候不该搬动任何目录。
              if (window.__znotesDragging) {
                const leafOut = String(pkId).split('/').pop()
                const srcAbs = path.join(WS, rel, leafOut)
                const dstAbs = path.join(WS, leafOut)
                try {
                  // 根级已存在同名目录：空的（残留壳）就清掉，非空则不动
                  if (fs.existsSync(dstAbs)) {
                    let emptyOut = false
                    try { emptyOut = fs.readdirSync(dstAbs).length === 0 } catch (e0) { emptyOut = false }
                    if (!emptyOut) throw new Error('target not empty')
                    fs.rmdirSync(dstAbs)
                  }
                  if (fs.existsSync(srcAbs) && !fs.existsSync(dstAbs)) fs.renameSync(srcAbs, dstAbs)
                } catch (e) {}
              }
            }
          }
        }

        // 3) 收拢子笔记：bundle 新建笔记会先 put 笔记（落在根目录），
        //    再把 {id} 塞进父文件夹的 children，最后 put 父文件夹。
        //    目录归属只存在于 children 里，这里把落到根目录的子笔记移进来。
        if (Array.isArray(doc.children)) {
          for (let ci = 0; ci < doc.children.length; ci++) {
            const kid = doc.children[ci]
            const kidId = kid && kid.id
            if (!kidId || kidId.indexOf('note/') !== 0) continue
            const kidRel = kidId.slice('note/'.length)
            const srcAbs = path.join(WS, kidRel)                 // 落在根目录时
            const dstAbs = path.join(WS, rel, path.basename(kidRel))
            try {
              if (fs.existsSync(srcAbs) && !fs.existsSync(dstAbs)) {
                mk(path.dirname(dstAbs))
                fs.renameSync(srcAbs, dstAbs)
              }
            } catch (e) {}
          }
        }

        // 3.5) 收拢子目录：children 里出现的目录项（既不是 note/ 也不是 folder/）
        //      应当位于本目录下。bundle 拖拽只改 children 不动磁盘，这里补齐真正的
        //      目录移动 —— 否则界面把子目录挂进来了，磁盘上它还留在原处，重扫就又回去了。
        //      只在拖拽期间做：启动时 bundle 也会 put 各 folder doc，不能让它搬目录。
        if (Array.isArray(doc.children) && window.__znotesDragging) {
          let scanned = null
          for (let ci = 0; ci < doc.children.length; ci++) {
            const kid = doc.children[ci]
            const kidId = kid && kid.id
            if (!kidId) continue
            const sid = String(kidId)
            if (sid.indexOf('note/') === 0 || sid.indexOf('folder/') === 0) continue
            const leafName = sid.split('/').pop()
            if (!leafName || leafName === '.' || leafName === '..') continue
            const dstAbs = path.join(WS, rel, leafName)
            // 目标位置已存在时：如果它只是个空壳（上次移动留下的空目录），
            // 清掉它再移；有真实内容才跳过，避免覆盖。
            if (fs.existsSync(dstAbs)) {
              let emptyHere = false
              try { emptyHere = fs.readdirSync(dstAbs).length === 0 } catch (e0) { emptyHere = false }
              if (!emptyHere) continue
              try { fs.rmdirSync(dstAbs) } catch (e1) { continue }
            }
            // 在磁盘上找同名目录的当前位置（优先层级浅的，根级最常见）
            if (!scanned) { scanned = { dirs: [], files: [], truncated: false }; walk(WS, '', scanned) }
            const cands = scanned.dirs.filter(function (d) {
              return d.split('/').pop() === leafName && d !== rel && d.indexOf(rel + '/') !== 0
            })
            if (!cands.length) continue
            cands.sort(function (a, b) { return a.split('/').length - b.split('/').length })
            const fromAbs = path.join(WS, cands[0])
            try {
              if (fs.existsSync(fromAbs) && !fs.existsSync(dstAbs)) {
                mk(path.dirname(dstAbs))
                fs.renameSync(fromAbs, dstAbs)
                rewriteDirImagePaths(fromAbs, dstAbs)
              }
            } catch (e) {}
          }
        }

        invalidate()
        try { if (typeof api.onFolderChanged === 'function') api.onFolderChanged() } catch (e) {}
        return { ok: true, id, rev: String(Date.now()) }
      }

      return { ok: true, id, rev: String(Date.now()) }
    },

    remove(doc) {
      const id = typeof doc === 'string' ? doc : doc && doc._id
      if (!id) return { error: true, message: 'bad id' }
      try { setNoteFlag(id, 'readonly', false) } catch (e) {}

      if (id.startsWith('note/')) {
        const rel = id.slice('note/'.length)
        const src = path.join(WS, rel)
        try {
          // 直接删除，不保留副本：误删由 git 恢复（提交过的版本都在历史里）。
          // 注意：新建成、还没被自动同步提交过的笔记删掉就找不回来了。
          if (fs.existsSync(src)) fs.unlinkSync(src)
        } catch (e) {
          return { error: true, message: String(e && e.message) }
        }
        invalidate()
        return { ok: true, id, rev: String(Date.now()) }
      }

      if (id.startsWith('folder/')) {
        const rel = id.slice('folder/'.length)
        const src = path.join(WS, rel)
        try {
          // 同上：真删，不搬回收站
          if (fs.existsSync(src)) fs.rmSync(src, { recursive: true, force: true })
        } catch (e) {
          return { error: true, message: String(e && e.message) }
        }
        invalidate()
        return { ok: true, id, rev: String(Date.now()) }
      }

      return { ok: true, id, rev: String(Date.now()) }
    },

    allDocs(selector) {
      const docs = scan()
      const out = []
      // 支持：不传（全部）、'folder/' 前缀、'note/' 前缀、id 数组
      if (Array.isArray(selector)) {
        for (const id of selector) {
          const d = __NDB.get(id)
          if (d) out.push(d)
        }
        return out
      }
      const prefix = typeof selector === 'string' ? selector : ''
      for (const [key, doc] of docs) {
        if (key === '__root__') continue
        // 关键：folder 一律只返回根级（无论调用方传 'folder/' 还是不带参数）。
        // UI 的 _R() 会把 children 中 id 命中「所有 folder id」的项当重复 splice 删除，
        // 一旦子目录也被单独返回，children 就会被就地破坏，反复展开/折叠后出现重叠。
        if (key.startsWith('folder/')) {
          if (dirOf(key.slice('folder/'.length)) !== '') continue
        }
        if (!prefix || key.startsWith(prefix)) out.push(doc)
      }
            // 根级顺序按用户拖拽记录（order.txt 的根段）重排
      if (out.length && (!prefix || prefix === 'folder/')) {
        const seq = new Map()
        ;(TREE_ORDER[''] || []).forEach((x, idx) => seq.set('folder/' + String(x).replace(/^folder\//, ''), idx))
        if (seq.size) {
          out.sort((a, b) => {
            const ia = seq.has(a._id) ? seq.get(a._id) : 1e9
            const ib = seq.has(b._id) ? seq.get(b._id) : 1e9
            return ia === ib ? 0 : ia - ib
          })
        }
      }
return out
    },

    postAttachment(id, data, contentType) {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
        const ext = (() => {
          const map = {
            'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
            'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
          }
          return map[contentType] || 'bin'
        })()
        const digest = id.startsWith('attachment/') ? id.slice('attachment/'.length) : id
        const file = path.join(ASSETS, digest + '.' + ext)
        mk(ASSETS)
        fs.writeFileSync(file, buf)
        // 记一张映射表，getAttachment 用
        const idx = rj(path.join(META, 'assets.json'), {})
        idx[digest] = digest + '.' + ext
        wj(path.join(META, 'assets.json'), idx)
        return { ok: true, id: 'attachment/' + digest }
      } catch (e) {
        return { error: true, message: String(e && e.message) }
      }
    },

    getAttachment(id) {
      try {
        const digest = String(id || '').startsWith('attachment/') ? id.slice('attachment/'.length) : id
        const idx = rj(path.join(META, 'assets.json'), {})
        let file = idx[digest]
        if (!file) {
          const found = fs.readdirSync(ASSETS).find((x) => x.startsWith(digest))
          if (!found) return null
          file = found
        }
        return fs.readFileSync(path.join(ASSETS, file))
      } catch (e) {
        return null
      }
    },

    replicateStateFromCloud() {
      return Promise.resolve({ ok: true })
    },

    promises: {},
  }

  __NDB.promises = {
    get: async (id) => __NDB.get(id),
    put: async (doc) => __NDB.put(doc),
    remove: async (doc) => __NDB.remove(doc),
    allDocs: async (sel) => __NDB.allDocs(sel),
  }

  // ---------------- __NSTORE（对应 dbStorage）----------------
  const store = () => rj(STOREJSON, {})
  const __NSTORE = {
    getItem(k) {
      const s = store()
      return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null
    },
    setItem(k, v) {
      const s = store()
      s[k] = v
      wj(STOREJSON, s)
      return true
    },
    removeItem(k) {
      const s = store()
      delete s[k]
      wj(STOREJSON, s)
      return true
    },
  }

  // 挂到渲染进程 window（ZTools 的插件 preload 与页面共享 window）
  win.__NDB = __NDB
  win.__NSTORE = __NSTORE
  win.__ZNOTES_WS = WS

  // 额外的诊断接口，方便排查
  win.__ZNOTES = {
    ws: WS,
    rescan: () => { invalidate(); return scan().size },
    // 把指定笔记收拢到根目录（bundle 把笔记拖到根时只改内存 state.data
    // 和 rootsort，不调用 put，所以只能在这里按文件名兜底移动）
    pullToRoot: function (ids) {
      if (!Array.isArray(ids)) return false
      const byName = new Map()
      const docs = scan()
      docs.forEach(function (d) {
        if (d && d._id && d._id.indexOf('note/') === 0) {
          const b = path.basename(d._id)
          if (!byName.has(b)) byName.set(b, [])
          byName.get(b).push(d._id.slice('note/'.length))
        }
      })
      let changed = false
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        if (!id || String(id).indexOf('note/') !== 0) continue
        const base = path.basename(String(id))
        const cands = byName.get(base) || []
        for (let c = 0; c < cands.length; c++) {
          const rel = cands[c]
          if (rel.indexOf('/') < 0) continue                 // 已经在根
          const srcAbs = path.join(WS, rel)
          const dstAbs = path.join(WS, base)
          try {
            if (fs.existsSync(srcAbs) && !fs.existsSync(dstAbs)) {
              fs.renameSync(srcAbs, dstAbs)
              changed = true
            }
          } catch (e) {}
        }
      }
      if (changed) { invalidate(); notifyFsChange('') }
      return changed
    },
    onFsChange: function (fn) { try { fsListeners.push(fn); startWatch() } catch (e) {} },
    toMarkdown: nodesToMd,
    saveTreeOrder: saveTreeOrder,
    readTreeOrder: readTreeOrder,
    reconcileTree: reconcileTree,
    toNodes: mdToNodes,
    onboardGet: onboardGet,
    onboardSet: onboardSet,
    metaDir: META,
    // 扫描是否因为目录/笔记过多而截断（界面据此提示用户换更具体的目录）
    truncated: () => LAST_TRUNCATED,
    // 只读状态：界面按 rel 询问，内部换算成 note/<rel> 的哈希
    readNoteState: function (rel) {
      try {
        const st = readNoteState()
        const h = idHash('note/' + String(rel))
        return { locked: st.readonlyHashes.has(h), near: st.nearHashes.has(h) }
      } catch (e) {
        return { locked: false, near: false }
      }
    },
    setNoteLocked: function (rel, on) {
      try {
        setNoteFlag('note/' + String(rel), 'readonly', !!on)
        return { ok: true }
      } catch (e) {
        return { ok: false, message: String(e && e.message ? e.message : e) }
      }
    },
    setNoteNear: function (rel, on) {
      try {
        setNoteFlag('note/' + String(rel), 'near', !!on)
        return { ok: true }
      } catch (e) {
        return { ok: false, message: String(e && e.message ? e.message : e) }
      }
    },
  }
  console.log('[znotes] workspace =', WS)
}