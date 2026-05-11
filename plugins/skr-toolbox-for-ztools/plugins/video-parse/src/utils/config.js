export function setConfig(key, value) {
  window.utools.dbStorage.setItem(key, value);
}

export function getConfig(key) {
  return window.utools.dbStorage.getItem(key);
}

/**
 * 设置自动打开配置
 * @param {boolean} value true:自动打开 false:不自动打开
 */
export function setAutoOpenConfig(value) {
  setConfig('autoOpen', value);
}

/**
 * 获取自动打开配置
 * @returns {boolean} true:自动打开 false:不自动打开
 */
export function getAutoOpenConfig() {
  const autoOpen = getConfig('autoOpen');
  return autoOpen !== null ? autoOpen : true;
}