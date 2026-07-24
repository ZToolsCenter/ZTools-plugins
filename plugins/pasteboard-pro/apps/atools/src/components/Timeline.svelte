<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { PasteItem } from "@pasteboard-pro/core";
  import { pasteboardTokens } from "@pasteboard-pro/design-tokens";

  import PasteCard from "./PasteCard.svelte";

  let { items, selectedIds, compact, onselect, onpaste, onpreview }: {
    items: PasteItem[]; selectedIds: string[]; compact: boolean;
    onselect: (id: string, extend: boolean, toggle: boolean) => void;
    onpaste: (id: string, plainText: boolean) => void; onpreview: (id: string) => void;
  } = $props();
  let viewport = $state<HTMLDivElement>();
  let scrollLeft = $state(0);
  let viewportWidth = $state(900);
  let cardWidth = $derived(compact ? pasteboardTokens.compactCardWidth : pasteboardTokens.expandedCardWidth);
  let stride = $derived(cardWidth + pasteboardTokens.cardGap);
  let start = $derived(Math.max(0, Math.floor(scrollLeft / stride) - 3));
  let end = $derived(Math.min(items.length, Math.ceil((scrollLeft + viewportWidth) / stride) + 3));
  let visible = $derived(items.slice(start, end));
  let observer: ResizeObserver | undefined;

  onMount(() => {
    observer = new ResizeObserver(([entry]) => { if (entry) viewportWidth = entry.contentRect.width; });
    if (viewport !== undefined) observer.observe(viewport);
  });
  onDestroy(() => observer?.disconnect());
</script>

<section class:compact class="timeline" aria-label="剪贴板时间线">
  {#if items.length === 0}
    <div class="empty"><span>LOCAL HISTORY</span><strong>复制内容后会出现在这里</strong><p>隐私规则会在写入本地历史之前运行。</p></div>
  {:else}
    <div class="viewport" bind:this={viewport} onscroll={(event) => scrollLeft = event.currentTarget.scrollLeft} role="listbox" aria-multiselectable="true">
      <div class="track" style:width={`${items.length * stride}px`} style:--card-width={`${cardWidth}px`}>
        {#each visible as item, offset (item.id)}
          <div class="slot" style:transform={`translateX(${(start + offset) * stride}px)`}>
            <PasteCard {item} index={start + offset} selected={selectedIds.includes(item.id)} {compact} {onselect} {onpaste} {onpreview} />
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .timeline{min-height:168px;padding:8px 16px 16px;overflow:hidden}.timeline.compact{min-height:130px}
  .viewport{min-height:160px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-color:color-mix(in srgb,var(--pb-violet) 28%,transparent) transparent;scrollbar-width:thin}.compact .viewport{min-height:122px}
  .track{position:relative;min-height:160px}.compact .track{min-height:122px}.slot{position:absolute;top:5px;left:0;width:var(--card-width);will-change:transform}
  .empty{display:grid;min-height:154px;place-content:center;justify-items:center;color:var(--pb-muted);text-align:center}.empty span{color:var(--pb-violet);font-size:8px;font-weight:800;letter-spacing:.18em}.empty strong{margin-top:8px;color:var(--pb-ink);font-size:15px}.empty p{margin:4px 0 0;font-size:10px}
</style>
