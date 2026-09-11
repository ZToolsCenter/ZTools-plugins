<script lang="ts">
  import type { Pinboard } from "@pasteboard-pro/core";

  let { pinboards, activeId, onselect, oncreate, onrename, onupdatecolor, onmove, ondelete, onassign }: {
    pinboards: Pinboard[]; activeId: string | undefined; onselect: (id?: string) => void;
    oncreate: (name: string) => void; onrename: (id: string, name: string) => void;
    onupdatecolor: (id: string, color: string) => void; onmove: (id: string, direction: -1 | 1) => void;
    ondelete: (id: string) => void;
    onassign: (id: string | undefined, itemId: string) => void;
  } = $props();
  let creating = $state(false);
  let editingId = $state<string>();
  let managingId = $state<string>();
  let draft = $state("");

  function drop(event: DragEvent, id?: string) {
    const itemId = event.dataTransfer?.getData("application/x-pasteboard-pro-item");
    if (itemId) onassign(id, itemId);
  }
  function commitCreate() { const name = draft.trim(); if (name) oncreate(name); creating = false; draft = ""; }
  function commitRename(id: string) { const name = draft.trim(); if (name) onrename(id, name); editingId = undefined; draft = ""; }
  function beginRename(pinboard: Pinboard) { managingId = undefined; editingId = pinboard.id; draft = pinboard.name; }
  function moveFromMenu(id: string, direction: -1 | 1) { managingId = undefined; onmove(id, direction); }
</script>

<nav class="strip" aria-label="分组">
  <button class:active={activeId === undefined} type="button" ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); drop(event); }} onclick={() => onselect()}>全部</button>
  {#each pinboards as pinboard (pinboard.id)}
    <div role="listitem" class:active={activeId === pinboard.id} class:managing={managingId === pinboard.id} class="chip" oncontextmenu={(event) => { event.preventDefault(); managingId = managingId === pinboard.id ? undefined : pinboard.id; }} ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); drop(event, pinboard.id); }}>
      {#if editingId === pinboard.id}
        <input aria-label="重命名分组" bind:value={draft} onkeydown={(event) => { if (event.key === "Enter") commitRename(pinboard.id); if (event.key === "Escape") editingId = undefined; }} onblur={() => commitRename(pinboard.id)} />
      {:else}
        <button type="button" onclick={() => onselect(pinboard.id)} ondblclick={() => beginRename(pinboard)}><span class="dot" style:background={pinboard.color}></span>{pinboard.name}</button>
        <button class="manage" type="button" aria-label={`管理 ${pinboard.name}`} onclick={(event) => { event.stopPropagation(); managingId = managingId === pinboard.id ? undefined : pinboard.id; }}>•••</button>
      {/if}
      {#if managingId === pinboard.id}
        <div class="controls" aria-label={`${pinboard.name} 管理选项`}>
          <button type="button" onclick={() => beginRename(pinboard)}>重命名</button>
          <label class="color-action"><input class="color" type="color" value={pinboard.color} aria-label="分组颜色" onchange={(event) => { onupdatecolor(pinboard.id, event.currentTarget.value); managingId = undefined; }} /><span>颜色</span></label>
          {#if pinboards[0]?.id !== pinboard.id}<button type="button" onclick={() => moveFromMenu(pinboard.id, -1)}>← 移到左侧</button>{/if}
          {#if pinboards.at(-1)?.id !== pinboard.id}<button type="button" onclick={() => moveFromMenu(pinboard.id, 1)}>移到右侧 →</button>{/if}
          <button class="danger" type="button" onclick={() => { managingId = undefined; ondelete(pinboard.id); }}>删除</button>
        </div>
      {/if}
    </div>
  {/each}
  {#if creating}
    <input class="new" aria-label="新建分组" placeholder="分组名称" bind:value={draft} onkeydown={(event) => { if (event.key === "Enter") commitCreate(); if (event.key === "Escape") creating = false; }} onblur={commitCreate} />
  {:else}
    <button class="add" type="button" aria-label="新建分组" onclick={() => { creating = true; draft = ""; }}>＋</button>
  {/if}
  <span class="hint">⌘1–9 快捷粘贴</span>
</nav>

<style>
  .strip { display:flex; gap:6px; align-items:center; min-height:39px; padding:5px 16px 3px; overflow-x:auto; scrollbar-width:none; }
  .strip::-webkit-scrollbar{display:none}
  button { display:inline-flex; flex:0 0 auto; gap:6px; align-items:center; min-height:27px; padding:0 10px; border:0; border-radius:9px; background:transparent; color:var(--pb-muted); cursor:pointer; font-size:10px; font-weight:650; }
  button:hover, button:focus-visible, button.active, .chip.active { background:color-mix(in srgb,var(--pb-violet) 14%,transparent); color:var(--pb-violet); outline:0; }
  .chip { position:relative; display:inline-flex; flex:0 0 auto; align-items:center; min-height:27px; border-radius:9px; }
  .dot { width:7px; height:7px; border-radius:50%; box-shadow:0 0 0 3px color-mix(in srgb,currentColor 10%,transparent); }
  input { width:100px; height:25px; padding:0 7px; border:1px solid var(--pb-violet); border-radius:8px; outline:0; background:var(--pb-glass-strong); color:var(--pb-ink); font-size:10px; }
  .manage{width:22px;min-width:22px;padding:0;overflow:hidden;opacity:0;transition:opacity 120ms ease}.chip:hover .manage,.chip:focus-within .manage,.chip.managing .manage{opacity:1}.controls{display:flex;gap:3px;align-items:center;padding:2px 4px 2px 1px}.controls button{min-width:max-content;min-height:23px;padding:0 7px}.controls .danger{color:#d94b57}.color-action{display:inline-flex;gap:5px;align-items:center;min-height:23px;padding:0 7px;border-radius:8px;color:var(--pb-muted);cursor:pointer;font-size:10px;font-weight:650}.color-action:hover{background:color-mix(in srgb,var(--pb-violet) 10%,transparent);color:var(--pb-ink)}.color{width:18px;height:23px;padding:3px 0;border:0;background:transparent;cursor:pointer}
  .new{flex:0 0 116px}.add{padding:0 8px;font-size:15px}.hint{margin-left:auto;color:var(--pb-muted);font-size:9px;white-space:nowrap}
</style>
