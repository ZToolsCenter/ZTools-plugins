/**
 * git-panel.js —— Git 面板（参照 Obsidian Git 的信息架构，纯 DOM 实现）
 *
 * 结构：顶部状态条 + 三个页签（改动 / 历史 / 设置）+ 底部动作区
 * 特性：
 *   - 深浅色自适应（prefers-color-scheme）
 *   - 改动列表只区分「未提交」文件，按类型着色，可丢弃 / 看差异（不暴露暂存区概念）
 *   - 历史列表可展开查看该提交的文件，点文件看该次改动
 *   - diff 视图按行着色（+绿 -红 @@蓝）
 *   - 当前打开的笔记在列表中高亮
 */
module.exports = function installGitPanel(win, WS) {
  const doc = win.document
  if (!doc) return
  if (doc.readyState === 'loading' || !doc.head || !doc.body) {
    doc.addEventListener('DOMContentLoaded', function () { installGitPanel(win, WS) })
    return
  }
  // 结构自检：面板可能由旧版本创建（缺少新容器），这种情况直接重建
  {
    const oldRoot = doc.getElementById('zgp-root')
    if (oldRoot) {
      const ok = oldRoot.querySelector('#zgp-chips') && oldRoot.querySelector('#zgp-fileact')
      if (ok) return
      try { oldRoot.remove() } catch (e) {}
    }
  }

  const G = win.__znotesGit
  if (!G) return

  // ============ 样式 ============
  const css = `
  :root{
    --zgp-bg:#ffffff; --zgp-bg2:#f7f8fa; --zgp-bg3:#eef0f4;
    --zgp-fg:#1f2328; --zgp-fg2:#57606a; --zgp-fg3:#8b949e;
    --zgp-bd:#e3e6ea; --zgp-bd2:#d0d7de;
    --zgp-acc:#2563eb; --zgp-acc-bg:#eff5ff;
    --zgp-ok:#1a7f37; --zgp-warn:#bf8700; --zgp-err:#cf222e;
    --zgp-add:#e6ffec; --zgp-add-fg:#1a7f37;
    --zgp-del:#ffebe9; --zgp-del-fg:#cf222e;
    --zgp-hunk:#ddf4ff; --zgp-hunk-fg:#0969da;
    --zgp-shadow:0 8px 32px rgba(31,35,40,.14),0 2px 8px rgba(31,35,40,.08);
  }
  :root[data-theme='dark']{
      --zgp-bg:#161b22; --zgp-bg2:#1c2128; --zgp-bg3:#22272e;
      --zgp-fg:#e6edf3; --zgp-fg2:#9aa4b2; --zgp-fg3:#6e7681;
      --zgp-bd:#30363d; --zgp-bd2:#3d444d;
      --zgp-acc:#58a6ff; --zgp-acc-bg:#12233d;
      --zgp-ok:#3fb950; --zgp-warn:#d29922; --zgp-err:#f85149;
      --zgp-add:#0f2b1a; --zgp-add-fg:#3fb950;
      --zgp-del:#2d1214; --zgp-del-fg:#f85149;
      --zgp-hunk:#0c2d4a; --zgp-hunk-fg:#58a6ff;
      --zgp-shadow:0 8px 32px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4);
  }
  #zgp-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;padding:3px 10px;
    border:1px solid var(--zgp-bd2);border-radius:6px;background:var(--zgp-bg);color:var(--zgp-fg2);
    cursor:pointer;margin-right:6px;transition:all .15s;line-height:20px;}
  #zgp-btn:hover{background:var(--zgp-bg3);color:var(--zgp-fg);border-color:var(--zgp-acc);}
  #zgp-btn .zgp-dot{width:6px;height:6px;border-radius:50%;background:var(--zgp-warn);display:none;}
  #zgp-btn.zgp-dirty .zgp-dot{display:block;animation:zgp-pulse 1.8s ease-in-out infinite;}
  @keyframes zgp-pulse{0%,100%{opacity:1}50%{opacity:.35}}

  #zgp-root{position:fixed;top:0;right:0;width:520px;max-width:96vw;height:100%;z-index:99998;
    display:none;flex-direction:column;background:var(--zgp-bg);color:var(--zgp-fg);
    box-shadow:var(--zgp-shadow);font-size:13px;line-height:1.5;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;}
  #zgp-root.open{display:flex;animation:zgp-in .22s cubic-bezier(.2,.8,.2,1);}
  @keyframes zgp-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}

  .zgp-head{padding:14px 16px 10px;border-bottom:1px solid var(--zgp-bd);}
  .zgp-head-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}
  .zgp-title{font-size:14px;font-weight:600;letter-spacing:.2px;display:flex;align-items:center;gap:7px;white-space:nowrap;flex:1;min-width:0;overflow:hidden;}
  .zgp-title > svg{width:16px;height:16px;flex:0 0 16px;fill:currentColor;}
  .zgp-title > span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .zgp-close{border:none;background:none;color:var(--zgp-fg3);cursor:pointer;font-size:20px;line-height:1;flex:0 0 auto;
    padding:2px 6px;border-radius:6px;}
  .zgp-close:hover{background:var(--zgp-bg3);color:var(--zgp-fg);}
  .zgp-status{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;}
  .zgp-chips{display:flex;flex-wrap:wrap;gap:6px;min-width:0;flex:1 1 auto;}
  .zgp-acts{display:flex;align-items:center;gap:6px;flex:0 0 auto;}
  .zgp-fileact{display:flex;align-items:center;gap:6px;flex:0 0 auto;}
  .zgp-fileact .zgp-b{padding:3px 9px;font-size:11px;}
  .zgp-fileact .zgp-count{font-size:11px;color:var(--zgp-fg2);white-space:nowrap;}
  .zgp-acts .zgp-b{padding:3px 9px;font-size:11px;}
  .zgp-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;
    background:var(--zgp-bg2);border:1px solid var(--zgp-bd);color:var(--zgp-fg2);white-space:nowrap;}
  .zgp-chip b{font-weight:600;color:var(--zgp-fg);}
  .zgp-chip.ok{border-color:var(--zgp-ok);color:var(--zgp-ok);}
  .zgp-chip.warn{border-color:var(--zgp-warn);color:var(--zgp-warn);}
  .zgp-chip.err{border-color:var(--zgp-err);color:var(--zgp-err);}
  .zgp-chip.acc{border-color:var(--zgp-acc);color:var(--zgp-acc);}
  .zgp-spin{width:9px;height:9px;border:1.5px solid currentColor;border-right-color:transparent;
    border-radius:50%;display:inline-block;animation:zgp-rot .7s linear infinite;}
  @keyframes zgp-rot{to{transform:rotate(360deg)}}

  .zgp-tabs{display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--zgp-bd);}
  .zgp-tab{padding:7px 14px 9px;font-size:12.5px;font-weight:500;color:var(--zgp-fg2);cursor:pointer;
    border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s;
    display:flex;align-items:center;gap:6px;}
  .zgp-tab:hover{color:var(--zgp-fg);}
  .zgp-tab.on{color:var(--zgp-acc);border-bottom-color:var(--zgp-acc);}
  .zgp-tab .zgp-badge{min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--zgp-bg3);
    color:var(--zgp-fg2);font-size:10px;display:none;align-items:center;justify-content:center;font-weight:600;}
  .zgp-tab .zgp-badge.on{display:inline-flex;}
  .zgp-tab.on .zgp-badge{background:var(--zgp-acc-bg);color:var(--zgp-acc);}

  .zgp-body{flex:1;overflow:auto;overscroll-behavior:contain;}
  .zgp-pane{display:none;padding:0;}
  .zgp-pane.on{display:block;}
  .zgp-sec{padding:12px 16px;border-bottom:1px solid var(--zgp-bd);}
  .zgp-sec:last-child{border-bottom:none;}
  .zgp-sec h5{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--zgp-fg3);}

  .zgp-autoline{display:flex;align-items:center;justify-content:space-between;gap:8px;
    margin-top:7px;font-size:11.5px;color:var(--zgp-fg2);}
  .zgp-autoline .zgp-b{padding:2px 8px;font-size:11px;}
  .zgp-file{display:flex;align-items:center;gap:8px;padding:7px 16px;cursor:default;
    border-bottom:1px solid var(--zgp-bd);transition:background .12s;}
  .zgp-file:hover{background:var(--zgp-bg2);}
  .zgp-file.cur{background:var(--zgp-acc-bg);box-shadow:inset 3px 0 0 var(--zgp-acc);}
  .zgp-st{width:18px;height:18px;flex:0 0 18px;border-radius:4px;display:flex;align-items:center;
    justify-content:center;font-size:10px;font-weight:700;font-family:Consolas,Menlo,monospace;}
  .zgp-st.M{background:#fff4ce;color:#9a6700;}
  .zgp-st.A{background:var(--zgp-add);color:var(--zgp-add-fg);}
  .zgp-st.D{background:var(--zgp-del);color:var(--zgp-del-fg);}
  .zgp-st.Q{background:var(--zgp-bg3);color:var(--zgp-fg3);}
  .zgp-st.U{background:var(--zgp-del);color:var(--zgp-del-fg);}
  :root[data-theme='dark'] .zgp-st.M{background:#3a2d00;color:#d29922;}
  .zgp-fp{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    font-family:Consolas,Menlo,monospace;}
  .zgp-fp span{unicode-bidi:normal;}
  .zgp-ops{display:flex;gap:3px;opacity:0;transition:opacity .12s;}
  .zgp-file:hover .zgp-ops{opacity:1;}
  .zgp-ic{border:1px solid var(--zgp-bd2);background:var(--zgp-bg);color:var(--zgp-fg2);cursor:pointer;
    width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;padding:0;}
  .zgp-ic:hover{background:var(--zgp-acc-bg);border-color:var(--zgp-acc);color:var(--zgp-acc);}
  .zgp-ic.danger:hover{background:var(--zgp-del);border-color:var(--zgp-err);color:var(--zgp-err);}
  .zgp-ic svg{width:13px;height:13px;fill:currentColor;}

  .zgp-cm{padding:9px 16px;border-bottom:1px solid var(--zgp-bd);cursor:pointer;transition:background .12s;}
  .zgp-cm:hover{background:var(--zgp-bg2);}
  .zgp-cm.open{background:var(--zgp-bg2);}
  .zgp-cm1{display:flex;align-items:baseline;gap:8px;}
  .zgp-cm-sub{flex:1;min-width:0;font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap;color:var(--zgp-fg);}
  .zgp-cm-meta{font-size:11px;color:var(--zgp-fg3);margin-top:3px;font-family:Consolas,Menlo,monospace;}
  .zgp-hash{font-size:10.5px;font-family:Consolas,Menlo,monospace;padding:1px 5px;border-radius:4px;
    background:var(--zgp-bg3);color:var(--zgp-fg2);flex:0 0 auto;}
  .zgp-cmbody{display:none;margin-top:7px;padding-left:4px;border-left:2px solid var(--zgp-bd2);}
  .zgp-cm.open .zgp-cmbody{display:block;}
  .zgp-cmf{display:flex;align-items:center;gap:7px;padding:3px 0 3px 8px;font-size:11.5px;
    font-family:Consolas,Menlo,monospace;color:var(--zgp-fg2);cursor:pointer;border-radius:4px;}
  .zgp-cmf:hover{background:var(--zgp-bg3);color:var(--zgp-fg);}
  .zgp-cmf .zgp-fs{font-weight:700;width:12px;flex:0 0 12px;}
  .zgp-cmf .zgp-fs.A{color:var(--zgp-add-fg);} .zgp-cmf .zgp-fs.D{color:var(--zgp-del-fg);}
  .zgp-cmf .zgp-fs.M{color:var(--zgp-warn);}

  .zgp-field{margin-bottom:13px;}
  .zgp-field:last-child{margin-bottom:0;}
  .zgp-lab{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px;}
  .zgp-lab span{font-size:12.5px;color:var(--zgp-fg);}
  .zgp-desc{font-size:11px;color:var(--zgp-fg3);margin-top:4px;line-height:1.5;}
  .zgp-in,.zgp-sel{width:100%;box-sizing:border-box;padding:6px 9px;font-size:12px;border-radius:6px;
    border:1px solid var(--zgp-bd2);background:var(--zgp-bg);color:var(--zgp-fg);outline:none;
    font-family:inherit;transition:border-color .15s;}
  .zgp-in:focus,.zgp-sel:focus{border-color:var(--zgp-acc);box-shadow:0 0 0 3px var(--zgp-acc-bg);}
  .zgp-drawer{overflow:hidden;max-height:0;opacity:0;
    transition:max-height .26s ease,opacity .2s ease;}
  .zgp-drawer.open{max-height:520px;opacity:1;}
  .zgp-sw{position:relative;width:36px;height:20px;flex:0 0 36px;}
  .zgp-sw input{opacity:0;width:0;height:0;position:absolute;}
  .zgp-sw i{position:absolute;inset:0;background:var(--zgp-bd2);border-radius:999px;transition:.18s;cursor:pointer;}
  .zgp-sw i::after{content:"";position:absolute;width:16px;height:16px;left:2px;top:2px;background:#fff;
    border-radius:50%;transition:.18s;box-shadow:0 1px 3px rgba(0,0,0,.25);}
  .zgp-sw input:checked + i{background:var(--zgp-acc);}
  .zgp-sw input:checked + i::after{transform:translateX(16px);}

  .zgp-b{padding:6px 14px;font-size:12.5px;font-weight:500;border-radius:6px;cursor:pointer;
    border:1px solid var(--zgp-bd2);background:var(--zgp-bg);color:var(--zgp-fg);transition:all .15s;
    display:inline-flex;align-items:center;gap:6px;}
  .zgp-b:hover{background:var(--zgp-bg3);}
  .zgp-b:disabled{opacity:.5;cursor:not-allowed;}
  .zgp-b.primary{background:var(--zgp-acc);border-color:var(--zgp-acc);color:#fff;}
  .zgp-b.primary:hover{filter:brightness(1.08);}
  .zgp-b svg{width:13px;height:13px;fill:currentColor;}

  .zgp-radio{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12.5px;cursor:pointer;}
  .zgp-radio input{width:14px;height:14px;accent-color:var(--zgp-acc);cursor:pointer;}
  .zgp-empty{padding:34px 20px;text-align:center;color:var(--zgp-fg3);font-size:12.5px;line-height:1.9;}
  .zgp-empty b{display:block;color:var(--zgp-fg2);font-size:13px;margin-bottom:4px;font-weight:500;}

  #zgp-view{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100001;display:none;
    align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(2px);}
  #zgp-view.on{display:flex;}
  .zgp-vbox{background:var(--zgp-bg);color:var(--zgp-fg);width:min(1000px,96vw);height:min(82vh,860px);
    border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--zgp-shadow);}
  .zgp-vhead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;
    border-bottom:1px solid var(--zgp-bd);background:var(--zgp-bg2);}
  .zgp-vtitle{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    font-family:Consolas,Menlo,monospace;}
  .zgp-vbody{flex:1;overflow:auto;margin:0;font-family:Consolas,"Cascadia Mono",Menlo,monospace;
    font-size:12px;line-height:1.6;}
  .zgp-dl{display:block;padding:0 14px;white-space:pre-wrap;word-break:break-word;}
  .zgp-dl.add{background:var(--zgp-add);color:var(--zgp-add-fg);}
  .zgp-dl.del{background:var(--zgp-del);color:var(--zgp-del-fg);}
  .zgp-dl.hunk{background:var(--zgp-hunk);color:var(--zgp-hunk-fg);font-weight:600;}
  .zgp-dl.meta{color:var(--zgp-fg3);}
  .zgp-dl{padding:0 8px 0 0;}
  .zgp-ln{display:inline-block;width:42px;padding-right:10px;text-align:right;
    color:var(--zgp-fg3);opacity:.7;user-select:none;font-variant-numeric:tabular-nums;}
  .zgp-dl.add .zgp-ln{color:var(--zgp-add-fg);opacity:.85;}
  .zgp-dl.del .zgp-ln{color:var(--zgp-del-fg);opacity:.85;}
  .zgp-dl.oldno .zgp-ln{opacity:.45;font-style:italic;}
  .zgp-jumpbar{position:sticky;top:0;z-index:3;display:flex;justify-content:flex-end;
    padding:4px 8px 3px;background:var(--zgp-bg);}
  .zgp-jumpbar button{padding:3px 10px;font-size:11.5px;border-radius:6px;cursor:pointer;
    border:1px solid var(--zgp-bd2);background:var(--zgp-bg);color:var(--zgp-fg2);}
  .zgp-jumpbar button:hover{background:var(--zgp-acc-bg);border-color:var(--zgp-acc);color:var(--zgp-acc);}
  .zgp-dl.zgp-flash{outline:none !important;border:none !important;background:rgba(9,105,218,.16) !important;}
  :root[data-theme='dark'] .zgp-dl.zgp-flash{background:rgba(88,166,255,.30) !important;}

  .zgp-cf-ov{position:absolute;inset:0;background:rgba(0,0,0,.38);display:flex;align-items:center;
    justify-content:center;z-index:20;padding:20px;}
  .zgp-cf-card{background:var(--zgp-bg);border:1px solid var(--zgp-bd);border-radius:10px;
    padding:16px 16px 12px;width:100%;max-width:340px;box-shadow:var(--zgp-shadow);}
  .zgp-cf-msg{font-size:12.5px;line-height:1.75;white-space:pre-wrap;color:var(--zgp-fg);
    margin-bottom:14px;word-break:break-word;}
  .zgp-cf-btns{display:flex;justify-content:flex-end;gap:8px;}
  .zgp-b.danger{background:var(--zgp-err);border-color:var(--zgp-err);color:#fff;}
  #zgp-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%) translateY(12px);
    background:#1f2328;color:#fff;padding:9px 18px;border-radius:8px;font-size:12.5px;z-index:100002;
    opacity:0;pointer-events:none;transition:all .22s;box-shadow:0 6px 24px rgba(0,0,0,.3);max-width:70vw;}
  #zgp-toast.on{opacity:1;transform:translateX(-50%) translateY(0);}
  #zgp-toast.err{background:var(--zgp-err);}
  #zgp-toast.ok{background:var(--zgp-ok);}
  `

  const style = doc.createElement('style')
  style.textContent = css
  doc.head.appendChild(style)

  // ============ 图标 ============
  const ICON = {
    // 与工作区比对：文件 + 对勾箭头（该提交 → 现在的差异）
    cmpWork: '<svg viewBox="0 0 16 16"><path d="M2 1.75A.75.75 0 0 1 2.75 1h5.19c.2 0 .39.08.53.22l3.31 3.31a.75.75 0 0 1 .22.53v2.13a5.5 5.5 0 0 0-1.5-.44V5.5H7.75A.75.75 0 0 1 7 4.75V2.5H2.75v11h3.44c.28.55.66 1.04 1.11 1.46H2.75A.75.75 0 0 1 2 14.25V1.75z"/><path d="M11.75 8a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5zm1.72 2.78l-2.22 2.22a.75.75 0 0 1-1.06 0l-.97-.97a.75.75 0 1 1 1.06-1.06l.44.44 1.69-1.69a.75.75 0 1 1 1.06 1.06z"/></svg>',
    // 查看该版本：眼睛
    eye: '<svg viewBox="0 0 16 16"><path d="M8 3C4.5 3 1.7 5.3.5 8c1.2 2.7 4 5 7.5 5s6.3-2.3 7.5-5C14.3 5.3 11.5 3 8 3zm0 8.25a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5z"/><circle cx="8" cy="8" r="1.6"/></svg>',
    // 与提交前比对：时钟回溯（那次提交本身改了什么）
    cmpPrev: '<svg viewBox="0 0 16 16"><path d="M8 1.5a6.5 6.5 0 1 1-6.4 7.65h1.53A5 5 0 1 0 8 3v1.75L4.75 2.5 8-.25V1.5z" transform="translate(0,1)"/><path d="M7.25 5h1.5v3.4l2.2 1.3-.75 1.27-2.95-1.74V5z"/></svg>',
    git: '<svg viewBox="0 0 1024 1024"><path d="M512 64c-16.128 0-31.872 5.888-44 18.016l-90.016 90.976c-4.864 2.624-8.96 6.4-11.968 11.008l-284.032 284a62.304 62.304 0 0 0 0 88l386.016 386.016a62.56 62.56 0 0 0 88 0l386.016-386.016a62.304 62.304 0 0 0 0-88L555.968 81.984A61.536 61.536 0 0 0 512 64z m0 64.992L895.008 512 512 895.008 128.992 512l265.024-264.992 56 56A63.36 63.36 0 0 0 448 320c0 23.616 12.864 43.872 32 55.008v273.984c-19.136 11.136-32 31.36-32 55.008a63.968 63.968 0 1 0 128 0c0-23.616-12.864-43.872-32-55.008v-250.976l98.016 97.984A63.968 63.968 0 0 0 704 576c35.328 0 63.968-28.64 63.968-64a63.968 63.968 0 0 0-80-62.016L573.984 336A63.968 63.968 0 0 0 512 256a63.36 63.36 0 0 0-16.96 2.016l-56-56z"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M7.25 1.75a.75.75 0 0 1 1.5 0V7.25h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5z"/></svg>',
    undo: '<svg viewBox="0 0 16 16"><path d="M1.5 8a6.5 6.5 0 1 1 1.9 4.6.75.75 0 1 1 1.08-1.04A5 5 0 1 0 3.5 8v1.25a.75.75 0 0 1-1.5 0V8z"/><path d="M1 4.5a.75.75 0 0 1 1.5 0V6h1.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 6.75V4.5z"/></svg>',
    diff: '<svg viewBox="0 0 16 16"><path d="M1.75 1a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H1.75zM1.75 5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5zM1.75 9a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5zM1.75 13a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5z"/></svg>',
    sync: '<svg viewBox="0 0 16 16"><path d="M1.75 8a6.25 6.25 0 0 1 10.6-4.46l1.2-1.2a.5.5 0 0 1 .85.35v3.5a.5.5 0 0 1-.5.5h-3.5a.5.5 0 0 1-.35-.85l1.24-1.24A4.75 4.75 0 0 0 3.25 8a.75.75 0 0 1-1.5 0zm12.5 0a.75.75 0 0 1-1.5 0A4.75 4.75 0 0 0 4.06 12.2l1.24-1.24a.5.5 0 0 1 .85.35v3.5a.5.5 0 0 1-.5.5h-3.5a.5.5 0 0 1-.35-.85l1.2-1.2A6.25 6.25 0 0 1 1.75 8z"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M8 1.5l5 5-.9.9L8.5 3.8V15h-1V3.8L3.9 7.4 3 6.5z"/></svg>',
    down: '<svg viewBox="0 0 16 16"><path d="M8 14.5l-5-5 .9-.9L7.5 12.2V1h1v11.2l3.6-3.6.9.9z"/></svg>'
  }

  // ============ DOM ============
  const root = doc.createElement('div')
  root.id = 'zgp-root'
  root.innerHTML = `
    <div class="zgp-head">
      <div class="zgp-head-row">
        <div class="zgp-title"><span id="zgp-title-text" style="white-space:nowrap">工作区变更记录</span></div>
        <button class="zgp-close" id="zgp-close" title="关闭 (Esc)">×</button>
      </div>
      <div class="zgp-status" id="zgp-status">
        <div class="zgp-chips" id="zgp-chips"></div>
        <div class="zgp-acts">
          <button class="zgp-b" id="zgp-pull" title="从远端拉取提交">${ICON.down}<span>拉取</span></button>
          <button class="zgp-b" id="zgp-push" title="把本地提交推送到远端">${ICON.up}<span>推送</span></button>
          <button class="zgp-b primary" id="zgp-sync" title="提交本地改动并推送">${ICON.sync}<span>同步</span></button>
        </div>
        <div class="zgp-fileact" id="zgp-fileact"></div>
      </div>
    </div>
    <div class="zgp-tabs">
      <button class="zgp-tab on" data-tab="changes">改动<span class="zgp-badge" id="zgp-b1"></span></button>
      <button class="zgp-tab" data-tab="history">历史</button>
    </div>
    <div class="zgp-body">
      <div class="zgp-pane on" id="zgp-pane-changes"></div>
      <div class="zgp-pane" id="zgp-pane-history"></div>
    </div>
  `
  doc.body.appendChild(root)

  const view = doc.createElement('div')
  view.id = 'zgp-view'
  view.innerHTML = `
    <div class="zgp-vbox">
      <div class="zgp-vhead">
        <div class="zgp-vtitle" id="zgp-vtitle"></div>
        <button class="zgp-b" id="zgp-vclose">关闭</button>
      </div>
      <div class="zgp-vbody" id="zgp-vbody"></div>
    </div>
  `
  doc.body.appendChild(view)

  const toastEl = doc.createElement('div')
  toastEl.id = 'zgp-toast'
  doc.body.appendChild(toastEl)

  const $ = (id) => doc.getElementById(id)

  // ============ 小工具 ============
  let toastTimer = null
  function toast(text, kind) {
    toastEl.textContent = text || ''
    toastEl.className = 'on ' + (kind || '')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastEl.className = '' }, 3600)
  }

  // 把服务层的错误类型翻译成"原因 + 下一步建议"
  function hintOf(r) {
    const map = {
      network: '网络不通或远端不可达，检查网络后重试',
      auth: '认证失败，检查 SSH key 或 git 凭据',
      rejected: '远端有新提交，先点「拉取」再推送',
      diverged: '本地与远端已分叉，先推送本地提交或手动合并',
      conflict: '存在冲突，请先处理冲突文件',
      lock: '有 git 操作正在进行，稍后重试',
      detached: 'HEAD 处于游离状态，先切回分支',
      noUpstream: '当前分支没有上游分支，首次推送会自动设置',
      perm: '文件被占用或权限不足，可能被杀毒软件锁定',
      backup: '备份失败，操作已中止（你的文件没有被改动）',
      timeout: '命令超时，检查网络或仓库大小',
      busy: '上一个 git 操作还在进行中，稍等再试'
    }
    const msg = r.message || ''
    const hint = map[r.kind]
    return hint ? (hint + (msg && msg.indexOf(hint) < 0 ? '（' + msg.slice(0, 100) + '）' : '')) : (msg || r.kind || '未知原因')
  }

  // 面板内确认层：不用原生 confirm —— 它会抢焦点，导致宿主把插件窗口隐藏掉
  function askConfirm(message, okText) {
    return new Promise(function (resolve) {
      var ov = doc.createElement('div')
      ov.className = 'zgp-cf-ov'
      var card = doc.createElement('div')
      card.className = 'zgp-cf-card'
      var msg = doc.createElement('div')
      msg.className = 'zgp-cf-msg'
      msg.textContent = message
      var row = doc.createElement('div')
      row.className = 'zgp-cf-btns'
      var no = doc.createElement('button')
      no.className = 'zgp-b'
      no.textContent = '取消'
      var yes = doc.createElement('button')
      yes.className = 'zgp-b primary'
      yes.textContent = okText || '确定'
      row.appendChild(no)
      row.appendChild(yes)
      card.appendChild(msg)
      card.appendChild(row)
      ov.appendChild(card)
      root.appendChild(ov)
      var done = function (v) {
        try { ov.remove() } catch (e) {}
        try { doc.removeEventListener('keydown', onKey) } catch (e) {}
        resolve(v)
      }
      var onKey = function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); done(false) }
      }
      no.onclick = function () { done(false) }
      yes.onclick = function () { done(true) }
      ov.onclick = function (e) { if (e.target === ov) done(false) }
      doc.addEventListener('keydown', onKey)
      setTimeout(function () { try { yes.focus() } catch (e) {} }, 30)
    })
  }

  // 还原到最近一次提交：把该文件的未提交改动丢掉（服务层会同时清掉暂存区）
  async function doRestoreHead(rel) {
    let r = await G.discard(rel)
    if (!r.ok && r.kind === 'confirm-needed') {
      const ok = await askConfirm('把「' + rel + '」还原到最近一次提交？\n\n未提交的改动会丢失（不会被同步到 git）。', '还原')
      if (!ok) return { ok: false, kind: 'cancelled' }
      r = await G.discard(rel, { force: true })
    }
    return r
  }

  // 回溯：先请求，服务层发现有未提交改动会返回 confirm-needed，确认后带 force 重试
  async function doRestore(commit, rel, label) {
    let r = await G.restoreTo(commit, rel)
    if (!r.ok && r.kind === 'confirm-needed') {
      const ok = await askConfirm('「' + rel + '」有未提交的改动。\n\n回溯到 ' + (label || commit.slice(0, 7)) + ' 会直接覆盖这些改动，且无法恢复。\n\n确定继续？')
      if (!ok) return { ok: false, kind: 'cancelled' }
      r = await G.restoreTo(commit, rel, { force: true })
    }
    return r
  }

  // 撤销未提交改动：同样先确认（未跟踪的新文件服务层会自行留底）
  async function doDiscard(rel) {
    let r = await G.discard(rel)
    if (!r.ok && r.kind === 'confirm-needed') {
      const ok = await askConfirm('「' + rel + '」的未提交改动将被丢弃，且无法恢复。\n\n确定继续？')
      if (!ok) return { ok: false, kind: 'cancelled' }
      r = await G.discard(rel, { force: true })
    }
    return r
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // 显示用路径：去掉笔记目录这一层（git 仓库根通常在其上一级，目录树里并不显示这一层）
  function displayPath(p) {
    const s = String(p || '')
    const sc = (G && G.scopeRel) || ''
    if (sc && s.indexOf(sc + '/') === 0) return s.slice(sc.length + 1)
    return s
  }

  function shortPath(p) {
    const seg = String(p).split('/')
    if (seg.length <= 2) return p
    // 保留首段与文件名：Notes/…/City.md
    return seg[0] + '/…/' + seg.slice(-1)[0]
  }

  // 长文件快速定位：在 diff 上方挂一个「跳到改动」按钮，循环跳 add/del 行
  function mountJumpBar (body) {
    if (!body) return
    const host = body.parentElement || body
    const prev = host.querySelector('.zgp-jumpbar')
    if (prev) prev.remove()
    const marks = body.querySelectorAll('.zgp-dl.add, .zgp-dl.del')
    if (!marks.length) return
    const bar = doc.createElement('div')
    bar.className = 'zgp-jumpbar'
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.textContent = '跳到改动'
    btn.title = '跳到下一处改动（共 ' + marks.length + ' 行改动）'
    bar.appendChild(btn)
    host.insertBefore(bar, body)
    let idx = -1
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation()
      idx = (idx + 1) % marks.length
      const el = marks[idx]
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch (e) { el.scrollIntoView() }
      el.classList.add('zgp-flash')
      setTimeout(function () { el.classList.remove('zgp-flash') }, 900)
    })
  }

  /** 找到元素最近的可滚动祖先（弹窗是 vbody 自己滚，内嵌是面板 body 滚） */
  function scrollHostOf (el) {
    var n = el
    while (n && n !== doc.body) {
      var cs = win.getComputedStyle(n)
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) return n
      n = n.parentElement
    }
    return el
  }

  /**
   * diff 打开后默认落到第一处改动：把第一行 add/del 滚到视口约 1/3 高度并闪一下，
   * 免得长文件每次都要自己往下翻。
   */
  function focusFirstChange (body) {
    if (!body) return
    var first = body.querySelector('.zgp-dl.add, .zgp-dl.del')
    if (!first) return
    var host = scrollHostOf(body)
    try {
      var hr = host.getBoundingClientRect()
      var er = first.getBoundingClientRect()
      var delta = er.top - hr.top
      host.scrollTop = Math.max(0, host.scrollTop + delta - Math.round(host.clientHeight / 3))
    } catch (e) {
      try { first.scrollIntoView({ block: 'center' }) } catch (e2) {}
    }
    first.classList.add('zgp-flash')
    win.setTimeout(function () { first.classList.remove('zgp-flash') }, 1200)
  }

  // diff 渲染：带行号
  function renderDiffLines (lines) {
    let oldNo = 0, newNo = 0
    const out = []
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      let cls = 'meta', o = '', n = ''
      if (ln.startsWith('@@')) {
        const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(ln)
        if (m) { oldNo = parseInt(m[1], 10); newNo = parseInt(m[2], 10) }
        continue                                   // hunk 头不显示
      } else if (ln.startsWith('+')) { cls = 'add'; n = String(newNo++) }
      else if (ln.startsWith('-')) { cls = 'del'; o = String(oldNo++) }
      else if (ln.charCodeAt(0) === 92) { continue }   // "\ No newline at end of file" 不显示
      else { cls = 'ctx'; o = String(oldNo++); n = String(newNo++) }
      // 单列行号：改动后的行号；删除行用旧行号并淡显
      const lnNo = n || o
      out.push('<span class="zgp-dl ' + cls + (n ? '' : ' oldno') + '">' +
        '<span class="zgp-ln">' + lnNo + '</span>' +
        (esc(ln) || '&nbsp;') + '</span>')
    }
    return out.join('')
  }

  // 去掉 diff 的头部元信息（diff --git / index / --- / +++ 等），只留 hunk 内容
  function stripDiffHeader (text) {
    const lines = String(text == null ? '' : text).split(String.fromCharCode(10))
    const out = []
    let seenHunk = false
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      if (!seenHunk) {
        if (ln.startsWith('@@')) { seenHunk = true; out.push(ln); continue }
        if (/^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode |new mode |similarity index|rename from |rename to |Binary files )/.test(ln)) continue
        if (ln.trim() === '') continue
        out.push(ln)
        continue
      }
      out.push(ln)
    }
    return out
  }

  function openView(title, content, isDiff) {
    $('zgp-vtitle').textContent = title
    const body = $('zgp-vbody')
    if (isDiff) {
      const lines = stripDiffHeader(content)
      body.innerHTML = renderDiffLines(lines)
      mountJumpBar(body)
    } else {
      body.innerHTML = '<span class="zgp-dl">' + esc(content || '(空)') + '</span>'
    }
    view.classList.add('on')
    if (isDiff) {
      // 必须先让弹窗可见再算位置，隐藏时 rect 全是 0
      focusFirstChange(body)
    } else {
      body.scrollTop = 0
    }
  }

  // ============ 当前笔记 ============
  function currentRel() {
    try {
      const inst = win.__znotesFindInstance && win.__znotesFindInstance('main')
      const wn = inst && inst.state && inst.state.workNote
      if (!wn || !wn._id || wn._id.indexOf('note/') !== 0) return null
      const rel = wn._id.slice(5)
      return G.relOf(WS + '/' + rel.split('/').join(require('path').sep))
    } catch (e) { return null }
  }

  // ============ 状态条 ============
  function renderStatus(st) {
    ensureStatusContainers()
    const box = $('zgp-status')
    if (!st || !st.isRepo) {
      box.innerHTML = '<span class="zgp-chip warn">尚未初始化 git 仓库</span>'
      const foot0 = doc.querySelector('.zgp-acts')
      const oldE = doc.getElementById('zgp-foot-extra')
      if (oldE) oldE.remove()
      return
    }
    const parts = []
    parts.push('<span class="zgp-chip acc">分支 <b>' + esc(st.detached ? '游离 HEAD' : (st.branch || '-')) + '</b></span>')
    if (st.ahead) parts.push('<span class="zgp-chip">待推送 <b>' + st.ahead + '</b></span>')
    if (st.behind) parts.push('<span class="zgp-chip warn">待拉取 <b>' + st.behind + '</b></span>')
    if (st.dirty) parts.push('<span class="zgp-chip warn"><b>' + st.dirty + '</b> 项改动</span>')
    else parts.push('<span class="zgp-chip ok">工作区干净</span>')
    if (st.locked) parts.push('<span class="zgp-chip err">仓库被占用</span>')
    if (st.inProgress) parts.push('<span class="zgp-chip err">' + esc(st.inProgress) + ' 进行中</span>')
    if (st.busy) parts.push('<span class="zgp-chip"><span class="zgp-spin"></span>' + esc(st.currentOp || '执行中') + '</span>')
    if (st._err) parts.push('<span class="zgp-chip err">状态读取失败：' + esc(String(st._err).slice(0, 60)) + '</span>')
    if (st.failCount >= 3) parts.push('<span class="zgp-chip err">自动同步连续失败 ' + st.failCount + ' 次</span>')
    let chipsBox = $('zgp-chips')
    if (!chipsBox) {
      chipsBox = doc.createElement('div')
      chipsBox.className = 'zgp-chips'
      chipsBox.id = 'zgp-chips'
      box.insertBefore(chipsBox, box.firstChild)
    }
    chipsBox.innerHTML = parts.join('')

    // 中断状态 / 陈旧锁：给出可操作按钮（不再让用户去终端）
    const foot = doc.querySelector('.zgp-acts')
    const oldExtra = doc.getElementById('zgp-foot-extra')
    if (oldExtra) oldExtra.remove()
    if (st.inProgress || (st.locked && st.lockAgeMs > 600000)) {
      const wrap = doc.createElement('span')
      wrap.id = 'zgp-foot-extra'
      wrap.style.cssText = 'display:inline-flex;gap:6px;margin-left:6px'
      if (st.inProgress) {
        const b = doc.createElement('button')
        b.className = 'zgp-b'
        b.textContent = '中止 ' + st.inProgress
        b.onclick = async () => {
          const ok = await askConfirm('中止当前的 ' + st.inProgress + ' 操作并恢复到之前的状态？')
          if (!ok) return
          const r = await G.abortInProgress()
          toast(r.ok ? ('已中止 ' + st.inProgress) : ('中止失败：' + r.message), r.ok ? 'ok' : 'err')
          refreshAfterAction()
        }
        wrap.appendChild(b)
      }
      if (st.locked && st.lockAgeMs > 600000) {
        const b2 = doc.createElement('button')
        b2.className = 'zgp-b'
        b2.textContent = '清理陈旧锁'
        b2.onclick = async () => {
          const r = await G.clearStaleLock()
          toast(r.ok ? '已清理陈旧 index.lock' : ('清理失败：' + r.message), r.ok ? 'ok' : 'err')
          refreshAfterAction()
        }
        wrap.appendChild(b2)
      }
      if (foot) foot.appendChild(wrap)
    }

    const badge = $('zgp-b1')
    if (badge) {
      if (st.dirty) { badge.textContent = String(st.dirty); badge.className = 'zgp-badge on' }
      else { badge.textContent = ''; badge.className = 'zgp-badge' }
    }
  }

  // ============ 改动页 ============
  // 只表达"这个文件改了什么"：新增 / 修改 / 删除 / 冲突
  function stLetter(f) {
    if (f.kind === 'untracked') return 'A'
    if (f.kind === 'conflict' || f.x === 'U' || f.y === 'U') return 'U'
    if (f.x === 'D' || f.y === 'D') return 'D'
    if (f.x === '?' || f.y === '?') return 'A'
    if (f.x === 'A' || f.y === 'A') return 'A'
    return 'M'
  }

  // 未初始化仓库时的提示：配置统一在设置面板，这里只做跳转（不再有第二套表单）
  function renderInit (pane) {
    pane.innerHTML = `
      <div class="zgp-sec" style="padding-bottom:8px">
        <div style="font-size:12.5px;color:var(--zgp-fg2);line-height:1.8">
          当前笔记目录还没有启用版本控制。<br>
          <span style="color:var(--zgp-fg3);font-size:11.5px">目录：${esc(WS)}</span>
        </div>
      </div>
      <div class="zgp-sec">
        <div class="zgp-row">
          <button class="zgp-b primary" id="zgp-goto-settings">打开设置 · 版本控制</button>
        </div>
        <div class="zgp-hint">
          在设置里可以选「仅本地记录历史」或「绑定远程仓库并同步」，初始化不会改动任何笔记内容。
        </div>
      </div>
    `
    const go = doc.getElementById('zgp-goto-settings')
    if (go) {
      go.onclick = () => {
        try {
          // 先收起 git 面板，避免两个 520px 面板叠在一起
          try { root.classList.remove('open') } catch (e) {}
          if (win.__zgsOpen) win.__zgsOpen()
          else toast('设置面板不可用', 'err')
        } catch (e) {
          toast('打开设置失败：' + (e && e.message), 'err')
        }
      }
    }
  }

  // 读取全局 git 身份，仅用于提示
  function globalIdentityHint() {
    try {
      const cp = require('child_process')
      const n = (cp.execFileSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8', windowsHide: true }) || '').trim()
      const e = (cp.execFileSync('git', ['config', '--global', 'user.email'], { encoding: 'utf8', windowsHide: true }) || '').trim()
      if (!n && !e) return '未配置'
      return [n, e].filter(Boolean).join(' / ')
    } catch (err) { return '未配置' }
  }

  // ===== 单文件模式：只显示当前笔记的改动与历史 =====
  function renderFileMode(st, raw) {
    // 单文件模式没有全局倒计时行，清掉上一次的残留（否则会留下看不见但仍可点的按钮）
    const _c = doc.getElementById('zgp-countdown')
    if (_c) { const _p = _c.closest('.zgp-autoline'); if (_p) _p.remove() }
    const box = $('zgp-status')
    const rel = currentRel()
    if (!rel) {
      const chips0 = box.querySelector('#zgp-chips')
      if (chips0) chips0.innerHTML = '<span class="zgp-chip warn">没有打开的笔记</span>'
      else box.innerHTML = '<span class="zgp-chip warn">没有打开的笔记</span>'
      const pane = $('zgp-pane-changes')
      if (pane) pane.innerHTML = '<div class="zgp-empty"><b>没有打开的笔记</b>打开一篇笔记后，这里显示它的改动与历史</div>'
      const hp = $('zgp-pane-history')
      if (hp) hp.innerHTML = '<div class="zgp-empty">打开一篇笔记后可以看到它的修改历史</div>'
      return
    }
    const files = (st && st.files) || []
    const file = files.find((f) => f.path === rel)
    const readErr = raw && !raw.ok ? ('状态读取失败：' + (raw.message || '')) : ''
    const chipsHtml = '<span class="zgp-chip acc">' + esc(displayPath(rel)) + '</span>'
      + (file ? '<span class="zgp-chip warn">有未提交改动</span>' : '<span class="zgp-chip ok">与最近提交一致</span>')
      + (readErr ? '<span class="zgp-chip err">' + esc(readErr.slice(0, 40)) + '</span>' : '')
    // 只更新 chips，不要覆盖整个状态条（否则会删掉右侧操作区与容器）
    const chipsBoxF = box.querySelector('#zgp-chips')
    if (chipsBoxF) chipsBoxF.innerHTML = chipsHtml
    else box.innerHTML = chipsHtml
    renderFileChanges(rel, file)
    if (activeTab === 'history') renderHistory(true)
  }

  // 状态条右侧：倒计时 + 立即推送 + 撤销改动（仅单文件模式、且有未提交改动时）
  function renderFileActions(rel, hasChanges) {
    const box = root.querySelector('#zgp-fileact')
    if (!box) return
    // 单文件模式：显示专属动作区，隐藏全局三按钮（不依赖 applyMode 的时序）
    const _acts = root.querySelector('.zgp-acts')
    if (_acts) _acts.style.display = 'none'
    box.style.display = 'flex'
    if (!hasChanges) { box.innerHTML = ''; return }
    let cfg = {}
    try { cfg = (G.config() || {}).data || {} } catch (e) {}
    let html = ''
    if (cfg.autoSync) {
      let nx = null
      try { nx = G.nextAutoAt ? G.nextAutoAt() : null } catch (e) {}
      // 没有有效的下次时间（已触发过 / 等待下次编辑）就不显示倒计时，避免出现 "0 秒"
      if (nx) {
        html += '<span class="zgp-count" id="zgp-fcount">'
          + Math.max(0, Math.round((nx.at - Date.now()) / 1000)) + ' 秒后自动同步</span>'
      }
    }
    html += '<button class="zgp-b primary" id="zgp-f-pushnow" title="提交这篇笔记的改动，然后拉取并推送">立即同步</button>'
    html += '<button class="zgp-b" id="zgp-f-undo" title="丢弃此文件在工作区的改动">撤销改动</button>'
    box.innerHTML = html

    const pushBtn = $('zgp-f-pushnow')
    if (pushBtn) {
      pushBtn.onclick = async () => {
        pushBtn.disabled = true
        toast('正在推送…')
        const r = await G.sync(null)
        pushBtn.disabled = false
        if (r.ok) {
          toast('已推送：' + (r.data.steps.join(' · ') || '无改动'), 'ok')
          logCache = null
          refreshAfterAction()
        } else toast('推送失败：' + hintOf(r), 'err')
      }
    }
    const undoBtn = $('zgp-f-undo')
    if (undoBtn) {
      undoBtn.onclick = async () => {
        const rr = await doRestoreHead(rel)
        if (rr.ok) {
          toast('已还原到最近一次提交', 'ok')
          logCache = null
          try { if (win.__znotesReloadNote) win.__znotesReloadNote(rel) } catch (e) {}
          refreshAfterAction()
        } else if (rr.kind !== 'cancelled') {
          toast('还原失败：' + hintOf(rr), 'err')
        }
      }
    }
  }

  async function renderFileChanges(rel, file) {
    const pane = $('zgp-pane-changes')
    if (!file) {
      pane.innerHTML = '<div class="zgp-empty"><b>没有未提交改动</b>这篇笔记与最近一次提交的内容一致</div>'
      renderFileActions(rel, false)
      return
    }
    // 已有 diff 内容时不先清空，避免每次刷新闪一下「读取差异…」
    const existedBody = pane.querySelector('#zgp-f-diffbody')
    if (!existedBody) pane.innerHTML = '<div class="zgp-empty">读取差异…</div>'
    const r = await G.diff(null, rel)
    const diff = r.ok ? (r.data || '(无差异)') : ('读取失败：' + r.message)
    pane.innerHTML = '<div class="zgp-sec" style="padding:0"><div id="zgp-f-diffbody"></div></div>'
    renderFileActions(rel, true)
    const body = $('zgp-f-diffbody')
    const lines = stripDiffHeader(diff)
    body.innerHTML = renderDiffLines(lines)
    mountJumpBar(body)
    // 首次渲染才跳；后续轮询刷新（内容没变）不打断用户当前阅读位置
    if (!existedBody) focusFirstChange(body)
  }

  function renderChanges(st) {
    const pane = $('zgp-pane-changes')
    // 全局模式：显示三按钮，隐藏单文件动作区
    const _fAct = root.querySelector('#zgp-fileact')
    const _acts = root.querySelector('.zgp-acts')
    if (_fAct) _fAct.style.display = 'none'
    if (_acts) _acts.style.display = 'flex'
    if (!st || !st.isRepo) {
      renderInit(pane)
      return
    }
    if (!st.files.length) {
      pane.innerHTML = '<div class="zgp-empty"><b>工作区干净</b>没有未提交的改动</div>'
      return
    }
    const cur = currentRel()
    const rows = st.files.map((f, i) => {
      const L = stLetter(f)
      const isCur = cur && f.path === cur
      return '<div class="zgp-file' + (isCur ? ' cur' : '') + '" data-i="' + i + '">'
        + '<span class="zgp-st ' + L + '">' + L + '</span>'
        + '<span class="zgp-fp" title="' + esc(displayPath(f.path)) + '"><span>' + esc(shortPath(displayPath(f.path))) + '</span></span>'
        + '<span class="zgp-ops">'
        + '<button class="zgp-ic" data-act="diff" data-i="' + i + '" title="查看差异">' + ICON.diff + '</button>'
        + '<button class="zgp-ic danger" data-act="discard" data-i="' + i + '" title="丢弃此文件在工作区的改动">' + ICON.undo + '</button>'
        + '</span></div>'
    }).join('')
    pane.innerHTML = rows


    pane.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation()
        const i = parseInt(el.getAttribute('data-i'), 10)
        const f = st.files[i]
        const act = el.getAttribute('data-act')
        if (act === 'diff') {
          const r = await G.diff(null, f.path)
          openView('未提交差异 · ' + f.path, r.ok ? r.data : ('读取失败：' + r.message), true)
        } else if (act === 'discard') {
          const r = await doRestoreHead(f.path)
          if (r.ok) {
            toast('已还原到最近一次提交', 'ok')
            // 编辑器内部可能残留旧内容并触发自动保存，把还原结果又写回磁盘；
            // 整页刷新是唯一可靠的做法（还原属低频操作）
            try { if (win.__znotesReloadNote) win.__znotesReloadNote(f.path) } catch (err) {}
            refreshAfterAction()
          } else if (r.kind !== 'cancelled') {
            toast('还原失败：' + hintOf(r), 'err')
          }
        }
      }
    })
  }

  // ============ 历史页 ============
  let logCache = null
  let filePage = 0        // 单文件历史的当前页（0 起）
  let fileLogRel = null   // 当前分页对应的笔记，换笔记时重置页码
  const FILE_PAGE_SIZE = 10
  const REPO_PAGE_SIZE = 20
  let repoPage = 0
  let lastFileSig = ''
  async function renderHistory(force) {
    const pane = $('zgp-pane-history')
    if (!pane) return
    // 单文件模式：只列这篇笔记自己的提交历史
    if (panelMode === 'file') {
      const rel = currentRel()
      if (!rel) {
        pane.innerHTML = '<div class="zgp-empty">没有打开的笔记</div>'
        return
      }
      // 换笔记时把页码归零
      if (rel !== fileLogRel) { fileLogRel = rel; filePage = 0; logCache = null }
      const cacheKey = rel + '#' + filePage
      if (!force && logCache && logCache._key === cacheKey) {
        renderFileLogPane(pane, rel, logCache._list, logCache._total)
        return
      }
      pane.innerHTML = '<div class="zgp-empty">读取修订记录…</div>'
      const cntR = await G.logCount(rel)
      const total = cntR.ok ? cntR.data : 0
      const rf = await G.log(rel, FILE_PAGE_SIZE, filePage * FILE_PAGE_SIZE)
      if (!rf.ok) {
        pane.innerHTML = '<div class="zgp-empty"><b>读取失败</b>' + esc(rf.message) + '</div>'
        return
      }
      logCache = rf.data
      logCache._key = cacheKey
      logCache._list = rf.data
      logCache._total = total
      renderFileLogPane(pane, rel, rf.data, total)
      return
    }
    if (!force && logCache && !logCache._rel) { renderRepoLogPane(pane, logCache, logCache._total || logCache.length); return }
    pane.innerHTML = '<div class="zgp-empty">读取提交历史…</div>'
    const cntR = await G.repoLogCount()
    const totalRepo = cntR.ok ? cntR.data : 0
    const r = await G.repoLog(REPO_PAGE_SIZE, repoPage * REPO_PAGE_SIZE)
    if (!r.ok) {
      pane.innerHTML = '<div class="zgp-empty"><b>读取失败</b>' + esc(r.message) + '</div>'
      return
    }
    logCache = r.data
    logCache._total = totalRepo
    renderRepoLogPane(pane, logCache, totalRepo)
  }

  // 单文件历史：标题 + 列表 + 分页
  // 全局历史：列表 + 分页（按钮在上，统计在下）
  function renderRepoLogPane(pane, list, total) {
    const pages = Math.max(1, Math.ceil(total / REPO_PAGE_SIZE))
    // 没有记录时不显示分页统计
    const pager = total > 0
      ? ('<div class="zgp-sec" style="display:flex;flex-direction:column;align-items:center;gap:7px;'
          + 'padding:10px 16px;border-top:1px solid var(--zgp-bd)">'
          + (pages > 1
            ? ('<div style="display:flex;align-items:center;gap:10px">'
                + '<button class="zgp-b" data-rpg="prev"' + (repoPage <= 0 ? ' disabled' : '') + '>上一页</button>'
                + '<span style="font-size:12px;color:var(--zgp-fg2);white-space:nowrap">第 ' + (repoPage + 1) + ' / ' + pages + ' 页</span>'
                + '<button class="zgp-b" data-rpg="next"' + (repoPage >= pages - 1 ? ' disabled' : '') + '>下一页</button>'
                + '</div>')
            : '')
          + '<span style="font-size:12px;color:var(--zgp-fg3)">共有 ' + total + ' 条提交记录</span>'
          + '</div>')
      : ''
    pane.innerHTML = (list && list.length)
      ? '<div id="zgp-repolog"></div>' + pager
      : '<div class="zgp-empty">暂无提交记录</div>' + pager
    const body = doc.getElementById('zgp-repolog')
    if (body) paintLog(body, list)
    const prev = pane.querySelector('[data-rpg="prev"]')
    const next = pane.querySelector('[data-rpg="next"]')
    if (prev) prev.onclick = () => { if (repoPage > 0) { repoPage--; logCache = null; renderHistory(true) } }
    if (next) next.onclick = () => { if (repoPage < pages - 1) { repoPage++; logCache = null; renderHistory(true) } }
  }

  function renderFileLogPane(pane, rel, list, total) {
    const pages = Math.max(1, Math.ceil(total / FILE_PAGE_SIZE))
    // 分页按钮在上，统计信息在下；没有记录时整块不显示
    const pager = total > 0
      ? ('<div class="zgp-sec" style="display:flex;flex-direction:column;align-items:center;gap:7px;'
          + 'padding:10px 16px;border-top:1px solid var(--zgp-bd)">'
          + (pages > 1
            ? ('<div style="display:flex;align-items:center;gap:10px">'
                + '<button class="zgp-b" data-pg="prev"' + (filePage <= 0 ? ' disabled' : '') + '>上一页</button>'
                + '<span style="font-size:12px;color:var(--zgp-fg2);white-space:nowrap">第 ' + (filePage + 1) + ' / ' + pages + ' 页</span>'
                + '<button class="zgp-b" data-pg="next"' + (filePage >= pages - 1 ? ' disabled' : '') + '>下一页</button>'
                + '</div>')
            : '')
          + '<span style="font-size:12px;color:var(--zgp-fg3)">共有 ' + total + ' 条修改记录</span>'
          + '</div>')
      : ''
    pane.innerHTML = (list && list.length)
      ? '<div id="zgp-filelog"></div>' + pager
      : '<div class="zgp-empty">暂无修改记录</div>' + pager
    const body = doc.getElementById('zgp-filelog')
    if (body) paintLog(body, list, rel)
    const prev = pane.querySelector('[data-pg="prev"]')
    const next = pane.querySelector('[data-pg="next"]')
    if (prev) prev.onclick = () => { if (filePage > 0) { filePage--; logCache = null; renderHistory(true) } }
    if (next) next.onclick = () => { if (filePage < pages - 1) { filePage++; logCache = null; renderHistory(true) } }
  }
  function paintLog(pane, list, onlyFile) {
    if (!list.length) {
      pane.innerHTML = '<div class="zgp-empty"><b>还没有提交记录</b>做一次同步就会产生第一条提交</div>'
      return
    }
    const cur = currentRel()
    pane.innerHTML = list.map((c, i) => {
      // 单文件模式：不再展开文件清单，直接给该版本的操作
      const ops = onlyFile
        ? '<div class="zgp-ops" style="margin-top:7px;opacity:1;align-items:center">'
          + '<button class="zgp-ic" data-cmpwork="' + i + '" title="与工作区比对：这次提交之后到现在，这篇笔记改了什么">' + ICON.cmpWork + '</button>'
          + '<button class="zgp-ic" data-cmpprev="' + i + '" title="与提交前比对：这一次提交本身对这篇笔记做了什么改动">' + ICON.cmpPrev + '</button>'
          + '<button class="zgp-ic" data-view="' + i + '" title="查看该版本：显示这次提交时这篇笔记的完整内容">' + ICON.eye + '</button>'
          + '<span style="flex:1"></span>'
          + '<button class="zgp-ic danger" data-back="' + i + '" title="回溯到此版本：把这篇笔记恢复成这个版本的内容">' + ICON.undo + '</button>'
          + '</div>'
        : ''
      return '<div class="zgp-cm" data-c="' + i + '">'
        + '<div class="zgp-cm1">'
        + '<span class="zgp-cm-sub">' + esc(c.subject || '(无提交信息)') + '</span>'
        + '<span class="zgp-hash">' + esc(c.short) + '</span>'
        + '</div>'
        + '<div class="zgp-cm-meta">' + esc(c.date) + ' · ' + esc(c.author) + '</div>'
        + ops
        + (onlyFile ? '' : '<div class="zgp-cmbody" data-body="' + i + '"></div>')
        + '</div>'
    }).join('')

    // 单文件模式：按钮直接响应，不再走展开逻辑
    if (onlyFile) {
      pane.querySelectorAll('[data-cmpwork]').forEach((b) => {
        b.onclick = async (ev) => {
          ev.stopPropagation()
          const c = list[parseInt(b.getAttribute('data-cmpwork'), 10)]
          const r = await G.diffWork(c.hash, onlyFile)
          openView('与工作区比对 · ' + c.short + ' → 当前文件', r.ok ? (r.data || '(无差异)') : ('读取失败：' + r.message), true)
        }
      })
      pane.querySelectorAll('[data-cmpprev]').forEach((b) => {
        b.onclick = async (ev) => {
          ev.stopPropagation()
          const c = list[parseInt(b.getAttribute('data-cmpprev'), 10)]
          const r = await G.diff(c.hash, onlyFile)
          openView('与提交前比对 · ' + c.short + ' 这次提交的改动', r.ok ? (r.data || '(无差异)') : ('读取失败：' + r.message), true)
        }
      })
      pane.querySelectorAll('[data-view]').forEach((b) => {
        b.onclick = async (ev) => {
          ev.stopPropagation()
          const c = list[parseInt(b.getAttribute('data-view'), 10)]
          const r = await G.show(c.hash, onlyFile)
          openView('查看 ' + c.short + ' · ' + c.date, r.ok ? r.data : ('读取失败：' + r.message), false)
        }
      })
      pane.querySelectorAll('[data-back]').forEach((b) => {
        b.onclick = async (ev) => {
          ev.stopPropagation()
          const c = list[parseInt(b.getAttribute('data-back'), 10)]
          const r = await doRestore(c.hash, onlyFile, c.short + '（' + c.date + '）')
          if (r.ok) {
            toast('已回溯到 ' + c.short, 'ok')
            logCache = null
            try { if (win.__znotesReloadNote) win.__znotesReloadNote(onlyFile) } catch (e) {}
            refreshAfterAction()
          } else if (r.kind !== 'cancelled') {
            toast('回溯失败：' + hintOf(r), 'err')
          }
        }
      })
    }

    pane.querySelectorAll('.zgp-cm').forEach((el) => {
      el.onclick = async (ev) => {
        if (onlyFile) return
        if (ev.target.closest('.zgp-cmf')) return
        const i = parseInt(el.getAttribute('data-c'), 10)
        const c = list[i]
        const body = el.querySelector('[data-body]')
        if (el.classList.contains('open')) { el.classList.remove('open'); return }
        el.classList.add('open')
        if (body.dataset.loaded) return
        body.innerHTML = '<div style="padding:4px 8px;font-size:11.5px;color:var(--zgp-fg3)">读取文件列表…</div>'
        const r = await G.commitFiles(c.hash)
        if (!r.ok) { body.innerHTML = '<div style="padding:4px 8px;color:var(--zgp-err);font-size:11.5px">' + esc(r.message) + '</div>'; return }
        const files = r.data
        if (!files.length) {
          body.innerHTML = '<div style="padding:4px 8px;font-size:11.5px;color:var(--zgp-fg3)">该提交没有文件改动</div>'
        } else {
          body.innerHTML = files.map((f) => {
            const isCur = cur && f.path === cur
            return '<div class="zgp-cmf" data-h="' + esc(c.hash) + '" data-p="' + esc(f.path) + '"'
              + (isCur ? ' style="background:var(--zgp-acc-bg);color:var(--zgp-acc)"' : '') + '>'
              + '<span class="zgp-fs ' + (f.status || '').charAt(0) + '">' + (f.status || '').charAt(0) + '</span>'
              + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(f.path) + '">' + esc(f.path) + '</span>'
              + '<button class="zgp-ic" title="查看该次改动">' + ICON.diff + '</button>'
              + '<button class="zgp-ic danger" data-restore="1" title="回溯到该版本">' + ICON.undo + '</button>'
              + '</div>'
          }).join('')
        }
        body.dataset.loaded = '1'

        body.querySelectorAll('.zgp-cmf').forEach((row) => {
          const hash = row.getAttribute('data-h')
          const p = row.getAttribute('data-p')
          const iDiff = row.querySelector('.zgp-ic:not([data-restore])')
          const iRest = row.querySelector('[data-restore]')
          if (iDiff) iDiff.onclick = async (e) => {
            e.stopPropagation()
            const r2 = await G.diff(hash, p)
            openView('改动 ' + hash.slice(0, 7) + ' · ' + p, r2.ok ? r2.data : ('读取失败：' + r2.message), true)
          }
          if (iRest) iRest.onclick = async (e) => {
            e.stopPropagation()
            const r3 = await doRestore(hash, p, hash.slice(0, 7))
            if (r3.ok) {
              toast('已回溯到 ' + hash.slice(0, 7), 'ok')
              logCache = null
              try { if (win.__znotesReloadNote) win.__znotesReloadNote(p) } catch (err) {}
              refreshAfterAction()
            } else if (r3.kind !== 'cancelled') {
              toast('回溯失败：' + hintOf(r3), 'err')
            }
          }
        })
      }
    })
  }


  // ============ 刷新 ============
  let refreshing = false
  let pendingForce = false
  let lastGoodState = null
  let lastSig = ''
  async function refresh(force) {
    // 轮询正在进行时，force 请求排队，等这一轮结束后立刻补跑
    if (refreshing) { if (force) pendingForce = true; return }
    refreshing = true
    try {
      const r = await G.state()
      // 状态签名去重：改动/分支/页签都没变时不重绘，避免闪烁
      if (r.ok && panelMode === 'global' && activeTab === 'changes') {
        const f = r.data.files || []
        const sig = r.data.branch + '|' + r.data.dirty + '|' + f.map((x) => x.path + x.x + x.y).join(',')
        if (!force && sig === lastSig) { renderStatus(r.data); return }
        lastSig = sig
      }
      if (panelMode === 'file') {
        const stAny = r.ok ? r.data : (lastGoodState || {})
        if (r.ok) lastGoodState = r.data
        // 签名去重：当前文件的改动状态没变就不重绘，避免每 3 秒闪一下
        const relF = currentRel() || ''
        const ff = ((r.ok ? (r.data.files || []) : []).find((x) => x.path === relF))
        const sigF = relF + '|' + (ff ? ff.x + ff.y : 'clean') + '|' + (r.ok ? 'ok' : 'err')
        if (!force && sigF === lastFileSig) return
        lastFileSig = sigF
        renderFileMode(stAny, r)
        return
      }
      if (r.ok) {
        lastGoodState = r.data
        renderStatus(r.data)
        renderChanges(r.data)
      } else {
        // 读不到状态时保留上一次的列表，只额外标出错误，避免显示"工作区干净"的假象
        const merged = Object.assign({}, lastGoodState || { isRepo: true }, { _err: r.message, _errKind: r.kind })
        renderStatus(merged)
        if (!lastGoodState) renderChanges({ isRepo: false })
      }
    } catch (e) {
      console.error('[zgp] refresh', e)
    } finally {
      refreshing = false
      if (pendingForce) { pendingForce = false; setTimeout(() => { try { refresh(true) } catch (e) {} }, 20) }
    }
  }

  /**
   * 操作（提交/推送/拉取/还原/中止）完成后的刷新。
   *
   * 不能只调 refresh()：① 它带签名去重，读到和上次一样的中间状态会直接返回；
   * ② git 命令返回时工作区/索引可能还没完全落稳，第一次读到的往往还是旧状态。
   * 所以先强制刷一次，再补几次重试，同时把历史页和顶部分支条一起拉新。
   */
  function refreshAfterAction() {
    try { refresh(true) } catch (e) {}
    ;[120, 400, 1000, 2200].forEach(function (ms) {
      setTimeout(function () { try { refresh(true) } catch (e) {} }, ms)
    })
    try { logCache = null } catch (e) {}
    try { if (activeTab === 'history') renderHistory(true) } catch (e) {}
    try { if (win.__zbbRefresh) win.__zbbRefresh() } catch (e) {}
  }

  // ============ 事件 ============
  let activeTab = 'changes'
  let panelMode = 'global'   // global：全部改动/历史；file：只看当前笔记

  function switchTab(name) {
    activeTab = name
    doc.querySelectorAll('.zgp-tab').forEach((x) => x.classList.toggle('on', x.getAttribute('data-tab') === name))
    doc.querySelectorAll('.zgp-pane').forEach((x) => x.classList.toggle('on', x.id === 'zgp-pane-' + name))
    // 切到改动页立即重新校验，不用等 3 秒轮询
    if (name === 'changes') refresh(true)
    // 切到历史页总是重新读取：提交/推送后必须看到最新记录，不能用旧缓存
    if (name === 'history') renderHistory(true)
  }

  // 单文件模式下隐藏底部全局操作区（设置页已独立到侧边栏入口）
  function applyMode() {
    const isFile = panelMode === 'file'
    // 面板标题：外部（工作区变更为全局改动/历史）vs 内部（当前文件）
    const titleEl = doc.getElementById('zgp-title-text')
    if (titleEl) titleEl.textContent = isFile ? '文档变更记录' : '工作区变更记录'
    // 单文件模式不显示全仓改动数（与当前文件无关）
    if (isFile) {
      const badge = doc.getElementById('zgp-b1')
      if (badge) { badge.textContent = ''; badge.className = 'zgp-badge' }
    }
    const foot = root.querySelector('.zgp-acts')
    if (foot) foot.style.display = isFile ? 'none' : ''
    const fAct = root.querySelector('#zgp-fileact')
    if (fAct) fAct.style.display = isFile ? 'flex' : 'none'
    if (!isFile && fAct) fAct.innerHTML = ''
  }

  doc.querySelectorAll('.zgp-tab').forEach((t) => {
    t.onclick = () => switchTab(t.getAttribute('data-tab'))
  })

  $('zgp-close').onclick = () => root.classList.remove('open')
  $('zgp-vclose').onclick = () => view.classList.remove('on')
  view.onclick = (e) => { if (e.target === view) view.classList.remove('on') }
  // 焦点/鼠标回到笔记正文时自动收起面板（点面板内部不会触发）
  function autoHideIfEditor(target) {
    if (!root.classList.contains('open')) return
    // target 可能是文本节点，取最近的元素
    var el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null
    if (!el) return
    // 面板自身、diff 大窗、toast 都算"面板内"
    if (el.closest('#zgp-root') || el.closest('#zgp-view') || el.closest('#zgp-toast')) return
    // 编辑器、可编辑区，以及"没有打开笔记"时的空白区（.worknote-empty，flex:1 撑满右侧）
    // 点击这些位置都收起面板
    if (el.closest('.editor-body') || el.closest('[contenteditable="true"]') || el.closest('.worknote-empty')) {
      root.classList.remove('open')
      return
    }
  }
  doc.addEventListener('focusin', (e) => autoHideIfEditor(e.target), true)
  doc.addEventListener('mousedown', (e) => autoHideIfEditor(e.target), true)

  // 倒计时每秒刷新（不整块重绘，只改文本）
  setInterval(() => {
    if (!root.classList.contains('open')) return
    if (panelMode !== 'file' && activeTab !== 'changes') return
    // file 模式的倒计时
    const fEl = doc.getElementById('zgp-fcount')
    if (fEl) {
      try {
        const nxF = G.nextAutoAt ? G.nextAutoAt() : null
        if (nxF) {
          fEl.style.display = ''
          fEl.textContent = Math.max(0, Math.round((nxF.at - Date.now()) / 1000)) + ' 秒后自动同步'
        } else {
          fEl.style.display = 'none'
        }
      } catch (e) {}
      return
    }
    const el = doc.getElementById('zgp-countdown')
    if (!el) return
    try {
      const nx = G.nextAutoAt && G.nextAutoAt()
      if (!nx) return   // 静态文案（停止编辑模式）保持不动
      el.textContent = Math.max(0, Math.round((nx.at - Date.now()) / 1000)) + ' 秒后自动同步'
    } catch (e) {}
  }, 1000)

  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (view.classList.contains('on')) { view.classList.remove('on'); return }
      if (root.classList.contains('open')) root.classList.remove('open')
    }
  })

  function busyUI(on, label) {
    doc.querySelectorAll('.zgp-acts .zgp-b').forEach((b) => { b.disabled = !!on })
    if (on) toast((label || '同步') + '…')
  }

  // 状态条三个操作按钮的绑定（容器可能被自愈重建，所以做成可重复调用）
  function bindStatusButtons() {
    const syncBtn = $('zgp-sync')
    if (syncBtn) syncBtn.onclick = async () => {
      busyUI(true, '同步中')
      const r = await G.sync(null, { pull: true, push: true })
      busyUI(false)
      if (r.ok) {
        toast('同步完成：' + (r.data.steps.length ? r.data.steps.join(' → ') : '无改动'), 'ok')
        logCache = null
      } else if (r.kind === 'nothing') {
        toast('没有需要提交的改动', 'ok')
      } else {
        toast('同步失败：' + hintOf(r), 'err')
      }
      refreshAfterAction()
    }

    const pushBtn = $('zgp-push')
    if (pushBtn) pushBtn.onclick = async () => {
      busyUI(true, '推送中')
      const r = await G.push()
      busyUI(false)
      toast(r.ok ? '已推送' : ('推送失败：' + hintOf(r)), r.ok ? 'ok' : 'err')
      refreshAfterAction()
    }

    const pullBtn = $('zgp-pull')
    if (pullBtn) pullBtn.onclick = async () => {
      busyUI(true, '拉取中')
      const r = await G.pull()
      busyUI(false)
      toast(r.ok ? '已拉取' : ('拉取失败：' + hintOf(r)), r.ok ? 'ok' : 'err')
      logCache = null
      refreshAfterAction()
    }
  }
  bindStatusButtons()

  // 状态条容器自愈：面板可能由旧版本创建，缺 chips / acts / fileact 时补回来
  function ensureStatusContainers() {
    const status = $('zgp-status')
    if (!status) return
    let changed = false
    if (!$('zgp-chips')) {
      const d = doc.createElement('div')
      d.className = 'zgp-chips'
      d.id = 'zgp-chips'
      status.insertBefore(d, status.firstChild)
      changed = true
    }
    if (!status.querySelector('.zgp-acts')) {
      const d = doc.createElement('div')
      d.className = 'zgp-acts'
      d.innerHTML = '<button class="zgp-b" id="zgp-pull" title="从远端拉取提交">' + ICON.down + '<span>拉取</span></button>'
        + '<button class="zgp-b" id="zgp-push" title="把本地提交推送到远端">' + ICON.up + '<span>推送</span></button>'
        + '<button class="zgp-b primary" id="zgp-sync" title="提交本地改动并推送">' + ICON.sync + '<span>同步</span></button>'
      status.appendChild(d)
      changed = true
    }
    if (!$('zgp-fileact')) {
      const d = doc.createElement('div')
      d.className = 'zgp-fileact'
      d.id = 'zgp-fileact'
      status.appendChild(d)
      changed = true
    }
    if (changed) {
      try { bindStatusButtons() } catch (e) {}
      try { applyMode() } catch (e2) {}
    }
  }


  // ============ 由标题栏按钮调用（bundle 里注入的 Git 图标） ============
  win.__zgpToggle = function (mode) {
    const next = mode === 'global' ? 'global' : 'file'
    const opening = !root.classList.contains('open')
    const modeChanged = next !== panelMode
    panelMode = next
    // 切模式必须清掉签名缓存，否则 refresh() 会判定"状态没变"直接返回，
    // 面板里还留着上一个模式的 DOM（表现为外部面板显示成单文件详情）
    if (modeChanged) { lastSig = ''; lastFileSig = '' }
    root.classList.toggle('open')
    if (opening) {
      // 先把编辑器里待写盘的内容落盘，否则刚敲完就打开会看到旧状态
      try { if (win.__znotesFlushSave) win.__znotesFlushSave() } catch (e) {}
      applyMode()
      switchTab('changes')
      refresh(true)
      // 刚在编辑器里敲完就打开面板时，编辑器可能还没把内容写盘，
      // 这几次重试可以兜住写盘延迟（签名未变时不会重绘，无闪烁）
      ;[250, 700, 1500, 2600, 4000].forEach(function (ms) {
        setTimeout(function () { try { refresh() } catch (e) {} }, ms)
      })
    } else if (modeChanged) {
      applyMode()
      refresh()
    }
  }
  win.__zgpOpen = function (mode) { if (!root.classList.contains('open')) win.__zgpToggle(mode || 'global') }
  win.__zgpIsOpen = function () { return root.classList.contains('open') }

  // 面板打开时定时刷新（3 秒）；历史页不做轮询，避免反复重绘导致闪烁
  setInterval(() => {
    if (!root.classList.contains('open')) return
    if (activeTab === 'history') return
    refresh()
  }, 3000)

  refresh()
}