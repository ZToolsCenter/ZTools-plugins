/* =====================================================================
   v7_utools.jsx — uTools 模式专属：接入 uTools 工具栈 + subInput 全局搜索
   两个画板：
     V7Global   — 在 uTools 主输入框全局搜索，鹅的监控 作为工具栈命令被唤起
     V7SubInput — 进入插件后，uTools 输入框被接管为我们的搜索框（subInput），
                  全局搜索词「chrome」自动带入并展开过滤结果
   ===================================================================== */

/* highlight matched substring with the accent color */
function Hl({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <React.Fragment>
      {text.slice(0, i)}
      <span style={{ color: "var(--accent)", fontWeight: 700, background: "var(--bg-row-sel)", borderRadius: 3, padding: "0 1px" }}>{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </React.Fragment>
  );
}

/* tiny brand tile used as the uTools plugin tag (real app icon) */
function BrandTile({ size = 22, radius = 6 }) {
  return <AppLogo size={size} radius={radius} />;
}

/* =====================================================================
   A — 全局唤起：uTools 主输入框搜索，鹅的监控 工具栈命令浮现
   ===================================================================== */
function V7Global({ theme = "dark" }) {
  const q = "chrome";
  const chrome = APPS.find((a) => a.id === "chrome");
  const cmds = [
    { tile: "app", app: chrome, title: "结束 Google Chrome", desc: "合并 14 进程 · 2.41 GB · CPU 23.4%", tag: "结束进程", hint: "↵", on: true },
    { tile: "brand", title: "在 鹅的监控 中搜索 “chrome”", desc: "打开进程管理器并定位匹配项", tag: "进程管理器" },
    { tile: "app", app: chrome, zap: true, title: "一键释放 Chrome 内存", desc: "结束渲染 / GPU Helper，保留主窗口", tag: "快捷动作" },
  ];
  return (
    <ThemeWrap theme={theme} style={{ display: "flex", flexDirection: "column", borderRadius: 12, background: "var(--bg-panel)" }}>
      {/* uTools 主输入框 */}
      <div style={{ height: 68, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 18px", borderBottom: "1px solid var(--border-1)", background: "var(--bg-elev)" }}>
        <Icon name="search" size={22} style={{ color: "var(--fg-3)" }} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
          <span style={{ font: "600 24px/1 var(--font-sans)", color: "var(--fg-1)" }}>{q}</span>
          <span style={{ width: 2, height: 26, marginLeft: 2, background: "var(--accent)", borderRadius: 2, animation: "ck 1.1s step-end infinite" }} />
        </div>
        <span className="t-xs" style={{ color: "var(--fg-3)", flex: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
          全局搜索 <Kbd wide>⌥ 空格</Kbd>
        </span>
      </div>

      {/* uTools 工具栈命中列表 */}
      <div style={{ flex: 1, padding: "10px 10px", overflow: "hidden" }}>
        <div className="t-label" style={{ padding: "4px 10px 8px" }}>鹅的监控 工具栈 · 接入 uTools</div>
        {cmds.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, height: 60, padding: "0 12px", borderRadius: 10,
            background: c.on ? "var(--bg-row-sel)" : "transparent", boxShadow: c.on ? "inset 0 0 0 1px var(--border-2)" : "none" }}>
            {c.tile === "brand"
              ? <BrandTile size={38} radius={9} />
              : <span style={{ position: "relative", flex: "none" }}>
                  <AppIcon app={c.app} size={38} radius={9} />
                  {c.zap ? <span style={{ position: "absolute", right: -4, bottom: -4, width: 18, height: 18, borderRadius: 999, background: "var(--warn)", border: "2px solid var(--bg-panel)", display: "grid", placeItems: "center", color: "#1a1206" }}><Icon name="zap" size={10} /></span> : null}
                </span>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="t-row" style={{ fontSize: 14.5, whiteSpace: "nowrap" }}><Hl text={c.title} q={q} /></div>
              <div className="t-sm" style={{ color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.desc}</div>
            </div>
            <span style={{ font: "var(--t-xs)", color: "var(--fg-3)", padding: "3px 8px", borderRadius: 6, background: "var(--bg-elev)", border: "1px solid var(--border-1)", flex: "none", whiteSpace: "nowrap" }}>{c.tag}</span>
            {c.on
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent)", font: "var(--t-sm)", fontWeight: 600, flex: "none" }}>打开 <Icon name="corner-down-left" size={15} /></span>
              : <span style={{ width: 60 }} />}
          </div>
        ))}
        {/* other-plugin hint, to show this is the *global* box */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 14px", marginTop: 2, opacity: 0.5 }}>
          <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--bg-track)", flex: "none" }} />
          <span className="t-sm" style={{ color: "var(--fg-3)" }}>其他插件结果…</span>
        </div>
      </div>

      {/* footer hint */}
      <footer style={{ height: 42, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderTop: "1px solid var(--border-1)", background: "var(--bg-sidebar)" }}>
        <BrandTile size={16} radius={5} />
        <span className="t-sm" style={{ color: "var(--fg-2)", fontWeight: 600 }}>鹅的监控</span>
        <span className="t-xs" style={{ color: "var(--fg-3)" }}>已注册关键词：结束进程 / kill / 内存 / 进程管理 + 应用名</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span className="t-xs" style={{ color: "var(--fg-3)" }}>进入</span><Kbd>↵</Kbd>
        </span>
      </footer>
    </ThemeWrap>
  );
}

/* =====================================================================
   B — 进入后：uTools 输入框被接管为 subInput，全局词自动带入并展开搜索
   ===================================================================== */
function V7SubInput({ theme = "dark" }) {
  const q = "chrome";
  const chrome = APPS.find((a) => a.id === "chrome");
  return (
    <ThemeWrap theme={theme} style={{ display: "flex", flexDirection: "column", borderRadius: 12, background: "var(--bg-panel)" }}>
      {/* uTools subInput 条：左侧插件标签 + 接管后的搜索输入 */}
      <div style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 10px", borderBottom: "1px solid var(--border-1)", background: "var(--bg-elev)" }}>
        <button style={{ width: 30, height: 30, borderRadius: 8, flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "none", color: "var(--fg-3)", cursor: "pointer" }}><Icon name="arrow-left" size={17} /></button>
        {/* 插件标签（uTools 进入插件后显示的 tag） */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 10px 0 7px", borderRadius: 8, background: "var(--bg-row-sel)", border: "1px solid var(--border-2)", flex: "none" }}>
          <BrandTile size={18} radius={5} />
          <span className="t-sm" style={{ color: "var(--fg-1)", fontWeight: 600 }}>鹅的监控</span>
        </span>
        {/* 接管后的搜索输入框（subInput）—— 带 accent 环表示已绑定 */}
        <div style={{ flex: 1, minWidth: 0, height: 36, display: "flex", alignItems: "center", gap: 9, padding: "0 12px", borderRadius: 9, background: "var(--bg-input)", boxShadow: "0 0 0 1.5px var(--accent)" }}>
          <Icon name="search" size={16} style={{ color: "var(--accent)" }} />
          <span style={{ font: "var(--t-lg)", color: "var(--fg-1)" }}>{q}</span>
          <span style={{ width: 2, height: 18, background: "var(--accent)", borderRadius: 2, animation: "ck 1.1s step-end infinite" }} />
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
            <span className="t-xs" style={{ color: "var(--accent)", fontWeight: 600 }}>uTools 输入框已接管</span>
            <button style={{ width: 20, height: 20, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--bg-track)", border: "none", color: "var(--fg-3)", cursor: "pointer" }}><Icon name="x" size={12} /></button>
          </span>
        </div>
      </div>

      {/* 自动展开的过滤结果 */}
      <div style={{ flex: 1, padding: "8px 8px", overflow: "hidden" }}>
        <div className="t-label" style={{ padding: "6px 10px 6px", display: "flex", justifyContent: "space-between" }}>
          <span>匹配 “{q}” · 1 应用 / {chrome.helpers.length} 进程</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>实时过滤 <Icon name="zap" size={11} style={{ color: "var(--warn)" }} /></span>
        </div>

        {/* 父应用行（选中） */}
        <div style={{ display: "flex", alignItems: "center", gap: 13, height: 52, padding: "0 12px", borderRadius: 10, background: "var(--bg-row-sel)" }}>
          <AppIcon app={chrome} size={34} radius={9} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="t-row" style={{ fontSize: 14, whiteSpace: "nowrap" }}><Hl text={chrome.name} q={q} /></span>
              <span style={{ font: "var(--t-mono-sm)", color: "var(--accent)", padding: "1px 6px", borderRadius: 5, background: "var(--bg-elev)", flex: "none" }}>合并 {chrome.procs} 进程</span>
            </div>
            <div className="t-path" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{chrome.path} · PID {chrome.pid}</div>
          </div>
          <span className="t-mono" style={{ color: "var(--metric-cpu)", minWidth: 50, textAlign: "right" }}>{fmtCpu(chrome.cpu)}</span>
          <span className="t-mono" style={{ minWidth: 60, textAlign: "right", color: "var(--fg-2)" }}>{fmtMem(chrome.mem)}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 8, background: "var(--danger)", color: "#fff", font: "var(--t-sm)", fontWeight: 600, whiteSpace: "nowrap", flex: "none" }}>结束进程 <Kbd>⏎</Kbd></span>
        </div>

        {/* helper 子进程行 */}
        {chrome.helpers.map((h, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 1fr 76px 56px 66px", alignItems: "center", gap: 11, height: 34, padding: "0 12px" }}>
            <span style={{ justifySelf: "center", width: 16, display: "flex", justifyContent: "center", color: "var(--fg-3)" }}>
              <span style={{ width: 1, height: "100%", background: "var(--border-2)" }} />
            </span>
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span className="t-sm" style={{ color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><Hl text={h.name} q={q} /></span>
              <span className="t-xs" style={{ color: "var(--fg-3)", flex: "none" }}>{h.role}</span>
            </div>
            <span className="t-path" style={{ color: "var(--fg-3)", textAlign: "right" }}>PID {h.pid}</span>
            <span className="t-mono" style={{ color: "var(--metric-cpu)", textAlign: "right", fontSize: 11 }}>{fmtCpu(h.cpu)}</span>
            <span className="t-mono" style={{ color: "var(--fg-2)", textAlign: "right", fontSize: 11 }}>{fmtMem(h.mem)}</span>
          </div>
        ))}
      </div>

      {/* action bar */}
      <footer style={{ height: 46, flex: "none", display: "flex", alignItems: "center", padding: "0 14px", borderTop: "1px solid var(--border-1)", background: "var(--bg-sidebar)" }}>
        <span className="t-xs" style={{ color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Icon name="corner-down-left" size={13} style={{ color: "var(--fg-3)" }} /> 删词回到 uTools 全局搜索
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 8, background: "var(--bg-elev)", border: "1px solid var(--border-1)" }}><span className="t-sm" style={{ color: "var(--fg-1)" }}>结束进程</span><Kbd>⏎</Kbd></span>
          <span style={{ width: 1, height: 18, background: "var(--border-2)" }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 8 }}><span className="t-sm" style={{ color: "var(--fg-2)" }}>更多操作</span><Kbd wide>⌘K</Kbd></span>
        </div>
      </footer>
    </ThemeWrap>
  );
}

Object.assign(window, { V7Global, V7SubInput });
