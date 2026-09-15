/* =====================================================================
   v8_tray.jsx — Tauri 菜单栏（状态栏）模式
   macOS 顶部状态栏下挂的 popover：多选 + 逐项结束 + 一键结束所选。
   新增「无操作自动收起」：菜单未切换 / 鼠标无操作时，按设定时间自动关闭。
   导出三个画板：
     V8Tray     — 菜单栏弹层 · 默认（2 项选中，红色「结束所选」，底部空闲计时）
     V8Settings — 偏好设置 · 自动收起时间 + 自动清理
     V8Idle     — 无操作自动收起 · 倒计时态
   ===================================================================== */

const TRAY_W = 360;

/* desktop + menubar backdrop, popover hangs from the tray icon (right side) */
function TrayScene({ theme = "dark", children, caretX = 372 }) {
  const wall = theme === "light"
    ? "linear-gradient(155deg,#cdd6e6 0%,#aeb9cf 55%,#9fb0c8 100%)"
    : "linear-gradient(155deg,#1c2433 0%,#10151f 55%,#0a0e15 100%)";
  return (
    <ThemeWrap theme={theme} style={{ background: wall }}>
      {/* macOS menu bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 26, display: "flex", alignItems: "center", padding: "0 12px",
        background: theme === "light" ? "rgba(255,255,255,0.55)" : "rgba(10,12,18,0.55)", backdropFilter: "blur(8px)",
        borderBottom: theme === "light" ? "1px solid rgba(0,0,0,0.06)" : "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ font: "600 12px/1 var(--font-sans)", color: theme === "light" ? "#1b2330" : "#e9edf5" }}>鹅的监控</span>
        <span style={{ marginLeft: 14, font: "var(--t-xs)", color: theme === "light" ? "rgba(27,35,48,0.6)" : "rgba(233,237,245,0.6)" }}>窗口　帮助</span>
        {/* right cluster */}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, color: theme === "light" ? "rgba(27,35,48,0.78)" : "rgba(233,237,245,0.82)" }}>
          <Icon name="wifi" size={14} />
          <span style={{ font: "var(--t-mono-sm)" }}>10:24</span>
          {/* our highlighted tray icon */}
          <span style={{ display: "grid", placeItems: "center", width: 22, height: 20, borderRadius: 5,
            background: theme === "light" ? "rgba(91,124,250,0.16)" : "rgba(91,124,250,0.28)", boxShadow: "inset 0 0 0 1px var(--accent)" }}>
            <AppLogo size={15} radius={4} />
          </span>
        </span>
      </div>
      {/* caret */}
      <div style={{ position: "absolute", top: 30, left: caretX - 7, width: 0, height: 0,
        borderLeft: "7px solid transparent", borderRight: "7px solid transparent",
        borderBottom: "7px solid var(--bg-panel)", filter: "drop-shadow(0 -1px 0 var(--border-2))", zIndex: 2 }} />
      {/* popover */}
      <div style={{ position: "absolute", top: 36, right: 20, width: TRAY_W,
        background: "var(--bg-panel)", borderRadius: 14, border: "1px solid var(--border-1)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25)", overflow: "hidden",
        display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </ThemeWrap>
  );
}

/* selection checkbox */
function Check({ on, dim }) {
  return (
    <span style={{ width: 18, height: 18, flex: "none", borderRadius: 5, display: "grid", placeItems: "center",
      background: on ? "var(--accent)" : "transparent",
      border: on ? "1px solid var(--accent)" : "1.5px solid var(--border-strong)",
      opacity: dim ? 0.5 : 1 }}>
      {on ? <Icon name="check" size={12} style={{ color: "#fff" }} /> : null}
    </span>
  );
}

