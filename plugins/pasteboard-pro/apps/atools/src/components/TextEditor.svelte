<script lang="ts">
  let { mode, title: initialTitle, text: initialText, saving, onclose, onsave }: {
    mode: "create" | "edit" | "rename";
    title: string;
    text: string;
    saving: boolean;
    onclose: () => void;
    onsave: (value: { title: string; text: string }) => void;
  } = $props();
  let title = $state("");
  let text = $state("");
  $effect(() => { title = initialTitle; text = initialText; });
</script>

<div class="backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) onclose(); }}>
  <section class="editor" aria-labelledby="text-editor-title">
    <header><div><span>PASTEBOARDPRO EDITOR</span><h2 id="text-editor-title">{mode === "create" ? "新建文本" : mode === "rename" ? "重命名" : "编辑文本"}</h2></div><button type="button" aria-label="关闭编辑器" onclick={onclose}>×</button></header>
    <form onsubmit={(event) => { event.preventDefault(); onsave({ title, text }); }}>
      <label><span>标题</span><input maxlength="160" bind:value={title} /></label>
      {#if mode !== "rename"}<label><span>正文</span><textarea rows="10" required bind:value={text}></textarea></label>{/if}
      <footer><button type="button" class="quiet" onclick={onclose}>取消</button><button type="submit" class="primary" disabled={saving || (mode !== "rename" && text.trim().length === 0)}>{saving ? "正在保存…" : "保存"}</button></footer>
    </form>
  </section>
</div>

<style>
  .backdrop{position:absolute;inset:0;z-index:23;display:grid;padding:12px;place-items:center;background:color-mix(in srgb,#171521 28%,transparent);backdrop-filter:blur(10px)}.editor{width:min(620px,100%);border:1px solid var(--pb-line);border-radius:20px;background:color-mix(in srgb,var(--pb-glass-strong) 95%,transparent);box-shadow:0 28px 80px rgba(25,20,43,.32)}header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px 14px}header span{color:var(--pb-violet);font-size:10px;font-weight:800;letter-spacing:.12em}h2{margin:4px 0 0;font-size:20px}header button{width:30px;height:30px;border:0;border-radius:50%;background:color-mix(in srgb,var(--pb-line) 60%,transparent);color:var(--pb-muted);cursor:pointer;font-size:20px}form{display:grid;gap:12px;padding:0 22px 20px}label{display:grid;gap:6px}label span{color:var(--pb-muted);font-size:10px;font-weight:700}input,textarea{width:100%;padding:10px 11px;border:1px solid var(--pb-line);border-radius:10px;outline:none;background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent);color:var(--pb-ink)}textarea{min-height:180px;resize:vertical;font:12px/1.55 "SFMono-Regular",Consolas,monospace}footer{display:flex;gap:8px;justify-content:flex-end}footer button{min-height:36px;padding:0 14px;border:1px solid var(--pb-line);border-radius:11px;cursor:pointer;font-weight:700}.quiet{background:transparent;color:var(--pb-muted)}.primary{border-color:transparent;background:var(--pb-violet);color:white}.primary:disabled{cursor:not-allowed;opacity:.55}
</style>
