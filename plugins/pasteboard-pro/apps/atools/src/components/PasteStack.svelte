<script lang="ts">
  import type { PasteStackState } from "@pasteboard-pro/core";
  let { state, ontoggle, onclear }: { state: PasteStackState; ontoggle: () => void; onclear: () => void } = $props();
</script>

{#if state.itemIds.length > 0}
  <div class="stack" role="status"><span class="layers" aria-hidden="true"></span><strong>粘贴队列</strong><span>{state.itemIds.length} 项 · {state.direction === "forward" ? "正序" : "倒序"}</span><button type="button" onclick={ontoggle}>切换</button><button type="button" onclick={onclear}>清空</button></div>
{/if}

<style>
  .stack{position:absolute;z-index:5;right:18px;bottom:16px;display:flex;gap:8px;align-items:center;min-height:36px;padding:0 10px;border:1px solid var(--pb-line);border-radius:13px;background:color-mix(in srgb,var(--pb-glass-strong) 94%,transparent);box-shadow:0 12px 30px var(--pb-shadow);color:var(--pb-muted);font-size:9px}.stack strong{color:var(--pb-ink)}.layers{width:14px;height:12px;border:1px solid var(--pb-violet);border-radius:4px;box-shadow:3px -3px 0 color-mix(in srgb,var(--pb-violet) 22%,transparent)}button{border:0;background:transparent;color:var(--pb-violet);cursor:pointer;font-size:9px}
</style>
