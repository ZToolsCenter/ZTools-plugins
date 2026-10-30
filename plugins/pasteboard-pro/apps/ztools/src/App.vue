<script setup lang="ts">
import Shelf from "./components/Shelf.vue";
import ThemeImageBackdrop from "./components/ThemeImageBackdrop.vue";
import Preview from "./components/Preview.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import TextEditor from "./components/TextEditor.vue";
import WhatsNewModal from "./components/WhatsNewModal.vue";
import SelectionPasteDialog from "./components/SelectionPasteDialog.vue";
import { CURRENT_APP_VERSION } from "./whats-new";
import { defaultSmartPinboards } from "./smart-pinboards";
import { usePasteboardApplication } from "./use-pasteboard-application";

const {
  panelMode, isShelfMode, hostCompatibility, requiresHostUpgrade, shortcutPlatform,
  state, pinboards, query, pagedHistory, historyTotal, hasMoreHistory, queryPending,
  activePinboardId, previewItem, visibleItems, reorderEnabled,
  updateQuery, selectItem, focusLatestItem, selectPinboard, reorderVisibleItems,
  loadMoreHistory, createPinboard, renamePinboard, updatePinboardColor,
  reorderPinboard, deletePinboard, assignPinboard,
  syncSettings, privacySettings, windowPreferences, prefersDark, themeStyle,
  hasImageBackground, settingsOpen, settingsSaving, settingsSaveError, settingsInitialTab,
  openPrivacySettings, saveSettings, retrySync, closeSettings,
  selectionPasteNotice, queueSaving, supportsGlobalQueue, editor, editorSaving,
  pasteItem, startSelectionQueue, createTextItem, editItem, renameItem,
  openPreview, saveEditor, pasteStackController, updatePasteStack,
  captureScreen, recognizeItem, rotateImage, quickLookItem,
  status, paused, startupError, shelfView, canCaptureScreen, togglePause,
  openWhatsNew, closeWhatsNew, closeWindow, onHistoryCleared, pointerReorderActive,
} = usePasteboardApplication();
</script>

