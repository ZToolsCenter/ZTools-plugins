<script lang="ts">
  let { query, paused, compact, status, syncState, loading, onquery, ontogglepause, ontogglecompact, onsync, onaddstack, onsettings, oncreate }: {
    query: string; paused: boolean; compact: boolean; status: string; syncState: string; loading: boolean;
    onquery: (value: string) => void; ontogglepause: () => void; ontogglecompact: () => void;
    onsync: () => void; onaddstack: () => void; onsettings: () => void; oncreate: () => void;
  } = $props();
</script>

<header class="toolbar">
  <div class="brand"><img class="mark" src="/logo.png" alt="" /><div><strong>Paste剪切板</strong><small>{status}</small></div></div>
  <label class="search">
    <span aria-hidden="true">⌕</span>
    <input data-pb-search type="search" value={query} placeholder="搜索内容、App、日期或分组" autocomplete="off" oninput={(event) => onquery(event.currentTarget.value)} />
    <kbd>⌘F</kbd>
  </label>
  <div class="actions">
    <button type="button" onclick={oncreate} title="新建文本（Command-N）"><span>＋</span><em>新建</em></button>
    <button type="button" onclick={onsettings} title="隐私与历史保留"><span>⚙</span><em>设置</em></button>
    <button type="button" class:active={syncState === "syncing"} onclick={onsync} title="立即同步"><span>↻</span><em>{syncState === "success" ? "已同步" : "同步"}</em></button>
    <button type="button" onclick={onaddstack} title="加入粘贴队列"><span>≋</span><em>队列</em></button>
    <button type="button" aria-pressed={compact} onclick={ontogglecompact} title="切换紧凑模式"><span>↔</span><em>{compact ? "展开" : "紧凑"}</em></button>
    <button type="button" class:paused aria-pressed={paused} onclick={ontogglepause}><span>{paused ? "▶" : "Ⅱ"}</span><em>{paused ? "继续" : "暂停"}</em></button>
  </div>
</header>

<style>
  .toolbar { display:grid; grid-template-columns:auto minmax(240px, 520px) auto; gap:16px; align-items:center; min-height:68px; padding:12px 16px 10px; border-bottom:1px solid color-mix(in srgb, var(--pb-line) 72%, transparent); }
  .brand { display:flex; gap:10px; align-items:center; min-width:150px; }
  .mark { display:block; width:30px; height:30px; border-radius:10px; box-shadow:0 7px 18px rgba(71,59,185,.24); object-fit:cover; }
  .brand div { display:grid; gap:2px; min-width:0; }
  strong { color:var(--pb-ink); font-size:12px; letter-spacing:-.01em; }
  small { max-width:160px; overflow:hidden; color:var(--pb-muted); font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
  .search { display:grid; grid-template-columns:18px minmax(0,1fr) auto; gap:9px; align-items:center; height:40px; padding:0 11px; border:1px solid var(--pb-line); border-radius:14px; background:color-mix(in srgb,var(--pb-glass-strong) 68%,transparent); box-shadow:inset 0 1px rgba(255,255,255,.09); }
  .search:focus-within { outline:2px solid color-mix(in srgb,var(--pb-violet) 64%,transparent); outline-offset:2px; }
  .search > span { color:var(--pb-muted); font-size:20px; transform:rotate(-16deg); }
  input { min-width:0; border:0; outline:0; background:transparent; color:var(--pb-ink); font-size:12px; }
  input::placeholder { color:var(--pb-muted); }
  kbd { padding:2px 6px; border:1px solid var(--pb-line); border-radius:6px; color:var(--pb-muted); font-size:9px; }
  .actions { display:flex; gap:7px; justify-content:flex-end; }
  button { display:flex; gap:5px; align-items:center; min-height:34px; padding:0 10px; border:1px solid var(--pb-line); border-radius:11px; background:color-mix(in srgb,var(--pb-glass-strong) 62%,transparent); color:var(--pb-muted); cursor:pointer; }
  button:hover, button:focus-visible, button.active { color:var(--pb-ink); outline:2px solid color-mix(in srgb,var(--pb-violet) 45%,transparent); outline-offset:1px; }
  button.paused { color:var(--pb-coral); }
  button span { font-size:13px; } button em { font-size:10px; font-style:normal; }
  @media (max-width:760px) { .toolbar{grid-template-columns:auto minmax(0,1fr)} .actions{grid-column:1/-1} .actions button{flex:1;justify-content:center} .brand div{display:none} }
</style>