/* one app row */
function TrayRow({ app, checked, muted }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, height: 40, padding: "0 12px", borderRadius: 9,
      background: checked ? "var(--bg-row-sel)" : "transparent" }}>
      <Check on={checked} />
      <AppIcon app={app} size={22} radius={6} />
      <span style={{ flex: 1, minWidth: 0, font: "var(--t-row)", fontWeight: checked ? 600 : 500,
        color: muted ? "var(--fg-3)" : "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{app.name}</span>
      <span style={{ font: "var(--t-mono-sm)", color: app.cpu >= 10 ? "var(--metric-cpu)" : "var(--fg-3)", minWidth: 42, textAlign: "right" }}>{fmtCpu(app.cpu)}</span>
      <button style={{ width: 24, height: 24, flex: "none", display: "grid", placeItems: "center", borderRadius: 6, border: "none", background: "transparent", color: "var(--fg-3)", cursor: "pointer" }}>
        <Icon name="more-horizontal" size={16} />
      </button>
      <button title="结束此应用" style={{ width: 26, height: 26, flex: "none", display: "grid", placeItems: "center", borderRadius: 7, border: "1px solid var(--border-1)", background: "var(--bg-elev)", color: "var(--fg-2)", cursor: "pointer" }}>
        <Icon name="power" size={14} />
      </button>
    </div>
  );
}

/* shared header: big primary kill-selected button + search */
function TrayHead({ selCount = 2 }) {
  const has = selCount > 0;
  return (
    <div style={{ padding: "12px 12px 6px" }}>
      <button style={{ width: "100%", height: 40, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, border: "none", cursor: "pointer",
        background: has ? "var(--danger)" : "var(--bg-elev)", color: has ? "#fff" : "var(--fg-3)",
        font: "var(--t-base)", fontWeight: 700, boxShadow: has ? "0 1px 0 rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.18)" : "none" }}>
        <Icon name="power" size={16} />结束所选
        {has ? <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: "rgba(255,255,255,0.22)", display: "grid", placeItems: "center", font: "var(--t-mono-sm)", fontWeight: 700 }}>{selCount}</span> : null}
      </button>
      <div style={{ marginTop: 8, height: 34, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", borderRadius: 9, background: "var(--bg-input)", border: "1px solid var(--border-1)" }}>
        <Icon name="search" size={15} style={{ color: "var(--fg-3)" }} />
        <span style={{ font: "var(--t-row)", color: "var(--fg-3)" }}>搜索应用…</span>
      </div>
    </div>
  );
}

