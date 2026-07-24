<script setup>
import { ref, onMounted } from 'vue'
import ConfigForm from '@/components/ConfigForm.vue'
import RunStatus from '@/components/RunStatus.vue'
import { useConfig } from '@/composables/useConfig'

const { isComplete } = useConfig()

// 'config' = show config form; 'run' = execute upload+paste flow
const view = ref('config')
const entry = ref(null)
// Bumped on every plugin enter so RunStatus remounts and re-runs even when the
// renderer process is kept alive by ZTools across exits.
const runId = ref(0)

const RUN_CODES = new Set(['paste-screenshot-path', 'copy-screenshot-path'])

function decideView(param) {
  entry.value = param || null
  if (RUN_CODES.has(param?.code)) {
    view.value = isComplete() ? 'run' : 'config'
    runId.value += 1
  } else {
    view.value = 'config'
  }
}

onMounted(() => {
  if (window.ztools?.onPluginEnter) {
    window.ztools.onPluginEnter((param) => decideView(param))
  } else {
    view.value = 'config'
  }
})

function onConfigSaved() {}
function onNeedConfig() { view.value = 'config' }
</script>

<template>
  <main style="padding:16px;max-width:640px;margin:0 auto">
    <ConfigForm v-if="view === 'config'" @saved="onConfigSaved" />
    <RunStatus v-else :key="runId" :entry="entry" @need-config="onNeedConfig" />
  </main>
</template>
