<script setup lang="ts">
import { computed } from "vue";
import { ref } from "vue";
import Card from "@/components/Card.vue";
import ColorFormats from "@/components/ColorFormats.vue";
import ColorWheel from "@/components/ColorWheel.vue";
import HarmonyColors from "@/components/HarmonyColors.vue";
import SaturationSlider from "@/components/SaturationSlider.vue";
import ValueSlider from "@/components/ValueSlider.vue";
import { useCounterStore } from "@/utils/config";
import { useCurrentColor } from "@/utils/current-color";

const currentColorStore = useCurrentColor();
const currentColor = computed({
  get: () => currentColorStore.currentColor,
  set: (value) => currentColorStore.setCurrentColor(value),
});
const config = useCounterStore();
</script>
<template>
  <!-- 取色器页面 -->
  <div class="grid grid-cols-12 gap-6">
    <!-- 色轮和滑块 -->
    <Card>
      <div class="mb-6 flex justify-center">
        <ColorWheel v-model="currentColor" />
      </div>
      <div class="space-y-4">
        <SaturationSlider v-model="currentColor" />
        <ValueSlider v-model="currentColor" />
      </div>
    </Card>

    <!-- 和谐色 -->
    <Card>
      <HarmonyColors :color="currentColor" />
    </Card>

    <!-- 颜色格式显示 -->

    <Card>
      <ColorFormats v-model="currentColor" />
    </Card>

    <!-- 操作栏 -->
    <Card>
      <div class="flex items-center space-x-4">
        <label class="flex cursor-pointer items-center space-x-2">
          <input
            :value="config.removeHash"
            @input="($event: any) => config.$patch({ removeHash: $event.target.checked })"
            type="checkbox"
            class="rounded text-blue-600"
          />
          <span class="text-sm">色值去 "#"</span>
        </label>
      </div>
    </Card>
  </div>
</template>
