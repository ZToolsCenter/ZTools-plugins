<script setup lang="ts">
import { LoaderCircle, Search } from 'lucide-vue-next'
import { ref } from 'vue'

const props = defineProps<{
  modelValue: string
  loading: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  search: []
}>()

const searchInput = ref<HTMLInputElement | null>(null)

function submit(): void {
  if (!props.loading) emit('search')
}

function focusSearch(selectAll = false): void {
  searchInput.value?.focus()
  if (selectAll) searchInput.value?.select()
}

defineExpose({ focusSearch })
</script>

<template>
  <header class="app-header">
    <div class="brand-lockup">
      <img src="/logo.png" alt="" class="brand-logo" />
      <div>
        <h1>图标检索</h1>
        <p>ICONIFY API</p>
      </div>
    </div>

    <form class="search-form" role="search" @submit.prevent="submit">
      <Search :size="19" aria-hidden="true" />
      <input
        ref="searchInput"
        :value="modelValue"
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="搜索图标，例如 home、设置、arrow"
        aria-label="搜索图标"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button class="icon-button search-button" type="submit" :disabled="loading" title="搜索" aria-label="搜索">
        <LoaderCircle v-if="loading" class="spin" :size="19" aria-hidden="true" />
        <Search v-else :size="19" aria-hidden="true" />
      </button>
    </form>
  </header>
</template>
