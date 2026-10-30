<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import type { SaveSyncConfigurationInput } from "../../preload/sync-config";
import type { SyncSettings } from "../../preload/sync-store";
import type {
  MultiPasteMode,
  ShelfDockEdge,
  ShelfUiVersion,
  ThemeBackground,
  ThemePreferences,
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
  parseContentRules,
  serializeContentRules,
} from "../privacy-view";
import { syncStatusPresentation } from "../sync-view";
import { themeCssVariables } from "../theme";
import {
  primaryModifierName,
  resolveShortcutPlatform,
} from "../platform-shortcuts";
import { openPasteShortcutSettings, type ZToolsShortcutSettingsApi } from "../hotkey-settings";
import SettingsNavigation from "./SettingsNavigation.vue";
import UiVersionPreference from "./UiVersionPreference.vue";
import BlockedApplicationsSelect from "./BlockedApplicationsSelect.vue";
import ThemeImageBackdrop from "./ThemeImageBackdrop.vue";
import ImageBackgroundOptions from "./ImageBackgroundOptions.vue";
import type { ThemeImageLayout } from "../../preload/window-theme-preferences";
import ThemeSurfaceControls from "./ThemeSurfaceControls.vue";
import ColorPickerField from "./ColorPickerField.vue";
import BackgroundImageControl from "./BackgroundImageControl.vue";
import { settingsTabs, type SettingsTab } from "./settings-tabs";
import { useSettingsDialogFocus } from "../use-settings-dialog-focus";
import { useImeSubmitGuard } from "../use-ime-submit-guard";

type ThemeBackgroundType = ThemeBackground["type"];

const props = defineProps<{
  initialTab: SettingsTab;
  privacySettings: PrivacySettings;
  syncSettings: SyncSettings;
  windowPreferences: WindowPreferences;
  saving: boolean;
  darkMode?: boolean;
  saveError?: string | undefined;
  standalone?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  historyCleared: [];
  retry: [];
  showWhatsNew: [];
  save: [
    privacySettings: PrivacySettings,
    windowPreferences: WindowPreferences,
    syncInput: SaveSyncConfigurationInput,
  ];
}>();

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
const imeSubmitGuard = useImeSubmitGuard();
const dialogElement = ref<HTMLElement | null>(null);
const trapDialogFocus = useSettingsDialogFocus(dialogElement, () => props.saving);
const imageEditorOpen = ref(false);
const clearingHistory = ref(false);
const historyClearMessage = ref("");
const historyClearFailed = ref(false);
const hotkeySettingsMessage = ref("");
const initialBlobBudgetUnit = preferredBlobBudgetUnit(
  props.privacySettings.retention.maxBlobBytes,
);
const form = reactive({
  dockEdge: props.windowPreferences.dockEdge as ShelfDockEdge,
  uiVersion: props.windowPreferences.uiVersion as ShelfUiVersion,
  multiPasteMode: props.windowPreferences.multiPasteMode as MultiPasteMode,
  accentColor: props.windowPreferences.theme.accentColor,
  cardBackground: props.windowPreferences.theme.cardBackground,
  backgroundBaseColor: props.windowPreferences.theme.backgroundBaseColor,
  backgroundType: props.windowPreferences.theme.background.type as ThemeBackgroundType,
  backgroundColor:
    props.windowPreferences.theme.background.type === "color"
      ? props.windowPreferences.theme.background.color
      : "#f1eefc",
  backgroundImageDataUrl:
    props.windowPreferences.theme.background.type === "image"
      ? props.windowPreferences.theme.background.imageDataUrl
      : "",
  backgroundImageLayout: (props.windowPreferences.theme.background.type === "image"
    ? props.windowPreferences.theme.background.layout ?? "cover" : "cover") as ThemeImageLayout,
  backgroundImageTilesPerRow: props.windowPreferences.theme.background.type === "image"
    ? props.windowPreferences.theme.background.tilesPerRow ?? 3 : 3,
  backgroundImageFrosted:
    props.windowPreferences.theme.background.type === "image" &&
    props.windowPreferences.theme.background.frosted === true,
  ignoredBundleIds: [...props.privacySettings.rules.ignoredBundleIds],
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
  intervalMinutes: props.syncSettings.intervalMinutes ?? 60,
  webdavPassword: "",
  syncPassword: "",
});

const syncIntervalOptions = [
  { value: 15, label: "每 15 分钟" },
  { value: 30, label: "每 30 分钟" },
  { value: 60, label: "每 1 小时（默认）" },
  { value: 120, label: "每 2 小时" },
  { value: 360, label: "每 6 小时" },
  { value: 720, label: "每 12 小时" },
  { value: 1440, label: "每 24 小时" },
] as const;

