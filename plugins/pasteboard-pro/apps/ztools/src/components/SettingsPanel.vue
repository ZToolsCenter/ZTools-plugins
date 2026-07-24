<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import type { SaveSyncConfigurationInput } from "../../preload/sync-config";
import type { SyncSettings } from "../../preload/sync-store";
import type {
  MultiPasteMode,
  ShelfDockEdge,
  WindowPreferences,
} from "../../preload/window-preferences";
import type { PrivacySettings } from "../../preload/privacy";
import {
  blobBudgetBytes,
  blobBudgetInputConstraints,
  blobBudgetUnits,
  blobBudgetValue,
  preferredBlobBudgetUnit,
  type BlobBudgetUnit,
} from "../blob-budget";
import {
  lines,
  parseContentRules,
  parseLines,
  serializeContentRules,
} from "../privacy-view";
import { syncStatusPresentation } from "../sync-view";

type SettingsTab = "general" | "privacy" | "sync";

const props = defineProps<{
  initialTab: SettingsTab;
  privacySettings: PrivacySettings;
  syncSettings: SyncSettings;
  windowPreferences: WindowPreferences;
  saving: boolean;
  standalone?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  retry: [];
  save: [
    privacySettings: PrivacySettings,
    windowPreferences: WindowPreferences,
    syncInput: SaveSyncConfigurationInput,
  ];
}>();

const tabs: readonly Readonly<{ id: SettingsTab; label: string }>[] = [
  { id: "general", label: "通用" },
  { id: "privacy", label: "隐私" },
  { id: "sync", label: "同步" },
];
const dockOptions: readonly (readonly [ShelfDockEdge, string])[] = [
  ["bottom", "下方"],
  ["top", "上方"],
  ["left", "左侧"],
  ["right", "右侧"],
];
const multiPasteOptions: readonly (readonly [MultiPasteMode, string])[] = [
  ["batch", "一次性多条"],
  ["queue", "逐一粘贴队列"],
];

const activeTab = ref<SettingsTab>(props.initialTab);
const initialBlobBudgetUnit = preferredBlobBudgetUnit(
  props.privacySettings.retention.maxBlobBytes,
);
const form = reactive({
  dockEdge: props.windowPreferences.dockEdge as ShelfDockEdge,
  multiPasteMode: props.windowPreferences.multiPasteMode as MultiPasteMode,
  ignoredBundleIds: lines(props.privacySettings.rules.ignoredBundleIds),
  contentRules: serializeContentRules(props.privacySettings.rules.contentRules),
  blockLikelySecrets: props.privacySettings.rules.blockLikelySecrets,
  retentionDays: props.privacySettings.retention.days,
  maxBlobValue: blobBudgetValue(
    props.privacySettings.retention.maxBlobBytes,
    initialBlobBudgetUnit,
  ),
  maxBlobUnit: initialBlobBudgetUnit,
  screenShareProtection: props.privacySettings.screenShareProtection,
  syncEnabled: props.syncSettings.enabled,
  baseUrl: props.syncSettings.baseUrl,
  username: props.syncSettings.username,
  webdavPassword: "",
  syncPassword: "",
  syncFileContents: props.syncSettings.syncFileContents,
});

const blobBudgetConstraints = computed(() =>
  blobBudgetInputConstraints(form.maxBlobUnit),
);
const syncPresentation = computed(() =>
  syncStatusPresentation(props.syncSettings.status),
);

watch(() => props.initialTab, (tab) => { activeTab.value = tab; });
watch(
  () => props.windowPreferences,
  (settings) => {
    form.dockEdge = settings.dockEdge;
    form.multiPasteMode = settings.multiPasteMode;
  },
);
watch(
  () => props.privacySettings,
  (settings) => {
    form.ignoredBundleIds = lines(settings.rules.ignoredBundleIds);
    form.contentRules = serializeContentRules(settings.rules.contentRules);
    form.blockLikelySecrets = settings.rules.blockLikelySecrets;
    form.retentionDays = settings.retention.days;
    form.maxBlobUnit = preferredBlobBudgetUnit(settings.retention.maxBlobBytes);
    form.maxBlobValue = blobBudgetValue(
      settings.retention.maxBlobBytes,
      form.maxBlobUnit,
    );
    form.screenShareProtection = settings.screenShareProtection;
  },
);
watch(
  () => props.syncSettings,
  (settings) => {
    form.syncEnabled = settings.enabled;
    form.baseUrl = settings.baseUrl;
    form.username = settings.username;
    form.webdavPassword = "";
    form.syncPassword = "";
    form.syncFileContents = settings.syncFileContents;
  },
);

