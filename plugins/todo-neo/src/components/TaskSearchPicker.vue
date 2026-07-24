<script setup lang="ts">
import { nextTick, watch } from 'vue'
import searchIcon from '../assets/icons/search.svg'
import { useTodoStore } from '../composables/useTodoStore'
import { plainTextInputAttrs } from '../utils/inputAttrs'
import SvgIcon from './SvgIcon.vue'

const store = useTodoStore()

function revealActiveResult() {
  nextTick(() => {
    document.querySelector<HTMLElement>('.search-result.active')?.scrollIntoView({ block: 'nearest' })
  })
}

function moveSelection(delta: number) {
  store.moveTaskSearchSelection(delta)
  revealActiveResult()
}

watch(() => store.taskSearchResults.value, revealActiveResult)
</script>

<template>
  <div v-if="store.taskSearchOpen.value" class="search-picker-layer" @mousedown.self="store.closeTaskSearch">
    <section class="search-picker" role="dialog" aria-label="搜索待办">
      <label class="search-box">
        <SvgIcon class="search-icon" :src="searchIcon" />
        <input
          v-bind="plainTextInputAttrs"
          class="task-search-input"
          :value="store.taskSearchQuery.value"
          placeholder="搜索待办"
          @input="store.updateTaskSearchQuery(($event.target as HTMLInputElement).value)"
          @keydown.down.prevent.stop="moveSelection(1)"
          @keydown.up.prevent.stop="moveSelection(-1)"
          @keydown.enter.prevent.stop="store.confirmTaskSearchSelection()"
          @keydown.esc.prevent.stop="store.closeTaskSearch"
        />
        <span class="search-key">/</span>
      </label>

      <div class="search-results">
        <button
          v-for="(result, index) in store.taskSearchResults.value"
          :key="result.task._id"
          class="search-result"
          :class="{ active: index === store.taskSearchIndex.value, done: result.task.completed }"
          @mousedown.prevent
          @click="store.confirmTaskSearchSelection(result)"
        >
          <span class="result-group">{{ result.group.title }}</span>
          <span class="result-text">{{ result.task.text }}</span>
        </button>

        <div v-if="!store.taskSearchResults.value.length" class="search-empty">无匹配</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.search-picker-layer {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  align-items: start;
  justify-items: center;
  padding-top: 54px;
  user-select: none;
}

.search-picker {
  width: min(520px, calc(100vw - 36px));
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
}

.search-box {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.search-icon {
  color: var(--muted);
}

.task-search-input {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 15px;
  outline: none;
  user-select: text;
}

.search-key {
  display: inline-grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 5px;
  color: var(--muted);
  font-size: 13px;
}

.search-results {
  display: grid;
  gap: 2px;
  max-height: 360px;
  padding: 6px;
  overflow: auto;
}

.search-result {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  min-height: 38px;
  padding: 8px 10px;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.search-result:hover,
.search-result.active {
  background: rgba(124, 140, 255, 0.14);
}

.result-group {
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-text {
  overflow: hidden;
  font-size: 14px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-result.done .result-text {
  color: var(--muted);
  text-decoration: line-through;
}

.search-empty {
  display: grid;
  min-height: 54px;
  place-items: center;
  color: var(--muted);
  font-size: 13px;
}

@media (prefers-color-scheme: dark) {
  .search-picker {
    border-color: rgba(255, 255, 255, 0.13);
    background: rgba(34, 34, 34, 0.82);
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(28px) saturate(135%);
  }

  .search-box {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .search-key {
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.04);
  }

  .search-result:hover,
  .search-result.active {
    background: rgba(124, 140, 255, 0.18);
  }
}
</style>