/* footer: idle auto-collapse indicator + settings */
function TrayFoot({ onSettings = true, idleLabel = "无操作 15s 后自动收起", pct = 0.62 }) {
  return (
    <footer style={{ height: 44, flex: "none", display: "flex", alignItems: "center", gap: 9, padding: "0 10px 0 12px", borderTop: "1px solid var(--border-1)", background: "var(--bg-sidebar)" }}>
      <Icon name="clock" size={13} style={{ color: "var(--fg-3)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span className="t-xs" style={{ color: "var(--fg-3)", whiteSpace: "nowrap" }}>{idleLabel}</span>
        <span style={{ height: 3, borderRadius: 999, background: "var(--bg-track)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: (pct * 100) + "%", background: "var(--fg-3)", borderRadius: 999 }} />
        </span>
      </div>
      <button title="偏好设置" style={{ width: 30, height: 30, flex: "none", display: "grid", placeItems: "center", borderRadius: 8, border: "1px solid var(--border-1)", background: "var(--bg-elev)", color: "var(--fg-2)", cursor: "pointer" }}>
        <Icon name="sliders-horizontal" size={16} />
      </button>
    </footer>
  );
}

/* =====================================================================
   A — 默认弹层
   ===================================================================== */
function V8Tray({ theme = "dark" }) {
  const list = [...APPS];
  const selected = { chrome: true, docker: true };
  const selCount = Object.keys(selected).length;
  return (
    <TrayScene theme={theme}>
      <TrayHead selCount={selCount} />
      <div style={{ padding: "2px 6px 6px", display: "flex", flexDirection: "column", gap: 1 }}>
        {list.map((a) => <TrayRow key={a.id} app={a} checked={!!selected[a.id]} muted={a.cpu < 1 && !selected[a.id]} />)}
      </div>
      <TrayFoot />
    </TrayScene>
  );
}

/* =====================================================================
   B — 偏好设置：自动收起时间 + 自动清理
   ===================================================================== */
function Segmented({ options, value }) {
  return (
    <div style={{ display: "flex", alignItems: "center", height: 34, gap: 3, padding: 3, borderRadius: 10, background: "var(--bg-track)", border: "1px solid var(--border-1)" }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <span key={o} style={{ flex: "1 1 0", minWidth: 0, height: 28, display: "grid", placeItems: "center", borderRadius: 7,
            font: "var(--t-sm)", fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap", cursor: "pointer",
            background: on ? "var(--bg-elev)" : "transparent", color: on ? "var(--fg-1)" : "var(--fg-3)",
            boxShadow: on ? "0 1px 2px rgba(0,0,0,0.18)" : "none", border: on ? "1px solid var(--border-2)" : "1px solid transparent" }}>{o}</span>
        );
      })}
    </div>
  );
}
function Switch({ on }) {
  return (
    <span style={{ width: 38, height: 22, flex: "none", borderRadius: 999, padding: 2, display: "flex",
      justifyContent: on ? "flex-end" : "flex-start", background: on ? "var(--accent)" : "var(--bg-track)",
      border: on ? "1px solid var(--accent)" : "1px solid var(--border-strong)", transition: "background .15s" }}>
      <span style={{ width: 16, height: 16, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} />
    </span>
  );
}
function SetRow({ icon, title, desc, control, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px" }}>
      <span style={{ width: 30, height: 30, flex: "none", display: "grid", placeItems: "center", borderRadius: 8, background: "var(--bg-elev)", border: "1px solid var(--border-1)", color: accent || "var(--fg-2)" }}>
        <Icon name={icon} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--t-row)", fontWeight: 600, color: "var(--fg-1)" }}>{title}</div>
        {desc ? <div className="t-xs" style={{ color: "var(--fg-3)", marginTop: 1 }}>{desc}</div> : null}
      </div>
      {control}
    </div>
  );
}

function V8Settings({ theme = "dark" }) {
  return (
    <TrayScene theme={theme}>
      {/* header */}
      <div style={{ height: 46, flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 8px", borderBottom: "1px solid var(--border-1)" }}>
        <button style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: 8, border: "none", background: "transparent", color: "var(--fg-2)", cursor: "pointer" }}><Icon name="arrow-left" size={17} /></button>
        <span style={{ font: "var(--t-lg)", fontWeight: 700, color: "var(--fg-1)" }}>偏好设置</span>
        <span style={{ marginLeft: "auto", marginRight: 6, font: "var(--t-xs)", color: "var(--fg-3)" }}>Preferences</span>
      </div>

      {/* 自动收起 */}
      <div style={{ padding: "4px 0 2px" }}>
        <div className="t-label" style={{ padding: "10px 14px 4px" }}>无操作自动收起</div>
        <SetRow icon="clock" accent="var(--accent)" title="菜单未切换时自动收起"
          desc="鼠标无操作、未切换应用即开始计时" control={null} />
        <div style={{ padding: "0 12px 12px" }}>
          <Segmented options={["关闭", "10s", "30s", "60s"]} value="30s" />
          <div className="t-xs" style={{ color: "var(--fg-3)", marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="timer" size={12} style={{ color: "var(--fg-3)" }} />当前：30 秒无操作后面板自动关闭，移动鼠标即重置
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: "var(--border-1)", margin: "0 12px" }} />

      {/* 自动清理 */}
      <div style={{ padding: "4px 0 2px" }}>
        <div className="t-label" style={{ padding: "10px 14px 4px" }}>自动清理</div>
        <SetRow icon="zap" accent="var(--warn)" title="空闲应用自动结束"
          desc="长时间空闲且低占用的应用自动 Quit" control={<Switch on={true} />} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 12px 53px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 8, background: "var(--bg-elev)", border: "1px solid var(--border-1)", font: "var(--t-mono-sm)", color: "var(--fg-1)" }}>空闲 &gt; 30 分钟</span>
          <span className="t-xs" style={{ color: "var(--fg-3)" }}>且</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 8, background: "var(--bg-elev)", border: "1px solid var(--border-1)", font: "var(--t-mono-sm)", color: "var(--fg-1)" }}>CPU &lt; 1%</span>
        </div>
        <SetRow icon="check" title="结束前二次确认" desc="批量结束时弹出确认（含「不再提醒」）" control={<Switch on={true} />} />
        <SetRow icon="moon-star" title="开机时随系统启动" control={<Switch on={false} />} />
      </div>

      {/* footer */}
      <footer style={{ height: 48, flex: "none", display: "flex", alignItems: "center", padding: "0 12px", borderTop: "1px solid var(--border-1)", background: "var(--bg-sidebar)" }}>
        <span className="t-xs" style={{ color: "var(--fg-3)" }}>更改即时生效</span>
        <button style={{ marginLeft: "auto", height: 32, padding: "0 18px", borderRadius: 9, border: "none", cursor: "pointer", background: "var(--accent)", color: "var(--fg-on-accent)", font: "var(--t-base)", fontWeight: 700 }}>完成</button>
      </footer>
    </TrayScene>
  );
}

