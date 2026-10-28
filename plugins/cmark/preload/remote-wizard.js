/**
 * remote-wizard.js —— 一键建仓向导（GitHub Device Flow / Gitee 私人令牌）
 *
 * 界面约束（ZTools 插件里不能用的东西）：
 *   - 不用 window.confirm / alert：原生模态会抢焦点，宿主随即隐藏插件窗口
 *   - 不用 location.reload()
 * 所以确认与进度都在自建遮罩层里完成。
 */
module.exports = function attachRemoteWizard (win) {
  const doc = win.document
  if (!doc) return
  if (!doc.body) { setTimeout(function () { try { attachRemoteWizard(win) } catch (e) {} }, 60); return }

  const R = function () { return win.__CMARK_REMOTE }
  const LABEL = { github: 'GitHub', gitee: 'Gitee' }

  function injectCss () {
    if (doc.getElementById('crw-css')) return
    const st = doc.createElement('style')
    st.id = 'crw-css'
    st.textContent = `
    .crw-mask{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);
      display:flex;align-items:center;justify-content:center;}
    .crw-card{width:min(460px,calc(100vw - 48px));max-height:86vh;overflow:auto;
      background:var(--zgp-bg,#fff);color:var(--zgp-fg,#1f2328);
      border:1px solid var(--zgp-bd,#e3e6ea);border-radius:12px;
      box-shadow:var(--zgp-shadow,0 8px 32px rgba(0,0,0,.18));padding:18px;}
    .crw-h{font-size:14px;font-weight:600;margin:0 0 4px;display:flex;align-items:center;justify-content:space-between;}
    .crw-x{cursor:pointer;border:none;background:transparent;color:var(--zgp-fg3,#8b949e);font-size:18px;line-height:1;}
    .crw-desc{font-size:12px;line-height:1.75;color:var(--zgp-fg2,#57606a);}
    .crw-code{font-family:Consolas,Menlo,monospace;font-size:26px;letter-spacing:.28em;
      text-align:center;padding:14px 0;margin:10px 0;border-radius:10px;
      background:var(--zgp-bg3,#eef0f4);color:var(--zgp-fg,#1f2328);user-select:all;}
    .crw-row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
    .crw-row.end{justify-content:flex-end;}
    .crw-b{padding:6px 14px;border-radius:7px;border:1px solid var(--zgp-bd2,#d0d7de);
      background:var(--zgp-bg,#fff);color:var(--zgp-fg2,#57606a);font-size:12.5px;cursor:pointer;}
    .crw-b:hover{border-color:var(--zgp-acc,#2563eb);color:var(--zgp-acc,#2563eb);}
    .crw-b.primary{background:var(--zgp-acc,#2563eb);border-color:var(--zgp-acc,#2563eb);color:#fff;}
    .crw-b[disabled]{opacity:.5;cursor:not-allowed;}
    .crw-url{flex:1;min-width:0;font-family:Consolas,Menlo,monospace;font-size:11.5px;line-height:1.5;
      padding:7px 9px;border-radius:6px;background:var(--zgp-bg3,#eef0f4);
      color:var(--zgp-fg2,#57606a);word-break:break-all;user-select:all;}
    .crw-in{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:7px;
      border:1px solid var(--zgp-bd2,#d0d7de);background:var(--zgp-bg,#fff);
      color:var(--zgp-fg,#1f2328);font-size:12.5px;font-family:inherit;}
    .crw-in:focus{outline:none;border-color:var(--zgp-acc,#2563eb);}
    .crw-sel{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:7px;
      border:1px solid var(--zgp-bd2,#d0d7de);background:var(--zgp-bg,#fff);
      color:var(--zgp-fg,#1f2328);font-size:12.5px;}
    .crw-msg{font-size:12px;margin-top:10px;line-height:1.7;}
    .crw-ok{color:var(--zgp-ok,#1a7f37);}
    .crw-err{color:var(--zgp-err,#cf222e);}
    .crw-dim{color:var(--zgp-fg3,#8b949e);}
    .crw-step{font-size:11.5px;color:var(--zgp-fg3,#8b949e);margin-bottom:8px;}
    `
    try { (doc.head || doc.documentElement).appendChild(st) } catch (e) {}
  }

  function open (provider) {
    const api = R()
    if (!api) return
    injectCss()
    if (doc.getElementById('crw-mask')) doc.getElementById('crw-mask').remove()

    const mask = doc.createElement('div')
    mask.className = 'crw-mask'
    mask.id = 'crw-mask'
    mask.innerHTML = `
      <div class="crw-card">
        <div class="crw-h"><span>绑定 ${LABEL[provider] || ''}</span><button class="crw-x" id="crw-close">×</button></div>
        <div class="crw-step" id="crw-step"></div>
        <div id="crw-body"></div>
      </div>`
    doc.body.appendChild(mask)
    const $ = function (id) { return mask.querySelector('#' + id) }
    const body = $('crw-body')
    const stepEl = $('crw-step')
    const close = function () {
      try { if (typeof stopPoll === 'function') stopPoll() } catch (e) {}
      try { mask.remove() } catch (e) {}
      // 注意：这里不写 Git 开关。取消/关闭不等于建仓成功，只有成功分支才置为开启
      try { win.dispatchEvent(new CustomEvent('cmark-git-changed')) } catch (e) {}
    }
    mask.addEventListener('click', function (e) { if (e.target === mask) close() })
    $('crw-close').onclick = close

    const state = { provider: provider, token: '', login: '', repos: [], timer: null }

    function stopPoll () { if (state.timer) { clearTimeout(state.timer); state.timer = null } }

    // 打开外部窗口前先提示：宿主的窗口策略是失焦即隐藏，授权页一开插件就收起
    function confirmExternal (url) {
      const box = doc.createElement('div')
      box.className = 'crw-mask'
      box.style.zIndex = '100001'
      box.innerHTML = '<div class="crw-card">' +
        '<div class="crw-h"><span>即将打开外部窗口</span><button class="crw-x" id="ce-x">×</button></div>' +
        '<div class="crw-desc">CMark 窗口可能会被隐藏。<br>完成授权后重新呼出 CMark（快捷键），授权进度会保留，可以继续完成设置。</div>' +
        '<div class="crw-row end"><button class="crw-b" id="ce-cancel">取消</button>' +
        '<button class="crw-b primary" id="ce-ok">继续打开</button></div></div>'
      doc.body.appendChild(box)
      const closeBox = function () { try { box.remove() } catch (e) {} }
      box.querySelector('#ce-x').onclick = closeBox
      box.querySelector('#ce-cancel').onclick = closeBox
      box.querySelector('#ce-ok').onclick = function () { closeBox(); api.openUrl(url) }
    }

    // ---- GitHub：申请设备码并轮询 ----
    function ghAuth () {
      stepEl.textContent = '第 1 步 / 共 2 步：授权 GitHub'
      body.innerHTML = '<div class="crw-desc">正在向 GitHub 申请设备码…</div>'
      api.ghStart().then(function (r) {
        if (!r.ok) {
          body.innerHTML = '<div class="crw-msg crw-err">' + esc(r.message) + '</div>'
          return
        }
        const secs = Math.round((r.expiresIn || 900) / 60)
        body.innerHTML = `
          <div class="crw-desc">在浏览器里打开下面的地址，输入这串代码并确认授权（${secs} 分钟内有效）：</div>
          <div class="crw-code">${esc(r.userCode)}</div>
          <div class="crw-row">
            <button class="crw-b" id="crw-copy">复制代码</button>
            <button class="crw-b primary" id="crw-open">打开授权页面</button>
          </div>
          <div class="crw-msg crw-dim" id="crw-wait">等待你在浏览器里确认…（授权完成会自动继续）</div>`
        const openBtn = mask.querySelector('#crw-open')
        if (openBtn) openBtn.onclick = function () { confirmExternal(r.verificationUri) }
        const copyBtn = mask.querySelector('#crw-copy')
        if (copyBtn) {
          copyBtn.onclick = function () {
            try {
              if (win.navigator && win.navigator.clipboard) win.navigator.clipboard.writeText(r.userCode)
              else if (win.ztools && win.ztools.copyText) win.ztools.copyText(r.userCode)
              copyBtn.textContent = '已复制'
            } catch (e) {}
          }
        }
        const tick = function () {
          api.ghPoll(r.deviceCode).then(function (p) {
            if (p.ok) {
              state.token = p.token
              return afterToken()
            }
            if (p.message) {
              const w = mask.querySelector('#crw-wait')
              if (w) { w.className = 'crw-msg crw-err'; w.textContent = p.message }
              return
            }
            const w = mask.querySelector('#crw-wait')
            if (w) w.textContent = '等待你在浏览器里确认…（授权完成会自动继续）'
            state.timer = setTimeout(tick, (r.interval || 5) * 1000)
          })
        }
        state.timer = setTimeout(tick, (r.interval || 5) * 1000)
      })
    }

    // ---- Gitee：粘贴私人令牌 ----
    function giteeAuth () {
      stepEl.textContent = '第 1 步 / 共 2 步：填写 Gitee 私人令牌'
      const TOKEN_URL = 'https://gitee.com/profile/personal_access_tokens'
      body.innerHTML = `
        <div class="crw-desc">打开下面的地址生成私人令牌（勾选 <b>projects</b> 权限），复制后粘贴到下方。</div>
        <div class="crw-row" style="margin-top:10px;align-items:center;gap:8px">
          <span class="crw-url" id="crw-token-url">${TOKEN_URL}</span>
          <button class="crw-b" id="crw-copy-token-url" style="flex:0 0 auto">复制</button>
        </div>
        <div class="crw-row" style="margin-top:12px"><input class="crw-in" id="crw-tk" placeholder="粘贴私人令牌" /></div>
        <div class="crw-row end"><button class="crw-b primary" id="crw-verify">验证并继续</button></div>
        <div class="crw-msg" id="crw-tkmsg"></div>`
      const copyUrlBtn = mask.querySelector('#crw-copy-token-url')
      if (copyUrlBtn) {
        copyUrlBtn.onclick = function () {
          let ok = false
          try {
            if (win.ztools && typeof win.ztools.copyText === 'function') { win.ztools.copyText(TOKEN_URL); ok = true }
            else if (win.navigator && win.navigator.clipboard) { win.navigator.clipboard.writeText(TOKEN_URL); ok = true }
          } catch (e) { ok = false }
          copyUrlBtn.textContent = ok ? '已复制' : '复制失败'
          setTimeout(function () { copyUrlBtn.textContent = '复制' }, 1600)
        }
      }
      const btn = mask.querySelector('#crw-verify')
      btn.onclick = function () {
        const tk = (mask.querySelector('#crw-tk').value || '').trim()
        if (!tk) return
        btn.disabled = true
        const m = mask.querySelector('#crw-tkmsg')
        m.className = 'crw-msg crw-dim'
        m.textContent = '验证中…'
        api.giteeVerify(tk).then(function (r) {
          btn.disabled = false
          if (!r.ok) {
            m.className = 'crw-msg crw-err'
            m.textContent = r.message
            return
          }
          state.token = tk
          afterToken()
        })
      }
    }

    // ---- 授权完成：列仓库 + 新建/选择 ----
    function afterToken () {
      stopPoll()
      stepEl.textContent = '第 2 步 / 共 2 步：选择仓库'
      body.innerHTML = '<div class="crw-desc">正在读取你的仓库列表…</div>'
      const listFn = state.provider === 'github' ? api.ghListRepos : api.giteeListRepos
      const userFn = state.provider === 'github' ? api.ghUser : api.giteeVerify
      userFn(state.token).then(function (u) {
        if (!u.ok) {
          body.innerHTML = '<div class="crw-msg crw-err">' + esc(u.message) + '</div>'
          return
        }
        state.login = u.login || ''
        return listFn(state.token).then(function (r) {
          if (!r.ok) {
            body.innerHTML = '<div class="crw-msg crw-err">' + esc(r.message) + '</div>'
            return
          }
          state.repos = r.repos || []
          renderPick()
        })
      })
    }

    function renderPick () {
      const opts = state.repos.map(function (x) {
        return '<option value="' + esc(x.url) + '">' + esc(x.fullName) + (x.private ? '（私有）' : '') + '</option>'
      }).join('')
      // 建仓目标是工作区（仓库根），不是笔记子目录
      let ws = ''
      try { ws = (win.__CMARK && win.__CMARK.repoDir ? win.__CMARK.repoDir() : '') || '' } catch (e) {}
      if (!ws) ws = win.__ZNOTES_WS || ''
      body.innerHTML = `
        <div class="crw-desc">已授权 <b>${esc(state.login)}</b>。当前笔记目录：<br><span class="crw-dim">${esc(ws || '未设置')}</span></div>
        <div class="crw-row" style="margin-top:14px">
          <label class="crw-desc"><input type="radio" name="crw-mode" value="new" checked> 新建仓库</label>
          <label class="crw-desc"><input type="radio" name="crw-mode" value="existing"> 使用已有仓库</label>
        </div>
        <div id="crw-new" class="crw-row"><input class="crw-in" id="crw-name" placeholder="仓库名，如 cmark-notes" value="cmark-notes" /></div>
        <div id="crw-old" class="crw-row" style="display:none"><select class="crw-sel" id="crw-repolist">${opts || '<option value="">（没有可用仓库）</option>'}</select></div>
        <div class="crw-row end"><button class="crw-b primary" id="crw-go">绑定并同步</button></div>
        <div class="crw-msg" id="crw-go-msg"></div>`
      const radios = mask.querySelectorAll('input[name=crw-mode]')
      for (let i = 0; i < radios.length; i++) {
        radios[i].onchange = function () {
          const isNew = mask.querySelector('input[name=crw-mode]:checked').value === 'new'
          mask.querySelector('#crw-new').style.display = isNew ? 'flex' : 'none'
          mask.querySelector('#crw-old').style.display = isNew ? 'none' : 'flex'
        }
      }
      mask.querySelector('#crw-go').onclick = function () {
        const goBtn = mask.querySelector('#crw-go')
        const msg = mask.querySelector('#crw-go-msg')
        const isNew = mask.querySelector('input[name=crw-mode]:checked').value === 'new'
        if (!ws) {
          msg.className = 'crw-msg crw-err'
          msg.textContent = '还没有笔记目录，请先在设置里选择目录'
          return
        }
        goBtn.disabled = true
        msg.className = 'crw-msg crw-dim'
        msg.textContent = isNew ? '正在创建远程仓库…' : '正在绑定已有仓库…'
        const createFn = state.provider === 'github' ? api.ghCreateRepo : api.giteeCreateRepo
        const start = isNew
          ? createFn(state.token, (mask.querySelector('#crw-name').value || 'cmark-notes').trim(), true)
          : Promise.resolve({ ok: true, url: mask.querySelector('#crw-repolist').value })
        start.then(function (c) {
          if (!c.ok) {
            goBtn.disabled = false
            msg.className = 'crw-msg crw-err'
            msg.textContent = c.message || '创建仓库失败'
            return
          }
          msg.textContent = '正在初始化本地仓库并推送…'
          return api.bind({
            provider: state.provider,
            url: c.url,
            token: state.token,
            dir: ws,
            existing: !isNew
          }).then(function (b) {
            goBtn.disabled = false
            if (!b.ok) {
              msg.className = 'crw-msg crw-err'
              msg.textContent = (b.message || '绑定失败') + (b.steps && b.steps.length ? '（已完成：' + b.steps.join(' / ') + '）' : '')
              return
            }
            // 建仓真的成功了：打开 Git 集成开关（按当前工作区落盘），再锁定界面
            try { if (win.__CMARK_GIT && win.__CMARK_GIT.set) win.__CMARK_GIT.set(true) } catch (e) {}
            // git 服务是在插件启动时探测仓库的；刚建好的仓库要让它重新探测一次，
            // 否则设置面板会一直显示「本地仓库未绑定」，直到重启插件
            try { if (win.__znotesGit && win.__znotesGit.rediscover) win.__znotesGit.rediscover() } catch (e) {}
            // 成功即锁定：清空可选仓库/输入，只留一个「完成按钮」，避免继续改配置把状态搞乱
            stopPoll()
            stepEl.textContent = '已完成'
            body.innerHTML = `
              <div class="crw-desc"><b>${state.provider === 'github' ? 'GitHub' : 'Gitee'}</b> 仓库已绑定</div>
              <div class="crw-code" style="font-size:12.5px;letter-spacing:0;padding:12px;word-break:break-all;text-align:left">${esc(c.url)}</div>
              <dl class="crw-kv" style="display:grid;grid-template-columns:56px 1fr;gap:6px 10px;font-size:12px;color:var(--zgp-fg2,#57606a)">
                <dt>目录</dt><dd style="margin:0">${esc(ws)}</dd>
                <dt>步骤</dt><dd style="margin:0">${esc((b.steps || []).join(' / ') || '已完成')}</dd>
              </dl>
              <div class="crw-msg crw-dim" style="margin-top:10px">这个窗口可以关掉了。之后的改动按设置里的自动同步策略推送。</div>
              <div class="crw-row end"><button class="crw-b primary" id="crw-done">完成</button></div>`
            const doneBtn = mask.querySelector('#crw-done')
            if (doneBtn) doneBtn.onclick = close
            return
          })
        })
      }
    }

    if (provider === 'github') ghAuth()
    else giteeAuth()
  }

  function esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  win.__CMARK_OPEN_WIZARD = open
}