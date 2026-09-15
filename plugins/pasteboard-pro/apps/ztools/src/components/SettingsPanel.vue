<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import type { SaveSyncConfigurationInput } from "../../preload/sync-config";
import type { SyncSettings } from "../../preload/sync-store";
import type {
  MultiPasteMode,
  ShelfDockEdge,
  ThemeBackground,
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
import { themeCssVariables } from "../theme";
import {
  primaryModifierName,
  resolveShortcutPlatform,
} from "../platform-shortcuts";
import { openPasteShortcutSettings, type ZToolsShortcutSettingsApi } from "../hotkey-settings";

type SettingsTab = "general" | "appearance" | "privacy" | "sync";
type ThemeBackgroundType = ThemeBackground["type"];

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
  historyCleared: [];
  retry: [];
  save: [
    privacySettings: PrivacySettings,
    windowPreferences: WindowPreferences,
    syncInput: SaveSyncConfigurationInput,
  ];
}>();

const tabs: readonly Readonly<{ id: SettingsTab; label: string }>[] = [
  { id: "general", label: "通用" },
  { id: "appearance", label: "外观" },
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
const selectingBackgroundImage = ref(false);
const backgroundImageError = ref("");
const clearingHistory = ref(false);
const historyClearMessage = ref("");
const historyClearFailed = ref(false);
const hotkeySettingsMessage = ref("");
const initialBlobBudgetUnit = preferredBlobBudgetUnit(
  props.privacySettings.retention.maxBlobBytes,
);
const form = reactive({
  dockEdge: props.windowPreferences.dockEdge as ShelfDockEdge,
  multiPasteMode: props.windowPreferences.multiPasteMode as MultiPasteMode,
  accentColor: props.windowPreferences.theme.accentColor,
  backgroundType: props.windowPreferences.theme.background.type as ThemeBackgroundType,
  backgroundColor:
    props.windowPreferences.theme.background.type === "color"
      ? props.windowPreferences.theme.background.color
      : "#f1eefc",
  backgroundImageDataUrl:
    props.windowPreferences.theme.background.type === "image"
      ? props.windowPreferences.theme.background.imageDataUrl
      : "",
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
});

const blobBudgetConstraints = computed(() =>
  blobBudgetInputConstraints(form.maxBlobUnit),
);
const syncPresentation = computed(() =>
  syncStatusPresentation(props.syncSettings.status),
);
const shortcutPlatform = computed(() =>
  resolveShortcutPlatform(window.pasteboardPro?.getPlatformCapabilities().platform),
);
const multiPasteHint = computed(() => {
  if (shortcutPlatform.value === "darwin") {
    return "一次性模式按 Enter 合并粘贴；逐一模式可连续按 Command-V。";
  }
  if (shortcutPlatform.value === "win32") {
    return "一次性模式按 Enter 合并粘贴；逐一模式需在插件内按 Enter。Win+V 是 Windows 系统剪贴板历史快捷键，不能用于 Paste。";
  }
  return "一次性模式按 Enter 合并粘贴；逐一模式需在插件内按 Enter。";
});
const hotkeySettingsHint = computed(() => {
  if (shortcutPlatform.value === "win32") {
    return "请设置未被系统占用的组合；Win+V 保留给 Windows 剪贴板历史。";
  }
  return `在 ZTools 中设置 Paste剪切板的全局唤起快捷键；列表内快捷键使用 ${primaryModifierName(shortcutPlatform.value)}。`;
});
const themePreviewStyle = computed<Record<string, string>>(() => {
  const variables = themeCssVariables(
    {
      accentColor: form.accentColor,
      background: selectedThemeBackground(),
    },
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  return {
    "--preview-accent": variables["--pb-violet"]!,
    "--preview-on-accent": variables["--pb-on-accent"]!,
    backgroundColor: variables["--pb-theme-background-color"]!,
    backgroundImage: variables["--pb-theme-background-image"]!,
  };
});

watch(() => props.initialTab, (tab) => { activeTab.value = tab; });
watch(
  () => props.windowPreferences,
  (settings) => {
    form.dockEdge = settings.dockEdge;
    form.multiPasteMode = settings.multiPasteMode;
    form.accentColor = settings.theme.accentColor;
    form.backgroundType = settings.theme.background.type;
    if (settings.theme.background.type === "color") {
      form.backgroundColor = settings.theme.background.color;
    }
    form.backgroundImageDataUrl =
      settings.theme.background.type === "image"
        ? settings.theme.background.imageDataUrl
        : "";
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

async function selectBackgroundImage(): Promise<void> {
  selectingBackgroundImage.value = true;
  backgroundImageError.value = "";
  try {
    const imageDataUrl = await window.pasteboardPro?.selectThemeBackgroundImage();
    if (imageDataUrl === undefined) return;
    form.backgroundImageDataUrl = imageDataUrl;
    form.backgroundType = "image";
  } catch (error) {
    backgroundImageError.value =
      error instanceof Error ? error.message : "背景图片读取失败";
  } finally {
    selectingBackgroundImage.value = false;
  }
}

async function clearHistory(): Promise<void> {
  if (
    !window.confirm(
      "确定清空全部剪贴板历史？固定内容、分组内内容和本地附件也会删除，此操作无法撤销。",
    )
  ) {
    return;
  }
  clearingHistory.value = true;
  historyClearMessage.value = "";
  historyClearFailed.value = false;
  try {
    const result = await window.pasteboardPro?.clearClipboardHistory();
    const deleted = result?.deleted ?? 0;
    const failed = result?.failed ?? 0;
    const blobFailures = result?.blobFailures ?? 0;
    historyClearFailed.value = failed > 0 || blobFailures > 0;
    historyClearMessage.value = historyClearFailed.value
      ? `已清空 ${deleted} 条；${failed} 条记录和 ${blobFailures} 个附件未能删除。`
      : `已清空 ${deleted} 条剪贴板历史。`;
    emit("historyCleared");
  } catch (error) {
    historyClearFailed.value = true;
    historyClearMessage.value =
      error instanceof Error ? error.message : "清空剪贴板失败";
  } finally {
    clearingHistory.value = false;
  }
}

function openHotkeySettings(): void {
  const ztools = (window as Window & { ztools?: ZToolsShortcutSettingsApi }).ztools;
  hotkeySettingsMessage.value = openPasteShortcutSettings(ztools)
    ? "已打开 ZTools 快捷键设置。"
    : "当前环境不支持打开 ZTools 快捷键设置；请在 ZTools 中右键 Paste剪切板后选择设置快捷键。";
}

function selectedThemeBackground(): ThemeBackground {
  if (form.backgroundType === "color") {
    return { type: "color", color: form.backgroundColor };
  }
  if (form.backgroundType === "image" && form.backgroundImageDataUrl.length > 0) {
    return { type: "image", imageDataUrl: form.backgroundImageDataUrl };
  }
  return { type: "default" };
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
      theme: {
        accentColor: form.accentColor,
        background: selectedThemeBackground(),
      },
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
              <small>{{ multiPasteHint }}</small>
            </fieldset>
            <div class="shortcut-settings">
              <span><strong>全局唤起快捷键</strong><small>{{ hotkeySettingsHint }}</small></span>
              <button type="button" @click="openHotkeySettings">设置 ZTools 快捷键</button>
            </div>
            <p v-if="hotkeySettingsMessage" class="settings-result" role="status">{{ hotkeySettingsMessage }}</p>
          </section>

          <section v-show="activeTab === 'appearance'" class="settings-page" aria-label="外观设置">
            <div class="settings-page__intro"><strong>主题与背景</strong><span>自定义主题色，并用纯色或本地图片装饰插件窗口。</span></div>
            <div class="theme-preview" :style="themePreviewStyle" aria-label="主题预览">
              <span class="theme-preview__brand">Paste</span>
              <div><i></i><i></i><i></i></div>
              <span class="theme-preview__button">主题预览</span>
            </div>
            <label class="color-field">
              <span><strong>主题色</strong><small>按钮、选中态和强调信息将使用此颜色。</small></span>
              <span class="color-field__control"><input v-model="form.accentColor" type="color" aria-label="选择主题色" /><code>{{ form.accentColor }}</code></span>
            </label>
            <fieldset class="option-field">
              <legend>主题背景</legend>
              <div class="option-grid option-grid--three">
                <label><input v-model="form.backgroundType" type="radio" name="background-type" value="default" /><span>跟随系统</span></label>
                <label><input v-model="form.backgroundType" type="radio" name="background-type" value="color" /><span>纯色</span></label>
                <label><input v-model="form.backgroundType" type="radio" name="background-type" value="image" :disabled="form.backgroundImageDataUrl.length === 0" /><span>图片</span></label>
              </div>
              <small>背景图片只保存在插件本地数据中；开启 WebDAV 后才会端到端加密同步。</small>
            </fieldset>
            <label v-if="form.backgroundType === 'color'" class="color-field color-field--compact">
              <span><strong>背景颜色</strong><small>用于插件窗口底层背景。</small></span>
              <span class="color-field__control"><input v-model="form.backgroundColor" type="color" aria-label="选择背景颜色" /><code>{{ form.backgroundColor }}</code></span>
            </label>
            <div class="background-image-control">
              <span><strong>背景图片</strong><small>支持 PNG、JPEG、WebP，最大 8 MB；选择时不会上传。</small></span>
              <div>
                <button type="button" class="quiet-action" :disabled="selectingBackgroundImage" @click="selectBackgroundImage">{{ selectingBackgroundImage ? "正在读取…" : form.backgroundImageDataUrl ? "更换图片" : "选择图片" }}</button>
                <button v-if="form.backgroundImageDataUrl" type="button" class="quiet-action quiet-action--danger" @click="form.backgroundImageDataUrl = ''; form.backgroundType = 'default'">移除</button>
              </div>
            </div>
            <p v-if="backgroundImageError" class="settings-error" role="alert">{{ backgroundImageError }}</p>
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
            <div class="danger-zone">
              <span><strong>清空剪贴板</strong><small>删除全部历史、固定内容、分组关联和插件自管附件，同时清空当前系统剪贴板。</small></span>
              <button type="button" :disabled="clearingHistory" @click="clearHistory">{{ clearingHistory ? "正在清空…" : "清空剪贴板" }}</button>
            </div>
            <p v-if="historyClearMessage" class="settings-result" :class="{ 'settings-result--error': historyClearFailed }" :role="historyClearFailed ? 'alert' : 'status'">{{ historyClearMessage }}</p>
          </section>

          <section v-show="activeTab === 'sync'" class="settings-page" aria-label="同步设置">
            <div class="settings-page__intro"><strong>加密 WebDAV</strong><span>在设备之间同步正文、分组、附件和外观配置。</span></div>
            <div class="sync-pulse" :class="`sync-pulse--${syncPresentation.tone}`"><span class="sync-pulse__orb" aria-hidden="true"></span><div><strong>{{ syncPresentation.label }}</strong><span>{{ syncPresentation.detail }}</span></div><button v-if="syncPresentation.action === 'retry'" type="button" @click="emit('retry')">重试</button></div>
            <label class="settings-toggle"><span><strong>启用加密同步</strong><small>正文、OCR、分组、图片、PDF 和外观配置默认同步。</small></span><input v-model="form.syncEnabled" type="checkbox" /></label>
            <div class="sync-grid" :aria-disabled="!form.syncEnabled">
              <label class="settings-field settings-field--wide"><span>WebDAV 地址</span><input v-model="form.baseUrl" :disabled="!form.syncEnabled" type="url" placeholder="https://dav.example.com/PasteboardPro/v1/" autocomplete="url" /></label>
              <label class="settings-field"><span>用户名</span><input v-model="form.username" :disabled="!form.syncEnabled" autocomplete="username" /></label>
              <label class="settings-field"><span>WebDAV 密码</span><input v-model="form.webdavPassword" :disabled="!form.syncEnabled" type="password" placeholder="未修改" autocomplete="current-password" /></label>
              <label class="settings-field settings-field--wide"><span>剪贴板同步密码</span><input v-model="form.syncPassword" :disabled="!form.syncEnabled" type="password" placeholder="用于端到端加密；丢失后无法恢复" autocomplete="new-password" /></label>
            </div>
            <p class="settings-note">密码和派生密钥只保存在系统安全存储；插件数据库不保存明文秘密。</p>
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
.option-field { display:grid; gap:9px; margin:0; padding:15px 0; border:0; border-top:1px solid var(--pb-line); }.option-field legend { padding:0; font-size:12px; font-weight:750; }.option-grid { display:grid; gap:7px; }.option-grid--four { grid-template-columns:repeat(4,1fr); }.option-grid--three { grid-template-columns:repeat(3,1fr); }.option-grid--two { grid-template-columns:repeat(2,1fr); }.option-grid label { position:relative; }.option-grid input { position:absolute; opacity:0; pointer-events:none; }.option-grid span { display:grid; min-height:36px; border:1px solid var(--pb-line); border-radius:10px; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); color:var(--pb-muted); cursor:pointer; font-size:11px; font-weight:700; place-items:center; }.option-grid input:checked + span { border-color:var(--pb-violet); background:color-mix(in srgb,var(--pb-violet) 12%,var(--pb-window-bg)); color:var(--pb-violet); }.option-grid input:disabled + span { cursor:not-allowed; opacity:.45; }.option-grid input:focus-visible + span { outline:2px solid color-mix(in srgb,var(--pb-violet) 45%,transparent); outline-offset:1px; }
.theme-preview { display:grid; grid-template-columns:auto 1fr auto; gap:14px; align-items:center; min-height:112px; margin-bottom:16px; padding:20px; overflow:hidden; border:1px solid var(--pb-line); border-radius:16px; background-position:center; background-repeat:no-repeat; background-size:cover; box-shadow:inset 0 0 0 999px color-mix(in srgb,var(--pb-glass) 32%,transparent); }.theme-preview__brand { color:var(--preview-accent); font-size:20px; font-weight:850; letter-spacing:-.04em; }.theme-preview div { display:flex; gap:5px; }.theme-preview i { width:26px; height:32px; border:1px solid color-mix(in srgb,var(--preview-accent) 22%,var(--pb-line)); border-radius:8px; background:color-mix(in srgb,var(--pb-glass-strong) 72%,transparent); }.theme-preview__button { display:grid; min-height:34px; padding:0 12px; border-radius:9px; background:var(--preview-accent); color:var(--preview-on-accent); font-size:10px; font-weight:750; place-items:center; }.color-field,.background-image-control { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 0; border-top:1px solid var(--pb-line); }.color-field > span:first-child,.background-image-control > span:first-child { display:grid; gap:3px; }.color-field strong,.background-image-control strong { font-size:12px; }.color-field small,.background-image-control small { color:var(--pb-muted); font-size:10px; line-height:1.4; }.color-field__control { display:flex; align-items:center; gap:8px; }.color-field__control input { width:36px; height:32px; padding:2px; border:1px solid var(--pb-line); border-radius:9px; background:transparent; cursor:pointer; }.color-field__control code { min-width:66px; color:var(--pb-muted); font-size:10px; text-transform:uppercase; }.color-field--compact { border-bottom:1px solid var(--pb-line); }.background-image-control > div { display:flex; gap:7px; }.quiet-action { min-height:34px; padding:0 11px; border:1px solid var(--pb-line); border-radius:9px; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); color:var(--pb-ink); cursor:pointer; font-size:10px; font-weight:700; }.quiet-action:hover { border-color:var(--pb-violet); color:var(--pb-violet); }.quiet-action:disabled { cursor:wait; opacity:.55; }.quiet-action--danger { color:#c34455; }.settings-error { margin:8px 0 0; color:#c34455; font-size:10px; }
.settings-toggle { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 0; border-top:1px solid var(--pb-line); }.settings-toggle span { display:grid; gap:3px; }.settings-toggle strong { font-size:12px; }.settings-toggle small { color:var(--pb-muted); font-size:10px; line-height:1.4; }.settings-toggle input { width:32px; accent-color:var(--pb-violet); }
.shortcut-settings { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 0; border-top:1px solid var(--pb-line); }.shortcut-settings > span { display:grid; gap:3px; }.shortcut-settings strong { font-size:12px; }.shortcut-settings small { color:var(--pb-muted); font-size:10px; line-height:1.4; }.shortcut-settings button { flex:none; min-height:34px; padding:0 11px; border:1px solid var(--pb-line); border-radius:9px; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); color:var(--pb-ink); cursor:pointer; font-size:10px; font-weight:700; }.shortcut-settings button:hover,.shortcut-settings button:focus-visible { border-color:var(--pb-violet); color:var(--pb-violet); outline:2px solid color-mix(in srgb,var(--pb-violet) 30%,transparent); outline-offset:1px; }
.danger-zone { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:18px; padding:14px; border:1px solid color-mix(in srgb,#c34455 28%,var(--pb-line)); border-radius:13px; background:color-mix(in srgb,#c34455 5%,transparent); }.danger-zone > span { display:grid; gap:3px; }.danger-zone strong { color:#b63f50; font-size:12px; }.danger-zone small { color:var(--pb-muted); font-size:10px; line-height:1.45; }.danger-zone button { flex:none; min-height:34px; padding:0 12px; border:1px solid color-mix(in srgb,#c34455 38%,var(--pb-line)); border-radius:9px; background:transparent; color:#b63f50; cursor:pointer; font-size:10px; font-weight:750; }.danger-zone button:hover { background:color-mix(in srgb,#c34455 9%,transparent); }.danger-zone button:disabled { cursor:wait; opacity:.55; }.settings-result { margin:8px 0 0; color:#23825d; font-size:10px; }.settings-result--error { color:#c34455; }
.settings-grid,.sync-grid { display:grid; grid-template-columns:1fr 1fr; gap:11px; padding:14px 0; border-top:1px solid var(--pb-line); }.settings-grid label,.settings-field { display:grid; gap:6px; }.settings-grid span,.settings-field span { color:var(--pb-muted); font-size:10px; font-weight:700; }.settings-grid input,.settings-field input,.settings-field textarea,textarea { width:100%; padding:9px 11px; border:1px solid var(--pb-line); border-radius:10px; outline:none; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); color:var(--pb-ink); }.settings-field { margin-top:12px; }.settings-field--wide { grid-column:1 / -1; margin-top:0; }.settings-field input:focus,.settings-field textarea:focus,textarea:focus { border-color:var(--pb-violet); box-shadow:0 0 0 3px color-mix(in srgb,var(--pb-violet) 14%,transparent); }.settings-field input:disabled { opacity:.45; } textarea { resize:vertical; font:11px/1.45 "SFMono-Regular",Consolas,monospace; }
.budget-control { display:grid; grid-template-columns:minmax(0,1fr) 84px; overflow:hidden; border:1px solid var(--pb-line); border-radius:10px; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); }.budget-control input { min-width:0; border:0; border-radius:0; background:transparent; }.budget-control select { min-width:0; padding:0 10px; border:0; border-left:1px solid var(--pb-line); outline:0; background:color-mix(in srgb,var(--pb-violet) 7%,transparent); color:var(--pb-ink); cursor:pointer; font:700 11px/1 system-ui,sans-serif; }
.sync-pulse { display:grid; grid-template-columns:auto 1fr auto; gap:11px; align-items:center; margin-bottom:16px; padding:12px 14px; border:1px solid var(--pb-line); border-radius:14px; background:color-mix(in srgb,var(--pb-glass-strong) 56%,transparent); }.sync-pulse__orb { width:10px; height:10px; border-radius:50%; background:var(--pb-muted); box-shadow:0 0 0 5px color-mix(in srgb,currentColor 12%,transparent); }.sync-pulse--success .sync-pulse__orb { background:#36b37e; }.sync-pulse--warning .sync-pulse__orb { background:#e99a35; }.sync-pulse--error .sync-pulse__orb { background:#e45568; }.sync-pulse--progress .sync-pulse__orb { background:var(--pb-violet); animation:sync-breathe 1.3s ease-in-out infinite; }.sync-pulse div { display:grid; gap:2px; }.sync-pulse strong { font-size:12px; }.sync-pulse span { color:var(--pb-muted); font-size:11px; }.sync-pulse button { border:0; background:transparent; color:var(--pb-violet); cursor:pointer; font-weight:700; }.settings-note { margin:14px 0 0; }
.settings-footer { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:64px; padding:12px 22px; border-top:1px solid var(--pb-line); background:color-mix(in srgb,var(--pb-window-bg) 96%,transparent); box-shadow:0 -9px 24px rgb(37 29 62 / 5%); }.settings-footer > span { color:var(--pb-muted); font-size:10px; }.settings-footer div { display:flex; gap:8px; }.settings-footer button { min-height:36px; padding:0 14px; border:1px solid var(--pb-line); border-radius:11px; cursor:pointer; font-weight:700; }.settings-footer .quiet { background:transparent; color:var(--pb-muted); }.settings-footer .primary { border-color:transparent; background:var(--pb-violet); color:var(--pb-on-accent,white); }.settings-footer button:disabled { cursor:wait; opacity:.55; }
@keyframes sync-breathe { 50% { transform:scale(1.25); box-shadow:0 0 0 8px color-mix(in srgb,var(--pb-violet) 4%,transparent); } }
@media (max-width:620px) { .settings-panel { height:100%; border-radius:0; }.settings-footer > span { display:none; }.settings-grid,.sync-grid { grid-template-columns:1fr; }.settings-field--wide { grid-column:auto; }.settings-tabs button { min-width:0; flex:1; padding:0 8px; } }
@media (prefers-reduced-motion:reduce) { .sync-pulse__orb { animation:none; } }
</style>
