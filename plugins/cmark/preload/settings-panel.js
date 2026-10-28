/* 设置面板：从 Git 面板中独立出来，入口在侧边栏底部齿轮按钮。
   只用 Git 面板那套 .zgp-* 样式，宿主容器换成 #zgs-root。 */
function logBoot () {}   // 调试打点已关闭

module.exports = function attachSettingsPanel (win) {
  logBoot('enter')
  const doc = win.document
  if (!doc || doc.getElementById('zgs-root')) return
  // preload 可能在 document-start 阶段执行，这时 body/head 还不存在，等 DOM 就绪再来
  if (!doc.body) {
    setTimeout(function () { try { attachSettingsPanel(win) } catch (e) {} }, 60)
    return
  }

  const ICON = {
    gear: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0-1.3a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/><path d="M13.1 9.2a4.9 4.9 0 0 0 0-2.4l1.2-.9-1.2-2-1.4.6a5 5 0 0 0-2-1.2L9.4 1.8h-2.8l-.3 1.5a5 5 0 0 0-2 1.2l-1.4-.6-1.2 2 1.2.9a4.9 4.9 0 0 0 0 2.4l-1.2.9 1.2 2 1.4-.6a5 5 0 0 0 2 1.2l.3 1.5h2.8l.3-1.5a5 5 0 0 0 2-1.2l1.4.6 1.2-2-1.2-.9zm-1.7-.4l1 .7-.3.5-1.1-.5a3.7 3.7 0 0 1-1.9 1.1l-.3 1.2h-.6l-.3-1.2a3.7 3.7 0 0 1-1.9-1.1l-1.1.5-.3-.5 1-.7a3.6 3.6 0 0 1 0-2.3l-1-.7.3-.5 1.1.5a3.7 3.7 0 0 1 1.9-1.1l.3-1.2h.6l.3 1.2a3.7 3.7 0 0 1 1.9 1.1l1.1-.5.3.5-1 .7a3.6 3.6 0 0 1 0 2.3z"/></svg>',
    x: '×'
  }

  function esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  const G = win.__znotesGit

  // ---------- 样式：定位 + 侧边栏底部按钮 ----------
  const style = doc.createElement('style')
  style.textContent = `
  #zgs-root{position:fixed;top:0;right:0;width:520px;max-width:96vw;height:100%;z-index:99998;
    display:none;flex-direction:column;background:var(--zgp-bg,#1b1b1f);color:var(--zgp-fg,#e6e6e6);
    border-left:1px solid var(--zgp-bd,rgba(255,255,255,.12));box-shadow:-8px 0 24px rgba(0,0,0,.28);
    font-family:inherit;}
  #zgs-root.open{display:flex;animation:zgs-in .22s cubic-bezier(.2,.8,.2,1);}
  @keyframes zgs-in{from{transform:translateX(24px);opacity:.4}to{transform:translateX(0);opacity:1}}
  .zgs-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:14px 16px 12px;border-bottom:1px solid var(--zgp-bd,rgba(255,255,255,.12));}
  .zgs-title{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600;}
  .zgs-title svg{width:15px;height:15px;fill:currentColor;opacity:.85;}
  .zgs-body{flex:1;overflow:auto;padding:4px 0 18px;}
  .znotes-sbtn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;
    padding:7px 8px;border:none;border-radius:6px;background:transparent;color:inherit;
    font-size:11.5px;cursor:pointer;opacity:.72;transition:background .15s,opacity .15s;}
  .znotes-sbtn:hover{background:rgba(128,128,128,.16);opacity:1;}
  .znotes-sbtn svg{width:13px;height:13px;fill:currentColor;flex:0 0 13px;}
  /* 目录树要让出底部按钮的空间，否则树会压住 footer（按钮点不到） */
  .sidebar-tree{flex:1 1 auto;min-height:0;}
  /* 底部按钮改为绝对定位 + 容器预留 padding：按钮晚挂载时不再改变树的高度，
     避免打开插件瞬间出现一次高度跳变 */
  .sidebar-body{position:relative;padding-bottom:34px;box-sizing:border-box;}
  .znotes-footer{padding:6px 8px;border-top:1px solid rgba(128,128,128,.18);flex:0 0 auto;
    position:absolute;left:0;right:0;bottom:0;z-index:2;background:inherit;}
  /* 顶部工具条整行不要：新建文件夹/新建笔记/折叠全部/工作区变更记录 全在里面，
     新建走右键菜单，git 操作由顶部那条 git 工具条承担 */
  .sidebar-header{display:none !important;}
  /* 设置面板自己的确认层：git-panel 的 askConfirm 把遮罩挂到 display:none 的 #zgp-root，
     在设置里复用会弹出点不到的框，所以这里独立实现一套 */
  .zgs-mask{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);
    display:flex;align-items:center;justify-content:center;}
  .zgs-dlg{background:var(--zgp-bg,#1b1b1f);color:var(--zgp-fg,#e6e6e6);
    border:1px solid var(--zgp-bd,rgba(255,255,255,.14));border-radius:10px;
    padding:18px 18px 14px;max-width:440px;width:calc(100% - 48px);
    box-shadow:0 12px 32px rgba(0,0,0,.45);}
  .zgs-dlg-msg{font-size:12.5px;line-height:1.8;color:var(--zgp-fg2,#cfcfcf);word-break:break-word;}
  .zgs-dlg-row{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}
  .zgp-in[disabled]{opacity:.5;cursor:not-allowed;}
  /* ---------- 设置面板排版规范 ---------- */
  /* 状态信息用键值对齐，而不是把多个字段串成一行用中点隔开 */
  .zgs-kv{display:grid;grid-template-columns:64px 1fr;gap:7px 12px;align-items:baseline;
    margin:4px 0 6px;padding:10px 12px;border-radius:8px;background:rgba(128,128,128,.08);}
  .zgs-kv dt{font-size:11.5px;color:var(--zgp-fg3,#8b8b93);}
  .zgs-kv dd{margin:0;font-size:12.5px;color:var(--zgp-fg,#e6e6e6);word-break:break-all;line-height:1.5;}
  .zgs-kv dd.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;}
  .zgs-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;
    vertical-align:1px;background:#3ddc97;box-shadow:0 0 0 2px rgba(61,220,151,.18);}
  .zgs-dot.off{background:#7c7c85;box-shadow:none;}
  /* 子分组标题：故意做得比分区标题轻，避免"子分组比父级更重"的层级倒置 */
  .zgs-sub{font-size:11.5px;font-weight:600;color:#adadb8;
    margin:18px 0 8px;letter-spacing:.03em;}
  .zgs-sub:first-child{margin-top:12px;}
  /* 持久 label：只靠 placeholder 的话，输入后语义就消失了 */
  .zgs-lab{display:block;font-size:11.5px;color:var(--zgp-fg3,#8b8b93);margin:0 0 5px;}
  /* 危险按钮：移除远端这种不能和主按钮同权重并排 */
  /* 用 #zgs-body 提高优先级：否则被 git-panel 的 .zgp-b 规则覆盖成普通按钮 */
  #zgs-body .zgp-b.danger{color:#ff8f85 !important;background:transparent !important;
    border:1px solid rgba(255,120,110,.42) !important;margin-left:auto;}
  #zgs-body .zgp-b.danger:hover{background:rgba(255,120,110,.12) !important;
    border-color:rgba(255,120,110,.6) !important;}
  /* 折叠块：低频配置（提交者身份、提交信息）默认收起，减少视觉噪音 */
  .zgs-fold{margin:18px 0 6px;}
  .zgs-fold > summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px;
    padding:2px 0;font-size:11.5px;font-weight:600;color:#adadb8;letter-spacing:.03em;
    user-select:none;transition:color .15s;}
  .zgs-fold > summary::-webkit-details-marker{display:none;}
  .zgs-fold > summary::before{content:'▸';display:inline-block;font-size:10px;opacity:.75;
    transition:transform .16s ease;transform-origin:50% 50%;}
  .zgs-fold[open] > summary::before{transform:rotate(90deg);}
  .zgs-fold > summary:hover{color:var(--zgp-fg,#e6e6e6);}
  .zgs-fold > summary .zgs-fold-badge{font-weight:400;color:var(--zgp-fg3,#8b8b93);}
  .zgs-fold[open] > summary{margin-bottom:10px;}

  /* details 的收起靠浏览器默认的 display:none，但本文件给内容元素写了
     .zgs-lab{display:block} / .zgp-row{display:flex} 这类作者样式，
     特异性更高会把内容顶出来，所以这里显式隐藏非 summary 的子元素 */
  .zgs-fold:not([open]) > *:not(summary){display:none !important;}
  /* 分区级折叠（提交信息）的标题用分区标题的规格 */
  .zgs-fold.seclvl{margin:0;}
  .zgs-fold.seclvl > summary{font-size:12.5px;letter-spacing:.02em;color:var(--zgp-fg,#e6e6e6);opacity:.95;}
  /* 分区标题：整块里最重的一级，提亮加大，和子分组、说明文字拉开层次 */
  #zgs-body .zgp-sec h5{font-weight:600;font-size:12.5px;letter-spacing:.02em;
    color:var(--zgp-fg,#e6e6e6);opacity:.95;}
  /* 分区内一致性：输入框统一高度与 focus 态 */
  /* 弹窗里的校验错误行 */
  .zgs-dlg-err{display:none;margin-top:9px;font-size:11.5px;line-height:1.5;color:#ff8f85;
    background:rgba(255,120,110,.1);border-radius:6px;padding:6px 9px;word-break:break-all;}
  /* 状态卡里的远端地址可能很长，允许在任意位置折行 */
  .zgs-kv-url{word-break:break-all;}
  /* 只读地址框：看起来是"展示"，不是"待填" */
  #zgs-body .zgs-auth-err{margin:10px 0 0;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.7;
    color:#cf222e;background:rgba(207,34,46,.10);border:1px solid rgba(207,34,46,.35);word-break:break-word;}
  :root[data-theme='dark'] #zgs-body .zgs-auth-err{color:#ff8f85;background:rgba(255,120,110,.12);border-color:rgba(255,120,110,.4);}
  /* 抽屉内的小节（提交 / 自动同步）：用细分隔线与上方仓库状态隔开 */
  #zgs-body .zgs-sub{margin-top:16px;padding-top:14px;border-top:1px solid rgba(128,128,128,.22);}
  #zgs-body .zgs-sub h5{font-size:12px;font-weight:600;margin:0 0 8px;letter-spacing:.02em;}
  /* Git 未启用时，提交/自动同步整体置灰且不可交互 */
  #zgs-body .zgp-sec.is-disabled{opacity:.45;pointer-events:none;filter:grayscale(.4);}
  #zgs-body .zgp-in[readonly]{opacity:.8;cursor:default;background:rgba(127,127,127,.08);}
  #zgs-body .zgp-in{padding-left:12px;padding-right:12px;height:34px;box-sizing:border-box;}
  #zgs-body .zgp-in:focus{outline:none;border-color:rgba(120,160,255,.55);
    box-shadow:0 0 0 2px rgba(120,160,255,.16);}
  #zgs-body .zgp-b{min-height:30px;}
  #zgs-body .zgp-sec{padding-top:16px;padding-bottom:16px;}
  #zgs-body .zgp-row{gap:8px;}
  `
  try { (doc.head || doc.body).appendChild(style) } catch (e0) { logBoot('appendStyle failed: ' + e0.message) }

  // ---------- 面板容器 ----------
  const root = doc.createElement('div')
  root.id = 'zgs-root'
  root.innerHTML = `
    <div class="zgs-head">
      <div class="zgs-title">${ICON.gear}<span>设置</span></div>
      <button class="zgp-close" id="zgs-close" title="关闭 (Esc)">${ICON.x}</button>
    </div>
    <div class="zgs-body" id="zgs-body"></div>
  `
  doc.body.appendChild(root)
  logBoot('panel mounted, sidebar-body=' + !!doc.querySelector('.sidebar-body'))

  const $ = (id) => doc.getElementById(id)

  // ---------- Toast（面板内既有 toast 在 git-panel 里，独立时自建一个轻提示） ----------
  let toastTimer = null
  function toast (text, kind) {
    let el = doc.getElementById('zgs-toast')
    if (!el) {
      el = doc.createElement('div')
      el.id = 'zgs-toast'
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
        'padding:8px 16px;border-radius:8px;font-size:12.5px;z-index:99999;opacity:0;' +
        'pointer-events:none;transition:opacity .18s;background:rgba(30,30,34,.95);color:#eee;' +
        'border:1px solid rgba(255,255,255,.14)'
      doc.body.appendChild(el)
    }
    el.textContent = text || ''
    if (kind === 'err') { el.style.color = '#ff8a80'; el.style.borderColor = 'rgba(255,120,110,.45)' } else { el.style.color = '#eee'; el.style.borderColor = 'rgba(255,255,255,.14)' }
    el.style.opacity = '1'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { el.style.opacity = '0' }, 2600)
  }

  // ---------- 二次确认（破坏性操作用） ----------
  function zgsConfirm (message, okText) {
    return new Promise(function (resolve) {
      const mask = doc.createElement('div')
      mask.className = 'zgs-mask'
      mask.innerHTML = '<div class="zgs-dlg">' +
        '<div class="zgs-dlg-msg">' + esc(String(message || '')).replace(/\n/g, '<br>') + '</div>' +
        '<div class="zgs-dlg-row">' +
        '<button class="zgp-b" data-r="0">取消</button>' +
        '<button class="zgp-b primary" data-r="1">' + esc(okText || '确定') + '</button>' +
        '</div></div>'
      ;(root || doc.body).appendChild(mask)
      mask.onclick = function (ev) {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-r]') : null
        if (!btn) return
        const ok = btn.getAttribute('data-r') === '1'
        try { mask.remove() } catch (e) {}
        resolve(ok)
      }
    })
  }

  // 带输入框的弹窗。传了 onConfirm 就是"异步校验"模式：
  // 点确定后不关窗，先跑 onConfirm(value)，成功才关；失败把原因显示在弹窗里，用户可以直接改地址重试。
  function zgsPrompt (title, placeholder, initial, onConfirm) {
    return new Promise(function (resolve) {
      const hasCheck = typeof onConfirm === 'function'
      const mask = doc.createElement('div')
      mask.className = 'zgs-mask'
      mask.innerHTML = '<div class="zgs-dlg">' +
        '<div class="zgs-dlg-msg">' + esc(String(title || '')).replace(/\n/g, '<br>') + '</div>' +
        '<input class="zgp-in zgs-dlg-in" type="text" placeholder="' + esc(placeholder || '') +
        '" value="' + esc(initial || '') + '" spellcheck="false">' +
        '<div class="zgs-dlg-err"></div>' +
        '<div class="zgs-dlg-row">' +
        '<button class="zgp-b" data-r="0">取消</button>' +
        '<button class="zgp-b primary zgs-dlg-ok" type="button">' + (hasCheck ? '检测并继续' : '保存') + '</button>' +
        '</div></div>'
      ;(root || doc.body).appendChild(mask)
      const inp = mask.querySelector('.zgs-dlg-in')
      const errEl = mask.querySelector('.zgs-dlg-err')
      const okBtn = mask.querySelector('.zgs-dlg-ok')
      let settled = false
      let busy = false
      const showErr = function (t) {
        if (!errEl) return
        errEl.textContent = t || ''
        errEl.style.display = t ? 'block' : 'none'
      }
      const done = function (val) {
        if (settled) return
        settled = true
        try { mask.remove() } catch (e) {}
        resolve(val)
      }
      const submit = async function () {
        if (busy || settled) return
        const v = ((inp && inp.value) || '').trim()
        if (!v) { showErr('请填写仓库地址'); return }
        if (!hasCheck) { done(v); return }
        busy = true
        showErr('')
        const label = okBtn.textContent
        okBtn.disabled = true
        okBtn.textContent = '检测中…'
        let res = null
        try { res = await onConfirm(v) } catch (e) { res = { ok: false, message: (e && e.message) || String(e) } }
        okBtn.disabled = false
        okBtn.textContent = label
        busy = false
        if (res && res.ok) done(v)
        else showErr((res && res.message) || '校验失败，请检查地址')
      }
      if (okBtn) okBtn.onclick = function (ev) { if (ev) ev.stopPropagation(); submit() }
      mask.onclick = function (ev) {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-r="0"]') : null
        if (btn) { done(null); return }
        if (ev.target === mask) done(null)
      }
      mask.onkeydown = function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); submit() }
        else if (ev.key === 'Escape') { ev.preventDefault(); done(null) }
      }
      setTimeout(function () { try { inp.focus(); inp.select() } catch (e) {} }, 30)
    })
  }

  // ---------- 渲染 ----------
  async function render () {
    // 页面重载后 <html> 上的 data-theme 有可能还没写上，这里兜一次
    try { if (win.__CMARK_THEME && win.__CMARK_THEME.apply) win.__CMARK_THEME.apply() } catch (e) {}
    if (!G) {
      $('zgs-body').innerHTML = '<div class="zgp-sec"><h5>不可用</h5><div class="zgp-desc">Git 服务未加载</div></div>'
      return
    }
    const cfg = (G.config() || {}).data || {}
    const ivOpts = [[60000, '1 分钟'], [300000, '5 分钟'], [900000, '15 分钟'], [1800000, '30 分钟'], [3600000, '1 小时']]
    const mode = cfg.autoMode || 'interval'
    const ivHtml = ivOpts.map(function (p) {
      return '<option value="' + p[0] + '"' + (cfg.intervalMs === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'
    }).join('')
    const stopOpts = [[0, '关闭'], [1, '1 分钟'], [3, '3 分钟'], [5, '5 分钟'], [10, '10 分钟']]
    const stopHtml = stopOpts.map(function (p) {
      return '<option value="' + p[0] + '"' + (cfg.onStopEditMinutes === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'
    }).join('')

    $('zgs-body').innerHTML = `
      <div class="zgp-sec">
        <h5>外观</h5>
        <div class="zgp-row" id="s-theme-row">
          <button class="zgp-b" id="s-theme-light">浅色</button>
          <button class="zgp-b" id="s-theme-dark">深色</button>
          <button class="zgp-b" id="s-theme-system">跟随系统</button>
        </div>
        <div class="zgp-desc">主题对所有界面生效，选择后立即应用并记住。</div>
      </div>
      <div class="zgp-sec">
        <h5>工作区信息</h5>
        <dl class="zgs-kv">
          <dt>工作区目录</dt><dd class="mono" id="s-repo-dir">—</dd>
          <dt>笔记目录</dt><dd class="mono" id="s-ws">—</dd>
          <dt>附件目录</dt><dd class="mono" id="s-attach-dir">—</dd>
          <dt>附件</dt><dd id="s-attach">统计中…</dd>
        </dl>
        <div class="zgp-row" style="margin-top:8px">
          <button class="zgp-b" id="s-repo-pick">修改工作区</button>
          <button class="zgp-b" id="s-notes-pick">选择笔记目录</button>
          <button class="zgp-b" id="s-attach-clean" title="直接删除没有任何笔记引用的附件（不做回收站，误删可从 git 历史取回）">清理未引用附件</button>
        </div>
        <div class="zgp-desc">默认在 <span class="mono">文档\CMark</span>；修改后重新扫描该目录下的 Markdown 文件，文件本身不会被移动或修改。</div>
      </div>
      <div class="zgp-sec">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <h5 style="margin:0">Git 集成</h5>
          <label class="zgp-sw"><input type="checkbox" id="s-git-enabled"><i></i></label>
        </div>
        <div class="zgp-desc" style="margin-top:6px">打开后可以提交历史、回溯版本，并同步到你自己的远程仓库。</div>
        <div class="zgp-drawer" id="s-git-drawer">
          <div id="s-git-body"></div>
            <div class="zgs-sub" id="s-sec-auto">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <h5 style="margin:0">自动同步</h5>
            <label class="zgp-sw"><input type="checkbox" id="s-auto" ${cfg.autoSync ? 'checked' : ''}><i></i></label>
          </div>
          <div class="zgp-desc" style="margin:6px 0 10px">按下方策略执行；只在有改动时才产生提交。</div>
          <div class="zgp-drawer${cfg.autoSync ? ' open' : ''}" id="s-auto-drawer">
            <div class="zgp-field">
              <div class="zgp-lab"><span>触发方式</span></div>
              <select class="zgp-sel" id="s-mode">
                <option value="interval"${mode === 'interval' ? ' selected' : ''}>固定间隔</option>
                <option value="stop-edit"${mode === 'stop-edit' ? ' selected' : ''}>停止编辑后</option>
              </select>
            </div>
            <div class="zgp-field" id="s-interval-row"${mode === 'interval' ? '' : ' style="display:none"'}>
              <div class="zgp-lab"><span>间隔时长</span></div>
              <select class="zgp-sel" id="s-interval">${ivHtml}</select>
              <div class="zgp-desc">跨会话生效：即使插件没开够一个间隔，下次启动会补一次。</div>
            </div>
            <div class="zgp-field" id="s-stop-row"${mode === 'stop-edit' ? '' : ' style="display:none"'}>
              <div class="zgp-lab"><span>静默时长</span></div>
              <select class="zgp-sel" id="s-stop">${stopHtml}</select>
              <div class="zgp-desc">停止输入 N 分钟后触发一次，适合边写边自动保存。</div>
            </div>
          </div>
        </div>
        </div>
      </div>
      <div class="zgp-sec">
        <h5>运行状态</h5>
        <div class="zgp-desc" id="s-repo">读取中…</div>
      </div>
    `

    // 附件统计 + 清理未引用附件。之前这个按钮根本没绑处理函数，点了没反应。
    // 清理是真删（不做回收站），所以必须先给用户看清楚会删几个、多大。
    const attachBox = $('s-attach')
    const attachBtn = $('s-attach-clean')
    const fmtSize = function (n) {
      const v = Number(n) || 0
      if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB'
      if (v >= 1024) return (v / 1024).toFixed(0) + ' KB'
      return v + ' B'
    }
    const attachDirEl = $('s-attach-dir')
    const refreshAttachStat = function () {
      if (attachDirEl) {
        const ws = win.__ZNOTES_WS || ''
        attachDirEl.textContent = ws ? (ws.replace(/[\\/]+$/, '') + '\\.attachments') : '未设置笔记目录'
      }
      if (!attachBox) return
      try {
        const api = win.__CMARK
        const s = api && api.scanAttachments ? api.scanAttachments() : null
        if (!s || !s.ok) {
          attachBox.textContent = '读取失败' + (s && s.message ? '（' + s.message + '）' : '')
          return
        }
        const total = Number(s.total) || 0
        const unused = (s.unused || []).length
        attachBox.textContent = total + ' 个，共 ' + fmtSize(s.allBytes) +
          '；未引用 ' + unused + ' 个（' + fmtSize(s.unusedBytes) + '）'
      } catch (e) {}
    }
    refreshAttachStat()
    if (attachBtn) {
      attachBtn.onclick = function () {
        try {
          const api = win.__CMARK
          if (!api || !api.cleanAttachments) return toast('清理功能不可用', 'err')
          const s = api.scanAttachments ? api.scanAttachments() : null
          const n = s && s.ok ? (s.unused || []).length : 0
          if (!n) return toast('没有未被引用的附件')
          const msg =
            '直接删除 ' + n + ' 个未被引用的附件（' + fmtSize(s.unusedBytes) + '）？\n' +
            '删除后不可撤销；这些附件如果已经提交过，可以从 git 历史里找回。'
          zgsConfirm(msg, '删除').then(function (ok) {
            if (!ok) return
            const r = api.cleanAttachments()
            if (!r || !r.ok) return toast('清理失败：' + ((r && r.message) || '未知错误'), 'err')
            toast('已删除 ' + (r.deleted || 0) + ' 个附件')
            refreshAttachStat()
          })
        } catch (e) {
          toast('清理失败：' + (e && e.message), 'err')
        }
      }
    }

    // ---------- 外观：主题三态 ----------
    const themeSvc = win.__CMARK_THEME
    const curMode = (themeSvc && themeSvc.get && themeSvc.get().mode) || 'system'
    const modeLabel = { light: '浅色', dark: '深色', system: '跟随系统' }
    ;['light', 'dark', 'system'].forEach(function (m) {
      const btn = $('s-theme-' + m)
      if (!btn) return
      if (m === curMode) btn.classList.add('primary')
      btn.onclick = function () {
        if (!themeSvc || !themeSvc.set) return toast('主题服务未就绪', 'err')
        themeSvc.set(m)
        ;['light', 'dark', 'system'].forEach(function (mm) {
          const bb = $('s-theme-' + mm)
          if (bb) bb.classList.toggle('primary', mm === m)
        })
        toast('已切换为' + modeLabel[m])
      }
    })

    // ---------- Git 集成：开关 + 按目录状态渲染 ----------
    const fs = require('fs')
    const GIT_KEY = 'cmark-git-enabled'
    const gitSwitch = $('s-git-enabled')
    const gitDrawer = $('s-git-drawer')
    const gitBody = $('s-git-body')
    const secAuto = $('s-sec-auto')

    // 状态源：优先 preload 暴露的配置文件接口（file:// 下 localStorage 可能不可用）
    const readGitFlag = function (fallback) {
      try {
        const v = win.__CMARK_GIT && win.__CMARK_GIT.get ? win.__CMARK_GIT.get() : undefined
        if (v === true || v === false) return v
      } catch (e) {}
      try {
        const v = win.localStorage.getItem(GIT_KEY)
        if (v === '1') return true
        if (v === '0') return false
      } catch (e) {}
      return fallback
    }
    const writeGitFlag = function (on) {
      try {
        if (win.__CMARK_GIT && win.__CMARK_GIT.set) { win.__CMARK_GIT.set(on); return } } catch (e) {}
      try { win.localStorage.setItem(GIT_KEY, on ? '1' : '0') } catch (e) {}
      try { win.dispatchEvent(new CustomEvent('cmark-git-changed', { detail: { enabled: !!on } })) } catch (e) {}
    }
    const setSectionsDisabled = function (disabled, reason) {
      const secs = [secAuto]
      for (let i = 0; i < secs.length; i++) {
        const sec = secs[i]
        if (!sec) continue
        sec.classList.toggle('is-disabled', !!disabled)
        // 置灰时把原因挂在容器上：disabled 的控件本身不弹 title，但祖先的 title 会生效
        if (disabled) sec.setAttribute('title', reason || '请先配置 Git 仓库')
        else sec.removeAttribute('title')
        const nodes = sec.querySelectorAll('input,select,button')
        for (let j = 0; j < nodes.length; j++) nodes[j].disabled = !!disabled
      }
    }
    const openWizard = function (p) {
      if (win.__CMARK_OPEN_WIZARD) win.__CMARK_OPEN_WIZARD(p)
      else toast('建仓向导未加载', 'err')
    }
    const afterGitChange = function () {
      try { win.dispatchEvent(new CustomEvent('cmark-git-changed')) } catch (e) {}
      refreshGitSection().catch(function () {})
    }

    // 认证失败时在抽屉顶部插入提示条，并给一个直接重新授权的入口
    const showAuthError = function (msg) {
      if (!gitBody) return
      const old = gitBody.querySelector('.zgs-auth-err')
      if (old) old.remove()
      let prov = 'github'
      try {
        const cur = (win.__CMARK_REMOTE && win.__CMARK_REMOTE.current) ? win.__CMARK_REMOTE.current() : null
        if (cur && cur.provider) prov = cur.provider
      } catch (e) {}
      const box = doc.createElement('div')
      box.className = 'zgs-auth-err'
      box.innerHTML = '授权可能已失效，推送/拉取被拒绝：' + esc(String(msg || '').slice(0, 180)) +
        '<div class="zgp-row" style="margin-top:8px"><button class="zgp-b primary" id="s-git-reauth">重新授权</button></div>'
      gitBody.insertBefore(box, gitBody.firstChild)
      const rb = box.querySelector('#s-git-reauth')
      if (rb) rb.onclick = function () { openWizard(prov) }
      toast('授权可能已失效，可点「重新授权」', 'err')
    }

    // 本机 git 可用性：首次检测后缓存，装完 git 可点「重新检测」刷新
    let gitProbe = null
    // 每次打开面板只做一次「未初始化则关开关」的校正；否则用户点开关会被立刻打回
    let gitGateDone = false
    const AUTH_RE = /Authentication failed|could not read Username|could not read Password|Permission denied|Authentication required|Invalid username or password|returned error: 403|403 Forbidden|support for password authentication/i
    const isAuthError = function (msg) { return AUTH_RE.test(String(msg || '')) }

    async function refreshGitSection () {
      if (!gitBody) return

      if (gitProbe === null) {
        try {
          const cp = require('child_process')
          const out = cp.execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 6000, windowsHide: true })
          gitProbe = { ok: true, ver: String(out || '').trim() }
        } catch (e) { gitProbe = { ok: false, ver: '' } }
      }
      if (!gitProbe.ok) {
        if (gitSwitch) { gitSwitch.checked = false; gitSwitch.disabled = true }
        if (gitDrawer) gitDrawer.classList.add('open')
        setSectionsDisabled(true, '请先安装 Git')
        gitBody.innerHTML =
          '<div class="zgs-auth-err">没检测到本机安装 Git，无法使用 Git 集成。</div>' +
          '<div class="zgp-desc">装好 Git for Windows 后点「重新检测」；如果装完仍提示未安装，重启一次 ZTools 让 PATH 生效。</div>' +
          '<div class="zgp-row" style="margin-top:10px">' +
          '<button class="zgp-b primary" data-git="redetect">重新检测</button>' +
          '<button class="zgp-b" data-git="dlgit">打开下载页</button></div>'
        const rd = gitBody.querySelector('[data-git="redetect"]')
        if (rd) rd.onclick = function () { gitProbe = null; refreshGitSection().catch(function () {}) }
        const dl = gitBody.querySelector('[data-git="dlgit"]')
        if (dl) dl.onclick = async function () {
          const ok = await zgsConfirm('即将打开外部窗口，CMark 窗口可能会被隐藏。装完 Git 后重新呼出 CMark 可继续设置。', '继续打开')
          if (ok) { try { win.ztools.shellOpenExternal('https://git-scm.com/download/win') } catch (e) {} }
        }
        return
      }
      if (gitSwitch) gitSwitch.disabled = false

      const insp = (G && G.inspect) ? G.inspect() : { isRepo: false }
      let data = {}
      try { const st = await G.state(); data = (st && st.data) || {} } catch (e) {}
      let remote = { hasRemote: false, url: '' }
      try { const r = await G.remoteInfo(); if (r && r.ok) remote = r.data } catch (e) {}
      const ws = win.__ZNOTES_WS || ''
      let count = 0
      try {
        if (ws && fs.existsSync(ws)) {
          count = fs.readdirSync(ws).filter(function (n) {
            return ['.git', '.cmark', '.attachments', 'backup'].indexOf(n) < 0
          }).length
        }
      } catch (e) {}

      let enabled = readGitFlag(null)
      if (enabled === null) { enabled = !!insp.isRepo; writeGitFlag(enabled) }
      // 每次打开面板后的首次渲染校正一次：目录还不是仓库却开着开关 → 落盘为关闭，
      // 这样「打开开关后没继续建仓就关面板」下次进来仍是关闭。
      if (!gitGateDone) {
        gitGateDone = true
        if (!insp.isRepo && enabled) { enabled = false; writeGitFlag(false) }
      }
      if (gitSwitch) gitSwitch.checked = enabled
      if (gitDrawer) gitDrawer.classList.toggle('open', enabled)
      setSectionsDisabled(
        !enabled || !insp.isRepo,
        !enabled ? '请先开启 Git 集成' : '请先配置 Git 仓库'
      )

      const branch = data.branch || 'main'
      const ahead = data.ahead || 0
      const behind = data.behind || 0
      const dirty = typeof data.dirty === 'number' ? data.dirty : -1

      let kind = 'empty'
      if (insp.isRepo && remote.hasRemote) kind = 'remote'
      else if (insp.isRepo) kind = 'local'
      else if (count > 0) kind = 'files'

      let html = ''
      if (kind === 'empty') {
        html = '<div class="zgp-desc">目录是空的，建一个仓库就能开始记。</div>' +
          '<div class="zgp-row" style="margin-top:10px">' +
          '<button class="zgp-b primary" data-git="gh">使用 GitHub 作为远程仓库</button>' +
          '<button class="zgp-b" data-git="gt">使用 Gitee 作为远程仓库</button>' +
          '<button class="zgp-b" data-git="adopt">从远程仓库加载</button>' +
          '<button class="zgp-b" data-git="local">仅本地仓库</button></div>'
      } else if (kind === 'files') {
        html = '<div class="zgp-desc">目录里有 ' + count + ' 项内容。初始化后这些文件成为第一个提交，内容不会被改动。</div>' +
          '<div class="zgp-row" style="margin-top:10px">' +
          '<button class="zgp-b primary" data-git="gh">使用 GitHub 作为远程仓库</button>' +
          '<button class="zgp-b" data-git="gt">使用 Gitee 作为远程仓库</button>' +
          '<button class="zgp-b" data-git="local">仅本地仓库</button></div>'
      } else if (kind === 'local') {
        html = '<dl class="zgs-kv"><dt>仓库</dt><dd>本地仓库</dd>' +
          '<dt>分支</dt><dd>' + esc(branch) + '</dd>' +
          '<dt>改动</dt><dd>' + (dirty >= 0 ? dirty + ' 个文件' : '读取失败') + '</dd></dl>' +
          '<div class="zgp-desc">还没有远程仓库，笔记只存在这台机器上。</div>' +
          '<div class="zgp-row" style="margin-top:10px">' +
          '<button class="zgp-b primary" data-git="gh">使用 GitHub 作为远程仓库</button>' +
          '<button class="zgp-b" data-git="gt">使用 Gitee 作为远程仓库</button>' +
          '<button class="zgp-b" data-git="manual">手动填远程地址</button></div>'
      } else {
        html = '<dl class="zgs-kv"><dt>远程</dt><dd class="mono">' + esc(remote.url || '') + '</dd>' +
          '<dt>分支</dt><dd>' + esc(branch) + '</dd>' +
          '<dt>状态</dt><dd>' + (dirty >= 0 ? dirty + ' 处改动' : '读取失败') +
          (ahead ? ' · 待推送 ' + ahead : '') + (behind ? ' · 待拉取 ' + behind : '') + '</dd></dl>' +
          '<div class="zgp-row" style="margin-top:10px">' +
          '<button class="zgp-b" data-git="push">推送</button>' +
          '<button class="zgp-b" data-git="pull">拉取</button>' +
          '<button class="zgp-b danger" data-git="unbind">移除远端</button>' +
          '<button class="zgp-b" data-git="clear-token">清除已保存凭据</button></div>'
      }
      gitBody.innerHTML = html

      const btns = gitBody.querySelectorAll('[data-git]')
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i]
        b.onclick = async function () {
          const act = b.getAttribute('data-git')
          if (act === 'gh') return openWizard('github')
          if (act === 'gt') return openWizard('gitee')
          if (act === 'adopt') return loadFromRemote()
          if (act === 'local') {
            b.disabled = true
            const r = await G.initRepo({ mode: 'local' })
            b.disabled = false
            if (r && r.ok) { toast('已创建本地仓库'); afterGitChange() } else toast((r && r.message) || '初始化失败', 'err')
            return
          }
          if (act === 'manual') {
            const bindRemote = async function (u) {
              const r = await G.initRepo({ mode: 'remote', remoteUrl: u, push: true })
              if (r && r.ok) { toast('已绑定远程仓库'); afterGitChange(); return { ok: true } }
              return { ok: false, message: (r && r.message) || '绑定失败' }
            }
            // 第二步：需要授权时让用户贴令牌，存进本工作区后再探测并绑定
            const askToken = function (u, hint) {
              setTimeout(function () {
                zgsPrompt(
                  '这个仓库需要授权访问\n把访问令牌粘贴到下面（GitHub PAT / Gitee 私人令牌 / 私有 GitLab token）',
                  '粘贴访问令牌（GitHub PAT / Gitee 私人令牌 / 私有 GitLab token）', '',
                  async function (tk) {
                    const t = String(tk || '').trim()
                    if (!t) return { ok: false, message: '请填写访问令牌' }
                    const saved = G.setRemoteToken(t, u)
                    if (saved && saved.ok === false) return { ok: false, message: saved.message || '保存令牌失败' }
                    const p2 = await G.probeRemote(u, t)
                    if (!p2 || !p2.ok) {
                      return { ok: false, message: '令牌无效或没有写权限：' + ((p2 && p2.message) || '未知原因') }
                    }
                    const r = await bindRemote(u)
                    if (r.ok) toast('已绑定远程仓库（凭据已保存在本机）')
                    return r
                  }
                )
              }, 140)
              return { ok: true }
            }
            zgsPrompt('填写远程仓库地址', 'https://github.com/you/repo.git', '', async function (url) {
              const u = String(url || '').trim()
              if (!u) return { ok: false, message: '请填写远程仓库地址' }
              // 先免授权探一下：公开仓库直接过，私有仓库会返回 auth 类错误
              const probe = await G.probeRemote(u)
              if (probe && probe.ok) return bindRemote(u)
              const msg = String((probe && probe.message) || '')
              // 注意：GitHub/Gitee 对「私有仓库无权限」和「仓库不存在」都返回 not found，
              // 所以这里把 not found 也算进去 —— 否则私有仓库会直接走到绑定、只丢一句英文报错。
              if (/auth|permission|denied|403|401|username|password|credentials|not found|does not exist/i.test(msg)) {
                // 需要授权：关掉地址输入，接着弹令牌输入
                askToken(u)
                return { ok: true }
              }
              return bindRemote(u)
            })
            return
          }
          if (act === 'push' || act === 'pull') {
            b.disabled = true
            const r = act === 'push' ? await G.push() : await G.pull()
            b.disabled = false
            if (r && r.ok) { toast(act === 'push' ? '推送完成' : '拉取完成'); return }
            const failMsg = (r && r.message) || (act === 'push' ? '推送失败' : '拉取失败')
            if (isAuthError(failMsg)) { showAuthError(failMsg); return }
            toast(failMsg, 'err')
            return
          }
          if (act === 'clear-token') {
            const ok = await zgsConfirm('清除本机保存的授权凭据后，推送需要重新授权；远端绑定关系保留。', '清除')
            if (!ok) return
            try { if (win.__CMARK_REMOTE && win.__CMARK_REMOTE.clear) win.__CMARK_REMOTE.clear() } catch (e) {}
            toast('已清除本机保存的授权凭据')
            afterGitChange()
            return
          }
          if (act === 'unbind') {
            const ok = await zgsConfirm('移除远端绑定后，笔记只保留在本机。', '移除')
            if (!ok) return
            const r = await G.setRemote('')
            if (r && r.ok) { toast('已移除远端'); afterGitChange() } else toast((r && r.message) || '移除失败', 'err')
          }
        }
      }
    }

    if (gitSwitch) {
      gitSwitch.onchange = function () {
        writeGitFlag(!!gitSwitch.checked)
        if (gitDrawer) gitDrawer.classList.toggle('open', !!gitSwitch.checked)
        setSectionsDisabled(!gitSwitch.checked)
        // 通知侧边栏操作栏与编辑区云端按钮同步置灰/隐藏
        try { win.dispatchEvent(new CustomEvent('cmark-git-changed')) } catch (e) {}
        refreshGitSection().catch(function () {})
      }
    }
    refreshGitSection().catch(function () {})

    // ---------- 工作区（仓库根）/ 笔记目录 ----------
    const fillDirs = function () {
      const api = win.__CMARK || {}
      const ws = win.__ZNOTES_WS || ''
      let root = ''
      try { root = api.repoDir ? api.repoDir() : '' } catch (e) {}
      if (!root) root = ws
      const rootEl = $('s-repo-dir')
      if (rootEl) rootEl.textContent = root || '未设置'
      const wsEl = $('s-ws')
      if (wsEl) wsEl.textContent = ws || '未设置'
    }
    fillDirs()

    const repoNames = { pick: '修改工作区', notes: '选择笔记目录' }
    const runDirPick = function (kind) {
      const api = win.__CMARK || {}
      const fn = kind === 'pick' ? api.pickRepoDir : api.pickNotesDir
      if (typeof fn !== 'function') return toast(repoNames[kind] + '功能不可用', 'err')
      let r = null
      try { r = fn.call(api) } catch (e) { return toast('打开目录选择失败：' + (e && e.message), 'err') }
      if (!r || r.canceled) return
      if (!r.ok) return toast(r.message || '操作失败', 'err')
      toast(kind === 'pick' ? '工作区已切换' : '笔记目录已切换')
      if (r.needReload) setTimeout(function () { try { win.location.reload() } catch (e) {} }, 400)
    }
    const repoBtn = $('s-repo-pick')
    if (repoBtn) repoBtn.onclick = function () { runDirPick('pick') }
    const notesBtn = $('s-notes-pick')
    if (notesBtn) notesBtn.onclick = function () { runDirPick('notes') }


    // 从远程仓库加载（要求空工作区）：校验连通性 + 目录状态后才拉取
    async function loadFromRemote () {
      const url = await zgsPrompt(
        '从远程仓库加载\n\n输入远端仓库地址。点「检测并继续」会先确认仓库可访问、当前工作区为空，通过后才开始拉取。',
        'https://gitee.com/账号/仓库.git', '',
        async function (v) {
          const chk = await Promise.resolve(G && typeof G.checkRemote === 'function' ? G.checkRemote(v) : { ok: true })
          if (!chk || !chk.ok) return { ok: false, message: '仓库地址不可用：' + ((chk && chk.message) || '无法连接') }
          const pre = G && typeof G.adoptPrecheck === 'function' ? G.adoptPrecheck() : null
          if (pre && !pre.ok) {
            const items = (pre.blocking && pre.blocking.length)
              ? '：' + pre.blocking.slice(0, 3).join('、') + (pre.blocking.length > 3 ? ' 等' : '')
              : ''
            return { ok: false, message: '加载需要空工作区。' + (pre.reason || '') + items }
          }
          return { ok: true }
        })
      if (!url) return
      toast('正在从远端拉取…', 'info')
      let r = null
      try { r = await Promise.resolve(G.adoptRepo({ remoteUrl: url, branch: 'main' })) } catch (e) { r = { ok: false, message: (e && e.message) || String(e) } }
      if (r && r.ok) {
        toast('已从远端加载完成', 'ok')
        try { if (G.rediscover) G.rediscover() } catch (e) {}
        refreshGitSection().catch(function () {})

    // 暴露给外部一次性监听器：每次 render 更新引用，避免重复注册 addEventListener
    win.__zgsRefreshGitSection = refreshGitSection

        setTimeout(function () { try { if (win.__ZNOTES_REFRESH) win.__ZNOTES_REFRESH() } catch (e) {} }, 600)
      } else {
        toast('加载失败：' + ((r && r.message) || '未知原因'), 'err')
      }
    }

    const save = function () {
      G.setConfig({
        autoSync: $('s-auto').checked,
        autoMode: $('s-mode') ? $('s-mode').value : 'interval',
        intervalMs: parseInt($('s-interval').value, 10),
        onStopEditMinutes: parseInt($('s-stop').value, 10)
      })
      toast('设置已保存', 'ok')
    }

    const autoSw = $('s-auto')
    if (autoSw) {
      autoSw.onchange = function () {
        const dr = $('s-auto-drawer')
        if (dr) dr.classList.toggle('open', autoSw.checked)
        save()
      }
    }
    const modeSel = $('s-mode')
    if (modeSel) {
      modeSel.onchange = function () {
        const isIv = modeSel.value === 'interval'
        const ivRow = $('s-interval-row')
        const stRow = $('s-stop-row')
        if (ivRow) ivRow.style.display = isIv ? '' : 'none'
        if (stRow) stRow.style.display = isIv ? 'none' : ''
        save()
      }
    }
    ;['s-interval', 's-stop'].forEach(function (id) {
      const el = $(id)
      if (el) el.onchange = save
    })

    // 仓库 / 状态信息（异步）
    let st = {}
    try {
      const r = await G.state()
      if (r && r.ok && r.data) st = r.data
    } catch (e) {}
    const repoEl = $('s-repo')
    if (repoEl) {
      const inspNow = (G && G.inspect) ? G.inspect() : { isRepo: false }
      let remoteNow = { hasRemote: false, url: '' }
      try { const rr = await G.remoteInfo(); if (rr && rr.ok) remoteNow = rr.data } catch (e) {}
      let lastRun = 0
      try { const cc = G.config(); if (cc && cc.ok) lastRun = cc.data.lastRunAt || 0 } catch (e) {}
      const fmtTime = function (t) {
        if (!t) return ''
        try {
          const diff = Date.now() - t
          if (diff < 0) return ''
          if (diff < 60000) return '刚刚'
          if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
          if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
          const d = new Date(t)
          const p2 = function (n) { return n < 10 ? '0' + n : String(n) }
          return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
        } catch (e) { return '' }
      }
      const c2 = (G.config() || {}).data || {}
      let rows = ''
      rows += '<dt>本地仓库</dt><dd>' + (inspNow.isRepo ? '已绑定' + (st.branch ? ' · ' + esc(st.branch) : '') : '未绑定') + '</dd>'
      rows += '<dt>远程仓库</dt><dd>' + (remoteNow.hasRemote ? '已绑定' : '未绑定') + '</dd>'
      if (inspNow.isRepo) {
        rows += '<dt>上次同步</dt><dd>' + (c2.lastRunAt ? new Date(c2.lastRunAt).toLocaleString('zh-CN') : '从未执行') + '</dd>'
        if (c2.lastAutoResult) {
          const ar = c2.lastAutoResult
          rows += '<dt>最近结果</dt><dd>' + (ar.ok ? '成功' : '失败') + (ar.message ? ' · ' + esc(ar.message) : '') + '</dd>'
          if (ar.error) rows += '<dt>错误</dt><dd>' + esc(ar.error) + '</dd>'
        }
      }
      if (typeof st.dirty === 'number') rows += '<dt>未提交</dt><dd>' + st.dirty + ' 个文件</dd>'
      if (G.scopeRel) rows += '<dt>笔记子目录</dt><dd class="mono">' + esc(G.scopeRel) + '</dd>'
      repoEl.innerHTML = '<dl class="zgs-kv">' + rows + '</dl>'
    }
  }

  // ---------- 开关 ----------
  // ZTools 的窗口策略是失焦即隐藏：打开资源管理器 / 外部授权页 / 原生目录选择框之后，
  // 插件窗口会被宿主收起来。这里用 sessionStorage 记住面板是否开着，
  // 窗口重新可见（或插件被重新呼出）时自动恢复，用户不用每次都重新点一遍。
  const OPEN_KEY = 'cmark-settings-open'
  function readOpenFlag () {
    try { return win.sessionStorage.getItem(OPEN_KEY) === '1' } catch (e) { return false }
  }
  function writeOpenFlag (on) {
    try { win.sessionStorage.setItem(OPEN_KEY, on ? '1' : '0') } catch (e) {}
  }

  function open () {
    if (root.classList.contains('open')) return
    root.classList.add('open')
    writeOpenFlag(true)
    render()
  }
  function close () {
    root.classList.remove('open')
    writeOpenFlag(false)
  }

  // 窗口从隐藏变回可见时恢复面板
  try {
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'visible' && readOpenFlag() && !root.classList.contains('open')) open()
    })
  } catch (e) {}
  // 补一条：宿主重新进入插件时也恢复（部分场景不触发 visibilitychange）
  try {
    if (win.ztools && typeof win.ztools.onPluginEnter === 'function') {
      win.ztools.onPluginEnter(function () { if (readOpenFlag()) open() })
    }
  } catch (e) {}
  // 首次挂载时若上次会话面板是开的，直接打开
  if (readOpenFlag()) setTimeout(function () { try { open() } catch (e) {} }, 80)
  function toggle () {
    if (root.classList.contains('open')) close()
    else open()
  }

  $('zgs-close').onclick = close
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) close()
  })

  // 点击设置面板以外的地方（编辑器 / 空状态）自动收起，和 Git 面板行为一致
  function maybeHide (target) {
    if (!root.classList.contains('open')) return
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null
    if (!el) return
    if (el.closest('#zgs-root') || el.closest('#zgp-root') || el.closest('#zgp-view') || el.closest('#znotes-sbtn')) return
    if (el.closest('.editor-body') || el.closest('[contenteditable="true"]') || el.closest('.worknote-empty')) close()
  }
  doc.addEventListener('mousedown', function (e) { maybeHide(e.target) }, true)

  // ---------- 侧边栏底部按钮 ----------
  function mountSidebarButton () {
    const body = doc.querySelector('.sidebar-body')
    if (!body) return false
    if (doc.getElementById('znotes-sbtn-wrap')) return true
    const wrap = doc.createElement('div')
    wrap.id = 'znotes-sbtn-wrap'
    wrap.className = 'znotes-footer'
    wrap.innerHTML = '<button id="znotes-sbtn" class="znotes-sbtn" title="设置：笔记目录、自动同步、提交选项">' +
      ICON.gear + '<span>设置</span></button>'
    body.appendChild(wrap)
    const btn = wrap.querySelector('#znotes-sbtn')
    btn.onclick = function (ev) {
      ev.stopPropagation()
      toggle()
    }
    // 让树所在的那个（无 class 的）容器成为可收缩的 flex 项，
    // 否则树的高度会把侧边栏撑破、盖住底部按钮栏
    const treeEl = doc.querySelector('.sidebar-tree')
    if (treeEl && treeEl.parentElement && treeEl.parentElement !== body) {
      const holder = treeEl.parentElement
      holder.style.flex = '1 1 auto'
      holder.style.minHeight = '0'
      holder.style.overflow = 'hidden'
      treeEl.style.height = '100%'
      treeEl.style.boxSizing = 'border-box'
    }
    return true
  }
  // 侧边栏可能是异步渲染的，重试几次
  if (!mountSidebarButton()) {
    let tries = 0
    const t = setInterval(function () {
      tries++
      if (mountSidebarButton() || tries > 40) clearInterval(t)
    }, 500)
  }

  // 暴露给 bundle（Git 面板标题栏不需要，留接口给后续）
  win.__zgsToggle = toggle
  win.__zgsOpen = open
  win.__zgsClose = close
  win.__zgsIsOpen = function () { return root.classList.contains('open') }
  // 建仓向导完成 / 开关变更时重算仓库状态（只注册一次；render 会被反复调用）
  try {
    win.addEventListener('cmark-git-changed', function () {
      try { if (typeof win.__zgsRefreshGitSection === 'function') win.__zgsRefreshGitSection() } catch (e) {}
    })
  } catch (e) {}

  win.__zgsRender = render
  logBoot('done, btn=' + !!doc.getElementById('znotes-sbtn'))
}