const blobBudgetConstraints = computed(() =>
  blobBudgetInputConstraints(form.maxBlobUnit),
);
const syncPresentation = computed(() =>
  syncStatusPresentation(props.syncSettings.status),
);
const shortcutPlatform = computed(() =>
  resolveShortcutPlatform(window.pasteboardPro?.getPlatformCapabilities().platform),
);
const multiPasteHint = computed(() => shortcutPlatform.value === "darwin"
  ? "一次性模式可将多条文本合并粘贴；图片、文件等混合内容可创建队列，每按一次 Command-V 粘贴一项。"
  : "一次性模式可将多条文本合并粘贴；图片、文件等混合内容暂不支持逐项队列，请分次选择粘贴。");
const hotkeySettingsHint = computed(() => {
  if (shortcutPlatform.value === "win32") {
    return "请设置未被系统占用的组合；Win+V 保留给 Windows 剪贴板历史。";
  }
  return `在 ZTools 中设置 Paste剪切板的全局唤起快捷键；列表内快捷键使用 ${primaryModifierName(shortcutPlatform.value)}。`;
});

const previewDarkMode = computed(() => props.darkMode ?? window.matchMedia("(prefers-color-scheme: dark)").matches);
const themePreviewStyle = computed<Record<string, string>>(() => {
  const variables = themeCssVariables(
    selectedTheme(),
    previewDarkMode.value,
  );
  return {
    ...variables,
    "--preview-accent": variables["--pb-violet"]!,
    "--preview-on-accent": variables["--pb-on-accent"]!,
    backgroundColor: variables["--pb-theme-background-color"]!,
    "--pb-theme-background-color": variables["--pb-theme-background-color"]!,
  };
});

watch(() => props.initialTab, (tab) => { activeTab.value = tab; });
watch(
  () => props.windowPreferences,
  (settings) => {
    form.dockEdge = settings.dockEdge;
    form.uiVersion = settings.uiVersion;
    form.multiPasteMode = settings.multiPasteMode;
    form.accentColor = settings.theme.accentColor;
    form.cardBackground = settings.theme.cardBackground;
    form.backgroundBaseColor = settings.theme.backgroundBaseColor;
    form.backgroundType = settings.theme.background.type;
    if (settings.theme.background.type === "color") {
      form.backgroundColor = settings.theme.background.color;
    }
    form.backgroundImageDataUrl =
      settings.theme.background.type === "image"
        ? settings.theme.background.imageDataUrl
        : "";
    form.backgroundImageLayout = settings.theme.background.type === "image"
      ? settings.theme.background.layout ?? "cover" : "cover";
    form.backgroundImageTilesPerRow = settings.theme.background.type === "image"
      ? settings.theme.background.tilesPerRow ?? 3 : 3;
    form.backgroundImageFrosted = settings.theme.background.type === "image" &&
      settings.theme.background.frosted === true;
  },
);
watch(
  () => props.privacySettings,
  (settings) => {
    form.ignoredBundleIds = [...settings.rules.ignoredBundleIds];
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
    form.intervalMinutes = settings.intervalMinutes ?? 60;
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
    return {
      type: "image",
      imageDataUrl: form.backgroundImageDataUrl,
      frosted: form.backgroundImageFrosted,
      layout: form.backgroundImageLayout,
      tilesPerRow: form.backgroundImageTilesPerRow,
    };
  }
  return { type: "default" };
}

function selectedTheme(): ThemePreferences {
  return {
    accentColor: form.accentColor,
    background: selectedThemeBackground(),
    ...(form.cardBackground === undefined ? {} : { cardBackground: { ...form.cardBackground } }),
    ...(form.backgroundBaseColor === undefined ? {} : { backgroundBaseColor: form.backgroundBaseColor }),
  };
}

