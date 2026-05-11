/**
 * 加载存储信息
 * @param key
 * @returns {{}|any}
 */
export function loadJsonStorage(key) {
    let storageValue = ztools.dbStorage.getItem(key)

    if (storageValue && typeof storageValue === 'string') {
        return JSON.parse(storageValue)
    }

    return {}
}

/**
 * 更新存储信息
 * @param config
 */
export function saveJsonStorage(key, storageValue) {
    ztools.dbStorage.setItem(key, JSON.stringify(storageValue));
}
