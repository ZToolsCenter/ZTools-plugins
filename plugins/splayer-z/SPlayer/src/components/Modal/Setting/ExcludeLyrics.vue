<template>
  <div class="exclude">
    <n-alert :show-icon="false">请勿添加过多，以免影响歌词的正常显示</n-alert>

    <n-tabs v-model:value="page" animated>
      <n-tab-pane name="keywords" tab="关键词">
        <n-scrollbar style="max-height: 70vh">
          <n-flex vertical :size="12">
            <n-dynamic-tags v-model:value="settingStore.excludeUserKeywords" />
            <n-button type="primary" strong secondary size="small" @click="resetUserKeywords">
              重置规则
            </n-button>
          </n-flex>
        </n-scrollbar>
      </n-tab-pane>

      <n-tab-pane name="regexes" tab="正则表达式">
        <n-scrollbar style="max-height: 70vh">
          <n-flex vertical :size="12">
            <n-dynamic-tags v-model:value="settingStore.excludeUserRegexes" />
            <n-button type="primary" strong secondary size="small" @click="resetUserRegexes">
              重置规则
            </n-button>
          </n-flex>
        </n-scrollbar>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";

const settingStore = useSettingStore();

const page = ref("keywords");

// 重置规则
const resetUserKeywords = () => {
  window.$dialog.warning({
    title: "重置确认",
    content: "确认清空所有关键词规则？该操作不可撤销！",
    positiveText: "确认",
    negativeText: "取消",
    onPositiveClick: () => {
      settingStore.excludeUserKeywords = [];
      window.$message.success("关键词规则已清空");
    },
  });
};

const resetUserRegexes = () => {
  window.$dialog.warning({
    title: "重置确认",
    content: "确认清空所有正则表达式规则？该操作不可撤销！",
    positiveText: "确认",
    negativeText: "取消",
    onPositiveClick: () => {
      settingStore.excludeUserRegexes = [];
      window.$message.success("正则表达式规则已清空");
    },
  });
};
</script>

<style lang="scss" scoped>
.exclude {
  .n-alert {
    margin-bottom: 20px;
  }
}
</style>
