// 使用 IIFE 创建单例配置对象
export const config = (function() {
    const cfg = {
        precision: 21,
        displayFormat: 'decimal',
        dateFormat: 'YYYY-MM-DD',
    };

    return {
        // 获取配置
        get(key) {
            return cfg[key];
        },
        
        // 设置配置
        set(key, value) {
            cfg[key] = value;
            // 这里可以添加配置变更时的其他逻辑
        },
        
    };
})();