function updateBlobBudgetUnit(event: Event): void {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  const nextUnit = select.value as BlobBudgetUnit;
  if (!blobBudgetUnits.includes(nextUnit) || nextUnit === form.maxBlobUnit) return;
  const bytes = blobBudgetBytes(form.maxBlobValue, form.maxBlobUnit);
  form.maxBlobUnit = nextUnit;
  form.maxBlobValue = blobBudgetValue(bytes, nextUnit);
}

function save(): void {
  emit(
    "save",
    {
      pause: props.privacySettings.pause,
      rules: {
        ignoredBundleIds: parseLines(form.ignoredBundleIds),
        blockLikelySecrets: form.blockLikelySecrets,
        contentRules: parseContentRules(form.contentRules),
      },
      retention: {
        days: Math.round(form.retentionDays),
        maxBlobBytes: blobBudgetBytes(form.maxBlobValue, form.maxBlobUnit),
      },
      screenShareProtection: form.screenShareProtection,
    },
    {
      dockEdge: form.dockEdge,
      multiPasteMode: form.multiPasteMode,
    },
    {
      enabled: form.syncEnabled,
      baseUrl: form.baseUrl,
      username: form.username,
      ...(form.webdavPassword.length === 0
        ? {}
        : { webdavPassword: form.webdavPassword }),
      ...(form.syncPassword.length === 0
        ? {}
        : { syncPassword: form.syncPassword }),
      syncFileContents: form.syncFileContents,
    },
  );
}
</script>

