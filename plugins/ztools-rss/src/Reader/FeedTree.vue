<script setup lang="ts">
import { computed } from 'vue'
import { type TreeNode, SPECIAL_ALL, SPECIAL_STARRED } from './types'
import { store, selectNode, toggleFolder } from './store'

const tree = computed(() => store.tree)

function badgeClass(n: { type: TreeNode['type'] }): string {
  return n.type === 'feed' ? 'dot' : 'count'
}
</script>

<template>
  <div class="tree">
    <template v-for="node in tree" :key="node.id">
      <div
        v-if="node.type !== 'folder'"
        class="tree-item"
        :class="{ active: store.selectedNodeId === node.id }"
        @click="selectNode(node.id)"
      >
        <span class="tree-icon">
          <img v-if="node.iconUrl" :src="node.iconUrl" alt="" />
          <span v-else-if="node.id === SPECIAL_ALL" class="glyph">≡</span>
          <span v-else-if="node.id === SPECIAL_STARRED" class="glyph">★</span>
          <span v-else class="glyph">·</span>
        </span>
        <span class="tree-title" :title="node.title">{{ node.title }}</span>
        <span v-if="node.unread > 0" :class="['unread', badgeClass(node)]">{{ node.unread }}</span>
      </div>

      <div v-else class="folder">
        <div class="tree-item folder-head" @click="toggleFolder(node.id)">
          <span class="caret" :class="{ open: !node.collapsed }">▸</span>
          <span class="tree-title" :title="node.title">{{ node.title }}</span>
          <span v-if="node.unread > 0" class="unread count">{{ node.unread }}</span>
        </div>
        <div v-show="!node.collapsed" class="folder-children">
          <div
            v-for="child in node.children"
            :key="child.id"
            class="tree-item feed"
            :class="{ active: store.selectedNodeId === child.id }"
            @click="selectNode(child.id)"
          >
            <span class="tree-icon small">
              <img v-if="child.iconUrl" :src="child.iconUrl" alt="" />
              <span v-else class="glyph">·</span>
            </span>
            <span class="tree-title" :title="child.title">{{ child.title }}</span>
            <span v-if="child.unread > 0" class="unread dot">{{ child.unread }}</span>
          </div>
        </div>
      </div>
    </template>
    <div v-if="!tree.length" class="tree-empty">无订阅源</div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
}
.tree-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 6px;
  user-select: none;
}
.tree-item:hover {
  background: var(--rss-hover);
}
.tree-item.active {
  background: var(--rss-accent-soft);
  color: var(--rss-accent);
}
.tree-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tree-icon img {
  width: 16px;
  height: 16px;
  border-radius: 3px;
}
.tree-icon.small img {
  width: 14px;
  height: 14px;
}
.glyph {
  font-size: 13px;
  opacity: 0.7;
}
.tree-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feed {
  padding-left: 30px;
}
.unread {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
}
.unread.count {
  min-width: 18px;
  text-align: center;
  color: var(--rss-text-soft);
}
.unread.dot {
  color: var(--rss-accent);
}
.caret {
  width: 12px;
  font-size: 10px;
  transition: transform 0.15s;
  opacity: 0.6;
}
.caret.open {
  transform: rotate(90deg);
}
.folder-head {
  font-weight: 600;
}
.tree-empty {
  padding: 20px 12px;
  text-align: center;
  color: var(--rss-text-dim);
  font-size: 12px;
}
</style>
