export function fetchConfig() {
    let config = ztools.dbStorage.getItem('config')

    if (config && typeof config === 'string') {
        return JSON.parse(config)
    }

    return {
        imageSource: '发表情',
    }
}

/**
 * 更新配置信息
 * @param config
 */
export function updateConfig(config) {
    ztools.dbStorage.setItem('config', JSON.stringify(config));
}
