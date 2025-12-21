// ztools 配置管理类，适用于 preload.js 和 settings.html
class ConfigManager {
    constructor() {
        this.configKey = 'confetti_settings';
    }

    getSettings() {
        try {
            return ztools.dbStorage.getItem(this.configKey) || {};
        } catch (error) {
            ztools.showNotification("获取配置失败:" + error.message)
            return {};
        }
    }

    getSetting(key, defaultValue) {
        const settings = this.getSettings();
        return settings[key] !== undefined ? settings[key] : defaultValue;
    }

    setSetting(key, value) {
        try {
            const settings = this.getSettings();
            settings[key] = value;
            ztools.dbStorage.setItem(this.configKey, settings);
        } catch (error) {
            ztools.showNotification("更新配置失败:" + error.message)
        }
    }

    updateSettings(newSettings) {
        try {
            const settings = this.getSettings();
            const updatedSettings = { ...settings, ...newSettings };
            ztools.dbStorage.setItem(this.configKey, updatedSettings);
        } catch (error) {
            ztools.showNotification("更新配置失败:" + error.message)
        }
    }

    getFullscreenSetting() {
        // 开启全屏：
        // MacOS 会独立全屏
        // Windows 开启礼花后，任务栏（任务栏默认会遮挡所有窗口）后如果有窗口，
        // 该窗口会被随着礼花一起置最前（即：挡住任务栏）
        const defaultFullscreen = false;
        const fullscreenEnabled = this.getSetting('fullscreenEnabled', null);
        return typeof fullscreenEnabled === 'boolean' ? fullscreenEnabled : defaultFullscreen;
    }

    getSoundSetting() {
        return this.getSetting('soundEnabled', true);
    }
}

// 兼容 CommonJS 和浏览器
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConfigManager;
} else {
    window.ConfigManager = ConfigManager;
} 