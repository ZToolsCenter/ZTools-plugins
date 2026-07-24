<script lang="ts">
  import type { PasteItem, PasteStackState, Pinboard } from "@pasteboard-pro/core";
  import type { DockEdge } from "@pasteboard-pro/design-tokens";

  import PasteStack from "./PasteStack.svelte";
  import PinboardStrip from "./PinboardStrip.svelte";
  import Preview from "./Preview.svelte";
  import Timeline from "./Timeline.svelte";
  import Toolbar from "./Toolbar.svelte";

  let {
    items, pinboards, selectedIds, query, paused, compact, activePinboardId,
    previewItem, pasteStack, status, syncState, loading, dockEdge, onquery, onselect,
    onpaste, onocr, onrotate, onquicklook, onpreview, onclosepreview, onselectpinboard, oncreatepinboard,
    onrenamepinboard, onassignpinboard, ontogglepause, ontogglecompact, onsync,
    onupdatepinboardcolor, onmovepinboard, ondeletepinboard,
    ondrag, onaddstack, ontogglestack, onclearstack, onsettings, oncreate, onedit, onrename,
  }: {
    items: PasteItem[]; pinboards: Pinboard[]; selectedIds: string[]; query: string;
    paused: boolean; compact: boolean; activePinboardId: string | undefined; previewItem: PasteItem | undefined;
    pasteStack: PasteStackState; status: string; syncState: string; loading: boolean;
    dockEdge: DockEdge;
    onquery: (value: string) => void; onselect: (id: string, extend: boolean, toggle: boolean) => void;
    onpaste: (id: string, plainText: boolean) => void; onpreview: (id: string) => void;
    onocr: (id: string) => void;
    onrotate: (id: string, quarterTurns: -1 | 1) => void;
    onquicklook: (id: string) => void;
    onedit: (id: string) => void; onrename: (id: string) => void; oncreate: () => void;
    onclosepreview: () => void; onselectpinboard: (id?: string) => void;
    oncreatepinboard: (name: string) => void; onrenamepinboard: (id: string, name: string) => void;
    onupdatepinboardcolor: (id: string, color: string) => void; onmovepinboard: (id: string, direction: -1 | 1) => void;
    ondeletepinboard: (id: string) => void;
    onassignpinboard: (id: string | undefined, itemId: string) => void; ontogglepause: () => void;
    ontogglecompact: () => void; onsync: () => void; onaddstack: () => void; onsettings: () => void;
    ondrag: () => void;
    ontogglestack: () => void; onclearstack: () => void;
  } = $props();
</script>

<section class:compact class="shelf" class:shelf--bottom={dockEdge === "bottom"} class:shelf--left={dockEdge === "left"} class:shelf--right={dockEdge === "right"} aria-label="Paste剪切板">
  <div class="sheen" aria-hidden="true"></div>
  <button
    type="button"
    class="drag-handle"
    aria-label="拖动 Paste剪切板面板"
    title="拖动到屏幕边缘可吸附"
    onpointerdown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      ondrag();
    }}
  ><span aria-hidden="true"></span></button>
  <Toolbar {query} {paused} {compact} {status} {syncState} {loading} {onquery} {ontogglepause} {ontogglecompact} {onsync} {onaddstack} {onsettings} {oncreate} />
  <PinboardStrip {pinboards} activeId={activePinboardId} onselect={onselectpinboard} oncreate={oncreatepinboard} onrename={onrenamepinboard} onupdatecolor={onupdatepinboardcolor} onmove={onmovepinboard} ondelete={ondeletepinboard} onassign={onassignpinboard} />
  <Timeline {items} {selectedIds} {compact} {onselect} {onpaste} {onpreview} />
  {#if previewItem}
    <Preview item={previewItem} onclose={onclosepreview} onpaste={onpaste} {onocr} {onrotate} {onquicklook} {onedit} {onrename} />
  {/if}
  <PasteStack state={pasteStack} ontoggle={ontogglestack} onclear={onclearstack} />
</section>

<style>
  .shelf {
    position: relative;
    width: 100%;
    min-width: 0;
    min-height: 278px;
    overflow: hidden;
    border: 1px solid var(--pb-line);
    border-radius: var(--pb-radius);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--pb-glass-strong) 84%, transparent), var(--pb-glass)),
      radial-gradient(circle at 16% -20%, rgba(139, 128, 255, .22), transparent 34%);
    box-shadow: 0 28px 70px var(--pb-shadow), inset 0 1px rgba(255,255,255,.28);
    backdrop-filter: blur(28px) saturate(145%);
    -webkit-backdrop-filter: blur(28px) saturate(145%);
    transition: min-height 160ms ease, border-radius 160ms ease;
  }
  .shelf.compact { min-height: 222px; }
  .shelf--bottom { border-bottom-right-radius: 0; border-bottom-left-radius: 0; }
  .shelf--left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .shelf--right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .drag-handle {
    position: absolute;
    z-index: 8;
    top: 3px;
    left: 50%;
    width: 72px;
    height: 16px;
    padding: 5px 18px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    cursor: grab;
    transform: translateX(-50%);
  }
  .drag-handle:active { cursor: grabbing; }
  .drag-handle span {
    display: block;
    width: 100%;
    height: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--pb-ink) 22%, transparent);
    box-shadow: 0 1px rgba(255,255,255,.28);
  }
  .drag-handle:focus-visible { outline: 2px solid var(--pb-accent); outline-offset: -1px; }
  .sheen { position: absolute; inset: 0 0 auto; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.72), transparent); pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .shelf { transition: none; } }
</style>
