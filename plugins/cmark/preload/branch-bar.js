/**
 * branch-bar.js —— 侧边栏顶部的 git 工具条
 *
 * 布局：[⎇ 分支名] [拉取] [推送] [刷新]
 *   - 左边的按钮只显示当前分支，点击直接打开「工作区变更记录」面板（不做分支切换）
 *   - 右边三个按钮：git pull / git push / 刷新分支状态
 *
 * 设计取舍（用户定的）：笔记场景不需要分支工作流，所以这里不提供分支列表、
 * 切换、新建等交互；分支名只作为"我在哪"的状态显示。
 */

module.exports = function installBranchBar (win) {
  var doc = win.document
  if (!doc) return
  if (!doc.body) {
    setTimeout(function () { try { installBranchBar(win) } catch (e) {} }, 80)
    return
  }

  var ROOT = 'zbb-root'
  var CSSID = 'zbb-css'
  if (doc.getElementById(ROOT)) return

  var G = win.__znotesGit
  var busy = false

  function $(id) { return doc.getElementById(id) }
  // 不再发 Windows 系统通知（成功失败都打扰）。这条旧版分支条已由 React 版
  // BranchBar.tsx 取代，这里保留空实现只为不破坏内部调用点。
  function toast (text) {
    void text
  }

  function injectCss () {
    if (doc.getElementById(CSSID)) return
    var css = [
      '.sidebar-body{padding-top:36px !important;}',
      '#' + ROOT + '{position:absolute;top:0;left:0;right:0;height:36px;z-index:6;display:flex;align-items:center;gap:4px;',
      '  padding:0 8px;box-sizing:border-box;--bfg:#1f2328;--bbd:#e2e6eb;--bsoft:#f4f6f8;--bsub:#7b838d;}',
      ":root[data-theme='dark'] #" + ROOT + '{--bfg:#e6edf3;--bbd:#30363d;--bsoft:#22272e;--bsub:#8b949e;}',
      '#' + ROOT + ' .zbb-branch{flex:1;min-width:0;display:flex;align-items:center;gap:5px;height:26px;padding:0 7px;',
      '  border:1px solid var(--bbd);border-radius:7px;background:transparent;color:var(--bfg);font-size:12px;cursor:pointer;',
      '  font-family:inherit;transition:background .14s,border-color .14s;}',
      '#' + ROOT + ' .zbb-branch:hover{background:var(--bsoft);}',
      '#' + ROOT + ' .zbb-branch svg{flex:0 0 auto;opacity:.75;}',
      '#' + ROOT + ' .zbb-bname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;}',
      '#' + ROOT + ' .zbb-dirty{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#e0a03a;display:none;}',
      '#' + ROOT + ' .zbb-dirty.on{display:block;}',
      '#' + ROOT + ' .zbb-btn{flex:0 0 auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;',
      '  border:1px solid var(--bbd);border-radius:7px;background:transparent;color:var(--bfg);cursor:pointer;opacity:.8;',
      '  transition:background .14s,opacity .14s;}',
      '#' + ROOT + ' .zbb-btn:hover{background:var(--bsoft);opacity:1;}',
      '#' + ROOT + '.is-off{opacity:.45;filter:grayscale(1);}',
      '#' + ROOT + '.is-off > *{pointer-events:none;}',
      '#zbb-lock{position:absolute;top:0;left:0;right:0;height:36px;z-index:7;display:none;cursor:not-allowed;}',
      '#zbb-lock.on{display:block;}',
      '#' + ROOT + ' .zbb-btn:disabled{opacity:.35;cursor:default;}',
      '#' + ROOT + ' .zbb-btn.busy svg{animation:zbb-spin 1s linear infinite;}',
      '@keyframes zbb-spin{to{transform:rotate(360deg)}}'
    ].join('\n')
    var st = doc.createElement('style')
    st.id = CSSID
    st.textContent = css
    ;(doc.head || doc.body).appendChild(st)
  }

  var ICON = {
    branch: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M5 3.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0zM3.75 5.9a2.75 2.75 0 1 0-1.5 0v4.2a2.75 2.75 0 1 0 1.5 0V8.5h3.5a2.5 2.5 0 0 0 2.5-2.5V5.9a2.75 2.75 0 1 0-1.5 0v.1a1 1 0 0 1-1 1h-3.5zM12.25 5.15a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zM4.5 13.05a1.25 1.25 0 1 0-1.5-1.24v1.24z"/></svg>',
    pull: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 1.5a.75.75 0 0 1 .75.75v6.94l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5zM2.5 12.5a.75.75 0 0 1 .75.75v.25h9.5v-.25a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 .75-.75z"/></svg>',
    push: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 14.5a.75.75 0 0 1-.75-.75V6.81L5.03 9.03a.75.75 0 0 1-1.06-1.06l3.5-3.5a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 1 1-1.06 1.06L8.75 6.81v6.94a.75.75 0 0 1-.75.75zM2.5 2.5a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-.25h-9.5v.25a.75.75 0 0 1-1.5 0v-1z"/></svg>',
    sync: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>'
  }

  function gitEnabled () {
    // 优先用 preload 的配置接口（file:// 下 localStorage 可能不可用）
    try {
      const v = win.__CMARK_GIT && win.__CMARK_GIT.get ? win.__CMARK_GIT.get() : undefined
      if (v === true || v === false) return v
    } catch (e) {}
    try { return win.localStorage.getItem('cmark-git-enabled') !== '0' } catch (e) { return true }
  }

  function applyGitGate () {
    var root = doc.getElementById(ROOT)
    if (!root) return
    var on = gitEnabled()
    root.classList.toggle('is-off', !on)
    var lock = doc.getElementById('zbb-lock')
    if (lock) lock.classList.toggle('on', !on)
  }

  function mount () {
    if (doc.getElementById(ROOT)) return true
    var sb = doc.querySelector('.sidebar-body')
    if (!sb) return false
    injectCss()
    var root = doc.createElement('div')
    root.id = ROOT
    root.innerHTML = [
      '<button class="zbb-branch" type="button" id="zbb-open" title="打开工作区变更记录">',
      '  ' + ICON.branch,
      '  <span class="zbb-bname" id="zbb-bname">—</span>',
      '  <span class="zbb-dirty" id="zbb-dirty" title="有未提交的改动"></span>',
      '</button>',
      '<button class="zbb-btn" type="button" id="zbb-pull" title="拉取（git pull）">' + ICON.pull + '</button>',
      '<button class="zbb-btn" type="button" id="zbb-push" title="推送（git push）">' + ICON.push + '</button>',
      '<button class="zbb-btn" type="button" id="zbb-sync" title="同步（拉取然后推送）">' + ICON.sync + '</button>'
    ].join('')
    sb.insertBefore(root, sb.firstChild)
    // Git 集成关掉时整条操作栏置灰、不可点，用覆盖层给出悬浮提示
    var lock = doc.createElement('div')
    lock.id = 'zbb-lock'
    lock.title = '请在设置中开启 Git 集成'
    sb.insertBefore(lock, root.nextSibling)
    applyGitGate()

    // 左边按钮 = 打开「工作区变更记录」面板
    $('zbb-open').onclick = function () {
      try {
        if (win.__zgpOpen) win.__zgpOpen('global')
        else if (win.__zgpToggle) win.__zgpToggle('global')
        else toast('变更记录面板不可用')
      } catch (e) { toast('打开面板失败：' + (e && e.message)) }
    }
    $('zbb-pull').onclick = function () { runAction('pull') }
    $('zbb-push').onclick = function () { runAction('push') }
    $('zbb-sync').onclick = function () { runAction('sync') }
    refreshState(false)
    return true
  }

  // 读当前分支 + 是否有未提交改动，用于显示
  function refreshState (feedback) {
    var nameEl = $('zbb-bname')
    var dotEl = $('zbb-dirty')
    if (!nameEl) return
    var st
    try { st = G && G.state ? G.state() : null } catch (e) { st = null }
    if (!st || !st.then) return
    st.then(function (r) {
      var ok = r && r.ok && r.data
      var name = ok && r.data.branch ? r.data.branch : ''
      var isRepo = ok && r.data.isRepo
      nameEl.textContent = name || (isRepo ? '(无分支)' : 'git')
      nameEl.title = isRepo ? ('当前分支：' + (name || '(detached)') + '，点击查看改动与历史') : '这个文件夹还不是 git 仓库，点击查看'
      if (dotEl) dotEl.classList.toggle('on', !!(ok && r.data.dirty > 0))
      if (feedback) toast(isRepo ? ('分支 ' + (name || '?') + (r.data.dirty > 0 ? '，有 ' + r.data.dirty + ' 个文件未提交' : '，没有未提交改动')) : '这个文件夹还不是 git 仓库')
    }).catch(function () {})
  }

  function setBusy (on) {
    busy = on
    ;['zbb-pull', 'zbb-push', 'zbb-sync'].forEach(function (id) {
      var b = $(id)
      if (b) { b.disabled = on; b.classList.toggle('busy', on && id === 'zbb-sync') }
    })
  }

  function runAction (kind) {
    if (busy) return
    if (!G) { toast('git 服务不可用'); return }
    var fn = kind === 'pull' ? G.pull : (kind === 'push' ? G.push : G.sync)
    if (typeof fn !== 'function') { toast('这个操作不可用'); return }
    var doneText = kind === 'pull' ? '已拉取' : (kind === 'push' ? '已推送' : '已同步')
    var failText = kind === 'pull' ? '拉取失败：' : (kind === 'push' ? '推送失败：' : '同步失败：')
    setBusy(true)
    Promise.resolve(fn.call(G)).then(function (r) {
      setBusy(false)
      refreshState(false)
      if (r && r.ok) {
        if (kind === 'sync' && r.data && r.data.local) toast('已提交到本机（未配置远程仓库）')
        else toast(doneText)
      } else {
        toast(failText + ((r && r.message) || '未知原因'))
      }
    }).catch(function (e) {
      setBusy(false)
      toast('操作失败：' + (e.message || ''))
    })
  }

  // 供变更面板在 push/pull/sync 之后主动刷新顶部分支与脏标记，
  // 否则要等下一次轮询（约 3 秒）才更新
  try { win.__zbbRefresh = function () { try { refreshState(false) } catch (e) {} } } catch (e) {}

  // 设置里切换 Git 集成、或窗口重新可见时，同步整条操作栏的可用状态
  try { win.addEventListener('cmark-git-changed', applyGitGate) } catch (e) {}
  try {
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'visible') applyGitGate()
    })
  } catch (e) {}

  if (!mount()) {
    var tries = 0
    var timer = setInterval(function () {
      tries++
      if (mount() || tries > 40) clearInterval(timer)
    }, 500)
  }
}
