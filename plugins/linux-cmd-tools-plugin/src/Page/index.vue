<template>
  <div class="page">
    <div class="list">
      <VistualList ref="listRef" :list="filteredList" :height="pageHeight" :item-height="60" :item-key="item => item.n" :buffer="20" v-slot="{ item, index }">
        <div class="item" @click="currentPage = item.n">
          <div class="item_title">{{ item.n }}</div>
          <div class="item_desc">{{ item.d }}</div>
        </div>
      </VistualList>
    </div>
    <div class="content">
      <component v-if="commands[currentPage]" :is="commands[currentPage]" />
      <div v-else class="placeholder-page">
        点击左侧列表查看
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { type Component, computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import VistualList from '../components/vistual-list.vue'
import cmdData from 'linux-command'

const modules = import.meta.glob('../command/*.md', { eager: true })
const commands = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => {
    const name = path.split('/').pop()!.replace('.md', '')
    return [name, (mod as any).default as Component]
  })
)

const listRef = useTemplateRef('listRef')

const cmdList = ref(Object.values(cmdData))
const windowHeight = ref(window.innerHeight)

const pageHeight = computed(() => windowHeight.value)

const updateHeight = () => {
  windowHeight.value = window.innerHeight
}

const searchStr = ref('')

const filteredList = computed(() => (searchStr.value ? cmdList.value.filter(v => v.n.includes(searchStr.value) || v.d.includes(searchStr.value)) : cmdList.value))

const currentPage = ref(filteredList.value[0]?.n ?? '')

let debTimer = 0

onMounted(() => {
  window.addEventListener('resize', updateHeight)
  window.ztools.setSubInput(
    ({ text }) => {
      clearTimeout(debTimer)
      debTimer = setTimeout(() => {
        searchStr.value = text
      }, 500)
    },
    '输入内容以搜索',
    true
  )
})
onUnmounted(() => {
  window.removeEventListener('resize', updateHeight)
})
</script>
<style scoped>
.page {
  display: flex;
  height: 100vh;
}
.list {
  width: 230px;
  height: 100%;
  border-right: 2px gray solid;
  flex-shrink: 0;
}
.content {
  height: calc(100% - 20px);
  padding: 10px;
  flex: 1;
  min-width: 0;
  overflow-y: scroll;
  .markdown-body {
    & > * {
      overflow-wrap: break-word;
      white-space: pre-wrap;
    }
    & > :deep(pre) {
      padding: 5px;
      border-radius: 3px;
      background-color: light-dark(#1112, #fff2);
    }
  }
}

.item {
  height: calc(100% - 10px);
  padding: 5px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  &:hover {
    background-color: light-dark(#1112, #fff2);
  }
}
.item_title {
  width: 100%;
}
.item_desc {
  width: 100%;
  color: gray;
  font-size: small;
}
</style>