/* =====================================================================
   C — 无操作自动收起 · 倒计时态
   ===================================================================== */
function CountRing({ n = 3, total = 30 }) {
  const R = 17, C = 2 * Math.PI * R;
  const frac = n / 8; /* visually near-empty when about to close */
  return (
    <span style={{ position: "relative", width: 40, height: 40, flex: "none", display: "grid", placeItems: "center" }}>
      <svg width="40" height="40" viewBox="0 0 40 40" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--bg-track)" strokeWidth="3" />
        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <span style={{ font: "var(--t-mono)", fontWeight: 700, color: "var(--accent)", fontSize: 15 }}>{n}</span>
    </span>
  );
}

function V8Idle({ theme = "dark" }) {
  const list = [...APPS];
  const selected = { chrome: true, docker: true };
  return (
    <TrayScene theme={theme}>
      <TrayHead selCount={2} />
      <div style={{ position: "relative", padding: "2px 6px 6px", display: "flex", flexDirection: "column", gap: 1 }}>
        <div style={{ opacity: 0.45, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 1 }}>
          {list.map((a) => <TrayRow key={a.id} app={a} checked={!!selected[a.id]} muted={a.cpu < 1 && !selected[a.id]} />)}
        </div>
        {/* idle overlay chip */}
        <div style={{ position: "absolute", left: 16, right: 16, top: "50%", transform: "translateY(-50%)",
          display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12,
          background: "var(--bg-elev)", border: "1px solid var(--border-2)", boxShadow: "var(--shadow-pop)" }}>
          <CountRing n={3} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--t-base)", fontWeight: 700, color: "var(--fg-1)" }}>3 秒后自动收起</div>
            <div className="t-xs" style={{ color: "var(--fg-3)", marginTop: 2 }}>检测到无操作 · 移动鼠标或按任意键取消</div>
          </div>
          <button style={{ height: 28, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--bg-panel)", color: "var(--fg-1)", font: "var(--t-sm)", fontWeight: 600, cursor: "pointer", flex: "none" }}>保持打开</button>
        </div>
      </div>
      <TrayFoot idleLabel="即将收起 · 倒计时中" pct={0.1} />
    </TrayScene>
  );
}

Object.assign(window, { V8Tray, V8Settings, V8Idle });
