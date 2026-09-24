<script lang="ts">
  import type { PasteItem } from "@pasteboard-pro/core";

  let { item, selected, index, compact, onselect, onpaste, onpreview }: {
    item: PasteItem; selected: boolean; index: number; compact: boolean;
    onselect: (id: string, extend: boolean, toggle: boolean) => void;
    onpaste: (id: string, plainText: boolean) => void; onpreview: (id: string) => void;
  } = $props();
  let body = $derived(item.payload.text ?? item.payload.filePaths?.map((path) => path.split("/").pop() ?? path).join("\n") ?? item.ocrText ?? item.payload.mediaType ?? item.kind);

  function drag(event: DragEvent) {
    event.dataTransfer?.setData("application/x-pasteboard-pro-item", item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }
</script>

<button type="button" class:selected class:compact class:color={item.kind === "color"} role="option" aria-selected={selected} draggable="true" ondragstart={drag} onclick={(event) => onselect(item.id, event.shiftKey, event.metaKey)} ondblclick={() => onpaste(item.id, false)} onkeydown={(event) => { if (event.key === "Enter") onpaste(item.id, event.shiftKey); if (event.key === " ") { event.preventDefault(); onpreview(item.id); } }}>
  <header><span>{item.kind.replace("_", " ")}</span>{#if index < 9}<kbd>⌘{index + 1}</kbd>{/if}</header>
  {#if item.kind === "color"}
    <div class="colorwell" style:background={item.payload.text ?? "transparent"}></div>
  {:else if item.kind === "image"}
    <div class="image"><span>IMAGE</span><i></i></div>
  {:else}
    <p>{body}</p>
  {/if}
  <footer><div><strong>{item.title ?? item.sourceApp?.name ?? "Untitled"}</strong><span>{item.sourceApp?.name ?? "Local"}</span></div><time>{new Date(item.copiedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></footer>
</button>

<style>
  button { display:grid; grid-template-rows:auto minmax(0,1fr) auto; width:var(--card-width); height:150px; padding:11px; overflow:hidden; border:1px solid var(--pb-line); border-radius:19px; background:color-mix(in srgb,var(--pb-glass-strong) 78%,transparent); box-shadow:0 8px 22px color-mix(in srgb,var(--pb-shadow) 55%,transparent), inset 0 1px rgba(255,255,255,.1); color:inherit; cursor:default; outline:0; text-align:left; transform:translateY(0); transition:transform 150ms ease,border-color 150ms ease,box-shadow 150ms ease; }
  button.compact{height:112px;border-radius:16px} button:hover{transform:translateY(-3px)}
  button.selected, button:focus-visible { z-index:2; border-color:color-mix(in srgb,var(--pb-violet) 75%,white 8%); box-shadow:0 0 0 3px color-mix(in srgb,var(--pb-violet) 17%,transparent),0 15px 36px color-mix(in srgb,var(--pb-shadow) 68%,transparent); transform:translateY(-4px); }
  header,footer{display:flex;align-items:center;justify-content:space-between;gap:8px} header span{color:var(--pb-violet);font-size:8px;font-weight:800;letter-spacing:.13em;text-transform:uppercase} kbd{padding:2px 5px;border:1px solid var(--pb-line);border-radius:6px;color:var(--pb-muted);font-size:8px}
  p{display:-webkit-box;margin:10px 0;overflow:hidden;color:var(--pb-ink);font-size:12px;line-height:1.45;white-space:pre-wrap;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3}.compact p{-webkit-line-clamp:2;line-clamp:2;margin:7px 0;font-size:11px}
  .colorwell,.image{min-height:68px;margin:8px 0;border-radius:12px}.compact .colorwell,.compact .image{min-height:42px}
  .colorwell{box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)} .image{position:relative;display:grid;overflow:hidden;background:linear-gradient(145deg,#9c94e9,#4a447b);color:rgba(255,255,255,.76);font-size:8px;font-weight:800;letter-spacing:.18em;place-items:center}.image:before{position:absolute;width:90px;height:90px;border-radius:50%;background:rgba(255,255,255,.18);content:"";filter:blur(8px);transform:translate(-38px,-26px)}
  footer div{display:grid;min-width:0}footer strong,footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}footer strong{color:var(--pb-ink);font-size:10px}footer span,time{color:var(--pb-muted);font-size:8px}time{flex:0 0 auto}
  @media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
