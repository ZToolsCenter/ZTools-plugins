<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import ChatArea from './components/ChatArea.vue'
import { useChat } from './useChat'

const { loadConversations, newConversation, conversations, sendMessage } = useChat()

const SIDEBAR_KEY = 'sidebar_visible'
const saved = window.ztools.dbStorage.getItem(SIDEBAR_KEY)
const sidebarVisible = ref(saved !== null ? saved : true)

function toggleSidebar() {
  sidebarVisible.value = !sidebarVisible.value
  window.ztools.dbStorage.setItem(SIDEBAR_KEY, sidebarVisible.value)
}

onMounted(() => {
  loadConversations()
  if (!conversations.value.length) {
    newConversation()
  }

  window.ztools.onPluginEnter((action: any) => {
    if (action.type === 'over' && action.payload) {
      newConversation()
      sendMessage(action.payload)
    }
  })
})
</script>

<template>
  <div class="app-layout">
    <Sidebar :visible="sidebarVisible" @toggle="toggleSidebar" />
    <div class="main-area">
      <div class="top-bar" v-if="!sidebarVisible">
        <button class="btn-toggle" @click="toggleSidebar" title="展开侧边栏">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
      </div>
      <ChatArea />
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg);
}
.top-bar {
  padding: 8px 12px 0;
}
.btn-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s;
}
.btn-toggle:hover { background: var(--hover); }
</style>
