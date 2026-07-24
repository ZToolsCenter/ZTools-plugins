<template>
  <n-drawer
    v-model:show="visible"
    :width="380"
    placement="right"
  >
    <n-drawer-content
      title="设置"
      closable
    >
      <n-form
        :model="formData"
        label-placement="left"
        label-width="90"
        label-align="left"
      >
        <n-form-item label="APP ID">
          <n-input
            v-model:value="formData.appId"
            type="password"
            show-password-on="click"
            placeholder="请输入百度翻译 APP ID"
          />
        </n-form-item>

        <n-form-item label="密钥">
          <n-input
            v-model:value="formData.appKey"
            type="password"
            show-password-on="click"
            placeholder="请输入百度翻译密钥"
          />
        </n-form-item>

        <n-form-item label="开放平台">
          <n-button
            text
            type="primary"
            @click="clickOpenPlatform"
          >
            百度翻译开放平台
          </n-button>
        </n-form-item>

        <n-divider />

        <n-form-item label="翻译模式">
          <n-radio-group v-model:value="formData.translateMode">
            <n-radio-button value="realtime">实时翻译</n-radio-button>
            <n-radio-button value="click">点击翻译</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item
          v-if="formData.translateMode === 'realtime'"
          label="延迟时间"
        >
          <div class="delay-row">
            <n-slider
              v-model:value="formData.delayTime"
              :min="sliderMin"
              :max="sliderMax"
            />
            <span class="delay-value">{{ formData.delayTime }}ms</span>
          </div>
        </n-form-item>

        <n-divider />

        <n-form-item label="选择后复制">
          <n-switch v-model:value="formData.copyOnSelect" />
        </n-form-item>

        <n-form-item label="选择后关闭">
          <n-switch v-model:value="formData.closeOnSelect" />
        </n-form-item>
      </n-form>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { computed, watch } from 'vue';
import { getConfig, saveConfig, sliderMarkers } from '@/utils/config';
import { copyContent } from '@/utils/copy-content';
import { useMessage } from 'naive-ui';

const visible = defineModel({ default: false });

const sliderKeys = computed(() =>
  Object.keys(sliderMarkers)
    .map(Number)
    .sort((a, b) => a - b)
);
const sliderMin = computed(() => sliderKeys.value[0]);
const sliderMax = computed(() => sliderKeys.value[sliderKeys.value.length - 1]);

const formData = reactive({
  appId: '',
  appKey: '',
  translateMode: 'realtime',
  delayTime: 500,
  copyOnSelect: true,
  closeOnSelect: true,
});

const message = useMessage();
const clickOpenPlatform = () => {
  copyContent('https://fanyi-api.baidu.com/manage/developer');
  message.success('已复制百度翻译开放平台链接');
};

watch(visible, (val) => {
  if (val) {
    const config = getConfig();
    if (config) {
      formData.appId = config.appId;
      formData.appKey = config.appKey;
      formData.translateMode = config.translateMode;
      formData.delayTime = config.delayTime;
      formData.copyOnSelect = config.copyOnSelect;
      formData.closeOnSelect = config.closeOnSelect;
    }
  }
});

watch(
  () => formData.delayTime,
  (val) => {
    const nearestKey = sliderKeys.value.reduce((prev, curr) =>
      Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev
    );
    if (formData.delayTime !== nearestKey) {
      formData.delayTime = nearestKey;
    }
  }
);

watch(
  () => [
    formData.appId,
    formData.appKey,
    formData.translateMode,
    formData.delayTime,
    formData.copyOnSelect,
    formData.closeOnSelect,
  ],
  () => {
    saveConfig({
      appId: formData.appId.trim(),
      appKey: formData.appKey.trim(),
      translateMode: formData.translateMode,
      delayTime: formData.delayTime,
      copyOnSelect: formData.copyOnSelect,
      closeOnSelect: formData.closeOnSelect,
    });
  }
);
</script>

<style scoped>
:deep(.n-form-item) {
  margin-bottom: 16px;
}

:deep(.n-form-item:last-child) {
  margin-bottom: 0;
}

:deep(.n-divider) {
  margin: 8px 0 20px;
}

.delay-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.delay-row :deep(.n-slider) {
  flex: 1;
}

.delay-value {
  font-size: 13px;
  color: var(--n-text-color-2);
  white-space: nowrap;
  min-width: 50px;
  text-align: right;
}
</style>
