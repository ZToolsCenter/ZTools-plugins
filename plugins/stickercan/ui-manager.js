class UIManager {
    constructor(emotionManager) {
        this.emotionManager = emotionManager;
        this.sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    }

    initSidebarState() {
        const sidebar = document.querySelector('.sidebar');
        const collapseBtn = document.getElementById('sidebarCollapseBtn');
        const collapseIcon = document.getElementById('collapseIcon');
        
        if (this.sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            collapseIcon.className = 'mdi mdi-menu-right';
        }
        
        collapseBtn.addEventListener('click', () => {
            this.toggleSidebar();
        });
    }

    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const collapseIcon = document.getElementById('collapseIcon');
        
        this.sidebarCollapsed = !this.sidebarCollapsed;
        sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
        
        if (this.sidebarCollapsed) {
            collapseIcon.className = 'mdi mdi-menu-right';
        } else {
            collapseIcon.className = 'mdi mdi-menu-left';
        }
        
        localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed);
    }

    switchView(viewName) {
        this.emotionManager.currentView = viewName;
        
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.add('active');
        }

        const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
        if (navItem) {
            navItem.classList.add('active');
        }

        this.emotionManager.renderView(viewName);
    }

    switchSettingsPanel(panelName) {
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.settings-panel').forEach(panel => {
            panel.classList.remove('active');
        });

        const navItem = document.querySelector(`.settings-nav-item[data-settings="${panelName}"]`);
        if (navItem) {
            navItem.classList.add('active');
        }

        const panel = document.getElementById(`settings${panelName.charAt(0).toUpperCase() + panelName.slice(1)}`);
        if (panel) {
            panel.classList.add('active');
        }
    }

    switchTab(tabName) {
        console.log('switchTab 被调用:', tabName);
        this.emotionManager.currentTab = tabName;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (targetBtn) {
            targetBtn.classList.add('active');
        }

        if (this.emotionManager.searchManager) {
            this.emotionManager.searchManager.clearContent();
        }

        if (tabName === 'mine') {
            this.emotionManager.renderEmotions(this.emotionManager.dataManager.getAllEmotions());
        } else {
            const keyword = document.getElementById('searchInput').value.trim();
            if (keyword) {
                this.emotionManager.searchManager.handleSearch();
            } else {
                const externalResults = document.getElementById('externalResults');
                externalResults.style.display = 'block';
                externalResults.innerHTML = '<p class="hint-text">请输入关键词进行搜索</p>';
            }
        }
    }

    showModal(modalId) {
        document.getElementById(modalId).style.display = 'block';
        
        if (modalId === 'addModal') {
            this.emotionManager.storageManager.updateStorageHint();
        }
    }

    hideModal(modal) {
        if (typeof modal === 'string') {
            modal = document.getElementById(modal);
        }
        modal.style.display = 'none';
    }

    showMessage(message, type = 'info') {
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${type}`;
        messageEl.textContent = message;
        
        const bgColor = this.emotionManager.isLightMode ? '#ffffff' : '#1a1a1a';
        const textColor = this.emotionManager.isLightMode ? '#000000' : '#ffffff';
        const borderColor = this.emotionManager.isLightMode ? '#e0e0e0' : '#333333';
        
        messageEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 10px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            animation: slideInRight 0.3s ease;
            max-width: 300px;
            word-wrap: break-word;
            background: ${bgColor};
            color: ${textColor};
            border: 2px solid ${borderColor};
        `;
        
        document.body.appendChild(messageEl);
        
        setTimeout(() => {
            messageEl.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (messageEl.parentNode) {
                    messageEl.parentNode.removeChild(messageEl);
                }
            }, 300);
        }, 3000);
    }

    updateStats() {
        const total = this.emotionManager.dataManager.getAllEmotions().length;
        const cloudCount = this.emotionManager.dataManager.emotions.cloud.length;
        const localCount = this.emotionManager.dataManager.emotions.local.length;
        
        const totalEl = document.getElementById('totalCount');
        const cloudEl = document.getElementById('cloudCount');
        const localEl = document.getElementById('localCount');
        
        if (totalEl) totalEl.textContent = total;
        if (cloudEl) cloudEl.textContent = cloudCount;
        if (localEl) localEl.textContent = localCount;
    }

    addTagInput() {
        const container = document.getElementById('tagsInputsContainer');
        const wrapper = document.createElement('div');
        wrapper.className = 'tag-input-wrapper';
        wrapper.innerHTML = `
            <input type="text" class="tag-input" placeholder="输入标签">
            <button type="button" class="remove-tag-btn">
                <i class="mdi mdi-close"></i>
            </button>
        `;
        container.appendChild(wrapper);
        
        const removeBtn = wrapper.querySelector('.remove-tag-btn');
        removeBtn.addEventListener('click', () => {
            wrapper.remove();
        });
        
        wrapper.querySelector('.tag-input').focus();
    }

    getTagsFromInputs() {
        const inputs = document.querySelectorAll('#tagsInputsContainer .tag-input');
        const tags = [];
        inputs.forEach(input => {
            const tag = input.value.trim();
            if (tag) {
                tags.push(tag);
            }
        });
        return tags;
    }

    resetTagsInputs() {
        const container = document.getElementById('tagsInputsContainer');
        container.innerHTML = `
            <div class="tag-input-wrapper">
                <input type="text" class="tag-input" placeholder="输入标签">
            </div>
        `;
    }

    loadSettingsToForm() {
        const settings = this.emotionManager.dataManager.settings;
        console.log('加载设置到表单，当前 settings:', settings);
        
        const themePreference = settings.themePreference || this.emotionManager.themeManager.getUserPreference();
        const themeRadio = document.querySelector(`input[name="theme"][value="${themePreference}"]`);
        if (themeRadio) {
            themeRadio.checked = true;
        }

        document.getElementById('cloudProvider').value = settings.cloudProvider || 'imgbb';
        document.getElementById('localPath').value = settings.localPath || '';
        console.log('设置本地路径到表单:', settings.localPath);
        
        document.getElementById('syncProvider').value = settings.syncConfig?.provider || 'none';
        
        if (settings.cloudConfig) {
            document.getElementById('s3Endpoint').value = settings.cloudConfig.s3Endpoint || '';
            document.getElementById('s3AccessKey').value = settings.cloudConfig.s3AccessKey || '';
            document.getElementById('s3SecretKey').value = settings.cloudConfig.s3SecretKey || '';
            document.getElementById('s3Bucket').value = settings.cloudConfig.s3Bucket || '';
            document.getElementById('s3Region').value = settings.cloudConfig.s3Region || '';
            const imgbbApiKeyInput = document.getElementById('imgbbApiKey');
            if (imgbbApiKeyInput) imgbbApiKeyInput.value = settings.cloudConfig.imgbbApiKey || '';
            const tucangTokenInput = document.getElementById('tucangToken');
            if (tucangTokenInput) tucangTokenInput.value = settings.cloudConfig.tucangToken || '';
            const tucangFolderIdInput = document.getElementById('tucangFolderId');
            if (tucangFolderIdInput) tucangFolderIdInput.value = settings.cloudConfig.tucangFolderId || '';
        }
        
        if (settings.syncConfig) {
            document.getElementById('webdavUrl').value = settings.syncConfig.webdavUrl || '';
            document.getElementById('webdavUsername').value = settings.syncConfig.webdavUsername || '';
            document.getElementById('webdavPassword').value = settings.syncConfig.webdavPassword || '';
            document.getElementById('gitRemote').value = settings.syncConfig.gitRemote || '';
        }

        const deleteLocalFileCheckbox = document.getElementById('deleteLocalFile');
        if (deleteLocalFileCheckbox) {
            deleteLocalFileCheckbox.checked = settings.deleteLocalFile || false;
        }

        this.emotionManager.toggleCloudConfig(settings.cloudProvider || 'imgbb');
        this.emotionManager.toggleSyncConfig(settings.syncConfig?.provider || 'none');
    }

    toggleCloudConfig(provider) {
        const s3Config = document.getElementById('s3Config');
        const imgbbConfig = document.getElementById('imgbbConfig');
        const tucangConfig = document.getElementById('tucangConfig');
        
        s3Config.style.display = 'none';
        imgbbConfig.style.display = 'none';
        tucangConfig.style.display = 'none';
        
        if (provider === 's3') {
            s3Config.style.display = 'block';
        } else if (provider === 'imgbb') {
            imgbbConfig.style.display = 'block';
        } else if (provider === 'tucang') {
            tucangConfig.style.display = 'block';
        }
    }

    toggleSyncConfig(provider) {
        const webdavConfig = document.getElementById('webdavConfig');
        const gitConfig = document.getElementById('gitConfig');
        const syncActions = document.getElementById('syncActions');

        webdavConfig.style.display = 'none';
        gitConfig.style.display = 'none';
        syncActions.style.display = 'none';

        if (provider === 'webdav') {
            webdavConfig.style.display = 'block';
            syncActions.style.display = 'flex';
        } else if (provider === 'git') {
            gitConfig.style.display = 'block';
            syncActions.style.display = 'flex';
        }
    }
}
