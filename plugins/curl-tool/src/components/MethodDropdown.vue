<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { HttpMethod } from '../utils/curl/types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

defineProps<{
  modelValue: HttpMethod
}>()

const emit = defineEmits<{
  'update:modelValue': [value: HttpMethod]
}>()

const open = ref(false)

function selectMethod(method: HttpMethod) {
  emit('update:modelValue', method)
  open.value = false
}

function close() {
  open.value = false
}

onMounted(() => window.addEventListener('click', close))
onBeforeUnmount(() => window.removeEventListener('click', close))
</script>

<template>
  <div class="method-dropdown" @click.stop>
    <button class="method-select" @click="open = !open">
      <span :class="`method-${modelValue.toLowerCase()}`">{{ modelValue }}</span>
      <ChevronDown :size="14" :stroke-width="1.8" :class="{ open }" />
    </button>
    <Transition name="dropdown-pop">
      <div v-if="open" class="method-menu">
        <button
          v-for="method in METHODS"
          :key="method"
          :class="[`method-${method.toLowerCase()}`, { active: modelValue === method }]"
          @click="selectMethod(method)"
        >
          {{ method }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.method-dropdown {
  position: relative;
}

.method-select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 112px;
  height: 34px;
  padding: 0 9px 0 10px;
  border: 1px solid #dbe2ea;
  border-radius: 7px;
  background: #fbfdff;
  cursor: pointer;
  font-weight: 800;
}

.method-select svg {
  color: #64748b;
  transition: transform 0.18s ease;
}

.method-select svg.open {
  transform: rotate(180deg);
}

.method-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: grid;
  width: 112px;
  padding: 5px;
  border: 1px solid #dbe2ea;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 14px 36px rgb(15 23 42 / 14%);
  transform-origin: top center;
}

.method-menu button {
  height: 30px;
  padding: 0 9px;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-weight: 800;
}

.method-menu button:hover,
.method-menu button.active {
  background: #f1f3f5;
}

.method-get {
  color: #00a870;
}

.method-post {
  color: #ff6a00;
}

.method-put,
.method-options,
.method-head {
  color: #1683ff;
}

.method-delete {
  color: #ff3b30;
}

.method-patch {
  color: #e44bc4;
}

.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
</style>
