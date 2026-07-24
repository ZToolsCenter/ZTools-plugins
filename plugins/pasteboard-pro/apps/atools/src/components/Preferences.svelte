<script lang="ts">
  import type { PasteboardPreferences } from "../adapter";

  let { preferences, saving, onclose, onsave }: {
    preferences: PasteboardPreferences;
    saving: boolean;
    onclose: () => void;
    onsave: (preferences: PasteboardPreferences) => void;
  } = $props();

  let retentionDays = $state(90);
  let blobBudgetGiB = $state(1);
  let privacyLiterals = $state("");
  let screenShareProtection = $state(true);

  $effect(() => {
    retentionDays = preferences.retentionDays;
    blobBudgetGiB = preferences.blobBudgetBytes / 1_073_741_824;
    privacyLiterals = preferences.privacyLiterals.join("\n");
    screenShareProtection = preferences.screenShareProtection;
  });

  function save() {
    onsave({
      retentionDays: Math.round(retentionDays),
      blobBudgetBytes: Math.round(blobBudgetGiB * 1_073_741_824),
      privacyLiterals: [...new Set(privacyLiterals.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean))],
      screenShareProtection,
    });
  }
</script>

<div class="backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) onclose(); }}>
  <section class="panel" aria-labelledby="preferences-title">
    <header><div><span>LOCAL PRIVACY</span><h2 id="preferences-title">隐私与历史保留</h2></div><button type="button" aria-label="关闭设置" onclick={onclose}>×</button></header>
    <form onsubmit={(event) => { event.preventDefault(); save(); }}>
      <label class="toggle"><span><strong>屏幕共享时隐藏浮窗</strong><small>保存后立即更新原生 content protection</small></span><input type="checkbox" bind:checked={screenShareProtection} /></label>
      <div class="grid">
        <label><span>普通历史保留天数</span><input type="number" min="1" max="3650" bind:value={retentionDays} /></label>
        <label><span>附件预算（GiB）</span><input type="number" min="0.0625" max="100" step="0.25" bind:value={blobBudgetGiB} /></label>
      </div>
      <label class="field"><span>敏感内容字面量（每行一个）</span><textarea rows="6" bind:value={privacyLiterals} placeholder="PRIVATE NOTE&#10;internal-only" spellcheck="false"></textarea></label>
      <p>字面量规则和内置令牌、私钥、验证码、支付卡检测会在历史与附件落盘前执行。分组与固定内容不受普通过期清理影响。</p>
      <footer><button type="button" class="quiet" onclick={onclose}>取消</button><button type="submit" class="primary" disabled={saving}>{saving ? "正在保存…" : "保存设置"}</button></footer>
    </form>
  </section>
</div>

<style>
  .backdrop{position:absolute;inset:0;z-index:22;display:grid;padding:12px;place-items:center;background:color-mix(in srgb,#171521 28%,transparent);backdrop-filter:blur(10px)}
  .panel{width:min(620px,100%);max-height:calc(100% - 8px);overflow:auto;border:1px solid var(--pb-line);border-radius:20px;background:color-mix(in srgb,var(--pb-glass-strong) 94%,transparent);box-shadow:0 28px 80px rgba(25,20,43,.32)}
  header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px 14px}header span{color:var(--pb-violet);font-size:10px;font-weight:800;letter-spacing:.12em}h2{margin:4px 0 0;font-size:20px}header button{width:30px;height:30px;border:0;border-radius:50%;background:color-mix(in srgb,var(--pb-line) 60%,transparent);color:var(--pb-muted);cursor:pointer;font-size:20px}
  form{padding:0 22px 20px}.toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 0;border-top:1px solid var(--pb-line)}.toggle span{display:grid;gap:3px}.toggle strong{font-size:12px}.toggle small,p{color:var(--pb-muted);font-size:10px;line-height:1.5}.toggle input{width:32px;accent-color:var(--pb-violet)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;padding:12px 0}.grid label,.field{display:grid;gap:6px}.grid span,.field span{color:var(--pb-muted);font-size:10px;font-weight:700}input[type="number"],textarea{width:100%;padding:9px 11px;border:1px solid var(--pb-line);border-radius:10px;outline:none;background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent);color:var(--pb-ink)}textarea{resize:vertical;font:11px/1.45 "SFMono-Regular",Consolas,monospace}.field{margin-top:11px}
  footer{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}footer button{min-height:36px;padding:0 14px;border:1px solid var(--pb-line);border-radius:11px;cursor:pointer;font-weight:700}.quiet{background:transparent;color:var(--pb-muted)}.primary{border-color:transparent;background:var(--pb-violet);color:white}.primary:disabled{cursor:wait;opacity:.55}
  @media(max-width:620px){.grid{grid-template-columns:1fr}}
</style>
