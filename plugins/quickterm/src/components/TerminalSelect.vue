<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { settings, terminals, saveSettings, refreshTerminals } from '../store'

const model = computed({
  get: () => settings.value.defaultTerminal,
  set: (v: string) => {
    settings.value.defaultTerminal = v as typeof settings.value.defaultTerminal
    saveSettings()
  }
})

function onChange() {
  ElMessage.success('默认终端已保存')
}

// Git Bash 自动探测失败时，手动指定 bash.exe 安装路径
function setGitBashPath() {
  ElMessageBox.prompt('填写 bash.exe 完整路径，例如 C:\\Program Files\\Git\\bin\\bash.exe', 'Git Bash 安装路径', {
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    inputValue: settings.value.gitBashPath || ''
  })
    .then(({ value }) => {
      const p = (value || '').trim()
      if (!p) return
      settings.value.gitBashPath = p
      saveSettings()
      refreshTerminals()
      ElMessage.success('已保存并重新探测')
    })
    .catch(() => {})
}
</script>

<template>
  <div class="qt-term-select">
    <span class="qt-term-label">默认终端</span>
    <el-select v-model="model" size="small" placeholder="自动探测" style="width: 170px" @change="onChange">
      <el-option label="自动探测" value="auto" />
      <el-option
        v-for="t in terminals"
        :key="t.type"
        :label="t.label + (t.available ? '' : '（未安装）')"
        :value="t.type"
        :disabled="!t.available"
      />
    </el-select>
    <el-button
      v-if="terminals.some((t) => t.type === 'gitbash' && !t.available)"
      link
      type="primary"
      size="small"
      @click="setGitBashPath"
    >
      设置 Git Bash 路径
    </el-button>
  </div>
</template>

<style scoped>
.qt-term-select {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qt-term-label {
  font-size: 12px;
  color: var(--el-text-color-secondary, var(--text-color, #909399));
  white-space: nowrap;
}
</style>
