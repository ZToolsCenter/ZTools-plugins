<template>
  <div class="home">
    <div>
      <n-tabs
        v-model:value="activeTab"
        type="segment"
        animated
      >
        <n-tab-pane
          name="use"
          tab="虚拟数据"
        >
          <Use />
        </n-tab-pane>
        <n-tab-pane
          name="dataConfiguration"
          tab="数据配置"
        >
          <DataConfiguration ref="dataConfigurationRef" />
        </n-tab-pane>
        <n-tab-pane
          name="systemSettings"
          tab="系统设置"
        >
          <SystemSettings />
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, provide, onMounted, reactive } from 'vue';
import Use from '../components/Use.vue';
import DataConfiguration from '../components/DataConfiguration/index.vue';
import SystemSettings from '../components/SystemSettings.vue';

const activeTab = ref('use');
const dataConfigurationRef = ref(null);

const SETTINGS_ID = 'settings-main';

const settings = reactive({
  clickToCopy: true,
  showCopyTip: true,
  closeAfterCopy: false,
  displayShape: '1',
});

const openAddDrawer = () => {
  activeTab.value = 'dataConfiguration';
  setTimeout(() => {
    dataConfigurationRef.value?.handleAdd();
  }, 100);
};

async function loadSettings() {
  try {
    const doc = await ztools.db.promises.get(SETTINGS_ID);
    if (doc) {
      Object.assign(settings, {
        clickToCopy: doc.clickToCopy !== undefined ? doc.clickToCopy : true,
        showCopyTip: doc.showCopyTip !== undefined ? doc.showCopyTip : true,
        closeAfterCopy: doc.closeAfterCopy !== undefined ? doc.closeAfterCopy : false,
        displayShape: doc.displayShape !== undefined ? doc.displayShape : '1',
      });
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

provide('activeTab', activeTab);
provide('openAddDrawer', openAddDrawer);
provide('settings', settings);

onMounted(() => {
  loadSettings();
});
</script>

<style scoped>
:deep(.n-tab-pane) {
  padding-top: 0 !important;
}
</style>
