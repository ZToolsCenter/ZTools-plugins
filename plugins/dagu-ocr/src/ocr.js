import {
  DEFAULT_CONFIG,
  SettingsStore,
  STORAGE_KEYS
} from './core/storage.js';
import {
  ProviderService,
  md5
} from './core/providers.js';

function getWindow() {
  return globalThis.window || globalThis;
}

function getNavigator(win) {
  return win?.navigator || globalThis.navigator;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class OCRApp {
  constructor({
    win,
    store,
    providerService,
    onChange,
    onScreenshotRequest,
    onEditRequest
  } = {}) {
    this.win = win || getWindow();
    this.store = store || new SettingsStore({ win: this.win });
    this.config = { ...DEFAULT_CONFIG };
    this.providerService = providerService || new ProviderService({
      win: this.win,
      config: this.config
    });
    this.onChange = onChange;
    this.onScreenshotRequest = onScreenshotRequest;
    this.onEditRequest = onEditRequest;
    this.ready = false;
    this.pendingPluginEnter = null;
    this.autoTranslate = false;
    this.history = [];
    this.historyExpanded = false;
    this.baiduAccessToken = null;
    this.baiduTokenExpireTime = 0;

    this.state = {
      mode: 'ocr',
      imageUrl: '',
      resultText: '',
      translationInput: '',
      translateResult: '',
      showUpload: true,
      showImage: false,
      showResult: false,
      showTranslationInput: false,
      showTranslateResult: false,
      showConfig: false,
      history: [],
      historyExpanded: false,
      busy: false,
      busyLabel: '',
      status: '',
      providerOptions: { ocr: [], translation: [] },
      config: { ...this.config }
    };

    // These references keep the public controller compatible with older integrations.
    this.resultText = null;
    this.translateResult = null;
    this.preview = null;
    this.previewImg = null;
    this.dropArea = null;
    this.configPanel = null;
  }

  emit() {
    this.state.config = { ...this.config };
    this.state.history = [...this.history];
    this.state.historyExpanded = this.historyExpanded;
    if (typeof this.onChange === 'function') {
      this.onChange({
        ...this.state,
        config: { ...this.state.config },
        history: [...this.state.history],
        providerOptions: {
          ocr: [...this.state.providerOptions.ocr],
          translation: [...this.state.providerOptions.translation]
        }
      });
    }
  }

  async initialize() {
    const loadedConfig = await this.store.load();
    Object.assign(this.config, loadedConfig);
    this.providerService.config = this.config;
    this.providerService.builtin.config = this.config;
    this.history = this.store.loadHistory();
    this.state.providerOptions = await this.providerService.refresh();
    this.ready = true;
    this.emit();
    if (this.isFirstUse()) this.showConfigPanel();
    this.processPendingPluginEnter();
    return this.state;
  }

  isFirstUse() {
    return !this.config.ocrProviderId || !this.config.translationProviderId;
  }

  // Kept for compatibility with the previous DOM controller and unit consumers.
  initElements() {
    const doc = this.win?.document;
    if (doc?.getElementById) {
      this.preview = doc.getElementById('preview');
      this.previewImg = doc.getElementById('previewImg');
      this.dropArea = doc.getElementById('dropArea');
      this.resultText = doc.getElementById('resultText');
      this.translateResult = doc.getElementById('translateResult');
      this.configPanel = doc.getElementById('configPanel');
    }
    this.ready = true;
    this.history = this.store.loadHistory();
    this.emit();
    return this;
  }

  bindEvents() {
    const doc = this.win?.document;
    if (!doc?.addEventListener) return;
    doc.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (this.getResultValue().trim()) this.confirmResult();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        this.clearAll();
      }
    });
  }

  onPluginEnter(param) {
    if (!this.ready) {
      this.pendingPluginEnter = param;
      return;
    }
    return this.handlePluginEnter(param);
  }

  processPendingPluginEnter() {
    if (!this.pendingPluginEnter || !this.ready) return;
    const pending = this.pendingPluginEnter;
    this.pendingPluginEnter = null;
    return this.handlePluginEnter(pending);
  }

  setStatus(message) {
    this.state.status = message || '';
    if (this.status) this.status.textContent = this.state.status;
    this.emit();
  }

  showStatus(message) {
    this.setStatus(message);
  }

  setInputMode(mode) {
    this.state.imageUrl = '';
    this.state.resultText = '';
    this.state.translateResult = '';
    this.state.showImage = false;
    this.state.showResult = false;
    this.state.showTranslateResult = false;
    this.state.mode = mode;
    this.state.showTranslationInput = mode === 'translate';
    this.state.showUpload = mode !== 'translate';
    this.emit();
  }

  showTranslationInputPanel() {
    this.state.showUpload = false;
    this.state.showImage = false;
    this.state.showResult = false;
    this.state.showTranslateResult = false;
    this.state.showTranslationInput = true;
    this.emit();
  }

  showDropArea() {
    this.state.showUpload = true;
    this.state.showTranslationInput = this.state.mode === 'translate';
    this.emit();
  }

  showConfigPanel() {
    this.state.showConfig = true;
    if (this.configPanel?.style) this.configPanel.style.display = 'block';
    this.emit();
  }

  hideConfigPanel() {
    this.state.showConfig = false;
    if (this.configPanel?.style) this.configPanel.style.display = 'none';
    this.emit();
  }

  async handlePluginEnter(param = {}) {
    const code = param.code || '';
    const type = param.type || '';
    const payload = typeof param.payload === 'string'
      ? param.payload
      : typeof param.text === 'string'
        ? param.text
        : '';

    if (code === 'screenshot' || code === 'screenshot-ocr' || code === 'screenshot-annotate') {
      this.setInputMode('edit');
      return this.handleScreenshotOCR();
    }

    if (code === 'edit-image' || code === 'edit') {
      this.setInputMode('edit');
      if (type === 'img' && payload) return this.openEditor(payload, { returnInput: false });
      this.showDropArea();
      return;
    }

    if (code === 'ocr' || code === 'image-ocr') {
      this.setInputMode('ocr');
      if (type === 'img' && payload) return this.processImageUrlAutoExit(payload);
      return this.handleOCRMain();
    }

    if (code === 'setup' || code === 'settings') {
      this.setInputMode('ocr');
      this.showDropArea();
      this.showConfigPanel();
      return;
    }

    if (code === 'translate' || code === 'translate-text') {
      this.setInputMode('translate');
      if ((type === 'text' || type === 'over' || !type) && payload) {
        this.state.translationInput = payload;
        this.emit();
        return this.translateTextInput();
      }
      this.state.translationInput = '';
      this.showTranslationInputPanel();
    }
  }

  handleScreenshotOCR() {
    if (typeof this.onScreenshotRequest === 'function') {
      return this.onScreenshotRequest();
    }
    this.setStatus('正在唤起截图功能...');
    this.captureScreen((imageUrl) => {
      if (imageUrl) this.openEditor(imageUrl, { fromScreenshot: true });
      else this.setStatus('已取消截图');
    });
  }

  async handleOCRMain() {
    const imageUrl = await this.readClipboardImage();
    if (!imageUrl) {
      this.showDropArea();
      return null;
    }
    return this.processImageUrlAutoExit(imageUrl);
  }

  async readClipboardImage() {
    try {
      const clipboard = getNavigator(this.win)?.clipboard;
      if (!clipboard?.read) return null;
      const items = await clipboard.read();
      for (const item of items) {
        const imageType = item.types?.find((type) => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          return URL.createObjectURL(blob);
        }
      }
    } catch (error) {
      console.warn('读取剪贴板图片失败:', error);
    }
    return null;
  }

  captureScreen(callback) {
    const capture = this.win?.ztools?.screenCapture || this.win?.utools?.screenCapture;
    if (typeof capture !== 'function') {
      this.setStatus('当前环境不支持截图功能');
      return;
    }
    capture(callback);
  }

  openEditor(imageUrl, options = {}) {
    if (!imageUrl) {
      this.setStatus('请先选择图片');
      return false;
    }
    if (typeof this.onEditRequest === 'function') {
      this.onEditRequest(imageUrl, options);
      return true;
    }
    this.setStatus('编辑器暂不可用');
    return false;
  }

  processImageUrl(url) {
    this.state.imageUrl = url || '';
    this.state.showImage = Boolean(url);
    this.state.showUpload = !url;
    if (url && this.state.mode === 'ocr') this.state.showResult = true;
    if (url && this.previewImg) {
      this.previewImg.src = url;
      this.preview?.classList?.add('show');
    }
    this.emit();
  }

  processImageUrlAutoExit(url) {
    this.processImageUrl(url);
    return this.recognizeAndUpdate(url);
  }

  async handleFile(file) {
    if (!file || !file.type?.startsWith('image/')) {
      this.setStatus('请选择图片文件');
      return false;
    }
    const imageUrl = await this.fileToDataUrl(file);
    if (this.state.mode === 'edit') {
      this.openEditor(imageUrl, { returnInput: false });
      return true;
    }
    this.processImageUrl(imageUrl);
    await this.recognizeAndUpdate(imageUrl);
    return true;
  }

  async fileToDataUrl(file) {
    if (typeof FileReader === 'function') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${file.type};base64,${btoa(binary)}`;
  }

  async recognize(imageUrl) {
    this.providerService.config = this.config;
    this.providerService.builtin.config = this.config;
    return this.providerService.invoke('ocr', { image: imageUrl }, this.config.ocrProviderId);
  }

  async recognizeByBaidu(imageUrl) {
    return this.providerService.builtin.recognizeByBaidu(imageUrl);
  }

  async recognizeByAli(imageUrl) {
    return this.providerService.builtin.recognizeByAli(imageUrl);
  }

  async recognizeAndUpdate(imageUrl, { autoTranslate = false } = {}) {
    if (!imageUrl) return '';
    this.state.showTranslateResult = false;
    this.state.translateResult = '';
    this.state.translationInput = '';
    this.processImageUrl(imageUrl);
    this.state.busy = true;
    this.state.busyLabel = '正在识别';
    this.setStatus('正在识别...');
    try {
      const text = await this.recognize(imageUrl);
      this.setResultValue(text || '');
      this.state.showResult = true;
      if (!text?.trim()) {
        this.setStatus('未识别出文字，可手动输入');
      } else if (autoTranslate) {
        await this.translateAndUpdate(text);
      } else {
        this.setStatus('识别完成，请编辑确认');
      }
      return text || '';
    } catch (error) {
      this.setStatus(`识别失败: ${errorMessage(error)}`);
      if (errorMessage(error).includes('Provider') || errorMessage(error).includes('密钥')) {
        this.showConfigPanel();
      }
      return '';
    } finally {
      this.state.busy = false;
      this.state.busyLabel = '';
      this.emit();
    }
  }

  async recognizeAndUpdateAutoExit(imageUrl) {
    return this.recognizeAndUpdate(imageUrl);
  }

  recognizeAgain(imageUrl = this.state.imageUrl) {
    return this.recognizeAndUpdate(imageUrl);
  }

  getResultValue() {
    return typeof this.resultText === 'object' && this.resultText
      ? this.resultText.value || ''
      : this.state.resultText || '';
  }

  setResultValue(value) {
    this.state.resultText = value || '';
    if (typeof this.resultText === 'object' && this.resultText) this.resultText.value = this.state.resultText;
    this.emit();
  }

  getTranslateValue() {
    return typeof this.translateResult === 'object' && this.translateResult
      ? this.translateResult.value || ''
      : this.state.translateResult || '';
  }

  setTranslateValue(value) {
    this.state.translateResult = value || '';
    if (typeof this.translateResult === 'object' && this.translateResult) this.translateResult.value = this.state.translateResult;
    this.emit();
  }

  copyResultText(text) {
    const copyText = this.win?.ztools?.copyText || this.win?.utools?.copyText;
    if (typeof copyText === 'function') return copyText(text);
    const clipboard = getNavigator(this.win)?.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(text).catch(() => {});
      return true;
    }
    try {
      const doc = this.win?.document;
      const textarea = doc?.createElement?.('textarea');
      if (!textarea) return false;
      textarea.value = text;
      doc.body.appendChild(textarea);
      textarea.select();
      const success = doc.execCommand('copy');
      textarea.remove();
      return success;
    } catch {
      return false;
    }
  }

  copyResult() {
    const text = this.getResultValue().trim();
    if (!text) {
      this.setStatus('没有可复制的内容');
      return false;
    }
    const success = this.copyResultText(text);
    this.setStatus(success ? '已复制到剪贴板' : '复制失败');
    return success;
  }

  copyTranslateResult() {
    const text = this.getTranslateValue().trim();
    if (!text) {
      this.setStatus('没有可复制的翻译内容');
      return false;
    }
    const success = this.copyResultText(text);
    this.setStatus(success ? '翻译内容已复制到剪贴板' : '复制失败');
    return success;
  }

  confirmResult() {
    const text = this.getResultValue().trim();
    if (!text) {
      this.setStatus('没有可复制的内容');
      return false;
    }
    const success = this.copyResultText(text);
    if (success) {
      this.saveHistory(text);
      this.setStatus('已复制到剪贴板');
    } else {
      this.setStatus('复制失败，请手动复制');
    }
    return success;
  }

  async translate(text, fromLang = this.config.sourceLang, toLang = this.config.targetLang) {
    const normalized = String(text || '').trim();
    if (!normalized) throw new Error('没有可翻译的内容');
    this.providerService.config = this.config;
    this.providerService.builtin.config = this.config;
    return this.providerService.invoke('translation', {
      text: normalized,
      from: fromLang,
      to: toLang
    }, this.config.translationProviderId);
  }

  getTranslationLanguageOptions(direction = 'target', providerId = this.config.translationProviderId) {
    return this.providerService.getTranslationLanguageOptions(providerId, direction);
  }

  async translateByBaidu(text, fromLang, toLang) {
    return this.providerService.builtin.translateByBaidu(text, fromLang, toLang);
  }

  async translateByAli(text, fromLang, toLang) {
    return this.providerService.builtin.translateByAli(text, fromLang, toLang);
  }

  async translateByMyMemory(text, fromLang, toLang) {
    return this.providerService.builtin.translateByMyMemory(text, fromLang, toLang);
  }

  async translateAndUpdate(text = this.getResultValue()) {
    const source = String(text || '').trim();
    if (!source) {
      this.setStatus('没有可翻译的内容');
      return '';
    }
    this.state.busy = true;
    this.state.busyLabel = '正在翻译';
    this.setStatus('正在翻译...');
    try {
      const result = await this.translate(source, this.config.sourceLang, this.config.targetLang);
      this.state.translationInput = source;
      this.setTranslateValue(result || '');
      this.state.showTranslateResult = true;
      this.setStatus('翻译完成');
      return result || '';
    } catch (error) {
      this.setStatus(`翻译失败: ${errorMessage(error)}`);
      if (errorMessage(error).includes('Provider') || errorMessage(error).includes('密钥')) {
        this.showConfigPanel();
      }
      return '';
    } finally {
      this.state.busy = false;
      this.state.busyLabel = '';
      this.emit();
    }
  }

  async translateTextInput() {
    return this.translateAndUpdate(this.state.translationInput);
  }

  setTranslationInput(value) {
    this.state.translationInput = value || '';
    this.emit();
  }

  async handleEditedImage(imageUrl, action) {
    if (!imageUrl) return;
    this.setInputMode('ocr');
    this.state.showTranslationInput = false;
    await this.recognizeAndUpdate(imageUrl, { autoTranslate: action === 'translate' });
  }

  async loadConfig() {
    const config = await this.store.load();
    Object.assign(this.config, config);
    this.providerService.config = this.config;
    this.providerService.builtin.config = this.config;
    this.emit();
    return this.config;
  }

  async saveConfig(patchOrAutoClose = true, autoClose = true) {
    const isPatch = patchOrAutoClose && typeof patchOrAutoClose === 'object';
    const shouldClose = isPatch ? autoClose !== false : patchOrAutoClose !== false;
    if (isPatch) Object.assign(this.config, patchOrAutoClose);

    if (!isPatch) this.readLegacyConfigInputs();
    if (this.sourceLangSelect?.value) this.config.sourceLang = this.sourceLangSelect.value;
    if (this.targetLangSelect?.value) this.config.targetLang = this.targetLangSelect.value;

    try {
      await this.store.save(this.config);
      this.baiduAccessToken = null;
      this.baiduTokenExpireTime = 0;
      this.setStatus('配置保存成功');
      if (shouldClose) this.hideConfigPanel();
      return true;
    } catch (error) {
      this.setStatus(`配置保存失败: ${errorMessage(error)}`);
      return false;
    }
  }

  readLegacyConfigInputs() {
    const fields = [
      'baiduAk', 'baiduSk', 'aliAk', 'aliSk',
      'baiduTranslateAppId', 'baiduTranslateSecretKey', 'myMemoryKey'
    ];
    for (const field of fields) {
      const input = this[`${field}Input`];
      if (input?.value !== undefined) this.config[field] = input.value.trim();
    }
    if (this.ocrProviderSelect?.value) this.config.ocrProviderId = this.ocrProviderSelect.value;
    if (this.translationProviderSelect?.value) this.config.translationProviderId = this.translationProviderSelect.value;
    if (this.syncSecretsInput?.checked !== undefined) this.config.syncSecrets = this.syncSecretsInput.checked;
  }

  async testConfig() {
    await this.saveConfig(false);
    this.setStatus('正在测试配置...');
    const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    try {
      await this.recognize(testImage);
      this.setStatus('配置测试成功');
      return true;
    } catch (error) {
      this.setStatus(`配置测试失败: ${errorMessage(error)}`);
      return false;
    }
  }

  loadHistory() {
    this.history = this.store.loadHistory();
    this.emit();
    return this.history;
  }

  saveHistory(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return false;
    this.history = [
      { text: normalized, timestamp: Date.now() },
      ...this.history.filter((item) => item.text !== normalized)
    ].slice(0, 50);
    this.store.saveHistory(this.history);
    this.emit();
    return true;
  }

  renderHistory() {
    this.emit();
  }

  toggleHistory() {
    this.historyExpanded = !this.historyExpanded;
    this.emit();
  }

  clearHistory() {
    this.history = [];
    this.store.clearHistory();
    this.setStatus('历史记录已清空');
  }

  copyHistoryItem(item) {
    const text = typeof item === 'string' ? item : item?.text;
    if (!text) return false;
    const success = this.copyResultText(text);
    this.setStatus(success ? '已复制到剪贴板' : '复制失败');
    return success;
  }

  clearAll() {
    this.state.imageUrl = '';
    this.state.resultText = '';
    this.state.translateResult = '';
    this.state.translationInput = '';
    this.state.showImage = false;
    this.state.showResult = false;
    this.state.showTranslateResult = false;
    this.state.showUpload = this.state.mode !== 'translate';
    this.state.showTranslationInput = this.state.mode === 'translate';
    if (this.resultText?.value !== undefined) this.resultText.value = '';
    if (this.previewImg) this.previewImg.src = '';
    this.setStatus('');
  }

  swapLanguages() {
    if (this.config.sourceLang === 'auto') return;
    const source = this.config.sourceLang;
    this.config.sourceLang = this.config.targetLang;
    this.config.targetLang = source;
    this.emit();
    return this.saveConfig(false);
  }

  exitPlugin() {
    if (typeof this.win?.ztools?.outPlugin === 'function') this.win.ztools.outPlugin(false);
    else if (typeof this.win?.utools?.hideMainWindow === 'function') this.win.utools.hideMainWindow();
  }

  md5(value) {
    return md5(value);
  }
}

export { DEFAULT_CONFIG, STORAGE_KEYS };
