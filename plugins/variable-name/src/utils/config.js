const STORAGE_KEY = 'baidu_translate_config';

export const sliderMarkers = {
  100: '100ms',
  200: '200ms',
  300: '300ms',
  400: '400ms',
  500: '500ms',
  600: '600ms',
  700: '700ms',
  800: '800ms',
  900: '900ms',
  1000: '10000ms',
};

const defaultConfig = {
  translateMode: 'click',
  delayTime: 500,
  copyOnSelect: true,
  closeOnSelect: true,
};

function normalizeDelayTime(time) {
  const markerKeys = Object.keys(sliderMarkers)
    .map(Number)
    .sort((a, b) => a - b);
  return markerKeys.reduce((prev, curr) =>
    Math.abs(curr - time) < Math.abs(prev - time) ? curr : prev
  );
}

export function getConfig() {
  try {
    const data = window.ztools?.db?.get(STORAGE_KEY);
    if (data) {
      return {
        appId: data.appId || '',
        appKey: data.appKey || '',
        translateMode: data.translateMode || defaultConfig.translateMode,
        delayTime: normalizeDelayTime(data.delayTime || defaultConfig.delayTime),
        copyOnSelect: data.copyOnSelect ?? defaultConfig.copyOnSelect,
        closeOnSelect: data.closeOnSelect ?? defaultConfig.closeOnSelect,
      };
    }
  } catch (e) {
    console.error('读取配置失败', e);
  }
  return null;
}

export function saveConfig(config) {
  try {
    const existingConfig = getConfig();
    const newConfig = {
      ...defaultConfig,
      ...existingConfig,
      ...config,
    };
    if (newConfig.delayTime !== undefined) {
      newConfig.delayTime = normalizeDelayTime(newConfig.delayTime);
    }
    window.ztools?.db?.remove(STORAGE_KEY);
    window.ztools?.db?.put({
      _id: STORAGE_KEY,
      ...newConfig,
    });
    return true;
  } catch (e) {
    console.error('保存配置失败', e);
    return false;
  }
}

export function hasValidConfig() {
  const config = getConfig();
  return !!(config?.appId && config?.appKey);
}
