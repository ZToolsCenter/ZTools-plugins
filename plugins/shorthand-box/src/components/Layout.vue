<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  NLayout,
  NLayoutContent,
  NDrawer,
  NDrawerContent,
  NIcon,
  NButton,
  NSwitch,
  NSpace,
} from 'naive-ui';
import { SettingsOutline } from '@vicons/ionicons5';
import { usePageActions } from '@/composables/usePageActions';
import { useSettings } from '@/composables/useSettings';

const props = defineProps({
  enterAction: {
    type: Object,
    default: () => ({}),
  },
});

const router = useRouter();
const activeKey = ref('1');
const showSettingsDrawer = ref(false);

const { pageActions } = usePageActions();
const { settings, loadSettings, updateSetting } = useSettings();

const menuItems = [
  {
    key: '1',
    label: '数据管理',
    path: '/',
  },
  {
    key: '2',
    label: '项目管理',
    path: '/project-management',
  },
  {
    key: '3',
    label: '数据类型',
    path: '/data-type',
  },
];

const handleMenuClick = (key, path) => {
  activeKey.value = key;
  router.push(path);
};

const openSettings = () => {
  showSettingsDrawer.value = true;
};

onMounted(() => {
  loadSettings();
});
</script>

<template>
  <NLayout style="height: 100vh">
    <div class="header">
      <div class="nav-container">
        <div class="nav-left">
          <div class="nav-cards">
            <div
              v-for="item in menuItems"
              :key="item.key"
              :class="['nav-card', { active: activeKey === item.key }]"
              @click="handleMenuClick(item.key, item.path)"
            >
              <span class="nav-label">{{ item.label }}</span>
            </div>
          </div>
        </div>
        <div class="nav-right">
          <div
            v-if="pageActions"
            class="nav-actions"
          >
            <component :is="pageActions" />
          </div>
          <div class="nav-divider"></div>
          <NButton
            quaternary
            circle
            size="small"
            class="settings-btn"
            @click="openSettings"
          >
            <template #icon>
              <NIcon :size="18">
                <SettingsOutline />
              </NIcon>
            </template>
          </NButton>
        </div>
      </div>
    </div>
    <NLayoutContent class="content">
      <router-view :enterAction="enterAction" />
    </NLayoutContent>

    <NDrawer
      v-model:show="showSettingsDrawer"
      :width="320"
      placement="right"
    >
      <NDrawerContent
        title="系统设置"
        closable
      >
        <div class="settings-list">
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-title">点击复制</div>
              <div class="settings-item-desc">点击表格单元格时自动复制内容</div>
            </div>
            <NSwitch
              :value="settings.clickToCopy"
              @update:value="(val) => updateSetting('clickToCopy', val)"
            />
          </div>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-title">复制提示</div>
              <div class="settings-item-desc">复制成功后显示提示消息</div>
            </div>
            <NSwitch
              :value="settings.showCopyTip"
              @update:value="(val) => updateSetting('showCopyTip', val)"
            />
          </div>
          <div class="settings-item">
            <div class="settings-item-info">
              <div class="settings-item-title">复制后关闭</div>
              <div class="settings-item-desc">复制成功后自动关闭界面</div>
            </div>
            <NSwitch
              :value="settings.copyAfterClose"
              @update:value="(val) => updateSetting('copyAfterClose', val)"
            />
          </div>
        </div>
      </NDrawerContent>
    </NDrawer>
  </NLayout>
</template>

<style scoped>
.n-layout {
  overflow: hidden;
}

.header {
  background-color: #fff;
  border-bottom: 1px solid #e0e0e0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.nav-container {
  display: flex;
  padding: 0 20px;
  height: 44px;
  align-items: center;
  justify-content: space-between;
}

.nav-left {
  display: flex;
  align-items: center;
  height: 100%;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-cards {
  display: flex;
  gap: 0;
  align-items: stretch;
  height: 100%;
}

.nav-card {
  position: relative;
  padding: 0 20px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  transition: all 0.25s ease;
  background-color: transparent;
  display: flex;
  align-items: center;
}

.nav-card::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%) scaleX(0);
  width: 60%;
  height: 3px;
  background-color: #18a058;
  border-radius: 3px 3px 0 0;
  transition: transform 0.25s ease;
}

.nav-card:hover {
  color: #18a058;
}

.nav-card.active {
  color: #18a058;
  font-weight: 600;
}

.nav-card.active::after {
  transform: translateX(-50%) scaleX(1);
}

.nav-label {
  position: relative;
  z-index: 1;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-divider {
  width: 1px;
  height: 20px;
  background-color: #e0e0e0;
  margin: 0 4px;
}

.content {
  padding: 16px;
  background-color: #f5f7f9;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

:deep(.n-layout-content) {
  padding: 10px;
}

.content :deep(.n-layout-content-scroll-container) {
  display: flex;
  flex-direction: column;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid #f0f0f0;
}

.settings-item:last-child {
  border-bottom: none;
}

.settings-item-info {
  flex: 1;
  padding-right: 16px;
}

.settings-item-title {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.settings-item-desc {
  font-size: 12px;
  color: #999;
}

.settings-btn :deep(.n-button__icon) {
  color: #666;
}

.settings-btn:hover :deep(.n-button__icon) {
  color: #18a058;
}

@media (prefers-color-scheme: dark) {
  .header {
    background-color: #1a1a1a;
    border-bottom-color: #333;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .nav-card {
    color: #a0a0a0;
  }

  .nav-card::after {
    background-color: #63e2b7;
  }

  .nav-card:hover {
    color: #63e2b7;
  }

  .nav-card.active {
    color: #63e2b7;
  }

  .nav-divider {
    background-color: #333;
  }

  .content {
    background-color: #121212;
  }

  .settings-item {
    border-bottom-color: #333;
  }

  .settings-item-title {
    color: #e0e0e0;
  }

  .settings-item-desc {
    color: #666;
  }

  .settings-btn :deep(.n-button__icon) {
    color: #a0a0a0;
  }

  .settings-btn:hover :deep(.n-button__icon) {
    color: #63e2b7;
  }
}
</style>
