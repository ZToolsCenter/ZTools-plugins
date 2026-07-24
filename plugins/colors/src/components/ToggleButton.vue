<script lang="ts" setup>
import { useCurrentColor } from "@/utils/current-color";

interface Props {
  modelValue: boolean;
}

const currentColorStore = useCurrentColor();

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const toggle = () => {
  emit("update:modelValue", !props.modelValue);
};
</script>

<template>
  <button
    type="button"
    :class="['relative h-6 w-11 rounded-full p-0 outline outline-[color:currentColor]']"
    :style="{ backgroundColor: currentColorStore.currentColor.toHex() }"
    @click="toggle"
  >
    <span
      :class="[
        'absolute top-0.5 left-0.5 h-5 w-5 translate-y-[0.5px] rounded-full bg-[color:currentColor] transition-transform',
        modelValue ? 'translate-x-5' : 'translate-x-0',
      ]"
    />
  </button>
</template>
