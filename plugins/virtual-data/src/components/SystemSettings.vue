<template>
  <div class="system-settings">
    <n-card>
      <n-space vertical>
        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">点击复制</div>
            <div class="setting-description">点击按钮或列表项时自动复制生成的数据</div>
          </div>
          <n-switch
            v-model:value="settings.clickToCopy"
            @update:value="handleSettingChange"
          />
        </div>

        <n-divider />

        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">复制后提示</div>
            <div class="setting-description">复制成功后显示提示消息</div>
          </div>
          <n-switch
            v-model:value="settings.showCopyTip"
            @update:value="handleSettingChange"
          />
        </div>

        <n-divider />

        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">复制后关闭</div>
            <div class="setting-description">复制成功后自动关闭窗口</div>
          </div>
          <n-switch
            v-model:value="settings.closeAfterCopy"
            @update:value="handleSettingChange"
          />
        </div>
      </n-space>
    </n-card>
  </div>
</template>

<script setup>
import { inject } from 'vue';
import { useMessage } from 'naive-ui';

const SETTINGS_ID = 'settings-main';
const message = useMessage();

const settings = inject('settings');

async function handleSettingChange() {
  try {
    const existingDoc = await ztools.db.promises.get(SETTINGS_ID);

    const settingsData = {
      _id: SETTINGS_ID,
      ...settings,
      updatedAt: Date.now(),
    };

    if (existingDoc) {
      await ztools.db.promises.put({
        ...settingsData,
        _rev: existingDoc._rev,
      });
    } else {
      await ztools.db.promises.put(settingsData);
    }
  } catch (error) {
    console.error('保存设置失败:', error);
  }
}
</script>

<style scoped>
.system-settings {
  height: 100%;
  background: #fff;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  padding: 16px;
  height: calc(100vh - 71px);
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.setting-info {
  flex: 1;
  margin-right: 16px;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
}

.setting-description {
  font-size: 12px;
  color: #999;
}
</style>
