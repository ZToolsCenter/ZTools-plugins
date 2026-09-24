<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LoadingMask from './LoadingMask.vue'
import JsonView from './JsonView.vue'

const loading = ref(false)
const error = ref('')
const health = ref<unknown>(null)
const info = ref<unknown>(null)
const nodes = ref<unknown>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [h, i, n] = await Promise.all([
      window.services.clusterHealth(),
      window.services.clusterInfo(),
      window.services.listNodes(),
    ])
    if (!h.ok) throw new Error(h.error?.message || `health HTTP ${h.status}`)
    health.value = h.body
    info.value = i.ok ? i.body : { error: i.error }
    nodes.value = n.ok ? n.body : { error: n.error }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="relative">
    <LoadingMask :show="loading" text="正在加载集群信息…" />
    <div class="hrow" style="margin-bottom: 10px">
      <button class="btn btn-primary" type="button" :disabled="loading" @click="load">
        {{ loading ? '加载中…' : '刷新集群信息' }}
      </button>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-else class="cols">
      <section class="panel">
        <JsonView title="Cluster Health" :value="health" />
      </section>
      <section class="panel">
        <JsonView title="Cluster Info (GET /)" :value="info" />
      </section>
      <section class="panel" style="grid-column: 1 / -1">
        <JsonView title="Nodes" :value="nodes" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.relative { position: relative; min-height: 200px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
</style>
