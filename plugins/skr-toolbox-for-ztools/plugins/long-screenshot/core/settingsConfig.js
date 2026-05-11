class settingsConfig {
    constructor() {
        // 如果已存在实例，则返回该实例
        if (settingsConfig.instance) {
            return settingsConfig.instance;
        }

        this.defaultConfig = {
            newUser: true,
            accuracy: 0.8,
            hd: true,
            height: 50,
            step: 0.1,
            configVersion: '3.0.1',
            userGuide: false,
            cutBtnType: 1
        };
        this.config = null;
        this.getConfig();


        if (this.config.configVersion != this.defaultConfig.configVersion) {
            this.resetConfig()
        }


        this.onchange = () => { }; // 状态变更事件

        // 保存实例
        settingsConfig.instance = this;
    }

    // 获取单例实例
    static getInstance() {
        if (!settingsConfig.instance) {
            settingsConfig.instance = new settingsConfig();
        }
        return settingsConfig.instance;
    }

    // 获取配置
    getConfig() {
        let config = null;
        try {
            config = JSON.parse(localStorage.getItem("settings"));
        } catch (e) {
            console.error(e);
        }
        if (!config) {
            config = this.defaultConfig;
        } else {
            // 合并默认配置
            config = { ...this.defaultConfig, ...config };
        }
        this.saveConfig(config);
        return config;
    }

    // 保存配置
    saveConfig(config) {
        localStorage.setItem("settings", JSON.stringify(config));
        this.config = config;

        // 直接合并属性到this
        Object.assign(this, config);
    }

    // 更新配置
    updateConfig(key, value) {
        if (this.config[key] === value) return;
        this.config[key] = value;
        this.saveConfig(this.config);
        this.onchange();
    }

    // 重置配置
    resetConfig() {
        this.saveConfig(JSON.parse(JSON.stringify(this.defaultConfig)));
        console.log('resetConfig_preload')
    }


}

// 初始化单例实例
const settings = settingsConfig.getInstance();

// 导出单例实例
module.exports = settings;

