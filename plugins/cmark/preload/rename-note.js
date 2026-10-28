// 笔记重命名弹层：目录树右键「重命名」调用
// 改标题后走 __NDB.put，put 内部会把磁盘文件同步改名
module.exports = function (win, findInstance) {
  const doc = win.document
  const ID = 'znotes-rename'
  const STYLE_ID = ID + '-style'
  const LOG = function () {}   // 调试打点已关闭

  function injectStyle() {
    if (doc.getElementById(STYLE_ID)) return
    const st = doc.createElement('style')
    st.id = STYLE_ID
    st.textContent = `
    #${ID}{position:fixed;inset:0;z-index:2147483200;display:none;align-items:center;justify-content:center;
      background:rgba(0,0,0,.28);}
    #${ID}.open{display:flex;}
    #${ID} .zrn-card{width:340px;max-width:86vw;border-radius:10px;background:#fff;color:#1f2328;
      box-shadow:0 16px 40px rgba(0,0,0,.28);padding:16px 18px 14px;font-size:13px;}
    #${ID} .zrn-title{font-weight:600;font-size:13.5px;margin-bottom:10px;}
    #${ID} input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;
      border:1px solid rgba(128,128,128,.42);background:transparent;color:inherit;font-size:13px;outline:none;}
    #${ID} input:focus{border-color:#3f7ef7;}
    #${ID} .zrn-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;}
    #${ID} button{padding:6px 14px;border-radius:6px;border:1px solid rgba(128,128,128,.36);
      background:transparent;color:inherit;font-size:12.5px;cursor:pointer;}
    #${ID} button.primary{background:#3f7ef7;border-color:#3f7ef7;color:#fff;}
    :root[data-theme='dark'] #${ID} .zrn-card{background:#2b2f36;color:#e6e6e6;box-shadow:0 16px 40px rgba(0,0,0,.5);}
    :root[data-theme='dark'] #${ID} input{border-color:rgba(255,255,255,.22);}
    :root[data-theme='dark'] #${ID} button{border-color:rgba(255,255,255,.2);}

    `
    try { (doc.head || doc.body || doc.documentElement).appendChild(st) } catch (e) {}
  }

  let root = null
  let onSubmit = null
  let promptTitle = '重命名笔记'

  function ensure() {
    injectStyle()
    if (root && doc.body.contains(root)) return root
    root = doc.createElement('div')
    root.id = ID
    root.innerHTML =
      '<div class="zrn-card">' +
      '<div class="zrn-title"></div>' +
      '<input type="text" maxlength="120" spellcheck="false">' +
      '<div class="zrn-btns">' +
      '<button data-act="cancel">取消</button>' +
      '<button data-act="ok" class="primary">确定</button>' +
      '</div></div>'
    const input = root.querySelector('input')
    root.addEventListener('mousedown', function (e) {
      if (e.target === root) hide()
      e.stopPropagation()
    })
    root.addEventListener('click', function (e) {
      const b = e.target.closest && e.target.closest('button[data-act]')
      LOG('click on rename root: ' + (b ? b.getAttribute('data-act') : 'non-button'))
      if (!b) return
      if (b.getAttribute('data-act') === 'ok') submit()
      else hide()
    })
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit() }
      else if (e.key === 'Escape') { e.preventDefault(); hide() }
      e.stopPropagation()
    })
    doc.body.appendChild(root)
    return root
  }

  function hide() {
    LOG('hide, was=' + (root ? root.classList.contains('open') : 'no-root'))
    if (root) root.classList.remove('open')
    onSubmit = null
  }

  function submit() {
    LOG('submit called, hasCb=' + !!onSubmit)
    const input = root && root.querySelector('input')
    const val = input ? String(input.value || '').trim() : ''
    const cur = onSubmit
    hide()
    if (!val || !cur) return
    cur(val)
  }

  function openNote(node, fallbackDoc) {
    const el = ensure()
    let id = node && node.data && node.data.id
    let d = id ? (win.NOTES_DIC || {})[id] : null
    if (!d && fallbackDoc) { d = fallbackDoc; id = fallbackDoc._id }
    if (!d) return
    const old = String(d.title || '')
    promptTitle = '重命名笔记'
    el.querySelector('.zrn-title').textContent = promptTitle
    const input = el.querySelector('input')
    input.value = old
    el.classList.add('open')
    setTimeout(function () { try { input.focus(); input.select() } catch (e) {} }, 20)
    onSubmit = function (next) {
      if (next === old) return
      const doc2 = {}
      for (const k in d) if (Object.prototype.hasOwnProperty.call(d, k)) doc2[k] = d[k]
      doc2.title = next
      let res = null
      try { res = win.__NDB.put(doc2) } catch (e) { res = { error: true, message: String(e && e.message) } }
      if (res && res.error) {
        try { win.ztools.showNotification('重命名失败：' + (res.message || '')) } catch (e) {}
        return
      }
      // put 可能把 _id 改成新的物理路径，同步 NOTES_DIC 的键
      const newId = (doc2 && doc2._id) || id
      if (newId !== id) { try { delete win.NOTES_DIC[id] } catch (e) {} }
      doc2._id = newId
      win.NOTES_DIC[newId] = doc2
      // 当前打开的就是这篇：立刻替换 workNote，面板顶部文件名即时更新
      try {
        const inst = findInstance('main')
        if (inst && inst.state && inst.state.workNote && inst.state.workNote._id === id) {
          inst.setState({ workNote: doc2 })
        }
      } catch (e) {}
      try { if (win.__znotesRefreshTree) win.__znotesRefreshTree() } catch (e) {}
    }
  }

  // 通用输入弹层：title=标题，value=默认值，cb(输入值)
  win.__znotesPrompt = function (title, value, cb) {
    const el = ensure()
    promptTitle = title || ''
    el.querySelector('.zrn-title').textContent = promptTitle
    el.querySelector('input').value = value == null ? '' : String(value)
    el.classList.add('open')
    LOG('open title=' + promptTitle)
    setTimeout(function () { try { const i = el.querySelector('input'); i.focus(); i.select() } catch (e) {} }, 20)
    onSubmit = cb
  }

  win.__znotesRenameNote = function (node) {
    let inst = null
    try { inst = findInstance('main') } catch (e) {}
    const sb = inst && inst.sidebarRef
    const n = node || (sb && sb.state && sb.state.contextMenu && sb.state.contextMenu.node)
    const fb = inst && inst.state && inst.state.workNote
    openNote(n, fb)
  }
  win.__znotesRenameOpen = openNote
}