function save(): void {
  if (imeSubmitGuard.shouldSuppressSubmit()) return;
  emit(
    "save",
    {
      pause: { ...props.privacySettings.pause },
      rules: {
        ignoredBundleIds: [...form.ignoredBundleIds],
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
      uiVersion: form.uiVersion,
      multiPasteMode: form.multiPasteMode,
      theme: selectedTheme(),
    },
    {
      enabled: form.syncEnabled,
      baseUrl: form.baseUrl,
      username: form.username,
      intervalMinutes: form.intervalMinutes,
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
  <div class="settings-backdrop" :class="{ 'settings-backdrop--standalone': standalone }" @click.self="!saving && emit('close')">
    <section ref="dialogElement" :inert="imageEditorOpen" :aria-hidden="imageEditorOpen || undefined" class="settings-panel glass-surface" :data-ui-version="props.windowPreferences.uiVersion" role="dialog" :aria-modal="!imageEditorOpen" :aria-busy="saving" aria-labelledby="settings-title" tabindex="-1" @keydown.esc.stop.prevent="!saving && !imageEditorOpen && emit('close')" @keydown.tab="trapDialogFocus">
      <form class="settings-shell" @keydown.capture="imeSubmitGuard.noteKeydown" @submit.prevent="save">
        <header class="settings-titlebar">
          <div class="settings-brand">
            <img src="/logo.png" alt="" />
            <strong>Paste</strong>
            <span class="settings-brand__divider" aria-hidden="true"></span>
            <span>设置</span>
          </div>
          <h2 id="settings-title">Paste剪切板设置</h2>
          <button type="button" :disabled="saving" aria-label="关闭设置" @click="emit('close')">×</button>
        </header>

        <div class="settings-layout" :inert="saving">
          <SettingsNavigation
            v-model="activeTab"
            :tabs="settingsTabs"
            :sync-tone="syncPresentation.tone"
          />
          <div class="settings-scroll">
            <section id="general-panel" v-show="activeTab === 'general'" class="settings-page" role="tabpanel" aria-labelledby="general-tab" tabindex="0">
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
              <div class="shortcut-settings">
                <span><strong>版本新特性</strong><small>探索当前版本 (v1.3.0) 带来的全新功能与体验提升。</small></span>
                <button type="button" @click="emit('showWhatsNew')">查看新特性</button>
              </div>
              <p v-if="hotkeySettingsMessage" class="settings-result" role="status">{{ hotkeySettingsMessage }}</p>
            </section>

          <section id="appearance-panel" v-show="activeTab === 'appearance'" class="settings-page" role="tabpanel" aria-labelledby="appearance-tab" tabindex="0">
            <div class="settings-page__intro"><strong>主题与背景</strong><span>自定义主题色，并用纯色或本地图片装饰插件窗口。</span></div>
            <UiVersionPreference v-model="form.uiVersion" />
            <div class="theme-preview" :style="themePreviewStyle" aria-label="主题预览">
              <ThemeImageBackdrop :background="selectedThemeBackground()" />
              <span class="theme-preview__brand">Paste</span>
              <div><i data-pb-theme-preview-card>文本</i><i data-pb-theme-preview-card>链接</i><i data-pb-theme-preview-card>图片</i></div>
              <span class="theme-preview__button">主题预览</span>
            </div>
            <div class="color-field">
              <span><strong>主题色</strong><small>按钮、选中态和强调信息将使用此颜色。</small></span>
              <ColorPickerField v-model="form.accentColor" label="选择主题色" :disabled="saving" />
            </div>
            <ThemeSurfaceControls
              v-model:card-background="form.cardBackground"
              v-model:background-base-color="form.backgroundBaseColor"
              :dark-mode="previewDarkMode"
              :background-mode="form.backgroundType"
            />
            <fieldset class="option-field">
              <legend>主题背景</legend>
              <div class="option-grid option-grid--three">
                <label><input v-model="form.backgroundType" type="radio" name="background-type" value="default" /><span>跟随系统</span></label>
                <label><input v-model="form.backgroundType" type="radio" name="background-type" value="color" /><span>纯色</span></label>
                <label><input v-model="form.backgroundType" type="radio" name="background-type" value="image" :disabled="form.backgroundImageDataUrl.length === 0" /><span>图片</span></label>
              </div>
              <small>背景图片只保存在插件本地数据中；开启 WebDAV 后才会端到端加密同步。</small>
            </fieldset>
            <div v-if="form.backgroundType === 'color'" class="color-field color-field--compact">
              <span><strong>背景颜色</strong><small>用于插件窗口底层背景。</small></span>
              <ColorPickerField v-model="form.backgroundColor" label="选择背景颜色" :disabled="saving" />
            </div>
            <BackgroundImageControl v-model="form.backgroundImageDataUrl" :disabled="saving" @update:editing="imageEditorOpen = $event" @chosen="form.backgroundType = 'image'" @remove="form.backgroundImageDataUrl = ''; form.backgroundType = 'default'" />
            <ImageBackgroundOptions v-if="form.backgroundType === 'image'"
              v-model:layout="form.backgroundImageLayout"
              v-model:tiles-per-row="form.backgroundImageTilesPerRow"
              v-model:frosted="form.backgroundImageFrosted"
            />
          </section>

          <section id="privacy-panel" v-show="activeTab === 'privacy'" class="settings-page" role="tabpanel" aria-labelledby="privacy-tab" tabindex="0">
            <div class="settings-page__intro"><strong>本地隐私与保留</strong><span>规则在内容写入历史记录之前执行。</span></div>
            <label class="settings-toggle"><span><strong>自动排除高置信度秘密</strong><small>令牌、私钥和已知凭据格式不会写入历史。</small></span><input v-model="form.blockLikelySecrets" type="checkbox" /></label>
            <label class="settings-toggle"><span><strong>屏幕共享时隐藏浮窗</strong><small>默认关闭。开启后在支持的共享或录屏工具中隐藏浮窗，保存后生效。</small></span><input v-model="form.screenShareProtection" type="checkbox" /></label>
            <div class="settings-grid">
              <label><span>普通历史保留天数</span><input v-model.number="form.retentionDays" type="number" min="1" max="3650" /></label>
              <label><span>附件预算</span><div class="budget-control"><input v-model.number="form.maxBlobValue" aria-label="附件预算数值" type="number" :min="blobBudgetConstraints.min" :max="blobBudgetConstraints.max" :step="blobBudgetConstraints.step" required /><select aria-label="附件预算单位" :value="form.maxBlobUnit" @change="updateBlobBudgetUnit"><option v-for="unit in blobBudgetUnits" :key="unit" :value="unit">{{ unit }}</option></select></div></label>
            </div>
            <div class="settings-field"><span>屏蔽应用</span><BlockedApplicationsSelect v-model="form.ignoredBundleIds" :disabled="saving" /></div>
            <label class="settings-field"><span>内容规则（literal: / wildcard: / regex:）</span><textarea v-model="form.contentRules" rows="4" spellcheck="false" placeholder="literal:PRIVATE NOTE&#10;wildcard:otp-*&#10;regex:^internal-[0-9]+$/i" /></label>
            <p class="settings-note">分组与固定内容不会被普通保留策略静默删除。</p>
            <div class="danger-zone">
              <span><strong>清空剪贴板</strong><small>删除全部历史、固定内容、分组关联和插件自管附件，同时清空当前系统剪贴板。</small></span>
              <button type="button" :disabled="clearingHistory" @click="clearHistory">{{ clearingHistory ? "正在清空…" : "清空剪贴板" }}</button>
            </div>
            <p v-if="historyClearMessage" class="settings-result" :class="{ 'settings-result--error': historyClearFailed }" :role="historyClearFailed ? 'alert' : 'status'">{{ historyClearMessage }}</p>
          </section>

          <section id="sync-panel" v-show="activeTab === 'sync'" class="settings-page" role="tabpanel" aria-labelledby="sync-tab" tabindex="0">
            <div class="settings-page__intro"><strong>加密 WebDAV</strong><span>在设备之间同步正文、分组、附件和外观配置。</span></div>
            <div class="sync-pulse" :class="`sync-pulse--${syncPresentation.tone}`"><span class="sync-pulse__orb" aria-hidden="true"></span><div class="sync-pulse__content"><strong>{{ syncPresentation.label }}</strong><span>{{ syncPresentation.detail }}</span></div><button v-if="syncPresentation.action === 'retry'" type="button" @click="emit('retry')">重试</button></div>
            <label class="settings-toggle"><span><strong>启用加密同步</strong><small>正文、OCR、分组、图片、PDF 和外观配置默认同步。</small></span><input v-model="form.syncEnabled" type="checkbox" /></label>
            <div class="sync-grid" :aria-disabled="!form.syncEnabled">
              <label class="settings-field settings-field--wide"><span>WebDAV 地址</span><input v-model="form.baseUrl" :disabled="!form.syncEnabled" type="url" placeholder="https://dav.example.com/PasteboardPro/v1/" autocomplete="url" /></label>
              <label class="settings-field"><span>用户名</span><input v-model="form.username" :disabled="!form.syncEnabled" autocomplete="username" /></label>
              <label class="settings-field"><span>WebDAV 密码</span><input v-model="form.webdavPassword" :disabled="!form.syncEnabled" type="password" placeholder="未修改" autocomplete="current-password" /></label>
              <label class="settings-field settings-field--wide"><span>自动备份间隔</span><select v-model.number="form.intervalMinutes" :disabled="!form.syncEnabled"><option v-for="opt in syncIntervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
              <label class="settings-field settings-field--wide"><span>剪贴板同步密码</span><input v-model="form.syncPassword" :disabled="!form.syncEnabled" type="password" placeholder="用于端到端加密；丢失后无法恢复" autocomplete="new-password" /></label>
            </div>
            <p class="settings-note">密码和派生密钥只保存在系统安全存储；插件数据库不保存明文秘密。</p>
          </section>
          </div>
        </div>

        <footer class="settings-footer">
          <span>更改仅在点击“保存设置”后生效</span>
          <p v-if="props.saveError" class="settings-error settings-footer__error" role="alert">{{ props.saveError }}</p>
          <div><button type="button" class="quiet" :disabled="saving" @click="emit('close')">取消</button><button type="submit" class="primary" :disabled="saving">{{ saving ? "正在保存…" : "保存设置" }}</button></div>
        </footer>
      </form>
    </section>
  </div>
</template>

<style src="../styles/settings-panel.css"></style>
<style src="../styles/settings-controls.css"></style>
