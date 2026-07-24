<script lang="ts">
  import type { PasteItem } from "@pasteboard-pro/core";

  import { atoolsPasteboard } from "../adapter";

  let { item, onclose, onpaste, onocr, onrotate, onquicklook, onedit, onrename }: {
    item: PasteItem; onclose: () => void; onpaste: (id: string, plainText: boolean) => void; onocr: (id: string) => void; onrotate: (id: string, quarterTurns: -1 | 1) => void; onquicklook: (id: string) => void; onedit: (id: string) => void; onrename: (id: string) => void;
  } = $props();
  let content = $derived(item.payload.text ?? item.ocrText ?? item.payload.filePaths?.join("\n") ?? item.payload.mediaType ?? "内容尚未下载到本机");
  let previewUrl = $state<string>();
  let previewMediaType = $state<string>();
  let previewError = $state<string>();

  $effect(() => {
    const itemId = item.id;
    let cancelled = false;
    previewUrl = undefined;
    previewMediaType = undefined;
    previewError = undefined;
    if (item.payload.blobId !== undefined) {
      void atoolsPasteboard.itemPreview(itemId).then((preview) => {
        if (cancelled || preview === null) return;
        previewMediaType = preview.mediaType;
        previewUrl = `data:${preview.mediaType};base64,${preview.dataBase64}`;
      }).catch((error: unknown) => {
        if (!cancelled) previewError = error instanceof Error ? error.message : String(error);
      });
    }
    return () => { cancelled = true; };
  });
</script>

<aside class="preview" aria-label="内容预览">
  <header><div><span>{item.kind}</span><strong>{item.title ?? item.sourceApp?.name ?? "Preview"}</strong></div><button type="button" aria-label="关闭预览" onclick={onclose}>×</button></header>
  {#if item.kind === "color"}<div class="large-color" style:background={item.payload.text}></div>{/if}
  {#if previewUrl !== undefined && previewMediaType?.startsWith("image/")}
    <div class="preview-body">
      <div class="media"><img src={previewUrl} alt={item.title ?? "剪贴板图片预览"} /></div>
      {#if item.ocrText}<pre class="ocr-text">{item.ocrText}</pre>{/if}
    </div>
  {:else if previewUrl !== undefined && previewMediaType === "application/pdf"}
    <div class="media"><object data={previewUrl} type="application/pdf" aria-label={item.title ?? "PDF 预览"}><span>当前 WebView 无法显示 PDF 预览</span></object></div>
  {:else}
    <pre>{previewError ?? content}</pre>
  {/if}
  <footer><span>{item.sourceApp?.name ?? "Local"} · {new Date(item.copiedAt).toLocaleString()}</span><div>{#if item.kind === "image"}<span class="rotation-group" aria-label="旋转图片"><button class="secondary icon-button" type="button" aria-label="向左旋转" title="向左旋转" onclick={() => onrotate(item.id, -1)}>↶</button><button class="secondary icon-button" type="button" aria-label="向右旋转" title="向右旋转" onclick={() => onrotate(item.id, 1)}>↷</button></span><button class="secondary" type="button" onclick={() => onocr(item.id)}>OCR</button>{/if}{#if item.kind === "image" || item.kind === "pdf"}<button class="secondary" type="button" onclick={() => onquicklook(item.id)}>Quick Look</button>{/if}<button class="secondary" type="button" onclick={() => onrename(item.id)}>重命名</button>{#if ["text", "rich_text", "html", "url", "color"].includes(item.kind)}<button class="secondary" type="button" onclick={() => onedit(item.id)}>编辑</button>{/if}<button class="secondary" type="button" onclick={() => onpaste(item.id, true)}>纯文本</button><button type="button" onclick={() => onpaste(item.id, false)}>粘贴</button></div></footer>
</aside>

<style>
  .preview{position:absolute;z-index:6;top:66px;right:14px;bottom:14px;display:grid;grid-template-rows:auto minmax(0,1fr) auto;width:min(390px,calc(100% - 28px));padding:15px;border:1px solid var(--pb-line);border-radius:21px;background:color-mix(in srgb,var(--pb-glass-strong) 95%,transparent);box-shadow:0 26px 64px var(--pb-shadow),inset 0 1px rgba(255,255,255,.16);backdrop-filter:blur(32px) saturate(150%)}
  header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}header div{display:grid;gap:2px}header span{color:var(--pb-violet);font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}header strong{font-size:14px}button{border:1px solid var(--pb-line);border-radius:10px;background:var(--pb-glass);color:var(--pb-ink);cursor:pointer}header button{width:29px;height:29px;font-size:18px}
  pre{margin:14px 0;overflow:auto;color:var(--pb-ink);font:11px/1.55 "SFMono-Regular",Menlo,monospace;white-space:pre-wrap}.large-color{min-height:82px;margin:14px 0 0;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
  .preview-body{display:grid;min-height:0;grid-template-rows:minmax(150px,1fr) auto;gap:10px;overflow:hidden}.media{min-height:0;margin:14px 0;overflow:hidden;border:1px solid var(--pb-line);border-radius:15px;background:rgba(0,0,0,.08)}.preview-body .media{margin-bottom:0}.media img,.media object{display:block;width:100%;height:100%;min-height:180px;object-fit:contain}.media object{border:0}.ocr-text{max-height:110px;margin:0;padding:10px;border:1px solid var(--pb-line);border-radius:12px;background:color-mix(in srgb,var(--pb-glass) 72%,transparent)}
  footer{flex-wrap:wrap}footer>span{min-width:0;flex:1 1 110px;overflow:hidden;color:var(--pb-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}footer div{display:flex;flex:0 1 auto;flex-wrap:wrap;justify-content:flex-end;gap:6px}footer button{min-height:32px;padding:0 10px;background:var(--pb-violet);color:white}.secondary{background:var(--pb-glass);color:var(--pb-violet)}.rotation-group{display:inline-flex;overflow:hidden;border:1px solid var(--pb-line);border-radius:10px}.rotation-group .icon-button{min-width:32px;padding:0;border:0;border-radius:0;font-size:17px}.rotation-group .icon-button+.icon-button{border-left:1px solid var(--pb-line)}
</style>
