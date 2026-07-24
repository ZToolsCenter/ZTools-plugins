class DataManager {
    constructor() {
        this.emotions = {
            local: [],
            cloud: []
        };
        this.settings = null;
        this.migrationDone = false;
        // 获取设备 ID，用于区别设备
        this.nativeId = window.ztools.getNativeId();
    }

    async loadData() {
        try {
            console.log('===== 开始加载数据 =====');
            console.log('当前设备 ID:', this.nativeId);
            
            // 加载本地表情包（ztools.dbStorage，不会同步）
            // 使用设备 ID 作为 key 前缀，确保只与当前设备相关
            const localEmotionsKey = this.nativeId + '/emotions_local';
            const localEmotions = window.ztools.dbStorage.getItem(localEmotionsKey);
            if (localEmotions && Array.isArray(localEmotions)) {
                this.emotions.local = localEmotions;
                console.log('本地表情包加载成功，数量:', this.emotions.local.length);
            } else {
                // 尝试从旧的 key 迁移数据
                const oldLocalEmotions = window.ztools.dbStorage.getItem('emotions_local');
                if (oldLocalEmotions && Array.isArray(oldLocalEmotions)) {
                    console.log('检测到旧的本地数据，迁移到新的 key');
                    this.emotions.local = oldLocalEmotions;
                    window.ztools.dbStorage.setItem(localEmotionsKey, this.emotions.local);
                }
            }
            
            // 加载云端表情包（ztools.db，会同步）
            const cloudData = await window.ztools.db.promises.get('emotions_cloud');
            if (cloudData && cloudData.data && Array.isArray(cloudData.data)) {
                this.emotions.cloud = cloudData.data;
                console.log('云端表情包加载成功，数量:', this.emotions.cloud.length);
            }
            
            // 检查是否需要从旧的单一结构迁移数据
            const hasOldData = await this.checkOldData();
            if (hasOldData) {
                const oldData = await window.ztools.db.promises.get('emotions');
                if (oldData && oldData.data && Array.isArray(oldData.data)) {
                    console.log('检测到旧数据，开始迁移...');
                    await this.migrateOldData(oldData.data);
                    this.migrationDone = true;
                }
            }
            
            // 加载设置
            const settingsData = await window.ztools.db.promises.get('settings');
            if (settingsData) {
                this.settings = settingsData.data;
                console.log('设置加载成功:', this.settings);
            } else {
                console.log('没有找到已保存的设置，使用默认值');
                let defaultLocalPath = 'E:\\图片\\表情包';
                if (window.emotionCan && typeof window.emotionCan.getDefaultDir === 'function') {
                    defaultLocalPath = window.emotionCan.getDefaultDir();
                }
                
                this.settings = {
                    cloudProvider: 'imgbb',
                    localPath: defaultLocalPath,
                    cloudConfig: {},
                    syncConfig: {},
                    deleteLocalFile: false
                };
                console.log('使用的默认 settings:', this.settings);
            }

            console.log('===== 数据加载完成 =====');
            console.log('本地表情包数量:', this.emotions.local.length);
            console.log('云端表情包数量:', this.emotions.cloud.length);
        } catch (error) {
            console.error('加载数据失败:', error);
            this.emotions = { local: [], cloud: [] };
            
            let defaultLocalPath = 'E:\\图片\\表情包';
            if (window.emotionCan && typeof window.emotionCan.getDefaultDir === 'function') {
                defaultLocalPath = window.emotionCan.getDefaultDir();
            }
            
            this.settings = {
                cloudProvider: 'imgbb',
                localPath: defaultLocalPath,
                cloudConfig: {},
                syncConfig: {},
                deleteLocalFile: false
            };
        }
    }

    async checkOldData() {
        try {
            // 检查是否有旧的单一结构数据
            const oldData = await window.ztools.db.promises.get('emotions');
            const localEmotionsKey = this.nativeId + '/emotions_local';
            const localData = window.ztools.dbStorage.getItem(localEmotionsKey);
            
            // 只有同时存在旧数据且新数据为空时才迁移
            return oldData && oldData.data && Array.isArray(oldData.data) && 
                   (!localData || !Array.isArray(localData) || localData.length === 0);
        } catch (e) {
            return false;
        }
    }

    async migrateOldData(oldEmotions) {
        console.log('开始迁移旧数据，共', oldEmotions.length, '个表情包');
        
        // 按 storageType 分类
        this.emotions.local = oldEmotions.filter(e => e.storageType === 'local' || !e.storageType);
        this.emotions.cloud = oldEmotions.filter(e => e.storageType === 'cloud');
        
        // 给没有 storageType 的数据补上
        this.emotions.local.forEach(e => {
            if (!e.storageType) e.storageType = 'local';
        });
        
        console.log('迁移后本地:', this.emotions.local.length, '个');
        console.log('迁移后云端:', this.emotions.cloud.length, '个');
        
        // 保存新结构数据
        await this.saveData();
        
        console.log('数据迁移完成！');
    }

    async saveData() {
        try {
            console.log('===== 开始保存表情包数据 =====');
            console.log('准备保存的本地表情包数量:', this.emotions.local.length);
            console.log('准备保存的云端表情包数量:', this.emotions.cloud.length);
            
            // 保存本地表情包到 dbStorage（不会同步）
            // 使用设备 ID 作为 key 前缀，确保只与当前设备相关
            const localEmotionsKey = this.nativeId + '/emotions_local';
            window.ztools.dbStorage.setItem(localEmotionsKey, this.emotions.local);
            console.log('本地表情包保存成功，key:', localEmotionsKey);
            
            // 保存云端表情包到 db（会同步）
            const existingCloud = await window.ztools.db.promises.get('emotions_cloud');
            const cloudDoc = {
                _id: 'emotions_cloud',
                data: this.emotions.cloud
            };
            if (existingCloud && existingCloud._rev) {
                cloudDoc._rev = existingCloud._rev;
            }
            const cloudResult = await window.ztools.db.promises.put(cloudDoc);
            console.log('云端表情包保存成功:', cloudResult);
            
            console.log('===== 表情包数据保存完成 =====');
        } catch (error) {
            console.error('保存表情包数据失败:', error);
            throw new Error('保存失败: ' + error.message);
        }
    }

    async saveSettings() {
        try {
            console.log('===== 开始保存设置 =====');
            console.log('准备保存的 settings:', this.settings);
            
            const existingSettings = await window.ztools.db.promises.get('settings');
            const settingsDoc = {
                _id: 'settings',
                data: this.settings
            };
            if (existingSettings && existingSettings._rev) {
                settingsDoc._rev = existingSettings._rev;
            }
            
            const result = await window.ztools.db.promises.put(settingsDoc);
            console.log('设置保存成功:', result);
            
            console.log('===== 保存流程结束 =====');
        } catch (error) {
            console.error('保存设置失败:', error);
            throw new Error('保存设置失败: ' + error.message);
        }
    }

    generateId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    getAllEmotions() {
        return [...this.emotions.local, ...this.emotions.cloud];
    }

    findEmotionByUrl(url) {
        const all = this.getAllEmotions();
        return all.find(e => e.url === url);
    }

    addEmotion(emotion, storageType) {
        if (storageType === 'local') {
            this.emotions.local.push(emotion);
        } else {
            this.emotions.cloud.push(emotion);
        }
    }

    removeEmotion(emotion) {
        if (emotion.storageType === 'local') {
            const index = this.emotions.local.findIndex(e => e.id === emotion.id);
            if (index !== -1) {
                this.emotions.local.splice(index, 1);
            }
        } else {
            const index = this.emotions.cloud.findIndex(e => e.id === emotion.id);
            if (index !== -1) {
                this.emotions.cloud.splice(index, 1);
            }
        }
    }
}
