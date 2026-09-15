<script setup>
import { computed, onMounted, onBeforeUnmount, onUpdated, reactive, ref, watch } from 'vue';
import { createPluginWindowLayoutSync } from './window-layout.js';

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

let windowLayout;

onMounted(() => {
  document.addEventListener('paste', pasteImage);
  windowLayout = createPluginWindowLayoutSync({
    win: window,
    doc: document,
    root: document.querySelector('.app-shell')
  });
  windowLayout.sync();
});

onUpdated(() => {
  windowLayout?.schedule(true);
});

onBeforeUnmount(() => {
  document.removeEventListener('paste', pasteImage);
  windowLayout?.dispose();
});
</script>

<template>
  <main class="app-shell">
    <section v-if="state.showTranslationInput" id="textInputPanel" class="input-panel text-input-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">TRANSLATE</span>
          <h2>输入要翻译的文字</h2>
        </div>
        <span class="panel-note">{{ state.config.sourceLang }} → {{ state.config.targetLang }}</span>
      </div>
      <textarea
        id="textInput"
        :value="state.translationInput"
        placeholder="粘贴或输入文字"
        @input="props.controller.setTranslationInput($event.target.value)"
      ></textarea>
      <div class="translation-controls text-translation-controls" aria-label="翻译语言">
        <select id="sourceLangText" :value="state.config.sourceLang" aria-label="源语言" @change="state.config.sourceLang = $event.target.value; updateLanguage()">
          <option v-for="language in translationLanguages('source')" :key="language.code" :value="language.code">
            {{ language.label }}
          </option>
        </select>
        <button class="swap-button" type="button" title="交换语言" @click="props.controller.swapLanguages">⇄</button>
        <select id="targetLangText" :value="state.config.targetLang" aria-label="目标语言" @change="state.config.targetLang = $event.target.value; updateLanguage()">
          <option v-for="language in translationLanguages('target')" :key="language.code" :value="language.code">
            {{ language.label }}
          </option>
        </select>
      </div>
      <div class="panel-actions">
        <button id="translateInputBtn" class="primary-button" type="button" :disabled="state.busy" @click="submitTranslation">开始翻译</button>
      </div>
      <div v-if="state.showTranslateResult" id="textTranslateResultArea" class="translate-result-area show">
        <div class="result-heading compact-heading">
          <h3>翻译结果</h3>
          <button id="copyTranslateBtn" class="text-button" type="button" @click="props.controller.copyTranslateResult">复制翻译</button>
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
      <div class="upload-icon" aria-hidden="true">↑</div>
      <h2>{{ state.mode === 'edit' ? '选择图片开始编辑' : '拖入图片，或点击上传' }}</h2>
      <p>{{ state.mode === 'edit' ? '编辑完成后可复制图片' : '支持 PNG、JPG、GIF 等常见格式，也可直接粘贴' }}</p>
    </section>

    <section v-if="state.showImage" class="workspace-grid" :class="{ 'has-translation': translationActive }">
      <div id="preview" class="preview" :class="{ show: state.showImage, 'is-collapsed': previewCollapsed }">
        <div class="preview-heading">
          <div>
            <span class="eyebrow">IMAGE</span>
            <span class="preview-label">当前图片</span>
          </div>
          <div class="preview-actions">
            <span v-if="!previewCollapsed" class="preview-badge">预览</span>
            <button
              v-if="translationActive"
              id="togglePreviewBtn"
              class="text-button preview-toggle"
              type="button"
              :title="previewCollapsed ? '展开图片预览' : '收起图片预览'"
              @click="togglePreview"
            >{{ previewCollapsed ? '展开预览' : '收起预览' }}</button>
          </div>
        </div>
        <div v-show="!previewCollapsed" class="preview-frame">
          <img id="previewImg" :src="state.imageUrl" alt="待处理图片">
        </div>
        <button id="edit-image-btn" class="secondary-button full-button" type="button" :disabled="state.busy" @click="openEditor">编辑图片</button>
      </div>

      <div v-if="state.showResult" id="resultArea" class="result-area" :class="{ show: state.showResult }">
        <div class="result-heading">
          <div>
            <span class="eyebrow">{{ state.showTranslateResult ? 'TRANSLATION' : 'OCR RESULT' }}</span>
            <h2>{{ state.showTranslateResult ? '原文与译文' : '识别结果' }}</h2>
          </div>
          <span v-if="state.busy" class="busy-dot">处理中</span>
        </div>

        <div class="translation-controls" aria-label="翻译语言">
          <select id="sourceLang" :value="state.config.sourceLang" aria-label="源语言" @change="state.config.sourceLang = $event.target.value; updateLanguage()">
            <option v-for="language in translationLanguages('source')" :key="language.code" :value="language.code">
              {{ language.label }}
            </option>
          </select>
          <button id="swapLangBtn" class="swap-button" type="button" title="交换语言" @click="props.controller.swapLanguages">⇄</button>
          <select id="targetLang" :value="state.config.targetLang" aria-label="目标语言" @change="state.config.targetLang = $event.target.value; updateLanguage()">
            <option v-for="language in translationLanguages('target')" :key="language.code" :value="language.code">
              {{ language.label }}
            </option>
          </select>
        </div>

        <div class="text-comparison" :class="{ 'with-translation': state.showTranslateResult }">
          <section id="sourceTextPane" class="text-pane source-pane" aria-labelledby="sourcePaneTitle">
            <div class="pane-heading">
              <div>
                <span class="pane-label">原文</span>
                <h3 id="sourcePaneTitle">OCR 结果</h3>
              </div>
              <span class="pane-meta">可编辑</span>
            </div>
            <textarea id="resultText" :value="state.resultText" placeholder="识别结果会显示在这里，可直接编辑" @input="props.controller.setResultValue($event.target.value)"></textarea>
          </section>

          <section v-if="state.showTranslateResult" id="translateResultArea" class="text-pane translation-pane translate-result-area show" aria-labelledby="translationPaneTitle">
            <div class="pane-heading">
              <div>
                <span class="pane-label">译文</span>
                <h3 id="translationPaneTitle">{{ state.config.targetLang }}</h3>
              </div>
              <button id="copyTranslateBtn" class="text-button" type="button" @click="props.controller.copyTranslateResult">复制译文</button>
            </div>
            <textarea id="translateResult" :value="state.translateResult" placeholder="翻译结果会显示在这里" @input="props.controller.setTranslateValue($event.target.value)"></textarea>
          </section>
        </div>

        <div class="actions-row">
          <button id="confirmBtn" class="primary-button" type="button" @click="props.controller.confirmResult">复制结果</button>
          <button id="copyBtn" class="secondary-button" type="button" @click="props.controller.copyResult">复制文本</button>
          <button id="ocrAgainBtn" class="secondary-button" type="button" :disabled="state.busy" @click="recognizeAgain">重新 OCR</button>
          <button id="translateBtn" class="secondary-button accent-button" type="button" :disabled="state.busy" @click="translateResult">翻译</button>
          <button id="clearBtn" class="ghost-button" type="button" @click="props.controller.clearAll">清空</button>
        </div>
      </div>
    </section>

    <section v-if="!state.showImage && !state.showUpload && !state.showTranslationInput" class="empty-state">
      <h2>准备开始</h2>
      <p>从 ZTools 传入图片或文字，处理结果会显示在这里。</p>
    </section>

    <section class="history-section" aria-label="识别历史">
      <div class="section-heading">
        <div>
          <span class="eyebrow">HISTORY</span>
          <h2>最近识别</h2>
        </div>
        <div class="section-actions">
          <button id="configBtn" class="icon-button" type="button" title="打开配置" @click="props.controller.showConfigPanel()">配置</button>
          <button id="historyToggle" class="text-button" type="button" title="查看识别历史" :aria-expanded="state.historyExpanded" @click="props.controller.toggleHistory">{{ state.historyExpanded ? '收起' : '展开' }}</button>
        </div>
      </div>
    </section>

    <div id="loading" class="loading" :class="{ show: state.busy }" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>{{ state.busyLabel || '处理中' }}
    </div>
    <p id="status" class="status" role="status" aria-live="polite">{{ state.status }}</p>

    <div v-if="state.historyExpanded" id="historyPanel" class="history-overlay" role="dialog" aria-modal="true" aria-labelledby="historyTitle" @click.self="props.controller.toggleHistory">
      <section class="history-dialog">
        <header class="history-dialog-header">
          <div>
            <span class="eyebrow">HISTORY</span>
            <h2 id="historyTitle">最近识别</h2>
          </div>
          <button id="closeHistoryBtn" class="icon-button" type="button" title="关闭历史" @click="props.controller.toggleHistory">关闭</button>
        </header>
        <div class="history-dialog-content">
          <div v-if="state.history.length" id="historyList" class="history-list">
            <button v-for="item in state.history" :key="item.timestamp + item.text" class="history-item" type="button" @click="props.controller.copyHistoryItem(item)">{{ item.text }}</button>
          </div>
          <p v-else id="historyEmpty" class="history-empty">暂无识别记录</p>
        </div>
        <footer class="history-dialog-footer">
          <button id="clearHistoryBtn" class="text-button danger-text" type="button" @click="props.controller.clearHistory">清空历史</button>
        </footer>
      </section>
    </div>

    <div v-if="state.showConfig" id="configPanel" class="config-overlay" role="dialog" aria-modal="true" aria-labelledby="configTitle">
      <section class="config-panel">
        <header class="config-header">
          <div>
            <span class="eyebrow">SETTINGS</span>
            <h2 id="configTitle">配置</h2>
          </div>
          <button id="closeConfigBtn" class="icon-button" type="button" title="关闭设置" @click="props.controller.hideConfigPanel">关闭</button>
        </header>

        <div class="config-scroll">
          <details class="provider-guide">
            <summary>如何设置提供商？</summary>
            <div class="provider-guide-body">
              <p>插件支持两种识别/翻译服务，二选一即可：</p>
              <ol>
                <li>
                  <strong>ZTools 提供商（推荐）</strong>：在 ZTools 搜索框输入「提供商」或「ZTools 提供商」，安装
                  <em>ZTools 提供商</em> 插件（f-provider）；打开它的设置页，为 OCR 配置识别渠道、为翻译配置翻译渠道。
                  完成后回到本设置页，下拉框中会自动出现这些渠道（如「微信 OCR」「AI 识图」「百度翻译」），选中即可使用，
                  密钥由该插件统一管理，无需在本页填写。
                </li>
                <li>
                  <strong>大古内置提供商</strong>：直接使用下方「OCR Provider / Translation Provider」下拉框中的
                  「大古内置 · 百度 / 阿里 / MyMemory」选项，并在下方「内置 Provider 密钥」里填入对应服务的密钥。
                </li>
              </ol>
              <p class="guide-note">下拉列表为空或提示「请先选择 Provider」时，说明尚未选择任何提供商，按上面任一方式设置即可。</p>
            </div>
          </details>

          <section class="config-section">
            <div class="section-heading compact-heading">
              <div><h3>OCR Provider</h3><p>只执行当前选中的一个识别服务。</p></div>
            </div>
            <select id="ocrProviderSelect" v-model="state.config.ocrProviderId" class="config-select">
              <option value="">请选择 OCR Provider</option>
              <option v-for="option in state.providerOptions.ocr" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </section>

          <section class="config-section">
            <div class="section-heading compact-heading">
              <div><h3>Translation Provider</h3><p>失败只提示当前服务错误，不自动切换。</p></div>
            </div>
            <select id="translationProviderSelect" v-model="state.config.translationProviderId" class="config-select">
              <option value="">请选择翻译 Provider</option>
              <option v-for="option in state.providerOptions.translation" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </section>

          <section class="config-section language-section">
            <div class="form-grid">
              <label>源语言<select id="sourceLangConfig" v-model="state.config.sourceLang"><option v-for="language in translationLanguages('source')" :key="language.code" :value="language.code">{{ language.label }}</option></select></label>
              <label>目标语言<select id="targetLangConfig" v-model="state.config.targetLang"><option v-for="language in translationLanguages('target')" :key="language.code" :value="language.code">{{ language.label }}</option></select></label>
            </div>
          </section>

          <section class="config-section credentials-section">
            <div class="section-heading compact-heading">
              <div><h3>内置 Provider 密钥</h3><p>仅填写你实际选中的内置服务。空白项不会上传。</p></div>
            </div>
            <div class="form-grid">
              <label>百度 OCR API Key<input id="baiduAk" v-model.trim="state.config.baiduAk" type="text" autocomplete="off"></label>
              <label>百度 OCR Secret Key<input id="baiduSk" v-model.trim="state.config.baiduSk" type="password" autocomplete="off"></label>
              <label>阿里 AccessKey ID<input id="aliAk" v-model.trim="state.config.aliAk" type="text" autocomplete="off"></label>
              <label>阿里 AccessKey Secret<input id="aliSk" v-model.trim="state.config.aliSk" type="password" autocomplete="off"></label>
              <label>百度翻译 APP ID<input id="baiduTranslateAppId" v-model.trim="state.config.baiduTranslateAppId" type="text" autocomplete="off"></label>
              <label>百度翻译密钥<input id="baiduTranslateSecretKey" v-model.trim="state.config.baiduTranslateSecretKey" type="password" autocomplete="off"></label>
              <label class="full-field">MyMemory key<input id="myMemoryKey" v-model.trim="state.config.myMemoryKey" type="password" autocomplete="off"><small>不再内置默认 key，未配置时 MyMemory 不可用。</small></label>
            </div>
          </section>

          <section class="sync-warning">
            <label class="switch-line"><input id="syncSecrets" v-model="state.config.syncSecrets" type="checkbox"><span class="switch-ui" aria-hidden="true"></span><span>同步密钥</span></label>
            <p>开启后密钥会写入 ZTools dbStorage，随备份同步；该存储未声明端到端加密，请只在信任同步环境时开启。关闭后会删除同步副本，但保留本机密钥。</p>
          </section>
        </div>

        <footer class="config-footer">
          <button id="testConfigBtn" class="secondary-button" type="button" :disabled="state.busy" @click="saveConfigWithoutClosing().then(() => props.controller.testConfig())">测试当前 OCR</button>
          <button id="saveConfigBtn" class="primary-button" type="button" :disabled="state.busy" @click="saveConfig">保存设置</button>
        </footer>
      </section>
    </div>
  </main>
</template>
