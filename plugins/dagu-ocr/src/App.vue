<script setup>
import { computed, onMounted, onBeforeUnmount, onUpdated, reactive, ref, watch } from 'vue';
import { createPluginWindowLayoutSync } from './window-layout.js';
import { hydrateIcons } from './icon-hydration.js';
import { createPreviewViewer } from './preview-viewer.js';
import { createZtoolsThemeSync } from './theme.js';

const props = defineProps({
  controller: { type: Object, required: true }
});

const state = reactive({
  ...props.controller.state,
  config: { ...props.controller.state.config },
  history: [...props.controller.state.history],
  providerOptions: {
    ocr: [...props.controller.state.providerOptions.ocr],
    translation: [...props.controller.state.providerOptions.translation]
  }
});
props.controller.onChange = (snapshot) => {
  Object.assign(state, snapshot);
};

const imageFileChanged = async (event) => {
  const file = event.target.files?.[0];
  if (file) await props.controller.handleFile(file);
  event.target.value = '';
};

const dropFile = async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) await props.controller.handleFile(file);
};

const pasteImage = async (event) => {
  const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
  if (file) await props.controller.handleFile(file);
};

const openEditor = () => {
  props.controller.openEditor(state.imageUrl, { returnInput: true });
};
const copyImage = () => props.controller.copyImageResult(state.imageUrl);

const previewFrame = ref(null);
const previewImg = ref(null);
let previewViewer = null;

// 折叠/展开会重建预览图片元素，每次渲染后重新绑定缩放拖动。
const syncPreviewViewer = () => {
  if (!previewFrame.value) {
    previewViewer?.dispose();
    previewViewer = null;
    return;
  }
  if (!previewViewer) previewViewer = createPreviewViewer({ frame: previewFrame.value });
  previewViewer.setImage(previewImg.value || null);
};

const submitTranslation = () => props.controller.translateTextInput();
const recognizeAgain = () => props.controller.recognizeAgain(state.imageUrl);
const translateResult = () => {
  previewExpanded.value = false;
  return props.controller.translateAndUpdate(state.resultText);
};
const translationLanguages = (direction) => props.controller.getTranslationLanguageOptions(
  direction,
  state.config.translationProviderId
);

const previewExpanded = ref(false);
const translationActive = computed(() => (
  state.showTranslateResult || state.busyLabel === '正在翻译'
));
const previewCollapsed = computed(() => translationActive.value && !previewExpanded.value);
const togglePreview = () => {
  previewExpanded.value = !previewExpanded.value;
};
watch(() => state.showTranslateResult, (visible) => {
  if (!visible) previewExpanded.value = false;
});

const saveConfig = () => props.controller.saveConfig({ ...state.config }, true);
const saveConfigWithoutClosing = () => props.controller.saveConfig({ ...state.config }, false);
const updateLanguage = () => props.controller.saveConfig({ ...state.config }, false);

let themeSync;
let windowLayout;

onMounted(() => {
  document.addEventListener('paste', pasteImage);
  hydrateIcons(document);
  themeSync = createZtoolsThemeSync();
  windowLayout = createPluginWindowLayoutSync({ win: window });
  windowLayout.sync();
  syncPreviewViewer();
});

onUpdated(() => {
  hydrateIcons(document);
  windowLayout?.schedule(true);
  syncPreviewViewer();
});

