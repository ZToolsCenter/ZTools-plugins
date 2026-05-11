<template>
  <div class="linux-cmd-doc">
    <div class="doc-container">
      <div class="doc-sidebar">
        <div class="doc-list" ref="listRef">
          <div v-for="cmd in filteredCommandList" :key="cmd.name" class="doc-item"
            :class="{ active: selectedName === cmd }" @click="selectedName = cmd">
            <div class="doc-item-title">{{ cmd.name }}</div>
            <div class="doc-item-desc">{{ cmd.desc }}</div>
          </div>
        </div>
      </div>
      <div class="doc-content">
        <mavon-editor v-model="md" :toolbarsFlag="false" :ishljs="false" :subfield="false" default-open="preview"
          :editable="false" placeholder="" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';

const props = defineProps({
  enterAction: Object
});

const commandList = ref([]);
const filteredCommandList = ref([]);
const selectedName = ref('');
const md = ref('');
const listRef = ref(null);

const readContent = (name) => {
  let content = window.services.readLinuxCmdContent(name);
  if (content && content.length > 0) {
    md.value = content;
  }
};


watch(selectedName, (newCmd) => {
  if (newCmd) {
    readContent(newCmd.name)
  }
});

window.ztools.setSubInput(input => {
  const keyword = input.text.trim().toLocaleLowerCase() || '';
  if (keyword !== "") {
    filteredCommandList.value = commandList.value.filter(cmd =>
      cmd.name.toLowerCase().includes(keyword) || cmd.desc.toLowerCase().includes(keyword)
    );
  } else {
    filteredCommandList.value = [...commandList.value];
  }
}, "输入名称", true)

onMounted(() => {
  commandList.value = window.services.readLinuxCmd();
  filteredCommandList.value = [...commandList.value];
});

</script>

<style scoped>
.linux-cmd-doc {
  width: 100%;
  height: 100%;
  background: #ffffff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.doc-container {
  display: flex;
  width: 100%;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

.doc-sidebar {
  width: 260px;
  background: #ffffff;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}

.doc-list {
  flex: 1;
  padding: 6px;
  overflow-y: auto;
}

.doc-content {
  flex: 1;
  overflow-y: auto;
  max-height: 100vh;
  overflow-x: hidden;
}

.doc-content::-webkit-scrollbar {
  width: 7px;
}

.doc-content::-webkit-scrollbar-thumb {
  background: #000000;
  border-radius: 4px;
}

.doc-content::-webkit-scrollbar-track {
  background: #f5f5f5;
}

.doc-item {
  padding: 6px 8px;
  margin-bottom: 3px;
  background: #ffffff;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid #e0e0e0;
}

.doc-item:hover {
  background: #f5f5f5;
  border-color: #000000;
}

.doc-item.active {
  background: #000000;
  border-color: #000000;
}

.doc-item.active .doc-item-title,
.doc-item.active .doc-item-desc {
  color: #ffffff;
}

.doc-item-title {
  font-size: 13px;
  font-weight: 600;
  color: #000000;
  margin-bottom: 1px;
}

.doc-item-desc {
  font-size: 11px;
  color: #333333;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #000000;
  font-size: 15px;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-top: 1px solid #e0e0e0;
}
</style>
