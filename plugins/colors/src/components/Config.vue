<script lang="ts" setup>
import { useConfigStore } from "@/utils/config";
import { useCurrentColor } from "@/utils/current-color";
import ColorFormatSelect from "./ColorFormatSelect.vue";
import SettingItem from "./SettingItem.vue";
import ToggleButton from "./ToggleButton.vue";

const config = useConfigStore();
const { currentColor } = useCurrentColor();
</script>
<template>
  <div class="flex flex-col space-y-4">
    <SettingItem label="色值去 #">
      <ToggleButton v-model="config.removeHash" />
    </SettingItem>

    <SettingItem label="复制格式">
      <ColorFormatSelect />
    </SettingItem>
  </div>
</template>
