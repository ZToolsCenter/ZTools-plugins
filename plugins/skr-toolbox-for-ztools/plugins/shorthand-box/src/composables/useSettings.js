import { ref, nextTick } from 'vue';

const SETTINGS_ID = 'settings-0001';

const settings = ref({
  clickToCopy: true,
  showCopyTip: true,
  copyAfterClose: false,
});

const loading = ref(false);

export function useSettings() {
  const loadSettings = async () => {
    loading.value = true;
    try {
      const data = await window.ztools.db.get(SETTINGS_ID);
      if (data) {
        settings.value = {
          clickToCopy: data.clickToCopy ?? true,
          showCopyTip: data.showCopyTip ?? true,
          copyAfterClose: data.copyAfterClose ?? false,
        };
      }
    } catch (error) {
      console.log('加载设置失败，使用默认设置');
    } finally {
      loading.value = false;
    }
  };

  const saveSettings = async () => {
    try {
      let doc = null;
      try {
        doc = await window.ztools.db.get(SETTINGS_ID);
      } catch (e) {
        doc = null;
      }

      await window.ztools.db.put({
        _id: SETTINGS_ID,
        _rev: doc?._rev,
        ...settings.value,
      });
    } catch (error) {
      console.error('保存设置失败:', error);
    }
  };

  const updateSetting = async (key, value) => {
    settings.value[key] = value;
    await saveSettings();
  };

  const closePlugin = () => {
    setTimeout(() => {
      nextTick(() => {
        window.ztools.outPlugin(true);
        window.ztools.hideMainWindow();
      });
    }, 1);
  };

  return {
    settings,
    loading,
    loadSettings,
    saveSettings,
    updateSetting,
    closePlugin,
  };
}
