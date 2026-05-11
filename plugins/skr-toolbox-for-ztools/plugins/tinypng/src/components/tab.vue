<template>
  <div class="tab">
    <span v-for="(it, idx) in list" :key="idx" @click="$emit('update:modelValue', idx)" :data-active="idx === modelValue" ref="els">
      <template v-if="idx === list.length - 1">
        {{ dayjs(it.date).fromNow() }}
      </template>
      <template v-else>
        {{ `${dayjs(it.date).fromNow()} - ${it.images.length}张` }}
      </template>
    </span>
  </div>
</template>

<style lang="scss" scoped>
.tab {
  position: relative;
  width: 100%;
  height: 50px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;

  &::-webkit-scrollbar {
    display: none;
  }

  &:before {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 160px;
    height: 2px;
    background: #90caf9;
    transform: translateX(calc(100% * v-bind(modelValue)));
    transition: transform 0.3s ease-in-out;
  }

  span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 160px;
    height: 100%;
    overflow: hidden;
    transition: color 0.3s ease-in-out;

    &[data-active='true'] {
      color: #90caf9;
    }
  }
}
</style>

<script lang="ts" setup>
import dayjs from 'dayjs';
import { nextTick, PropType, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  list: { type: Array as PropType<TinypngConfig.List[]>, default: [] }
});

defineEmits(['update:modelValue']);

const els = ref<HTMLSpanElement[]>([]);

watch(
  () => props.modelValue,
  () => nextTick(() => els.value[props.modelValue]?.scrollIntoView({ behavior: 'smooth', inline: 'center' }))
);
</script>
