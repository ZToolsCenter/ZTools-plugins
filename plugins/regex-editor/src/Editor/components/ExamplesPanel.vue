<script setup lang="ts">
import { computed } from 'vue'
import { REGEX_CATEGORIES, REGEX_EXAMPLES } from '../../data/examples'
import type { RegexExample } from '../../data/examples'

const props = defineProps<{
  activeCategory: string
}>()

const emit = defineEmits<{
  select: [example: RegexExample]
  'update:activeCategory': [category: string]
}>()

const filtered = computed(() => {
  if (props.activeCategory === '全部') return REGEX_EXAMPLES
  return REGEX_EXAMPLES.filter((e) => e.category === props.activeCategory)
})

function setCategory(cat: string) {
  emit('update:activeCategory', cat)
}
</script>

<template>
  <div class="examples-panel">
    <h3 class="panel-title">常用范例</h3>
    <div class="category-tabs">
      <button
        v-for="cat in REGEX_CATEGORIES"
        :key="cat"
        class="cat-btn"
        :class="{ active: activeCategory === cat }"
        @click="setCategory(cat)"
      >
        {{ cat }}
      </button>
    </div>
    <ul class="example-list">
      <li
        v-for="item in filtered"
        :key="item.id"
        class="example-item"
        @click="emit('select', item)"
      >
        <span class="example-name">{{ item.name }}</span>
        <span class="example-desc">{{ item.description }}</span>
        <code class="example-pattern">{{ item.pattern }}</code>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.examples-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.panel-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.cat-btn {
  padding: 4px 10px;
  line-height: 1.4;
  font-size: 12px;
  border-radius: 6px;
  background: var(--panel-bg);
  color: inherit;
  border: 1px solid var(--border-color);
}

.cat-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.example-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.example-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}

.example-item:hover {
  background: var(--hover-bg);
  border-color: var(--border-color);
}

.example-name {
  display: block;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 2px;
}

.example-desc {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.example-pattern {
  display: block;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