<template>
  <div class="settings-backdrop" :class="{ 'settings-backdrop--standalone': standalone }" @click.self="emit('close')">
    <section class="settings-panel glass-surface" aria-labelledby="settings-title">
      <form class="settings-shell" @submit.prevent="save">
        <header class="settings-header">
          <div class="settings-heading">
            <div><p>Paste Control Center</p><h2 id="settings-title">Paste剪切板设置</h2></div>
            <button type="button" aria-label="关闭设置" @click="emit('close')">×</button>
          </div>
          <nav class="settings-tabs" aria-label="设置分类">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              :class="{ 'settings-tab--active': activeTab === tab.id }"
              :aria-selected="activeTab === tab.id"
              role="tab"
              @click="activeTab = tab.id"
            >
              <span v-if="tab.id === 'sync'" class="settings-tab__status" :class="`settings-tab__status--${syncPresentation.tone}`" aria-hidden="true"></span>
              {{ tab.label }}
            </button>
          </nav>
        </header>

        <div class="settings-scroll">
          <section v-show="activeTab === 'general'" class="settings-page" aria-label="通用设置">
            <div class="settings-page__intro"><strong>窗口与粘贴</strong><span>决定列表出现在哪里，以及多选后如何执行。</span></div>
            <fieldset class="option-field">
              <legend>显示位置</legend>
              <div class="option-grid option-grid--four">
                <label v-for="option in dockOptions" :key="option[0]">
                  <input v-model="form.dockEdge" type="radio" name="dock-edge" :value="option[0]" />
                  <span>{{ option[1] }}</span>
                </label>
              </div>
              <small>每次唤起都会贴在当前鼠标所在屏幕的对应边缘。</small>
            </fieldset>
            <fieldset class="option-field">
              <legend>多选粘贴</legend>
              <div class="option-grid option-grid--two">
                <label v-for="option in multiPasteOptions" :key="option[0]">
                  <input v-model="form.multiPasteMode" type="radio" name="multi-paste-mode" :value="option[0]" />
                  <span>{{ option[1] }}</span>
                </label>
              </div>
              <small>一次性模式按 Enter 合并粘贴；逐一模式按 Enter 生成队列，再连续按 Command-V。</small>
            </fieldset>
          </section>

          <section v-show="activeTab === 'privacy'" class="settings-page" aria-label="隐私设置">
            <div class="settings-page__intro"><strong>本地隐私与保留</strong><span>规则在内容写入历史记录之前执行。</span></div>
            <label class="settings-toggle"><span><strong>自动排除高置信度秘密</strong><small>令牌、私钥和已知凭据格式不会写入历史。</small></span><input v-model="form.blockLikelySecrets" type="checkbox" /></label>
            <label class="settings-toggle"><span><strong>屏幕共享时隐藏浮窗</strong><small>使用 Electron content protection，保存后立即应用。</small></span><input v-model="form.screenShareProtection" type="checkbox" /></label>
            <div class="settings-grid">
              <label><span>普通历史保留天数</span><input v-model.number="form.retentionDays" type="number" min="1" max="3650" /></label>
              <label><span>附件预算</span><div class="budget-control"><input v-model.number="form.maxBlobValue" aria-label="附件预算数值" type="number" :min="blobBudgetConstraints.min" :max="blobBudgetConstraints.max" :step="blobBudgetConstraints.step" required /><select aria-label="附件预算单位" :value="form.maxBlobUnit" @change="updateBlobBudgetUnit"><option v-for="unit in blobBudgetUnits" :key="unit" :value="unit">{{ unit }}</option></select></div></label>
            </div>
            <label class="settings-field"><span>排除应用 Bundle ID（每行一个）</span><textarea v-model="form.ignoredBundleIds" rows="4" spellcheck="false" /></label>
            <label class="settings-field"><span>内容规则（literal: / wildcard: / regex:）</span><textarea v-model="form.contentRules" rows="4" spellcheck="false" placeholder="literal:PRIVATE NOTE&#10;wildcard:otp-*&#10;regex:^internal-[0-9]+$/i" /></label>
            <p class="settings-note">分组与固定内容不会被普通保留策略静默删除。</p>
          </section>

          <section v-show="activeTab === 'sync'" class="settings-page" aria-label="同步设置">
            <div class="settings-page__intro"><strong>加密 WebDAV</strong><span>在设备之间同步正文、分组和附件。</span></div>
            <div class="sync-pulse" :class="`sync-pulse--${syncPresentation.tone}`"><span class="sync-pulse__orb" aria-hidden="true"></span><div><strong>{{ syncPresentation.label }}</strong><span>{{ syncPresentation.detail }}</span></div><button v-if="syncPresentation.action === 'retry'" type="button" @click="emit('retry')">重试</button></div>
            <label class="settings-toggle"><span><strong>启用加密同步</strong><small>正文、OCR、分组、图片和 PDF 默认同步。</small></span><input v-model="form.syncEnabled" type="checkbox" /></label>
            <div class="sync-grid" :aria-disabled="!form.syncEnabled">
              <label class="settings-field settings-field--wide"><span>WebDAV 地址</span><input v-model="form.baseUrl" :disabled="!form.syncEnabled" type="url" placeholder="https://dav.example.com/PasteboardPro/v1/" autocomplete="url" /></label>
              <label class="settings-field"><span>用户名</span><input v-model="form.username" :disabled="!form.syncEnabled" autocomplete="username" /></label>
              <label class="settings-field"><span>WebDAV 密码</span><input v-model="form.webdavPassword" :disabled="!form.syncEnabled" type="password" placeholder="未修改" autocomplete="current-password" /></label>
              <label class="settings-field settings-field--wide"><span>剪贴板同步密码</span><input v-model="form.syncPassword" :disabled="!form.syncEnabled" type="password" placeholder="用于端到端加密；丢失后无法恢复" autocomplete="new-password" /></label>
            </div>
            <label class="settings-toggle"><span><strong>同步任意文件内容</strong><small>默认只同步文件元数据；单项最大 100 MB。</small></span><input v-model="form.syncFileContents" :disabled="!form.syncEnabled" type="checkbox" /></label>
            <p class="settings-note">密码和派生密钥只保存在 macOS 钥匙串；插件数据库不保存明文秘密。</p>
          </section>
        </div>

        <footer class="settings-footer">
          <span>更改仅在点击“保存设置”后生效</span>
          <div><button type="button" class="quiet" @click="emit('close')">取消</button><button type="submit" class="primary" :disabled="saving">{{ saving ? "正在保存…" : "保存设置" }}</button></div>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.settings-backdrop { position:absolute; inset:0; z-index:21; display:grid; padding:12px; place-items:center; background:color-mix(in srgb,#171521 28%,transparent); backdrop-filter:blur(10px); }
.settings-panel { width:min(680px,100%); height:min(720px,calc(100% - 8px)); overflow:hidden; border:1px solid var(--pb-line); border-radius:20px; background:color-mix(in srgb,var(--pb-glass-strong) 94%,transparent); box-shadow:0 28px 80px rgb(25 20 43 / 32%); }
.settings-backdrop--standalone { padding:0; background:var(--pb-window-bg); backdrop-filter:none; }.settings-backdrop--standalone .settings-panel { width:100%; height:100%; border:0; border-radius:0; background:var(--pb-window-bg); box-shadow:none; }
.settings-shell { display:grid; grid-template-rows:auto minmax(0,1fr) auto; width:100%; height:100%; }
.settings-header { position:relative; z-index:2; padding:19px 22px 0; border-bottom:1px solid var(--pb-line); background:color-mix(in srgb,var(--pb-window-bg) 94%,transparent); box-shadow:0 9px 24px rgb(37 29 62 / 5%); }.settings-heading { display:flex; align-items:flex-start; justify-content:space-between; }.settings-heading p { margin:0 0 4px; color:var(--pb-violet); font-size:10px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }.settings-heading h2 { margin:0; font-size:20px; letter-spacing:-.025em; }.settings-heading button { width:30px; height:30px; border:0; border-radius:50%; background:color-mix(in srgb,var(--pb-line) 60%,transparent); color:var(--pb-muted); cursor:pointer; font-size:20px; }
.settings-tabs { display:flex; gap:6px; margin-top:16px; }.settings-tabs button { position:relative; display:flex; gap:7px; align-items:center; min-width:84px; min-height:38px; justify-content:center; padding:0 16px; border:0; border-radius:11px 11px 0 0; background:transparent; color:var(--pb-muted); cursor:pointer; font-size:12px; font-weight:750; }.settings-tabs button::after { position:absolute; right:12px; bottom:-1px; left:12px; height:2px; border-radius:999px; background:transparent; content:""; }.settings-tabs button:hover,.settings-tabs button:focus-visible { color:var(--pb-ink); outline:none; background:color-mix(in srgb,var(--pb-violet) 5%,transparent); }.settings-tabs .settings-tab--active { background:color-mix(in srgb,var(--pb-violet) 8%,transparent); color:var(--pb-violet); }.settings-tabs .settings-tab--active::after { background:var(--pb-violet); }.settings-tab__status { width:7px; height:7px; border-radius:50%; background:var(--pb-muted); }.settings-tab__status--success { background:#36b37e; }.settings-tab__status--warning { background:#e99a35; }.settings-tab__status--error { background:#e45568; }.settings-tab__status--progress { background:var(--pb-violet); }
.settings-scroll { min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }.settings-page { display:grid; gap:0; padding:20px 22px 28px; }.settings-page__intro { display:grid; gap:4px; padding-bottom:16px; }.settings-page__intro strong { font-size:14px; }.settings-page__intro span,.option-field small,.settings-note { color:var(--pb-muted); font-size:10px; line-height:1.5; }
.option-field { display:grid; gap:9px; margin:0; padding:15px 0; border:0; border-top:1px solid var(--pb-line); }.option-field legend { padding:0; font-size:12px; font-weight:750; }.option-grid { display:grid; gap:7px; }.option-grid--four { grid-template-columns:repeat(4,1fr); }.option-grid--two { grid-template-columns:repeat(2,1fr); }.option-grid label { position:relative; }.option-grid input { position:absolute; opacity:0; pointer-events:none; }.option-grid span { display:grid; min-height:36px; border:1px solid var(--pb-line); border-radius:10px; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); color:var(--pb-muted); cursor:pointer; font-size:11px; font-weight:700; place-items:center; }.option-grid input:checked + span { border-color:var(--pb-violet); background:color-mix(in srgb,var(--pb-violet) 12%,var(--pb-window-bg)); color:var(--pb-violet); }.option-grid input:focus-visible + span { outline:2px solid color-mix(in srgb,var(--pb-violet) 45%,transparent); outline-offset:1px; }
.settings-toggle { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 0; border-top:1px solid var(--pb-line); }.settings-toggle span { display:grid; gap:3px; }.settings-toggle strong { font-size:12px; }.settings-toggle small { color:var(--pb-muted); font-size:10px; line-height:1.4; }.settings-toggle input { width:32px; accent-color:var(--pb-violet); }
.settings-grid,.sync-grid { display:grid; grid-template-columns:1fr 1fr; gap:11px; padding:14px 0; border-top:1px solid var(--pb-line); }.settings-grid label,.settings-field { display:grid; gap:6px; }.settings-grid span,.settings-field span { color:var(--pb-muted); font-size:10px; font-weight:700; }.settings-grid input,.settings-field input,.settings-field textarea,textarea { width:100%; padding:9px 11px; border:1px solid var(--pb-line); border-radius:10px; outline:none; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); color:var(--pb-ink); }.settings-field { margin-top:12px; }.settings-field--wide { grid-column:1 / -1; margin-top:0; }.settings-field input:focus,.settings-field textarea:focus,textarea:focus { border-color:var(--pb-violet); box-shadow:0 0 0 3px color-mix(in srgb,var(--pb-violet) 14%,transparent); }.settings-field input:disabled { opacity:.45; } textarea { resize:vertical; font:11px/1.45 "SFMono-Regular",Consolas,monospace; }
.budget-control { display:grid; grid-template-columns:minmax(0,1fr) 84px; overflow:hidden; border:1px solid var(--pb-line); border-radius:10px; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); }.budget-control input { min-width:0; border:0; border-radius:0; background:transparent; }.budget-control select { min-width:0; padding:0 10px; border:0; border-left:1px solid var(--pb-line); outline:0; background:color-mix(in srgb,var(--pb-violet) 7%,transparent); color:var(--pb-ink); cursor:pointer; font:700 11px/1 system-ui,sans-serif; }
.sync-pulse { display:grid; grid-template-columns:auto 1fr auto; gap:11px; align-items:center; margin-bottom:16px; padding:12px 14px; border:1px solid var(--pb-line); border-radius:14px; background:color-mix(in srgb,var(--pb-glass-strong) 56%,transparent); }.sync-pulse__orb { width:10px; height:10px; border-radius:50%; background:var(--pb-muted); box-shadow:0 0 0 5px color-mix(in srgb,currentColor 12%,transparent); }.sync-pulse--success .sync-pulse__orb { background:#36b37e; }.sync-pulse--warning .sync-pulse__orb { background:#e99a35; }.sync-pulse--error .sync-pulse__orb { background:#e45568; }.sync-pulse--progress .sync-pulse__orb { background:var(--pb-violet); animation:sync-breathe 1.3s ease-in-out infinite; }.sync-pulse div { display:grid; gap:2px; }.sync-pulse strong { font-size:12px; }.sync-pulse span { color:var(--pb-muted); font-size:11px; }.sync-pulse button { border:0; background:transparent; color:var(--pb-violet); cursor:pointer; font-weight:700; }.settings-note { margin:14px 0 0; }
.settings-footer { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:64px; padding:12px 22px; border-top:1px solid var(--pb-line); background:color-mix(in srgb,var(--pb-window-bg) 96%,transparent); box-shadow:0 -9px 24px rgb(37 29 62 / 5%); }.settings-footer > span { color:var(--pb-muted); font-size:10px; }.settings-footer div { display:flex; gap:8px; }.settings-footer button { min-height:36px; padding:0 14px; border:1px solid var(--pb-line); border-radius:11px; cursor:pointer; font-weight:700; }.settings-footer .quiet { background:transparent; color:var(--pb-muted); }.settings-footer .primary { border-color:transparent; background:var(--pb-violet); color:white; }.settings-footer button:disabled { cursor:wait; opacity:.55; }
@keyframes sync-breathe { 50% { transform:scale(1.25); box-shadow:0 0 0 8px color-mix(in srgb,var(--pb-violet) 4%,transparent); } }
@media (max-width:620px) { .settings-panel { height:100%; border-radius:0; }.settings-footer > span { display:none; }.settings-grid,.sync-grid { grid-template-columns:1fr; }.settings-field--wide { grid-column:auto; }.settings-tabs button { min-width:0; flex:1; padding:0 8px; } }
@media (prefers-reduced-motion:reduce) { .sync-pulse__orb { animation:none; } }
</style>
