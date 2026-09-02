/**
 * UIManager - UI 管理器（ZTools 客户端）
 *
 * 负责视图切换、模态框、加载状态、统计、侧边栏等所有 DOM 操作。
 * 业务逻辑委托给 EmotionService / SettingsService / SearchService。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class UIManager {
  constructor(deps = {}) {
    this.emotionService = deps.emotionService;
    this.settingsService = deps.settingsService;
    this.searchService = deps.searchService;
    this.themeManager = deps.themeManager;
    this.notification = deps.notification;

    this.currentView = 'home';
    this.currentTab = 'mine';
    this.currentEmotion = null;
    this.imageObserver = null;
    this.sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    this.loadingCount = 0;
    this._scrollBound = false;
    this.searchKeyword = '';
  }

  // ─────────────── ZTools 子输入框 ───────────────

  setupSubInput() {
    if (typeof ztools !== 'undefined' && ztools.setSubInput) {
      ztools.setSubInput((data) => {
        this.searchKeyword = data.text.trim();
        if (this.currentTab === 'mine') {
          this.searchEmotions(this.searchKeyword);
        } else {
          if (this.searchKeyword) {
            this.handleExternalSearch(this.searchKeyword);
          } else {
            const er = document.getElementById('externalResults');
            if (er) { er.style.display = 'block'; er.innerHTML = '<p class="hint-text">请输入关键词进行搜索</p>'; }
          }
        }
      }, '搜索表情包...');
    }
  }

  showLoading(message = '加载中...') {
    this.loadingCount++;
    let el = document.getElementById('loadingOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loadingOverlay';
      el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span class="loading-text"></span></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.loading-text').textContent = message;
    el.style.display = 'flex';
  }

  hideLoading() {
    this.loadingCount--;
    if (this.loadingCount <= 0) {
      this.loadingCount = 0;
      const el = document.getElementById('loadingOverlay');
      if (el) el.style.display = 'none';
    }
  }

  initSidebarState() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('sidebarCollapseBtn');
    const icon = document.getElementById('collapseIcon');
    if (this.sidebarCollapsed) { sidebar.classList.add('collapsed'); icon.className = 'mdi mdi-menu-right'; }
    btn.addEventListener('click', () => this.toggleSidebar());
  }

  toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const icon = document.getElementById('collapseIcon');
    this.sidebarCollapsed = !this.sidebarCollapsed;
    sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
    icon.className = this.sidebarCollapsed ? 'mdi mdi-menu-right' : 'mdi mdi-menu-left';
    localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed);
  }

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const tv = document.getElementById(`${viewName}View`);
    if (tv) tv.classList.add('active');
    const ni = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (ni) ni.classList.add('active');
    this.renderView(viewName);
  }

  switchSettingsPanel(panelName) {
    document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    const ni = document.querySelector(`.settings-nav-item[data-settings="${panelName}"]`);
    if (ni) ni.classList.add('active');
    const panel = document.getElementById(`settings${panelName.charAt(0).toUpperCase() + panelName.slice(1)}`);
    if (panel) panel.classList.add('active');
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tb = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (tb) tb.classList.add('active');
    this.clearContent();
    if (tabName === 'mine') {
      this.renderEmotions(this.searchService.searchLocal(this.searchKeyword));
    } else {
      this.searchService.setActiveSource(tabName);
      if (this.searchKeyword) { this.handleExternalSearch(this.searchKeyword); }
      else {
        const er = document.getElementById('externalResults');
        er.style.display = 'block';
        er.innerHTML = '<p class="hint-text">请输入关键词进行搜索</p>';
      }
    }
  }

  clearContent() {
    const g = document.getElementById('emotionGrid');
    const e = document.getElementById('externalResults');
    const s = document.getElementById('emptyState');
    if (g) { g.style.display = 'none'; g.innerHTML = ''; }
    if (e) { e.style.display = 'none'; e.innerHTML = ''; }
    if (s) { s.style.display = 'none'; }
  }

  showModal(id) {
    document.getElementById(id).style.display = 'block';
    if (id === 'addModal') this.updateStorageHint();
  }

  hideModal(modal) {
    if (typeof modal === 'string') modal = document.getElementById(modal);
    if (modal) modal.style.display = 'none';
  }

  updateStats() {
    const s = this.emotionService.getStats();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('totalCount', s.total);
    set('cloudCount', s.cloud);
    set('localCount', s.local);
  }

  renderView(viewName) {
    switch (viewName) {
      case 'home': this.renderEmotions(this.emotionService.getAllEmotions()); break;
      case 'local': this.renderLocalView(); break;
      case 'cloud': this.renderCloudView(); break;
      case 'settings': this.loadSettingsToForm(); break;
    }
    this.updateStats();
  }

  renderAllViews() {
    this.renderEmotions(this.emotionService.getAllEmotions());
    this.renderLocalView();
    this.renderCloudView();
    this.updateStats();
  }

  initImageLazyLoading() {
    this.imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) { img.src = img.dataset.src; img.classList.remove('lazy'); }
          this.imageObserver.unobserve(img);
        }
      });
    }, { rootMargin: '100px', threshold: 0.1 });
  }

  observeImages() {
    if (!this.imageObserver) this.initImageLazyLoading();
    document.querySelectorAll('img.lazy[data-src]').forEach(img => this.imageObserver.observe(img));
  }

  _renderEmotionCard(emotion) {
    const imgSrc = this.emotionService.getImageSrc(emotion);
    const fallback = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzc3NyIgPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
    const si = emotion.storageType === 'cloud' ? 'cloud' : 'folder';
    return '<div class="emotion-card" data-emotion-id="' + emotion.id + '">' +
      '<div class="storage-icon ' + emotion.storageType + '"><i class="mdi mdi-' + si + '"></i></div>' +
      '<div class="copy-overlay"><button class="copy-btn" data-emotion-id="' + emotion.id + '"><i class="mdi mdi-content-copy"></i><span>复制</span></button></div>' +
      '<img data-src="' + imgSrc + '" class="lazy" alt="表情包" data-emotion-id="' + emotion.id + '" onerror="this.src=\'' + fallback + '\'">' +
      '<div class="tags">' + emotion.tags.slice(0, 3).map(t => '<span class="tag">' + HtmlUtils.escapeHtml(t) + '</span>').join('') +
      (emotion.tags.length > 3 ? '<span class="tag">+' + (emotion.tags.length - 3) + '</span>' : '') + '</div></div>';
  }

  _bindCardEvents(grid, emotions) {
    grid.querySelectorAll('.emotion-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.closest('.copy-btn')) {
          const em = emotions.find(m => m.id === card.dataset.emotionId);
          if (em) this.showEmotionDetail(em);
        }
      });
    });
    grid.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const em = emotions.find(m => m.id === btn.dataset.emotionId);
        if (em) this.copyEmotionImage(em);
      });
    });
  }

  renderEmotions(emotions) {
    const grid = document.getElementById('emotionGrid');
    const ext = document.getElementById('externalResults');
    const empty = document.getElementById('emptyState');
    if (!grid || !ext || !empty) return;
    ext.style.display = 'none';
    if (!emotions.length) { grid.style.display = 'none'; empty.style.display = 'block'; return; }
    grid.style.display = 'grid'; empty.style.display = 'none';
    grid.innerHTML = emotions.map(e => this._renderEmotionCard(e)).join('');
    this.observeImages();
    this._bindCardEvents(grid, emotions);
  }

  renderLocalView() {
    const grid = document.getElementById('localEmotionGrid');
    const empty = document.getElementById('localEmptyState');
    const emotions = this.emotionService.emotions.local;
    if (!grid || !empty) return;
    if (!emotions.length) { grid.style.display = 'none'; empty.style.display = 'block'; return; }
    grid.style.display = 'grid'; empty.style.display = 'none';
    grid.innerHTML = emotions.map(e => this._renderEmotionCard(e)).join('');
    this.observeImages();
    this._bindCardEvents(grid, emotions);
  }

  renderCloudView() {
    const grid = document.getElementById('cloudEmotionGrid');
    const empty = document.getElementById('cloudEmptyState');
    const emotions = this.emotionService.emotions.cloud;
    if (!grid || !empty) return;
    if (!emotions.length) { grid.style.display = 'none'; empty.style.display = 'block'; return; }
    grid.style.display = 'grid'; empty.style.display = 'none';
    grid.innerHTML = emotions.map(e => this._renderEmotionCard(e)).join('');
    this.observeImages();
    this._bindCardEvents(grid, emotions);
  }

  showEmotionDetail(emotion) {
    this.currentEmotion = emotion;
    const lw = document.getElementById('localImageWrapper');
    const cw = document.getElementById('cloudImageWrapper');
    const li = document.getElementById('modalLocalImage');
    const ci = document.getElementById('modalCloudImage');
    if (lw) lw.style.display = 'none';
    if (cw) cw.style.display = 'none';
    if (emotion.storageType === 'cloud') {
      if (ci) ci.src = emotion.url;
      if (cw) cw.style.display = 'block';
      const p = this.emotionService.findPairedEmotion(emotion, 'local');
      if (p) { if (li) li.src = p.url; if (lw) lw.style.display = 'block'; }
    } else {
      if (li) li.src = emotion.url;
      if (lw) lw.style.display = 'block';
      const p = this.emotionService.findPairedEmotion(emotion, 'cloud');
      if (p) { if (ci) ci.src = p.url; if (cw) cw.style.display = 'block'; }
    }
    const badge = document.getElementById('storageBadge');
    if (badge) {
      badge.className = 'storage-badge ' + emotion.storageType;
      const bIcon = badge.querySelector('.badge-icon');
      if (bIcon) bIcon.className = 'badge-icon mdi mdi-' + (emotion.storageType === 'cloud' ? 'cloud' : 'folder');
      const bText = badge.querySelector('.badge-text');
      if (bText) bText.textContent = emotion.storageType === 'cloud' ? '云端存储' : '本地存储';
    }
    const cb = document.getElementById('convertBtn');
    if (cb) {
      const hp = emotion.storageType === 'cloud'
        ? this.emotionService.findPairedEmotion(emotion, 'local')
        : this.emotionService.findPairedEmotion(emotion, 'cloud');
      if (hp) {
        cb.innerHTML = '<i class="mdi mdi-' + (emotion.storageType === 'cloud' ? 'folder-download' : 'cloud-upload') + '"></i><span>' + (emotion.storageType === 'cloud' ? '保存到本地' : '上传到云端') + '</span>';
        cb.disabled = false;
      } else {
        cb.innerHTML = '<i class="mdi mdi-' + (emotion.storageType === 'cloud' ? 'folder-download' : 'cloud-upload') + '"></i><span>' + (emotion.storageType === 'cloud' ? '保存到本地' : '上传到云端') + '</span>';
        cb.disabled = false;
      }
    }

    // 删除下拉菜单：根据是否有配对动态设置选项
    const paired = emotion.storageType === 'cloud'
      ? this.emotionService.findPairedEmotion(emotion, 'local')
      : this.emotionService.findPairedEmotion(emotion, 'cloud');
    const deleteCurrentLabel = document.getElementById('deleteCurrentLabel');
    const deletePairedBtn = document.getElementById('deletePairedBtn');
    const deleteBothBtn = document.getElementById('deleteBothBtn');
    const deletePairedLabel = document.getElementById('deletePairedLabel');
    if (deleteCurrentLabel) {
      deleteCurrentLabel.textContent = emotion.storageType === 'cloud' ? '仅删除云端' : '仅删除本地';
    }
    if (paired) {
      if (deletePairedBtn) deletePairedBtn.style.display = 'flex';
      if (deleteBothBtn) deleteBothBtn.style.display = 'flex';
      if (deletePairedLabel) {
        deletePairedLabel.textContent = emotion.storageType === 'cloud' ? '仅删除本地' : '仅删除云端';
      }
    } else {
      if (deletePairedBtn) deletePairedBtn.style.display = 'none';
      if (deleteBothBtn) deleteBothBtn.style.display = 'none';
    }
    const tl = document.getElementById('tagList');
    const te = document.getElementById('tagEditor');
    const eb = document.getElementById('editTagsBtn');
    if (tl) tl.innerHTML = emotion.tags.map(t => '<span class="tag">' + HtmlUtils.escapeHtml(t) + '</span>').join('');
    if (te) te.style.display = 'none';
    if (tl) tl.style.display = 'flex';
    if (eb) eb.innerHTML = '<i class="mdi mdi-tag"></i><span>编辑标签</span>';
    this.showModal('emotionModal');
  }

  toggleEditMode() {
    const tl = document.getElementById('tagList');
    const te = document.getElementById('tagEditor');
    const tic = document.getElementById('tagInputContainer');
    const tin = document.getElementById('tagInputNew');
    const eb = document.getElementById('editTagsBtn');
    if (te.style.display === 'none') {
      tl.style.display = 'none'; te.style.display = 'block';
      tic.innerHTML = this.currentEmotion.tags.map((t, i) =>
        '<span class="tag" data-index="' + i + '" data-tag="' + HtmlUtils.escapeHtml(t) + '">' + HtmlUtils.escapeHtml(t) +
        '<i class="mdi mdi-close remove-tag-btn" data-index="' + i + '"></i></span>'
      ).join('');
      tic.querySelectorAll('.remove-tag-btn').forEach(b => {
        b.addEventListener('click', (e) => this.removeTagFromEditor(parseInt(e.target.dataset.index)));
      });
      tin.value = ''; tin.focus();
      tin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addTagFromInput(); } });
      eb.innerHTML = '<i class="mdi mdi-content-save"></i> 保存标签';
    } else {
      this.saveTags();
    }
  }

  removeTagFromEditor(index) {
    const tic = document.getElementById('tagInputContainer');
    const tags = tic.querySelectorAll('.tag');
    if (tags[index]) {
      tags[index].remove();
      tic.querySelectorAll('.tag').forEach((t, i) => { t.dataset.index = i; t.querySelector('.remove-tag-btn').dataset.index = i; });
    }
  }

  addTagFromInput() {
    const tin = document.getElementById('tagInputNew');
    const tic = document.getElementById('tagInputContainer');
    const nt = tin.value.trim();
    if (nt) {
      const cc = tic.querySelectorAll('.tag').length;
      const el = document.createElement('span');
      el.className = 'tag'; el.dataset.index = cc; el.dataset.tag = HtmlUtils.escapeHtml(nt);
      el.innerHTML = HtmlUtils.escapeHtml(nt) + '<i class="mdi mdi-close remove-tag-btn" data-index="' + cc + '"></i>';
      el.querySelector('.remove-tag-btn').addEventListener('click', (e) => this.removeTagFromEditor(parseInt(e.target.dataset.index)));
      tic.appendChild(el); tin.value = ''; tin.focus();
    }
  }

  async saveTags() {
    const tic = document.getElementById('tagInputContainer');
    const tags = Array.from(tic.querySelectorAll('.tag')).map(t => t.dataset.tag || t.textContent.trim());
    if (!tags.length) { this.notification.showMessage('至少需要一个标签', 'error'); return; }
    this.currentEmotion.tags = tags;
    this.emotionService.updateEmotion(this.currentEmotion);
    await this.emotionService.saveData();
    this.renderAllViews();
    document.getElementById('tagList').innerHTML = tags.map(t => '<span class="tag">' + HtmlUtils.escapeHtml(t) + '</span>').join('');
    document.getElementById('tagEditor').style.display = 'none';
    document.getElementById('tagList').style.display = 'flex';
    document.getElementById('editTagsBtn').innerHTML = '<i class="mdi mdi-tag"></i> 编辑标签';
    this.notification.showMessage('标签已更新', 'success');
  }

  async copyEmotionToClipboard() { if (this.currentEmotion) await this.copyEmotionImage(this.currentEmotion); }

  async copyEmotionImage(emotion) {
    try { await this.emotionService.copyToClipboard(emotion); this.notification.showMessage('已复制到剪贴板', 'success'); }
    catch (e) { this.notification.showMessage(e.message, 'error'); }
  }

  toggleDeleteDropdown() {
    const dd = document.querySelector('.delete-dropdown');
    if (dd) dd.classList.toggle('open');
  }

  closeDeleteDropdown() {
    const dd = document.querySelector('.delete-dropdown');
    if (dd) dd.classList.remove('open');
  }

  async deleteCurrentEmotion(action) {
    if (!this.currentEmotion) return;
    this.closeDeleteDropdown();

    const emotion = this.currentEmotion;
    const dl = this.settingsService.settings.deleteLocalFile;

    if (action === 'current') {
      const label = emotion.storageType === 'cloud' ? '云端' : '本地';
      if (!confirm('确定要删除' + label + '的表情包吗？')) return;
      await this.emotionService.deleteEmotion(emotion, dl);
      this.renderAllViews();
      this.hideModal('emotionModal');
      this.notification.showMessage('已删除' + label + '表情包', 'success');
    } else if (action === 'paired') {
      const targetType = emotion.storageType === 'cloud' ? 'local' : 'cloud';
      const label = targetType === 'cloud' ? '云端' : '本地';
      if (!confirm('确定要删除' + label + '的表情包吗？')) return;
      await this.emotionService.deletePairedEmotion(emotion, targetType, dl);
      this.renderAllViews();
      this.hideModal('emotionModal');
      this.notification.showMessage('已删除' + label + '表情包', 'success');
    } else if (action === 'both') {
      if (!confirm('确定要删除本地和云端的表情包吗？')) return;
      const targetType = emotion.storageType === 'cloud' ? 'local' : 'cloud';
      await this.emotionService.deletePairedEmotion(emotion, targetType, dl);
      await this.emotionService.deleteEmotion(emotion, dl);
      this.renderAllViews();
      this.hideModal('emotionModal');
      this.notification.showMessage('表情包已全部删除', 'success');
    } else {
      if (!confirm('确定要删除这个表情包吗？')) return;
      await this.emotionService.deleteEmotion(emotion, dl);
      this.renderAllViews();
      this.hideModal('emotionModal');
      this.notification.showMessage('表情包已删除', 'success');
    }
  }

  async convertCurrentEmotionStorage() {
    if (!this.currentEmotion) return;
    try {
      this.notification.showMessage('正在转换...', 'info');
      const wasCloud = this.currentEmotion.storageType === 'cloud';
      const newEmotion = await this.emotionService.convertStorage(this.currentEmotion, (m) => this.notification.showMessage(m, 'info'));
      this.renderAllViews();
      this.showEmotionDetail(newEmotion);
      this.notification.showMessage(wasCloud ? '表情包已保存到本地' : '表情包已上传到云端', 'success');
    } catch (e) { this.notification.showMessage('转换失败: ' + e.message, 'error'); }
  }

  async handleAddEmotion() {
    const urlInput = document.getElementById('imageUrl');
    const fileInput = document.getElementById('localImage');
    const url = urlInput.value.trim();
    const tags = this.getTagsFromInputs();
    const activeSourceTab = document.querySelector('.source-tab.active');
    const sourceType = activeSourceTab ? activeSourceTab.dataset.source : 'url';
    if (!tags.length) { this.notification.showMessage('请至少添加一个标签', 'error'); return; }
    const ss = this._getSelectedStorage();
    const hint = this.settingsService.settings.getConfigHint(ss);
    if (hint) { this.notification.showMessage(hint, 'error'); return; }
    try {
      if (sourceType === 'url') {
        if (!url) { this.notification.showMessage('请输入图片URL', 'error'); return; }
        const resp = await this.searchService.http.fetchWithTimeout(url, { method: 'HEAD' });
        if (!resp.ok) throw new Error('图片URL无效');
        const ct = resp.headers.get('content-type');
        if (!ct || !ct.startsWith('image/')) throw new Error('URL不是图片格式');
        this.notification.showMessage('正在处理图片...', 'info');
        await this.emotionService.addFromUrl(url, tags[0], ss, (m) => this.notification.showMessage(m, 'info'));
      } else {
        if (!fileInput.files[0]) { this.notification.showMessage('请选择要上传的图片', 'error'); return; }
        this.notification.showMessage('正在处理...', 'info');
        await this.emotionService.addFromFile(fileInput.files[0], tags, ss, (m) => this.notification.showMessage(m, 'info'));
      }
      this.renderAllViews();
      this.hideModal('addModal');
      urlInput.value = '';
      fileInput.value = '';
      this.resetTagsInputs();
      this.notification.showMessage('表情包添加成功', 'success');
    } catch (e) { this.notification.showMessage('添加失败: ' + e.message, 'error'); }
  }

  async addFromUrlLocal(url, keyword) {
    try {
      this.notification.showMessage('正在下载图片到本地...', 'info');
      await this.emotionService.addFromUrl(url, keyword, 'local', (m) => this.notification.showMessage(m, 'info'));
      this.updateStats();
      this.notification.showMessage('表情包下载成功', 'success');
    } catch (e) { this.notification.showMessage('下载失败: ' + e.message, 'error'); }
  }

  async addFromUrlCloud(url, keyword) {
    try {
      this.notification.showMessage('正在上传图片到云端...', 'info');
      await this.emotionService.addFromUrl(url, keyword, 'cloud', (m) => this.notification.showMessage(m, 'info'));
      this.updateStats();
      this.notification.showMessage('表情包上传成功', 'success');
    } catch (e) { this.notification.showMessage('上传失败: ' + e.message, 'error'); }
  }

  handleSearch() {
    if (this.currentTab === 'mine') { this.renderEmotions(this.searchService.searchLocal(this.searchKeyword)); }
    else { this.handleExternalSearch(this.searchKeyword); }
  }

  async handleExternalSearch(keyword) {
    if (!keyword) { this.notification.showMessage('请输入搜索关键词', 'error'); return; }
    this.searchService.setActiveSource(this.currentTab);
    const er = document.getElementById('externalResults');
    er.style.display = 'block';
    er.innerHTML = '<p class="hint-text">正在搜索...</p>';
    try {
      const result = await this.searchService.search(keyword, 1);
      if (result.images.length > 0) { this._renderExternalResults(result.images, keyword, result.hasMore); this._setupInfiniteScroll(); }
      else { er.innerHTML = '<p class="hint-text">未找到表情包，请尝试其他关键词</p>'; }
    } catch (e) { er.innerHTML = '<p class="hint-text">搜索失败，请稍后重试</p>'; this.notification.showMessage('搜索失败: ' + e.message, 'error'); }
  }

  _renderExternalResults(images, keyword, hasMore) {
    const er = document.getElementById('externalResults');
    er.style.display = 'grid';
    const fb = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzc3NyIgPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
    er.innerHTML = images.map(u => `<div class="result-item" data-url="${u}"><img src="${u}" alt="表情包" onerror="this.src='${fb}'"><div class="search-result-buttons"><button class="add-btn local" onclick="window._emotionApp.addFromUrlLocal('${u}', '${keyword}')"><i class="mdi mdi-folder"></i> 本地</button><button class="add-btn cloud" onclick="window._emotionApp.addFromUrlCloud('${u}', '${keyword}')"><i class="mdi mdi-cloud"></i> 云端</button></div></div>`).join('');
    if (hasMore) { er.innerHTML += '<div class="load-more-container"><button class="load-more-btn" onclick="window._emotionApp.loadMoreExternal()"><i class="mdi mdi-chevron-down"></i> 继续</button></div>'; }
  }

  async loadMoreExternal() {
    const btn = document.querySelector('.load-more-btn');
    if (btn) { btn.classList.add('loading'); btn.querySelector('.mdi').classList.replace('mdi-chevron-down', 'mdi-loading'); }
    try {
      const result = await this.searchService.loadMore();
      if (result && result.images.length > 0) { this._appendExternalResults(result.images, result.keyword, result.hasMore); }
      else if (result && !result.hasMore) { if (btn) btn.closest('.load-more-container').remove(); this.notification.showMessage('没有更多表情包了', 'info'); }
    } catch (e) { this.notification.showMessage('加载更多失败: ' + e.message, 'error'); }
  }

  _appendExternalResults(newImages, keyword, hasMore) {
    const er = document.getElementById('externalResults');
    const lm = er.querySelector('.load-more-container');
    if (lm) lm.remove();
    const fb = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzc3NyIgPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
    newImages.forEach(u => {
      const d = document.createElement('div');
      d.className = 'result-item'; d.dataset.url = u;
      d.innerHTML = `<img src="${u}" alt="表情包" onerror="this.src='${fb}'"><div class="search-result-buttons"><button class="add-btn local" onclick="window._emotionApp.addFromUrlLocal('${u}', '${keyword}')"><i class="mdi mdi-folder"></i> 本地</button><button class="add-btn cloud" onclick="window._emotionApp.addFromUrlCloud('${u}', '${keyword}')"><i class="mdi mdi-cloud"></i> 云端</button></div>`;
      er.appendChild(d);
    });
    if (hasMore) { er.innerHTML += '<div class="load-more-container"><button class="load-more-btn" onclick="window._emotionApp.loadMoreExternal()"><i class="mdi mdi-chevron-down"></i> 继续</button></div>'; }
  }

  _setupInfiniteScroll() {
    const mc = document.querySelector('.main-content');
    if (!mc || this._scrollBound) return;
    this._scrollBound = true;
    mc.addEventListener('scroll', async () => {
      if (this.currentTab === 'mine') return;
      const s = this.searchService.getActiveSource();
      if (!s || !s.hasMore || s.loading) return;
      if (mc.scrollTop + mc.clientHeight >= mc.scrollHeight - 200) { await this.loadMoreExternal(); }
    });
  }

  searchEmotions(keyword) { this.renderEmotions(this.searchService.searchLocal(keyword)); }

  loadSettingsToForm() {
    const s = this.settingsService.settings;
    const tp = s.themePreference || this.themeManager.getUserPreference();
    const tr = document.querySelector(`input[name="theme"][value="${tp}"]`);
    if (tr) tr.checked = true;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('cloudProvider', s.cloudProvider);
    set('localPath', s.localPath);
    set('syncProvider', s.syncConfig?.provider);
    if (s.cloudConfig) { set('s3Endpoint', s.cloudConfig.s3Endpoint); set('s3AccessKey', s.cloudConfig.s3AccessKey); set('s3SecretKey', s.cloudConfig.s3SecretKey); set('s3Bucket', s.cloudConfig.s3Bucket); set('s3Region', s.cloudConfig.s3Region); set('imgbbApiKey', s.cloudConfig.imgbbApiKey); set('tucangToken', s.cloudConfig.tucangToken); set('tucangFolderId', s.cloudConfig.tucangFolderId); }
    if (s.syncConfig) { set('webdavUrl', s.syncConfig.webdavUrl); set('webdavUsername', s.syncConfig.webdavUsername); set('webdavPassword', s.syncConfig.webdavPassword); set('gitRemote', s.syncConfig.gitRemote); }
    const dlf = document.getElementById('deleteLocalFile');
    if (dlf) dlf.checked = s.deleteLocalFile || false;
    this.toggleCloudConfig(s.cloudProvider || 'imgbb');
    this.toggleSyncConfig(s.syncConfig?.provider || 'none');
  }

  async saveSettingsFromForm() {
    const sb = document.getElementById('saveSettingsBtn');
    const oc = sb.innerHTML;
    sb.disabled = true; sb.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i> 保存中...';
    try {
      const s = this.settingsService.settings;
      s.localPath = document.getElementById('localPath').value;
      s.cloudProvider = document.getElementById('cloudProvider').value;
      if (!s.cloudConfig) s.cloudConfig = {};
      if (s.cloudProvider === 'imgbb') { s.cloudConfig.imgbbApiKey = document.getElementById('imgbbApiKey').value; }
      else if (s.cloudProvider === 's3') { s.cloudConfig.s3Endpoint = document.getElementById('s3Endpoint').value; s.cloudConfig.s3AccessKey = document.getElementById('s3AccessKey').value; s.cloudConfig.s3SecretKey = document.getElementById('s3SecretKey').value; s.cloudConfig.s3Bucket = document.getElementById('s3Bucket').value; s.cloudConfig.s3Region = document.getElementById('s3Region').value; }
      else if (s.cloudProvider === 'tucang') { s.cloudConfig.tucangToken = document.getElementById('tucangToken').value; const fi = document.getElementById('tucangFolderId'); s.cloudConfig.tucangFolderId = fi ? parseInt(fi.value) || 0 : 0; }
      await this.settingsService.saveSettings();
      sb.innerHTML = '<i class="mdi mdi-check"></i> 已保存'; sb.classList.add('btn-success');
      setTimeout(() => { sb.innerHTML = oc; sb.classList.remove('btn-success'); sb.disabled = false; }, 2000);
      this.notification.showMessage('设置已保存', 'success');
    } catch (e) {
      sb.innerHTML = '<i class="mdi mdi-alert-circle"></i> 保存失败'; sb.classList.add('btn-danger');
      setTimeout(() => { sb.innerHTML = oc; sb.classList.remove('btn-danger'); sb.disabled = false; }, 2000);
      this.notification.showMessage('保存设置失败: ' + e.message, 'error');
    }
  }

  async saveDeleteLocalFileSetting() {
    const cb = document.getElementById('deleteLocalFile');
    if (cb) { this.settingsService.settings.deleteLocalFile = cb.checked; await this.settingsService.saveSettings(); this.notification.showMessage('设置已保存', 'success'); }
  }

  toggleCloudConfig(provider) {
    const ids = ['s3Config', 'imgbbConfig', 'tucangConfig'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    const map = { 's3': 's3Config', 'imgbb': 'imgbbConfig', 'tucang': 'tucangConfig' };
    const target = document.getElementById(map[provider]);
    if (target) target.style.display = 'block';
  }

  toggleSyncConfig(provider) {
    const wc = document.getElementById('webdavConfig');
    const gc = document.getElementById('gitConfig');
    const sa = document.getElementById('syncActions');
    if (wc) wc.style.display = 'none';
    if (gc) gc.style.display = 'none';
    if (sa) sa.style.display = 'none';
    if (provider === 'webdav') { if (wc) wc.style.display = 'block'; if (sa) sa.style.display = 'flex'; }
    else if (provider === 'git') { if (gc) gc.style.display = 'block'; if (sa) sa.style.display = 'flex'; }
  }

  _getSelectedStorage() {
    const activeBtn = document.querySelector('.toggle-btn.active');
    return activeBtn ? activeBtn.dataset.storage : 'local';
  }

  updateStorageHint() {
    const hint = document.getElementById('storageHint');
    if (!hint) return;
    const ss = this._getSelectedStorage();
    const settings = this.settingsService.settings;
    const configHint = settings.getConfigHint(ss);
    if (configHint) { hint.innerHTML = '<i class="mdi mdi-alert"></i> ' + configHint; hint.style.color = '#ff6b6b'; }
    else {
      hint.innerHTML = '<i class="mdi mdi-information"></i> ' + (ss === 'local' ? '本地存储不会同步到其他设备' : '云端存储会同步到其他设备');
      hint.style.color = '';
    }
  }

  updateAddEmotionButtonText(sourceType) {
    const bt = document.getElementById('addEmotionBtnText');
    if (!bt) return;
    const ss = this._getSelectedStorage();
    if (sourceType === 'url') { bt.textContent = ss === 'local' ? '下载到本地' : '上传到云端'; }
    else { bt.textContent = ss === 'local' ? '保存到本地' : '上传到云端'; }
  }

  addTagInput() {
    const c = document.getElementById('tagsInputsContainer');
    const w = document.createElement('div');
    w.className = 'tag-input-wrapper';
    w.innerHTML = '<input type="text" class="tag-input" placeholder="输入标签"><button type="button" class="remove-tag-btn"><i class="mdi mdi-close"></i></button>';
    c.appendChild(w);
    w.querySelector('.remove-tag-btn').addEventListener('click', () => w.remove());
    w.querySelector('.tag-input').focus();
  }

  getTagsFromInputs() {
    return Array.from(document.querySelectorAll('#tagsInputsContainer .tag-input'))
      .map(i => i.value.trim()).filter(Boolean);
  }

  resetTagsInputs() {
    document.getElementById('tagsInputsContainer').innerHTML = '<div class="tag-input-wrapper"><input type="text" class="tag-input" placeholder="输入标签"></div>';
  }

  async init() {
    this.showLoading('正在初始化...');
    try {
      await this.settingsService.loadSettings();
      await this.emotionService.loadData();
      this.themeManager.loadTheme();
      this._setupEventListeners();
      this.initImageLazyLoading();
      this.renderAllViews();
      this.switchView('home');
      this.initSidebarState();
      this._setupInfiniteScroll();
      this._initChangelog();
    } finally { this.hideLoading(); }
  }

  _initChangelog() {
    if (window.changelogManager) {
      const tl = document.getElementById('changelogTimeline');
      if (tl) tl.innerHTML = window.changelogManager.renderAll();
    }
  }

  _setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => { const v = item.dataset.view; if (v) this.switchView(v); });
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => { const t = btn.dataset.tab; if (t) this.switchTab(t); });
    });
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      item.addEventListener('click', () => { const p = item.dataset.settings; if (p) this.switchSettingsPanel(p); });
    });
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', (e) => { this.themeManager.setUserPreference(e.target.value); });
    });
    const ab = document.getElementById('addBtn');
    if (ab) ab.addEventListener('click', () => this.showModal('addModal'));
    document.querySelectorAll('.close').forEach(cb => {
      cb.addEventListener('click', (e) => this.hideModal(e.target.closest('.modal')));
    });
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', (e) => { if (e.target === m) this.hideModal(m); });
    });
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateStorageHint();
        const ast = document.querySelector('.source-tab.active');
        const st = ast ? ast.dataset.source : 'url';
        this.updateAddEmotionButtonText(st);
      });
    });
    document.querySelectorAll('.source-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const source = tab.dataset.source;
        document.querySelectorAll('.source-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.source-content').forEach(c => c.style.display = 'none');
        if (source === 'url') document.querySelector('.url-source').style.display = 'block';
        else document.querySelector('.file-source').style.display = 'block';
        this.updateAddEmotionButtonText(source);
      });
    });
    const atb = document.getElementById('addTagBtn');
    if (atb) atb.addEventListener('click', () => this.addTagInput());
    const aeb = document.getElementById('addEmotionBtn');
    if (aeb) aeb.addEventListener('click', () => this.handleAddEmotion());
    const cb = document.getElementById('copyBtn');
    if (cb) cb.addEventListener('click', () => this.copyEmotionToClipboard());
    const etb = document.getElementById('editTagsBtn');
    if (etb) etb.addEventListener('click', () => this.toggleEditMode());
    const db = document.getElementById('deleteBtn');
    if (db) db.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDeleteDropdown(); });
    document.querySelectorAll('.delete-option').forEach(opt => {
      opt.addEventListener('click', (e) => { e.stopPropagation(); this.deleteCurrentEmotion(opt.dataset.action); });
    });
    document.addEventListener('click', () => this.closeDeleteDropdown());
    const cvb = document.getElementById('convertBtn');
    if (cvb) cvb.addEventListener('click', () => this.convertCurrentEmotionStorage());
    const ti = document.getElementById('tagInput');
    if (ti) ti.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.saveTags(); });
    const ssb = document.getElementById('saveSettingsBtn');
    if (ssb) ssb.addEventListener('click', async () => await this.saveSettingsFromForm());
    const tcb = document.getElementById('testConnectionBtn');
    if (tcb) tcb.addEventListener('click', () => this._testCloudConnection());
    const cp = document.getElementById('cloudProvider');
    if (cp) cp.addEventListener('change', (e) => this.toggleCloudConfig(e.target.value));
    const sp = document.getElementById('syncProvider');
    if (sp) sp.addEventListener('change', (e) => this.toggleSyncConfig(e.target.value));
    const sfb = document.getElementById('selectFolderBtn');
    if (sfb) sfb.addEventListener('click', async () => await this._selectLocalFolder());
    const dlf = document.getElementById('deleteLocalFile');
    if (dlf) dlf.addEventListener('change', async () => await this.saveDeleteLocalFileSetting());
    document.querySelectorAll('[data-external-link="true"]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = link.getAttribute('href');
        if (typeof ztools !== 'undefined' && ztools.shellOpenExternal) ztools.shellOpenExternal(url);
        else window.open(url, '_blank');
      });
    });

    // 图片放大遮罩
    document.querySelectorAll('.zoomable-image').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showImageZoom(img.src);
      });
    });
    const zoomOverlay = document.getElementById('imageZoomOverlay');
    if (zoomOverlay) {
      zoomOverlay.addEventListener('click', (e) => {
        if (e.target === zoomOverlay) this._hideImageZoom();
      });
    }
    const zoomedImg = document.getElementById('zoomedImage');
    if (zoomedImg) {
      zoomedImg.addEventListener('click', (e) => e.stopPropagation());
    }
  }

  _showImageZoom(src) {
    const overlay = document.getElementById('imageZoomOverlay');
    const img = document.getElementById('zoomedImage');
    if (overlay && img) {
      img.src = src;
      overlay.classList.add('active');
    }
  }

  _hideImageZoom() {
    const overlay = document.getElementById('imageZoomOverlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
  }

  async _selectLocalFolder() {
    try {
      const folderPath = await this.emotionService.file.selectFolder();
      if (folderPath) {
        document.getElementById('localPath').value = folderPath;
        this.settingsService.settings.localPath = folderPath;
        this.notification.showMessage('本地存储路径已选择，请点击保存设置', 'info');
      }
    } catch (e) {
      this.notification.showMessage('选择文件夹功能暂时不可用，请手动输入路径', 'info');
    }
  }

  _testCloudConnection() {
    const provider = document.getElementById('cloudProvider').value;
    if (provider === 'imgbb') {
      const k = document.getElementById('imgbbApiKey')?.value;
      if (!k) { this.notification.showMessage('请先配置ImgBB API Key', 'error'); return; }
      this.notification.showMessage('ImgBB配置正常', 'success');
    } else if (provider === 's3') {
      const e = document.getElementById('s3Endpoint')?.value;
      const a = document.getElementById('s3AccessKey')?.value;
      const s = document.getElementById('s3SecretKey')?.value;
      const b = document.getElementById('s3Bucket')?.value;
      if (!e || !a || !s || !b) { this.notification.showMessage('请先完整配置S3存储信息', 'error'); return; }
      this.notification.showMessage('S3配置已保存，请点击保存设置', 'info');
    } else if (provider === 'tucang') {
      const t = document.getElementById('tucangToken')?.value;
      if (!t) { this.notification.showMessage('请先配置图仓Token', 'error'); return; }
      this.notification.showMessage('图仓配置已保存，请点击保存设置', 'info');
    } else {
      this.notification.showMessage('请检查云存储配置', 'info');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIManager;
}