<template>
  <main
    class="stage"
    :aria-busy="queryPending"
    :style="themeStyle"
    :class="{
      'stage--panel': panelMode !== undefined,
      'stage--primary': !requiresHostUpgrade && !isShelfMode && panelMode === undefined,
      'stage--image-background': hasImageBackground,
    }"
  >
    <ThemeImageBackdrop v-if="hasImageBackground && !isShelfMode" :background="windowPreferences.theme.background" />
    <section v-if="requiresHostUpgrade" class="upgrade-required" role="alert">
      <img src="/logo.png" alt="" />
      <h1>请升级 ZTools</h1>
      <p>
        Paste剪切板需要 ZTools {{ hostCompatibility?.minimumVersion ?? "2.4.0" }} 或更高版本。
      </p>
      <small v-if="hostCompatibility?.currentVersion">
        当前版本：{{ hostCompatibility.currentVersion }}
      </small>
    </section>
    <section v-else-if="startupError" class="upgrade-required" role="alert">
      <p>{{ startupError }}</p>
      <button type="button" @click="closeWindow">关闭</button>
    </section>
    <template v-else>
    <Shelf
      ref="shelfView"
      v-if="isShelfMode"
      :inert="selectionPasteNotice !== undefined || settingsOpen"
      :items="visibleItems"
      :total="pagedHistory ? historyTotal : visibleItems.length"
      :has-more="hasMoreHistory"
      @load-more="loadMoreHistory"
      :pinboards="pinboards"
      :smart-pinboards="defaultSmartPinboards"
      :selected-ids="state.selection.selected"
      :focused-item-id="state.selection.focus"
      :query="query"
      :paused="paused"
      :edge="state.dockEdge"
      :density="state.density"
      :ui-version="windowPreferences.uiVersion"
      :accent-color="windowPreferences.theme.accentColor"
      :theme-background="windowPreferences.theme.background"
      :card-background="windowPreferences.theme.cardBackground"
      :background-base-color="windowPreferences.theme.backgroundBaseColor"
      :dark-mode="prefersDark"
      :active-pinboard-id="activePinboardId"
      :paste-stack-count="state.pasteStack.itemIds.length"
      :paste-stack-direction="state.pasteStack.direction"
      :reorder-enabled="reorderEnabled"
      :can-capture-screen="canCaptureScreen"
      @update:query="updateQuery"
      @select="selectItem"
      @paste="pasteItem"
      @preview="openPreview"
      @latest-visible="focusLatestItem"
      @select-pinboard="selectPinboard"
      @create-pinboard="createPinboard"
      @rename-pinboard="renamePinboard"
      @update-pinboard-color="updatePinboardColor"
      @reorder-pinboard="reorderPinboard"
      @delete-pinboard="deletePinboard"
      @assign-pinboard="assignPinboard"
      @toggle-pause="togglePause"
      @toggle-compact="state.setDensity(state.density === 'compact' ? 'expanded' : 'compact')"
      @toggle-stack-direction="updatePasteStack({ type: 'set-direction', direction: state.pasteStack.direction === 'forward' ? 'reverse' : 'forward' })"
      @clear-stack="pasteStackController.clearSelection()"
      @start-stack="startSelectionQueue()"
      @open-privacy-settings="openPrivacySettings"
      @create-text="createTextItem"
      @capture-screen="captureScreen"
      @edit-item="editItem"
      @rename-item="renameItem"
      @pointer-reorder-active="pointerReorderActive = $event"
      @reorder="reorderVisibleItems"
    />
    <SelectionPasteDialog
      v-if="selectionPasteNotice"
      :notice="selectionPasteNotice"
      :supports-queue="supportsGlobalQueue"
      :busy="queueSaving"
      :paste-shortcut="shortcutPlatform === 'darwin' ? '⌘V' : 'Ctrl+V'"
      @close="selectionPasteNotice = undefined"
      @queue="startSelectionQueue(selectionPasteNotice.itemIds)"
    />
    <SettingsPanel
      v-if="settingsOpen && (panelMode === undefined || panelMode === 'privacy' || panelMode === 'sync')"
      :standalone="panelMode === 'privacy' || panelMode === 'sync'"
      :initial-tab="settingsInitialTab"
      :dark-mode="prefersDark"
      :privacy-settings="privacySettings"
      :sync-settings="syncSettings"
      :window-preferences="windowPreferences"
      :saving="settingsSaving"
      :save-error="settingsSaveError"
      @close="closeSettings"
      @save="saveSettings"
      @retry="retrySync"
      @history-cleared="onHistoryCleared"
      @show-whats-new="openWhatsNew"
    />
    <WhatsNewModal
      v-if="panelMode === 'whatsnew'"
      standalone
      :version="CURRENT_APP_VERSION"
      @close="closeWhatsNew"
    />
    <TextEditor
      v-if="panelMode === 'editor' && editor"
      standalone
      :mode="editor.mode"
      :title="editor.title"
      :text="editor.text"
      :saving="editorSaving"
      @close="closeWindow"
      @save="saveEditor"
    />
    <Preview
      v-if="panelMode === 'preview' && previewItem"
      standalone
      :item="previewItem"
      @close="closeWindow"
      @paste="pasteItem"
      @ocr="recognizeItem"
      @rotate="rotateImage($event.itemId, $event.quarterTurns)"
      @quick-look="quickLookItem"
      @edit="editItem"
      @rename="renameItem"
    />
    <p v-if="isShelfMode" class="status" :class="{ 'visually-hidden': windowPreferences.uiVersion === 'modern' }" aria-live="polite">{{ status }}</p>
    </template>
  </main>
</template>

<style>
@import "./styles/tokens.css";
@import "./styles/glass.css";
@import "./styles/layout.css";
@import "./styles/modern-panels.css";
@import "./styles/custom-theme-surfaces.css";

.stage {
  display: grid;
  height: 100%;
  min-height: 100%;
  padding: 0;
  place-items: end center;
  background-color: var(--pb-theme-background-color, var(--pb-window-bg));
  background-image: var(--pb-theme-background-image, none);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

.stage.stage--image-background {
  position: relative;
  isolation: isolate;
  background-color: var(--pb-window-bg);
  background-image: none;
}

.stage--panel {
  position: relative;
  height: 100%;
  min-height: 0;
  padding: 0;
  place-items: center;
}

.upgrade-required {
  align-self: center;
  justify-self: center;
  width: min(420px, calc(100% - 32px));
  padding: 28px;
  border: 1px solid var(--pb-line);
  border-radius: 20px;
  background: var(--pb-glass-strong);
  box-shadow: 0 24px 80px var(--pb-shadow);
  color: var(--pb-ink);
  text-align: center;
}

.upgrade-required img { width: 52px; height: 52px; border-radius: 14px; }
.upgrade-required h1 { margin: 14px 0 8px; font-size: 22px; }
.upgrade-required p { margin: 0; color: var(--pb-muted); line-height: 1.6; }
.upgrade-required small { display: block; margin-top: 10px; color: var(--pb-muted); }


.stage--primary {
  display: none;
}

.status {
  position: fixed;
  left: 50%;
  bottom: 2px;
  margin: 0;
  color: var(--pb-muted);
  font-size: 9px;
  transform: translateX(-50%);
}

body:has(.shelf--bottom) .stage {
  padding-bottom: 0;
}

body:has(.shelf--top) .stage {
  padding-top: 0;
  place-items: start center;
}

body:has(.shelf--left) .stage {
  padding-left: 0;
  place-items: center start;
}

body:has(.shelf--right) .stage {
  padding-right: 0;
  place-items: center end;
}
</style>
