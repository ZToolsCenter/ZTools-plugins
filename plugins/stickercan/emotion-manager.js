class EmotionManager {
    async fetchWithTimeout(url, options = {}, timeout = 30000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('请求超时，请检查网络连接');
            }
            throw error;
        }
    }

    constructor() {
        this.currentView = 'home';
        this.currentEmotion = null;
        this.currentTab = 'mine';
        this.isLightMode = false;
        
        this.themeManager = new ThemeManager();
        this.dataManager = new DataManager();
        this.searchManager = new SearchManager(this);
        this.uiManager = new UIManager(this);
        this.storageManager = new StorageManager(this);
    }

    async init() {
        console.log('EmotionManager.init() 开始');
        await this.dataManager.loadData();
        this.loadTheme();
        this.setupEventListeners();
        this.renderAllViews();
        this.switchView('home');
        this.uiManager.initSidebarState();
        this.searchManager.setupInfiniteScroll();
        this.initChangelog();
        console.log('EmotionManager.init() 完成');
    }

    initChangelog() {
        if (window.changelogManager) {
            const timeline = document.getElementById('changelogTimeline');
            if (timeline) {
                timeline.innerHTML = window.changelogManager.renderAll();
                console.log('更新记录已加载');
            }
        }
    }

    loadTheme() {
        try {
            if (this.dataManager.settings && this.dataManager.settings.theme !== undefined) {
                this.isLightMode = this.dataManager.settings.theme;
            } else {
                const savedTheme = localStorage.getItem('emotion-theme');
                if (savedTheme !== null) {
                    this.isLightMode = savedTheme === 'light';
                }
            }
            this.applyTheme();
        } catch (error) {
            console.error('加载主题失败:', error);
        }
    }

    toggleTheme() {
        this.isLightMode = !this.isLightMode;
        this.applyTheme();
        this.saveTheme();
    }

    applyTheme() {
        const body = document.body;
        const themeBtn = document.getElementById('themeToggle');
        
        if (this.isLightMode) {
            body.classList.add('light-mode');
            if (themeBtn) {
                themeBtn.innerHTML = '<i class="mdi mdi-weather-night"></i>';
            }
        } else {
            body.classList.remove('light-mode');
            if (themeBtn) {
                themeBtn.innerHTML = '<i class="mdi mdi-weather-sunny"></i>';
            }
        }
    }

    async saveTheme() {
        try {
            if (!this.dataManager.settings) {
                this.dataManager.settings = {};
            }
            this.dataManager.settings.theme = this.isLightMode;
            await this.saveSettings();
            
            localStorage.setItem('emotion-theme', this.isLightMode ? 'light' : 'dark');
        } catch (error) {
            console.error('保存主题失败:', error);
        }
    }

    setupEventListeners() {
        console.log('setupEventListeners() 开始');
        
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                if (view) {
                    console.log('导航项点击:', view);
                    this.switchView(view);
                }
            });
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                console.log('选项卡按钮点击:', tab);
                if (tab) {
                    this.switchTab(tab);
                }
            });
        });

        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const settingsPanel = item.dataset.settings;
                if (settingsPanel) {
                    this.switchSettingsPanel(settingsPanel);
                }
            });
        });

        document.querySelectorAll('input[name="theme"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.themeManager.setUserPreference(e.target.value);
            });
        });

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchManager.handleSearch();
                }
            });
            searchInput.addEventListener('input', (e) => {
                if (this.currentTab === 'mine') {
                    this.searchManager.searchEmotions(e.target.value);
                }
            });
        }

        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.searchManager.handleSearch();
            });
        }

        const addBtn = document.getElementById('addBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.showModal('addModal');
            });
        }

        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                this.hideModal(e.target.closest('.modal'));
            });
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideModal(modal);
                }
            });
        });

        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.storageManager.selectedStorage = btn.dataset.storage;
                this.storageManager.updateStorageHint();
                const activeSourceTab = document.querySelector('.source-tab.active');
                const sourceType = activeSourceTab ? activeSourceTab.dataset.source : 'url';
                this.updateAddEmotionButtonText(sourceType);
            });
        });

        const addTagBtn = document.getElementById('addTagBtn');
        if (addTagBtn) {
            addTagBtn.addEventListener('click', () => {
                this.uiManager.addTagInput();
            });
        }

        const addEmotionBtn = document.getElementById('addEmotionBtn');
        if (addEmotionBtn) {
            addEmotionBtn.addEventListener('click', () => {
                this.handleAddEmotion();
            });
        }

        const copyBtn = document.getElementById('copyBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                this.copyEmotionToClipboard();
            });
        }

        const editTagsBtn = document.getElementById('editTagsBtn');
        if (editTagsBtn) {
            editTagsBtn.addEventListener('click', () => {
                this.toggleEditMode();
            });
        }

        const deleteBtn = document.getElementById('deleteBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteCurrentEmotion();
            });
        }

        const convertBtn = document.getElementById('convertBtn');
        if (convertBtn) {
            convertBtn.addEventListener('click', () => {
                this.convertCurrentEmotionStorage();
            });
        }

        const tagInput = document.getElementById('tagInput');
        if (tagInput) {
            tagInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.saveTags();
                }
            });
        }

        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', async () => {
                await this.saveSettingsFromForm();
            });
        }

        const testConnectionBtn = document.getElementById('testConnectionBtn');
        if (testConnectionBtn) {
            testConnectionBtn.addEventListener('click', () => {
                this.testCloudConnection();
            });
        }

        const cloudProvider = document.getElementById('cloudProvider');
        if (cloudProvider) {
            cloudProvider.addEventListener('change', (e) => {
                this.toggleCloudConfig(e.target.value);
            });
        }

        const syncProvider = document.getElementById('syncProvider');
        if (syncProvider) {
            syncProvider.addEventListener('change', (e) => {
                this.toggleSyncConfig(e.target.value);
            });
        }

        const selectFolderBtn = document.getElementById('selectFolderBtn');
        if (selectFolderBtn) {
            selectFolderBtn.addEventListener('click', () => {
                this.storageManager.selectLocalFolder();
            });
        }

        const deleteLocalFileCheckbox = document.getElementById('deleteLocalFile');
        if (deleteLocalFileCheckbox) {
            deleteLocalFileCheckbox.addEventListener('change', async () => {
                await this.saveDeleteLocalFileSetting();
            });
        }
        
        document.querySelectorAll('[data-external-link="true"]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const url = link.getAttribute('href');
                if (window.ztools && window.ztools.shellOpenExternal) {
                    window.ztools.shellOpenExternal(url);
                } else {
                    window.open(url, '_blank');
                }
            });
        });
        
        console.log('setupEventListeners() 完成');
    }

    switchView(viewName) {
        console.log('EmotionManager.switchView:', viewName);
        this.uiManager.switchView(viewName);
    }

    switchSettingsPanel(panelName) {
        this.uiManager.switchSettingsPanel(panelName);
    }

    switchTab(tabName) {
        console.log('EmotionManager.switchTab:', tabName);
        this.uiManager.switchTab(tabName);
    }

    showModal(modalId) {
        this.uiManager.showModal(modalId);
    }

    hideModal(modal) {
        this.uiManager.hideModal(modal);
    }

    showMessage(message, type = 'info') {
        this.uiManager.showMessage(message, type);
    }

    renderView(viewName) {
        console.log('renderView:', viewName);
        switch(viewName) {
            case 'home':
                this.renderEmotions(this.dataManager.getAllEmotions());
                break;
            case 'local':
                this.renderLocalView();
                break;
            case 'cloud':
                this.renderCloudView();
                break;
            case 'settings':
                this.uiManager.loadSettingsToForm();
                break;
        }
        this.uiManager.updateStats();
    }

    renderAllViews() {
        this.renderEmotions(this.dataManager.getAllEmotions());
        this.renderLocalView();
        this.renderCloudView();
        this.uiManager.updateStats();
    }

    renderEmotions(emotions) {
        console.log('renderEmotions 调用, 表情包数量:', emotions.length);
        const grid = document.getElementById('emotionGrid');
        const externalResults = document.getElementById('externalResults');
        const emptyState = document.getElementById('emptyState');
        
        if (!grid || !externalResults || !emptyState) {
            return;
        }
        
        externalResults.style.display = 'none';
        
        if (emotions.length === 0) {
            grid.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }
        
        grid.style.display = 'grid';
        emptyState.style.display = 'none';
        
        grid.innerHTML = emotions.map((emotion) => {
            const imgSrc = this.storageManager.getImageSrc(emotion);
            return '<div class="emotion-card" data-emotion-id="' + emotion.id + '">' +
                '<div class="storage-icon ' + emotion.storageType + '">' +
                    '<i class="mdi mdi-' + (emotion.storageType === 'cloud' ? 'cloud' : 'folder') + '"></i>' +
                '</div>' +
                '<div class="copy-overlay">' +
                    '<button class="copy-btn" data-emotion-id="' + emotion.id + '">' +
                        '<i class="mdi mdi-content-copy"></i>' +
                        '<span>复制</span>' +
                    '</button>' +
                '</div>' +
                '<img src="' + imgSrc + '" alt="表情包" ' +
                     'data-emotion-id="' + emotion.id + '"' +
                     'onerror="this.src=\'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzc3NyIgPkltYWdlPC90ZXh0Pjwvc3ZnPg==\'">' +
                '<div class="tags">' +
                    emotion.tags.slice(0, 3).map(tag => '<span class="tag">' + tag + '</span>').join('') +
                    (emotion.tags.length > 3 ? '<span class="tag">+' + (emotion.tags.length - 3) + '</span>' : '') +
                '</div>' +
            '</div>';
        }).join('');

        grid.querySelectorAll('.emotion-card').forEach(card => {
            const emotionId = card.dataset.emotionId;
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.copy-btn')) {
                    const emotion = this.dataManager.findEmotionByUrl(
                        card.querySelector('img').src.replace(window.location.origin + '/', '')
                    ) || this.dataManager.getAllEmotions().find(e => e.id === emotionId);
                    if (emotion) {
                        this.showEmotionDetail(emotion);
                    }
                }
            });
        });

        grid.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const emotionId = btn.dataset.emotionId;
                const emotion = this.dataManager.getAllEmotions().find(e => e.id === emotionId);
                if (emotion) {
                    this.copyEmotionImage(emotion);
                }
            });
        });
    }

    renderLocalView() {
        const grid = document.getElementById('localEmotionGrid');
        const emptyState = document.getElementById('localEmptyState');
        const localEmotions = this.dataManager.emotions.local;
        
        if (!grid || !emptyState) {
            return;
        }
        
        if (localEmotions.length === 0) {
            grid.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }
        
        grid.style.display = 'grid';
        emptyState.style.display = 'none';
        
        grid.innerHTML = localEmotions.map((emotion) => {
            const imgSrc = this.storageManager.getImageSrc(emotion);
            return '<div class="emotion-card" data-emotion-id="' + emotion.id + '">' +
                '<div class="storage-icon local"><i class="mdi mdi-folder"></i></div>' +
                '<div class="copy-overlay">' +
                    '<button class="copy-btn" data-emotion-id="' + emotion.id + '">' +
                        '<i class="mdi mdi-content-copy"></i>' +
                        '<span>复制</span>' +
                    '</button>' +
                '</div>' +
                '<img src="' + imgSrc + '" alt="表情包" ' +
                     'data-emotion-id="' + emotion.id + '"' +
                     'onerror="this.src=\'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzc3NyIgPkltYWdlPC90ZXh0Pjwvc3ZnPg==\'">' +
                '<div class="tags">' +
                    emotion.tags.slice(0, 3).map(tag => '<span class="tag">' + tag + '</span>').join('') +
                    (emotion.tags.length > 3 ? '<span class="tag">+' + (emotion.tags.length - 3) + '</span>' : '') +
                '</div>' +
            '</div>';
        }).join('');

        grid.querySelectorAll('.emotion-card').forEach(card => {
            const emotionId = card.dataset.emotionId;
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.copy-btn')) {
                    const emotion = this.dataManager.emotions.local.find(e => e.id === emotionId);
                    if (emotion) {
                        this.showEmotionDetail(emotion);
                    }
                }
            });
        });

        grid.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const emotionId = btn.dataset.emotionId;
                const emotion = this.dataManager.emotions.local.find(e => e.id === emotionId);
                if (emotion) {
                    this.copyEmotionImage(emotion);
                }
            });
        });
    }

    renderCloudView() {
        const grid = document.getElementById('cloudEmotionGrid');
        const emptyState = document.getElementById('cloudEmptyState');
        const cloudEmotions = this.dataManager.emotions.cloud;
        
        if (!grid || !emptyState) {
            return;
        }
        
        if (cloudEmotions.length === 0) {
            grid.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }
        
        grid.style.display = 'grid';
        emptyState.style.display = 'none';
        
        grid.innerHTML = cloudEmotions.map((emotion) => {
            const imgSrc = this.storageManager.getImageSrc(emotion);
            return '<div class="emotion-card" data-emotion-id="' + emotion.id + '">' +
                '<div class="storage-icon cloud"><i class="mdi mdi-cloud"></i></div>' +
                '<div class="copy-overlay">' +
                    '<button class="copy-btn" data-emotion-id="' + emotion.id + '">' +
                        '<i class="mdi mdi-content-copy"></i>' +
                        '<span>复制</span>' +
                    '</button>' +
                '</div>' +
                '<img src="' + imgSrc + '" alt="表情包" ' +
                     'data-emotion-id="' + emotion.id + '"' +
                     'onerror="this.src=\'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzc3NyIgPkltYWdlPC90ZXh0Pjwvc3ZnPg==\'">' +
                '<div class="tags">' +
                    emotion.tags.slice(0, 3).map(tag => '<span class="tag">' + tag + '</span>').join('') +
                    (emotion.tags.length > 3 ? '<span class="tag">+' + (emotion.tags.length - 3) + '</span>' : '') +
                '</div>' +
            '</div>';
        }).join('');

        grid.querySelectorAll('.emotion-card').forEach(card => {
            const emotionId = card.dataset.emotionId;
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.copy-btn')) {
                    const emotion = this.dataManager.emotions.cloud.find(e => e.id === emotionId);
                    if (emotion) {
                        this.showEmotionDetail(emotion);
                    }
                }
            });
        });

        grid.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const emotionId = btn.dataset.emotionId;
                const emotion = this.dataManager.emotions.cloud.find(e => e.id === emotionId);
                if (emotion) {
                    this.copyEmotionImage(emotion);
                }
            });
        });
    }

    async showEmotionDetail(emotion) {
        this.currentEmotion = emotion;
        
        const localWrapper = document.getElementById('localImageWrapper');
        const cloudWrapper = document.getElementById('cloudImageWrapper');
        const localImage = document.getElementById('modalLocalImage');
        const cloudImage = document.getElementById('modalCloudImage');
        
        localWrapper.style.display = 'none';
        cloudWrapper.style.display = 'none';
        
        if (emotion.storageType === 'cloud') {
            cloudImage.src = emotion.url;
            cloudWrapper.style.display = 'block';
            
            const pairedLocal = this.findPairedEmotion(emotion, 'local');
            if (pairedLocal) {
                localImage.src = pairedLocal.url;
                localWrapper.style.display = 'block';
            }
        } else {
            localImage.src = emotion.url;
            localWrapper.style.display = 'block';
            
            const pairedCloud = this.findPairedEmotion(emotion, 'cloud');
            if (pairedCloud) {
                cloudImage.src = pairedCloud.url;
                cloudWrapper.style.display = 'block';
            }
        }
        
        const badge = document.getElementById('storageBadge');
        badge.className = 'storage-badge ' + emotion.storageType;
        const badgeIcon = badge.querySelector('.badge-icon');
        const badgeText = badge.querySelector('.badge-text');
        
        if (badgeIcon) {
            badgeIcon.className = 'mdi mdi-' + (emotion.storageType === 'cloud' ? 'cloud' : 'folder');
        }
        if (badgeText) {
            badgeText.textContent = emotion.storageType === 'cloud' ? '云端存储' : '本地存储';
        }
        
        const convertBtn = document.getElementById('convertBtn');
        if (convertBtn) {
            const hasPair = emotion.storageType === 'cloud' 
                ? this.findPairedEmotion(emotion, 'local') 
                : this.findPairedEmotion(emotion, 'cloud');
            
            if (hasPair) {
                if (emotion.storageType === 'cloud') {
                    convertBtn.innerHTML = '<i class="mdi mdi-check-circle"></i><span>已存在本地</span>';
                    convertBtn.disabled = true;
                } else {
                    convertBtn.innerHTML = '<i class="mdi mdi-check-circle"></i><span>已存在云端</span>';
                    convertBtn.disabled = true;
                }
            } else {
                if (emotion.storageType === 'cloud') {
                    convertBtn.innerHTML = '<i class="mdi mdi-folder-download"></i><span>保存到本地</span>';
                } else {
                    convertBtn.innerHTML = '<i class="mdi mdi-cloud-upload"></i><span>上传到云端</span>';
                }
                convertBtn.disabled = false;
            }
        }
        
        document.getElementById('tagList').innerHTML = emotion.tags.map(tag => 
            '<span class="tag">' + this.escapeHtml(tag) + '</span>'
        ).join('');
        
        document.getElementById('tagEditor').style.display = 'none';
        document.getElementById('tagList').style.display = 'flex';
        document.getElementById('editTagsBtn').innerHTML = '<i class="mdi mdi-tag"></i><span>编辑标签</span>';
        
        this.showModal('emotionModal');
    }
    
    findPairedEmotion(emotion, targetType) {
        const targetEmotions = targetType === 'local' 
            ? this.dataManager.emotions.local 
            : this.dataManager.emotions.cloud;
        
        return targetEmotions.find(e => {
            const hasOriginalUrl = e.metadata && 
                ((targetType === 'local' && e.metadata.originalCloudUrl === emotion.url) ||
                 (targetType === 'cloud' && e.metadata.originalLocalPath === emotion.url));
            
            const hasMatchingTags = e.tags.length > 0 && 
                e.tags.every(tag => emotion.tags.includes(tag));
            
            return hasOriginalUrl || hasMatchingTags;
        });
    }

    async copyEmotionToClipboard() {
        if (!this.currentEmotion) return;
        await this.copyEmotionImage(this.currentEmotion);
    }

    async copyEmotionImage(emotion) {
        const getErrorMessage = (error) => {
            if (error.name === 'AbortError' || error.message.includes('超时')) {
                return '请求超时，请检查网络连接后重试';
            }
            if (error.message.includes('CORS') || error.message.includes('跨域')) {
                return '图片存在跨域限制，无法复制';
            }
            if (error.message.includes('网络') || error.message.includes('network')) {
                return '网络连接失败，请检查网络后重试';
            }
            return '复制失败: ' + (error.message || '请重试');
        };

        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = emotion.url;
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('图片加载超时')), 10000);
                img.onload = () => {
                    clearTimeout(timeout);
                    resolve();
                };
                img.onerror = (err) => {
                    clearTimeout(timeout);
                    reject(new Error('图片加载失败'));
                };
            });
            
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const imageData = canvas.toDataURL('image/png');
            window.ztools.copyImage(imageData);
            this.showMessage('已复制到剪贴板', 'success');
            return;
            
        } catch (error) {
            console.warn('Canvas 方案失败，尝试备用方案:', error);
        }

        try {
            const response = await this.fetchWithTimeout(emotion.url);
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            const blob = await response.blob();
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    window.ztools.copyImage(e.target.result);
                    this.showMessage('已复制到剪贴板', 'success');
                } catch (copyError) {
                    console.error('ztools.copyImage 失败:', copyError);
                    this.showMessage(getErrorMessage(copyError), 'error');
                }
            };
            
            reader.onerror = () => {
                this.showMessage('图片解码失败，请重试', 'error');
            };
            
            reader.readAsDataURL(blob);
            
        } catch (error) {
            console.error('所有复制方案均失败:', error);
            this.showMessage(getErrorMessage(error), 'error');
        }
    }

    toggleEditMode() {
        const tagList = document.getElementById('tagList');
        const tagEditor = document.getElementById('tagEditor');
        const tagInputContainer = document.getElementById('tagInputContainer');
        const tagInputNew = document.getElementById('tagInputNew');
        const editBtn = document.getElementById('editTagsBtn');
        
        if (tagEditor.style.display === 'none') {
            tagList.style.display = 'none';
            tagEditor.style.display = 'block';
            
            tagInputContainer.innerHTML = this.currentEmotion.tags.map((tag, index) => 
                '<span class="tag" data-index="' + index + '" data-tag="' + this.escapeHtml(tag) + '">' +
                    this.escapeHtml(tag) +
                    '<i class="mdi mdi-close remove-tag-btn" data-index="' + index + '"></i>' +
                '</span>'
            ).join('');
            
            tagInputContainer.querySelectorAll('.remove-tag-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const index = parseInt(e.target.dataset.index);
                    this.removeTagFromEditor(index);
                });
            });
            
            tagInputNew.value = '';
            tagInputNew.focus();
            
            tagInputNew.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addTagFromInput();
                }
            });
            
            editBtn.innerHTML = '<i class="mdi mdi-content-save"></i> 保存标签';
        } else {
            this.saveTags();
        }
    }
    
    removeTagFromEditor(index) {
        const tagInputContainer = document.getElementById('tagInputContainer');
        const tags = tagInputContainer.querySelectorAll('.tag');
        
        if (tags[index]) {
            tags[index].remove();
            
            tagInputContainer.querySelectorAll('.tag').forEach((tag, i) => {
                tag.dataset.index = i;
                tag.querySelector('.remove-tag-btn').dataset.index = i;
            });
        }
    }
    
    addTagFromInput() {
        const tagInputNew = document.getElementById('tagInputNew');
        const tagInputContainer = document.getElementById('tagInputContainer');
        const newTag = tagInputNew.value.trim();
        
        if (newTag) {
            const currentCount = tagInputContainer.querySelectorAll('.tag').length;
            const tagElement = document.createElement('span');
            tagElement.className = 'tag';
            tagElement.dataset.index = currentCount;
            tagElement.dataset.tag = this.escapeHtml(newTag);
            tagElement.innerHTML = 
                this.escapeHtml(newTag) +
                '<i class="mdi mdi-close remove-tag-btn" data-index="' + currentCount + '"></i>';
            
            tagElement.querySelector('.remove-tag-btn').addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.removeTagFromEditor(index);
            });
            
            tagInputContainer.appendChild(tagElement);
            tagInputNew.value = '';
            tagInputNew.focus();
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    async saveTags() {
        const tagInputContainer = document.getElementById('tagInputContainer');
        const tagElements = tagInputContainer.querySelectorAll('.tag');
        const newTags = Array.from(tagElements).map(tag => tag.dataset.tag || tag.textContent.trim());
        
        if (newTags.length === 0) {
            this.showMessage('至少需要一个标签', 'error');
            return;
        }
        
        this.currentEmotion.tags = newTags;
        
        const updateEmotion = (arr) => {
            const index = arr.findIndex(e => e.id === this.currentEmotion.id);
            if (index !== -1) {
                arr[index] = this.currentEmotion;
                return true;
            }
            return false;
        };
        
        if (!updateEmotion(this.dataManager.emotions.local)) {
            updateEmotion(this.dataManager.emotions.cloud);
        }
        
        await this.dataManager.saveData();
        this.renderAllViews();
        
        const tagList = document.getElementById('tagList');
        tagList.innerHTML = newTags.map(tag => 
            '<span class="tag">' + this.escapeHtml(tag) + '</span>'
        ).join('');
        
        const tagEditor = document.getElementById('tagEditor');
        tagEditor.style.display = 'none';
        tagList.style.display = 'flex';
        
        const editBtn = document.getElementById('editTagsBtn');
        editBtn.innerHTML = '<i class="mdi mdi-tag"></i> 编辑标签';
        this.showMessage('标签已更新', 'success');
    }

    async deleteCurrentEmotion() {
        if (!this.currentEmotion) return;
        
        if (confirm('确定要删除这个表情包吗？')) {
            const emotionToDelete = this.currentEmotion;

            if (this.dataManager.settings.deleteLocalFile && emotionToDelete.storageType === 'local') {
                const filePath = emotionToDelete.url.replace('file://', '').replace(/\//g, '\\');
                if (window.emotionCan && typeof window.emotionCan.deleteFile === 'function') {
                    const deleted = window.emotionCan.deleteFile(filePath);
                    if (deleted) {
                        console.log('本地文件已删除:', filePath);
                    } else {
                        console.log('本地文件不存在或删除失败:', filePath);
                    }
                }
            }

            this.dataManager.removeEmotion(emotionToDelete);
            await this.dataManager.saveData();
            this.renderAllViews();
            this.hideModal('emotionModal');
            this.showMessage('表情包已删除', 'success');
        }
    }

    async addFromUrl(url, keyword) {
        const configHint = this.storageManager.getConfigHint();
        if (configHint) {
            this.showMessage(configHint, 'error');
            return;
        }

        if (this.dataManager.getAllEmotions().some(e => e.url === url)) {
            this.showMessage('该表情包已存在', 'error');
            return;
        }

        try {
            let finalUrl = url;
            const storageType = this.storageManager.selectedStorage;
            
            if (storageType === 'local') {
                this.showMessage('正在下载图片到本地...', 'info');
                finalUrl = await this.storageManager.downloadAndSaveToLocal(url);
            } else {
                this.showMessage('正在上传图片到云端...', 'info');
                finalUrl = await this.storageManager.uploadUrlToCloud(url);
            }

            const emotion = {
                id: this.dataManager.generateId(),
                url: finalUrl,
                storageType: storageType,
                tags: [keyword],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            this.dataManager.addEmotion(emotion, storageType);
            await this.dataManager.saveData();
            this.uiManager.updateStats();
            this.showMessage('表情包添加成功', 'success');
        } catch (error) {
            console.error('添加表情包失败:', error);
            this.showMessage('添加失败: ' + error.message, 'error');
        }
    }

    async addFromUrlLocal(url, keyword) {
        const configHint = this.storageManager.getLocalConfigHint();
        if (configHint) {
            this.showMessage(configHint, 'error');
            return;
        }

        if (this.dataManager.getAllEmotions().some(e => e.url === url)) {
            this.showMessage('该表情包已存在', 'error');
            return;
        }

        try {
            this.showMessage('正在下载图片到本地...', 'info');
            const finalUrl = await this.storageManager.downloadAndSaveToLocal(url);

            const emotion = {
                id: this.dataManager.generateId(),
                url: finalUrl,
                storageType: 'local',
                tags: [keyword],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            this.dataManager.addEmotion(emotion, 'local');
            await this.dataManager.saveData();
            this.uiManager.updateStats();
            this.showMessage('表情包下载成功', 'success');
        } catch (error) {
            console.error('下载表情包失败:', error);
            this.showMessage('下载失败: ' + error.message, 'error');
        }
    }

    async addFromUrlCloud(url, keyword) {
        const configHint = this.storageManager.getCloudConfigHint();
        if (configHint) {
            this.showMessage(configHint, 'error');
            return;
        }

        if (this.dataManager.getAllEmotions().some(e => e.url === url)) {
            this.showMessage('该表情包已存在', 'error');
            return;
        }

        try {
            this.showMessage('正在上传图片到云端...', 'info');
            const finalUrl = await this.storageManager.uploadUrlToCloud(url);

            const emotion = {
                id: this.dataManager.generateId(),
                url: finalUrl,
                storageType: 'cloud',
                tags: [keyword],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            this.dataManager.addEmotion(emotion, 'cloud');
            await this.dataManager.saveData();
            this.uiManager.updateStats();
            this.showMessage('表情包上传成功', 'success');
        } catch (error) {
            console.error('上传表情包失败:', error);
            this.showMessage('上传失败: ' + error.message, 'error');
        }
    }

    async handleAddEmotion() {
        const urlInput = document.getElementById('imageUrl');
        const fileInput = document.getElementById('localImage');
        const url = urlInput.value.trim();
        const tags = this.uiManager.getTagsFromInputs();
        
        const activeSourceTab = document.querySelector('.source-tab.active');
        const sourceType = activeSourceTab ? activeSourceTab.dataset.source : 'url';
        
        if (tags.length === 0) {
            this.showMessage('请至少添加一个标签', 'error');
            return;
        }
        
        const configHint = this.storageManager.getConfigHint();
        if (configHint) {
            this.showMessage(configHint, 'error');
            return;
        }
        
        try {
            if (sourceType === 'url') {
                if (!url) {
                    this.showMessage('请输入图片URL', 'error');
                    return;
                }
                
                const response = await this.fetchWithTimeout(url, { method: 'HEAD' });
                if (!response.ok) {
                    throw new Error('图片URL无效');
                }
                
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.startsWith('image/')) {
                    throw new Error('URL不是图片格式');
                }
                
                this.showMessage('正在处理图片...', 'info');
                
                let finalUrl;
                const storageType = this.storageManager.selectedStorage;
                
                if (storageType === 'local') {
                    this.showMessage('正在下载图片到本地文件夹...', 'info');
                    finalUrl = await this.storageManager.downloadAndSaveToLocal(url);
                } else {
                    this.showMessage('正在上传图片到云端...', 'info');
                    finalUrl = await this.storageManager.uploadUrlToCloud(url);
                }
                
                const emotion = {
                    id: this.dataManager.generateId(),
                    url: finalUrl,
                    storageType: storageType,
                    tags: tags,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                this.dataManager.addEmotion(emotion, storageType);
                await this.dataManager.saveData();
                this.renderAllViews();
                this.hideModal('addModal');
                
                urlInput.value = '';
                this.uiManager.resetTagsInputs();
                
                this.showMessage('表情包添加成功', 'success');
            } else {
                if (!fileInput.files[0]) {
                    this.showMessage('请选择要上传的图片', 'error');
                    return;
                }
                
                this.showMessage('正在处理...', 'info');
                
                let finalUrl;
                const storageType = this.storageManager.selectedStorage;
                
                if (storageType === 'local') {
                    finalUrl = await this.storageManager.saveToLocal(fileInput.files[0]);
                } else {
                    finalUrl = await this.storageManager.uploadToCloud(fileInput.files[0]);
                }
                
                const emotion = {
                    id: this.dataManager.generateId(),
                    url: finalUrl,
                    storageType: storageType,
                    tags: tags,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    metadata: {
                        originalName: fileInput.files[0].name,
                        size: fileInput.files[0].size
                    }
                };
                
                this.dataManager.addEmotion(emotion, storageType);
                await this.dataManager.saveData();
                this.renderAllViews();
                this.hideModal('addModal');
                
                fileInput.value = '';
                this.uiManager.resetTagsInputs();
                
                this.showMessage('表情包上传成功', 'success');
            }
        } catch (error) {
            console.error('添加表情包失败:', error);
            this.showMessage('添加失败: ' + error.message, 'error');
        }
    }

    async saveSettingsFromForm() {
        console.log('开始保存设置，从表单读取值...');

        const saveBtn = document.getElementById('saveSettingsBtn');
        const originalContent = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i> 保存中...';

        try {
            const newLocalPath = document.getElementById('localPath').value;
            console.log('表单中的 localPath:', newLocalPath);
            this.dataManager.settings.localPath = newLocalPath;

            const cloudProvider = document.getElementById('cloudProvider').value;
            console.log('表单中的 cloudProvider:', cloudProvider);
            this.dataManager.settings.cloudProvider = cloudProvider;

            if (!this.dataManager.settings.cloudConfig) {
                this.dataManager.settings.cloudConfig = {};
            }

            if (cloudProvider === 'imgbb') {
                const imgbbApiKey = document.getElementById('imgbbApiKey').value;
                console.log('表单中的 imgbbApiKey:', imgbbApiKey);
                this.dataManager.settings.cloudConfig.imgbbApiKey = imgbbApiKey;
            } else if (cloudProvider === 's3') {
                this.dataManager.settings.cloudConfig.s3Endpoint = document.getElementById('s3Endpoint').value;
                this.dataManager.settings.cloudConfig.s3AccessKey = document.getElementById('s3AccessKey').value;
                this.dataManager.settings.cloudConfig.s3SecretKey = document.getElementById('s3SecretKey').value;
                this.dataManager.settings.cloudConfig.s3Bucket = document.getElementById('s3Bucket').value;
                this.dataManager.settings.cloudConfig.s3Region = document.getElementById('s3Region').value;
            } else if (cloudProvider === 'tucang') {
                this.dataManager.settings.cloudConfig.tucangToken = document.getElementById('tucangToken').value;
                const folderIdInput = document.getElementById('tucangFolderId');
                this.dataManager.settings.cloudConfig.tucangFolderId = folderIdInput ? parseInt(folderIdInput.value) || 0 : 0;
            }

            console.log('准备保存到数据库的 settings:', this.dataManager.settings);
            await this.dataManager.saveSettings();

            saveBtn.innerHTML = '<i class="mdi mdi-check"></i> 已保存';
            saveBtn.classList.add('btn-success');

            setTimeout(() => {
                saveBtn.innerHTML = originalContent;
                saveBtn.classList.remove('btn-success');
                saveBtn.disabled = false;
            }, 2000);

            this.showMessage('设置已保存', 'success');

        } catch (error) {
            console.error('保存设置失败:', error);
            saveBtn.innerHTML = '<i class="mdi mdi-alert-circle"></i> 保存失败';
            saveBtn.classList.add('btn-danger');

            setTimeout(() => {
                saveBtn.innerHTML = originalContent;
                saveBtn.classList.remove('btn-danger');
                saveBtn.disabled = false;
            }, 2000);

            this.showMessage('保存设置失败: ' + error.message, 'error');
        }
    }

    async saveDeleteLocalFileSetting() {
        const deleteLocalFileCheckbox = document.getElementById('deleteLocalFile');
        if (deleteLocalFileCheckbox) {
            this.dataManager.settings.deleteLocalFile = deleteLocalFileCheckbox.checked;
            await this.dataManager.saveSettings();
            this.showMessage('设置已保存', 'success');
        }
    }

    async saveSettings() {
        await this.dataManager.saveSettings();
    }

    toggleCloudConfig(provider) {
        this.uiManager.toggleCloudConfig(provider);
    }

    toggleSyncConfig(provider) {
        this.uiManager.toggleSyncConfig(provider);
    }

    updateAddEmotionButtonText(sourceType) {
        const btnText = document.getElementById('addEmotionBtnText');
        if (!btnText) return;
        
        if (sourceType === 'url') {
            if (this.storageManager.selectedStorage === 'local') {
                btnText.textContent = '下载到本地';
            } else {
                btnText.textContent = '上传到云端';
            }
        } else {
            if (this.storageManager.selectedStorage === 'local') {
                btnText.textContent = '保存到本地';
            } else {
                btnText.textContent = '上传到云端';
            }
        }
    }

    testCloudConnection() {
        const provider = document.getElementById('cloudProvider').value;
        
        if (provider === 'imgbb') {
            const apiKey = document.getElementById('imgbbApiKey')?.value;
            if (!apiKey) {
                this.showMessage('请先配置ImgBB API Key', 'error');
                return;
            }
            this.showMessage('ImgBB配置正常', 'success');
        } else if (provider === 's3') {
            const endpoint = document.getElementById('s3Endpoint')?.value;
            const accessKey = document.getElementById('s3AccessKey')?.value;
            const secretKey = document.getElementById('s3SecretKey')?.value;
            const bucket = document.getElementById('s3Bucket')?.value;
            if (!endpoint || !accessKey || !secretKey || !bucket) {
                this.showMessage('请先完整配置S3存储信息', 'error');
                return;
            }
            this.showMessage('S3配置已保存，请点击保存设置', 'info');
        } else if (provider === 'tucang') {
            const token = document.getElementById('tucangToken')?.value;
            if (!token) {
                this.showMessage('请先配置图仓Token', 'error');
                return;
            }
            this.showMessage('图仓配置已保存，请点击保存设置', 'info');
        } else {
            this.showMessage('请检查云存储配置', 'info');
        }
    }

    async convertCurrentEmotionStorage() {
        if (!this.currentEmotion) return;
        
        try {
            if (this.currentEmotion.storageType === 'cloud') {
                // 云端 → 本地
                const configHint = this.storageManager.getLocalConfigHint();
                if (configHint) {
                    this.showMessage(configHint, 'error');
                    return;
                }
                
                // 检查是否已存在本地副本
                const existingLocal = this.dataManager.emotions.local.find(e => 
                    e.tags.join(',') === this.currentEmotion.tags.join(',') && 
                    e.createdAt === this.currentEmotion.createdAt
                );
                if (existingLocal) {
                    this.showMessage('该表情包已存在本地副本', 'info');
                    return;
                }
                
                this.showMessage('正在保存到本地...', 'info');
                const finalUrl = await this.storageManager.downloadAndSaveToLocal(this.currentEmotion.url);
                
                const newEmotion = {
                    id: this.dataManager.generateId(),
                    url: finalUrl,
                    storageType: 'local',
                    tags: [...this.currentEmotion.tags],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    metadata: {
                        originalCloudUrl: this.currentEmotion.url
                    }
                };
                
                this.dataManager.addEmotion(newEmotion, 'local');
                await this.dataManager.saveData();
                this.renderAllViews();
                this.showMessage('表情包已保存到本地', 'success');
                
            } else {
                // 本地 → 云端
                const configHint = this.storageManager.getCloudConfigHint();
                if (configHint) {
                    this.showMessage(configHint, 'error');
                    return;
                }
                
                // 检查是否已存在云端副本
                const existingCloud = this.dataManager.emotions.cloud.find(e => 
                    e.tags.join(',') === this.currentEmotion.tags.join(',') && 
                    e.createdAt === this.currentEmotion.createdAt
                );
                if (existingCloud) {
                    this.showMessage('该表情包已存在云端副本', 'info');
                    return;
                }
                
                this.showMessage('正在上传到云端...', 'info');
                const file = await this.storageManager.getFileFromLocal(this.currentEmotion);
                const finalUrl = await this.storageManager.uploadToCloud(file);
                
                const newEmotion = {
                    id: this.dataManager.generateId(),
                    url: finalUrl,
                    storageType: 'cloud',
                    tags: [...this.currentEmotion.tags],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    metadata: {
                        originalLocalPath: this.currentEmotion.url
                    }
                };
                
                this.dataManager.addEmotion(newEmotion, 'cloud');
                await this.dataManager.saveData();
                this.renderAllViews();
                this.showMessage('表情包已上传到云端', 'success');
            }
        } catch (error) {
            console.error('转换存储位置失败:', error);
            this.showMessage('转换失败: ' + error.message, 'error');
        }
    }
}
