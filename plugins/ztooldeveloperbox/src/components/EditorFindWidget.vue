<script setup lang="ts">
import { ref } from 'vue'

const searchQuery = defineModel<string>('searchQuery', { required: true })
const replaceQuery = defineModel<string>('replaceQuery', { required: true })
const caseSensitive = defineModel<boolean>('caseSensitive', { default: false })
const wholeWord = defineModel<boolean>('wholeWord', { default: false })
const useRegex = defineModel<boolean>('useRegex', { default: false })
const replaceExpanded = defineModel<boolean>('replaceExpanded', { default: false })

defineProps<{
  statusText: string
}>()

defineEmits<{
  previous: []
  next: []
  replace: []
  replaceAll: []
  close: []
  searchKeydown: [event: KeyboardEvent]
}>()

const searchInputRef = ref<HTMLInputElement | null>(null)

const focusSearch = () => {
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
}

defineExpose({ focusSearch })
</script>

<template>
  <div class="find-widget">
    <div class="find-widget__row">
      <button
        type="button"
        class="find-widget__toggle"
        :class="{ 'find-widget__toggle--expanded': replaceExpanded }"
        title="切换替换"
        @mousedown.prevent
        @click="replaceExpanded = !replaceExpanded"
      >
        ›
      </button>

      <div class="find-widget__input-wrap">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          class="find-widget__input"
          type="text"
          placeholder="查找"
          spellcheck="false"
          @keydown="$emit('searchKeydown', $event)"
        />
        <div class="find-widget__toggles">
          <button
            type="button"
            class="find-widget__option"
            :class="{ 'find-widget__option--active': caseSensitive }"
            title="区分大小写"
            @mousedown.prevent
            @click="caseSensitive = !caseSensitive"
          >
            Aa
          </button>
          <button
            type="button"
            class="find-widget__option"
            :class="{ 'find-widget__option--active': wholeWord }"
            title="全字匹配"
            @mousedown.prevent
            @click="wholeWord = !wholeWord"
          >
            ab
          </button>
          <button
            type="button"
            class="find-widget__option"
            :class="{ 'find-widget__option--active': useRegex }"
            title="正则表达式"
            @mousedown.prevent
            @click="useRegex = !useRegex"
          >
            .*
          </button>
        </div>
      </div>

      <span class="find-widget__status">{{ statusText }}</span>

      <button type="button" class="find-widget__icon-btn" title="上一个 (Shift+Enter)" @mousedown.prevent @click="$emit('previous')">
        ▲
      </button>
      <button type="button" class="find-widget__icon-btn" title="下一个 (Enter)" @mousedown.prevent @click="$emit('next')">
        ▼
      </button>
      <button type="button" class="find-widget__icon-btn find-widget__icon-btn--close" title="关闭 (Esc)" @mousedown.prevent @click="$emit('close')">
        ×
      </button>
    </div>

    <div v-if="replaceExpanded" class="find-widget__row">
      <span class="find-widget__spacer" />

      <div class="find-widget__input-wrap">
        <input
          v-model="replaceQuery"
          class="find-widget__input"
          type="text"
          placeholder="替换"
          spellcheck="false"
          @keydown="$emit('searchKeydown', $event)"
        />
      </div>

      <span class="find-widget__status find-widget__status--placeholder" />

      <button type="button" class="find-widget__icon-btn" title="替换" @mousedown.prevent @click="$emit('replace')">
        ↻
      </button>
      <button type="button" class="find-widget__icon-btn" title="全部替换" @mousedown.prevent @click="$emit('replaceAll')">
        ≡
      </button>
      <span class="find-widget__icon-placeholder" />
    </div>
  </div>
</template>

<style scoped>
.find-widget {
  position: absolute;
  top: 8px;
  right: 16px;
  z-index: 5;
  width: min(460px, calc(100% - 24px));
  padding: 4px;
  border: 1px solid #c8c8c8;
  border-radius: 4px;
  background: #f3f3f3;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.find-widget__row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.find-widget__row + .find-widget__row {
  margin-top: 4px;
}

.find-widget__toggle {
  width: 20px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  line-height: 1;
  font-size: 14px;
  cursor: pointer;
  transform: rotate(0deg);
  transition: transform 0.15s;
}

.find-widget__toggle--expanded {
  transform: rotate(90deg);
}

.find-widget__spacer {
  width: 20px;
  flex-shrink: 0;
}

.find-widget__input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.find-widget__input {
  width: 100%;
  height: 26px;
  padding: 0 88px 0 8px;
  border: 1px solid #ccc;
  border-radius: 2px;
  font-size: 13px;
  box-sizing: border-box;
  background: #fff;
  color: inherit;
}

.find-widget__toggles {
  position: absolute;
  top: 1px;
  right: 2px;
  display: flex;
  gap: 1px;
}

.find-widget__option {
  width: 24px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: #666;
  font-size: 11px;
  line-height: 22px;
  cursor: pointer;
}

.find-widget__option--active {
  background: rgba(88, 164, 246, 0.2);
  color: var(--blue);
}

.find-widget__status {
  min-width: 52px;
  font-size: 12px;
  text-align: center;
  white-space: nowrap;
  opacity: 0.85;
}

.find-widget__status--placeholder,
.find-widget__icon-placeholder {
  width: 20px;
  flex-shrink: 0;
}

.find-widget__icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 24px;
  cursor: pointer;
}

.find-widget__icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

.find-widget__icon-btn--close {
  font-size: 16px;
}

@media (prefers-color-scheme: dark) {
  .find-widget {
    background: #2d2d2d;
    border-color: #555;
  }

  .find-widget__input {
    background: #1e1e1e;
    border-color: #555;
  }

  .find-widget__option {
    color: #aaa;
  }

  .find-widget__icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}
</style>
