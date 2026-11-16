<script setup lang="ts">
import { toast } from './bridge';
const props = defineProps<{ label: string; value: number; min: number; max: number }>();
const emit = defineEmits<{ change: [value: number] }>();
function update(event: Event) {
  const input = event.target as HTMLInputElement, next = Number(input.value);
  if (!Number.isInteger(next) || (next !== 0 && (next < props.min || next > props.max))) {
    input.value = props.value ? String(props.value) : '';
    toast(`请输入 ${props.min}～${props.max} 的整数，或点击“自动”`, true);
    return;
  }
  emit('change', next);
}
</script>
<template>
  <div class="setting-row dimension-row"><span><strong>{{ label }}</strong><small>{{min}}～{{max}} px</small></span>
    <div class="dimension-control"><button type="button" :aria-label="`${label}恢复自动`" :aria-pressed="value === 0" @click="emit('change',0)">自动</button><label><input :aria-label="label" type="number" min="0" :max="max" step="1" :value="value || ''" placeholder="自动" @change="update"><span>px</span></label></div>
  </div>
</template>