onBeforeUnmount(() => {
  document.removeEventListener('paste', pasteImage);
  themeSync?.();
  windowLayout?.dispose();
  previewViewer?.dispose();
  previewViewer = null;
});
</script>
<template>
  <main class="app-shell">
    <section v-if="state.showTranslationInput" id="textInputPanel" class="input-panel text-input-panel">
      <textarea
        id="textInput"
        :value="state.translationInput"
        placeholder="粘贴或输入文字"
        @input="props.controller.setTranslationInput($event.target.value)"
      ></textarea>
      <div class="translation-bar" aria-label="翻译语言">
        <div class="translation-controls text-translation-controls">
          <select id="sourceLangText" :value="state.config.sourceLang" aria-label="源语言" @change="state.config.sourceLang = $event.target.value; updateLanguage()">
            <option v-for="language in translationLanguages('source')" :key="language.code" :value="language.code">
              {{ language.label }}
            </option>
          </select>
          <button class="swap-button" type="button" title="交换语言" @click="props.controller.swapLanguages"><span data-icon="swap"></span></button>
          <select id="targetLangText" :value="state.config.targetLang" aria-label="目标语言" @change="state.config.targetLang = $event.target.value; updateLanguage()">
            <option v-for="language in translationLanguages('target')" :key="language.code" :value="language.code">
              {{ language.label }}
            </option>
          </select>
        </div>
        <button id="translateInputBtn" class="primary-button" type="button" :disabled="state.busy" @click="submitTranslation"><span data-icon="languages"></span>翻译</button>
      </div>
      <div v-if="state.showTranslateResult" id="textTranslateResultArea" class="translate-result-area show">
        <div class="result-heading compact-heading">
          <span class="pane-label">译文</span>
          <button id="copyTranslateBtn" class="text-button" type="button" @click="props.controller.copyTranslateResult"><span data-icon="copy"></span>复制</button>
        </div>
        <textarea id="translateResult" :value="state.translateResult" placeholder="翻译结果会显示在这里" @input="props.controller.setTranslateValue($event.target.value)"></textarea>
      </div>
    </section>

    <section
      v-if="state.showUpload"
      id="dropArea"
      class="drop-area"
      @click="$refs.fileInput.click()"
      @dragover.prevent
      @drop="dropFile"
    >
      <input ref="fileInput" id="fileInput" type="file" accept="image/*" @change="imageFileChanged">
      <div class="upload-icon" aria-hidden="true"><span data-icon="upload"></span></div>
      <h2>{{ state.mode === 'edit' ? '选择图片开始编辑' : '拖入图片，或点击上传' }}</h2>
      <p>{{ state.mode === 'edit' ? '编辑完成后可复制图片' : '支持 PNG、JPG、GIF 等常见格式，也可直接粘贴' }}</p>
    </section>

    <section v-if="state.showImage" class="workspace-grid" :class="{ 'has-translation': translationActive }">
      <div id="preview" class="preview" :class="{ show: state.showImage, 'is-collapsed': previewCollapsed }">
        <div class="preview-heading">
          <span class="pane-label">图片</span>
          <div class="preview-actions">
            <button
              v-if="translationActive"
              id="togglePreviewBtn"
              class="text-button preview-toggle"
              type="button"
              :title="previewCollapsed ? '展开图片预览' : '收起图片预览'"
              :aria-label="previewCollapsed ? '展开图片预览' : '收起图片预览'"
              @click="togglePreview"
            ><span :data-icon="previewCollapsed ? 'chevronDown' : 'chevronUp'"></span>预览</button>
            <button id="copy-image-btn" class="text-button" type="button" title="复制图片" :disabled="state.busy" @click="copyImage"><span data-icon="copy"></span>复制</button>
            <button id="edit-image-btn" class="text-button" type="button" title="编辑图片" :disabled="state.busy" @click="openEditor"><span data-icon="pen"></span>编辑</button>
          </div>
        </div>
        <!-- 折叠时整个预览框都不渲染，避免结果页顶部留下空白占位。 -->
        <div v-if="!previewCollapsed" ref="previewFrame" class="preview-frame">
          <img id="previewImg" ref="previewImg" :src="state.imageUrl" alt="待处理图片">
        </div>
      </div>
      <div v-if="state.showResult" id="resultArea" class="result-area" :class="{ show: state.showResult }">
        <div class="translation-controls" aria-label="翻译语言">
          <select id="sourceLang" :value="state.config.sourceLang" aria-label="源语言" @change="state.config.sourceLang = $event.target.value; updateLanguage()">
            <option v-for="language in translationLanguages('source')" :key="language.code" :value="language.code">
              {{ language.label }}
            </option>
          </select>
          <button id="swapLangBtn" class="swap-button" type="button" title="交换语言" @click="props.controller.swapLanguages"><span data-icon="swap"></span></button>
          <select id="targetLang" :value="state.config.targetLang" aria-label="目标语言" @change="state.config.targetLang = $event.target.value; updateLanguage()">
            <option v-for="language in translationLanguages('target')" :key="language.code" :value="language.code">
              {{ language.label }}
            </option>
          </select>
        </div>

        <div class="text-comparison" :class="{ 'with-translation': state.showTranslateResult }">
          <section id="sourceTextPane" class="text-pane source-pane" aria-label="原文">
            <div class="pane-heading">
              <span class="pane-label">原文</span>
              <div class="pane-heading-actions">
                <span v-if="state.busy" class="busy-dot">处理中</span>
                <button id="copySourceBtn" class="text-button" type="button" title="复制原文" @click="props.controller.copyResult"><span data-icon="copy"></span>复制</button>
              </div>
            </div>
            <textarea id="resultText" :value="state.resultText" placeholder="识别结果会显示在这里，可直接编辑" @input="props.controller.setResultValue($event.target.value)"></textarea>
          </section>

          <section v-if="state.showTranslateResult" id="translateResultArea" class="text-pane translation-pane translate-result-area show" aria-label="译文">
            <div class="pane-heading">
              <span class="pane-label">译文</span>
              <button id="copyTranslateBtn" class="text-button" type="button" @click="props.controller.copyTranslateResult"><span data-icon="copy"></span>复制</button>
            </div>
            <textarea id="translateResult" :value="state.translateResult" placeholder="翻译结果会显示在这里" @input="props.controller.setTranslateValue($event.target.value)"></textarea>
          </section>
        </div>

      </div>

      <!-- 操作栏和翻译结果页保持一致，跨列贴在图片容器与 OCR 结果容器底部。 -->
      <div v-if="state.showResult" class="actions-row">
        <button id="confirmBtn" class="primary-button" type="button" @click="props.controller.confirmResult"><span data-icon="copy"></span>复制</button>
        <button id="ocrAgainBtn" class="secondary-button" type="button" :disabled="state.busy" @click="recognizeAgain"><span data-icon="refresh"></span>重新识别</button>
        <button id="translateBtn" class="secondary-button" type="button" :disabled="state.busy" @click="translateResult"><span data-icon="languages"></span>翻译</button>
        <button id="clearBtn" class="ghost-button" type="button" @click="props.controller.clearAll"><span data-icon="clear"></span>清空</button>
        <p id="status" class="status" role="status" aria-live="polite">{{ state.status }}</p>
        <div class="actions-utility" aria-label="识别历史与设置">
          <button id="historyToggle" class="text-button" type="button" title="查看识别历史" :aria-expanded="state.historyExpanded" @click="props.controller.toggleHistory"><span data-icon="history"></span>历史</button>
          <button id="configBtn" class="icon-button" type="button" title="打开配置" @click="props.controller.showConfigPanel()"><span data-icon="settings"></span>配置</button>
        </div>
      </div>
    </section>

    <section v-if="!state.showImage && !state.showUpload && !state.showTranslationInput" class="empty-state">
      <p>从 ZTools 传入图片或文字，处理结果会显示在这里。</p>
    </section>

    <section v-if="!state.showResult" class="history-section utility-bar" aria-label="识别历史与设置">
      <p id="status" class="status" role="status" aria-live="polite">{{ state.status }}</p>
      <div class="section-actions">
        <button id="historyToggle" class="text-button" type="button" title="查看识别历史" :aria-expanded="state.historyExpanded" @click="props.controller.toggleHistory"><span data-icon="history"></span>历史</button>
        <button id="configBtn" class="icon-button" type="button" title="打开配置" @click="props.controller.showConfigPanel()"><span data-icon="settings"></span>配置</button>
      </div>
    </section>

    <div id="loading" class="loading" :class="{ show: state.busy }" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>{{ state.busyLabel || '处理中' }}
    </div>
    <div v-if="state.historyExpanded" id="historyPanel" class="history-overlay" role="dialog" aria-modal="true" aria-label="最近识别" @click.self="props.controller.toggleHistory">
      <section class="history-dialog">
        <header class="history-dialog-header">
          <h2 id="historyTitle">最近识别</h2>
          <button id="closeHistoryBtn" class="icon-button" type="button" title="关闭历史" @click="props.controller.toggleHistory"><span data-icon="close"></span>关闭</button>
        </header>
        <div class="history-dialog-content">
          <div v-if="state.history.length" id="historyList" class="history-list">
            <button v-for="item in state.history" :key="item.timestamp + item.text" class="history-item" type="button" @click="props.controller.copyHistoryItem(item)">{{ item.text }}</button>
          </div>
          <p v-else id="historyEmpty" class="history-empty">暂无识别记录</p>
        </div>
        <footer class="history-dialog-footer">
          <button id="clearHistoryBtn" class="text-button danger-text" type="button" @click="props.controller.clearHistory"><span data-icon="clear"></span>清空历史</button>
        </footer>
      </section>
    </div>

    <div v-if="state.showConfig" id="configPanel" class="config-overlay" role="dialog" aria-modal="true" aria-labelledby="configTitle">
      <section class="config-panel">
        <header class="config-header">
          <h2 id="configTitle">配置</h2>
          <button id="closeConfigBtn" class="icon-button" type="button" title="关闭设置" @click="props.controller.hideConfigPanel"><span data-icon="close"></span>关闭</button>
        </header>
        <div class="config-scroll">
          <details class="provider-guide">
            <summary>设置说明</summary>
            <div class="provider-guide-body">
              <p>推荐使用 <strong>ZTools 提供商</strong>：在 ZTools 搜索并打开「ZTools 提供商」（f-provider），完成 OCR 与翻译渠道配置后回到这里选择。</p>
              <p>也可以选择「大古内置」服务，并在下方填写对应密钥。密钥空白项不会上传。</p>
            </div>
          </details>

          <section class="config-card">
            <div class="config-fields">
              <label class="field">
                <span>OCR 服务</span>
                <select id="ocrProviderSelect" v-model="state.config.ocrProviderId">
                  <option value="">请选择识别服务</option>
                  <option v-for="option in state.providerOptions.ocr" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
              </label>
              <label class="field">
                <span>翻译服务</span>
                <select id="translationProviderSelect" v-model="state.config.translationProviderId">
                  <option value="">请选择翻译服务</option>
                  <option v-for="option in state.providerOptions.translation" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
              </label>
              <label class="field">
                <span>源语言</span>
                <select id="sourceLangConfig" v-model="state.config.sourceLang">
                  <option v-for="language in translationLanguages('source')" :key="language.code" :value="language.code">{{ language.label }}</option>
                </select>
              </label>
              <label class="field">
                <span>目标语言</span>
                <select id="targetLangConfig" v-model="state.config.targetLang">
                  <option v-for="language in translationLanguages('target')" :key="language.code" :value="language.code">{{ language.label }}</option>
                </select>
              </label>
            </div>
          </section>

          <section class="config-card credentials-section">
            <div class="card-label">
              <span>内置服务密钥</span>
              <small>只填写实际使用的服务</small>
            </div>
            <div class="form-grid">
              <label>百度 OCR API Key<input id="baiduAk" v-model.trim="state.config.baiduAk" type="text" autocomplete="off"></label>
              <label>百度 OCR Secret Key<input id="baiduSk" v-model.trim="state.config.baiduSk" type="password" autocomplete="off"></label>
              <label>阿里 AccessKey ID<input id="aliAk" v-model.trim="state.config.aliAk" type="text" autocomplete="off"></label>
              <label>阿里 AccessKey Secret<input id="aliSk" v-model.trim="state.config.aliSk" type="password" autocomplete="off"></label>
              <label>百度翻译 APP ID<input id="baiduTranslateAppId" v-model.trim="state.config.baiduTranslateAppId" type="text" autocomplete="off"></label>
              <label>百度翻译密钥<input id="baiduTranslateSecretKey" v-model.trim="state.config.baiduTranslateSecretKey" type="password" autocomplete="off"></label>
              <label class="full-field">MyMemory key<input id="myMemoryKey" v-model.trim="state.config.myMemoryKey" type="password" autocomplete="off"><small>未配置时 MyMemory 不可用。</small></label>
            </div>
          </section>

          <section class="sync-warning">
            <label class="switch-line"><input id="syncSecrets" v-model="state.config.syncSecrets" type="checkbox"><span class="switch-ui" aria-hidden="true"></span><span>同步密钥</span></label>
            <p>开启后密钥写入 ZTools dbStorage 并随备份同步；该存储未声明端到端加密。关闭后删除同步副本，保留本机密钥。</p>
          </section>
        </div>

        <footer class="config-footer">
          <button id="testConfigBtn" class="secondary-button" type="button" :disabled="state.busy" @click="saveConfigWithoutClosing().then(() => props.controller.testConfig())">测试当前 OCR</button>
          <button id="saveConfigBtn" class="primary-button" type="button" :disabled="state.busy" @click="saveConfig"><span data-icon="check"></span>保存设置</button>
        </footer>
      </section>
    </div>
  </main>
</template>
