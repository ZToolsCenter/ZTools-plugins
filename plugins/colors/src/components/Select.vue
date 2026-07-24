<script lang="ts" setup>
import { computed } from "vue";

interface Option {
  value: string;
  label: string;
}

interface Props {
  modelValue: string;
  options: Option[];
  id?: string;
  placeholder?: string;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  id: "",
  placeholder: "",
  class: "",
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const selectClass = computed(() => {
  return (
    props.class ||
    "cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium shadow-sm backdrop-blur-sm duration-0 hover:shadow-md focus:ring-2 focus:outline-none"
  );
});

const updateValue = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  emit("update:modelValue", target.value);
};
</script>

<template>
  <select :id="id" :value="modelValue" @change="updateValue" :class="selectClass">
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>
