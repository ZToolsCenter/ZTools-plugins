<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DockerImage, DockerVolume, DockerNetwork } from '../types'

const props = defineProps<{
  type: 'images' | 'volumes' | 'networks' | 'cleanup'
  confirm?: (title: string, message: string, danger?: boolean) => Promise<boolean>
}>()
const emit = defineEmits<{ (e: 'toast', msg: string): void }>()

const images = ref<DockerImage[]>([])
const volumes = ref<DockerVolume[]>([])
const networks = ref<DockerNetwork[]>([])
const dfText = ref('')
const loading = ref(false)

const title = computed(() => ({
  images: '镜像',
  volumes: '卷',
  networks: '网络',
  cleanup: '清理垃圾'
})[props.type])

async function refresh() {
  loading.value = true
  try {
    if (props.type === 'images') {
      const r = await window.services.docker.listImages()
      if (r.ok === true) images.value = r.images
      else emit('toast', r.error.message)
    } else if (props.type === 'volumes') {
      const r = await window.services.docker.listVolumes()
      if (r.ok === true) volumes.value = r.volumes
      else emit('toast', r.error.message)
    } else if (props.type === 'networks') {
      const r = await window.services.docker.listNetworks()
      if (r.ok === true) networks.value = r.networks
      else emit('toast', r.error.message)
    } else {
      const r = await window.services.docker.systemDf()
      if (r.ok === true) dfText.value = r.stdout
      else emit('toast', r.error.message)
    }
  } finally {
    loading.value = false
  }
}

async function removeImage(img: DockerImage) {
  const ref = img.repository && img.tag !== '<none>' ? img.repository + ':' + img.tag : img.id
  const r = await window.services.docker.removeImage(ref)
  emit('toast', r.ok === true ? '镜像已删除' : r.error.message)
  refresh()
}

async function removeVolume(v: DockerVolume) {
  const ok = props.confirm
    ? await props.confirm('删除卷', `确认删除卷 ${v.name}？卷内数据将永久丢失！`, true)
    : window.confirm(`确认删除卷 ${v.name}？卷内数据将永久丢失！`)
  if (!ok) return
  const r = await window.services.docker.removeVolume(v.name)
  emit('toast', r.ok === true ? '卷已删除' : r.error.message)
  refresh()
}

async function removeNetwork(n: DockerNetwork) {
  const r = await window.services.docker.removeNetwork(n.id)
  emit('toast', r.ok === true ? '网络已删除' : r.error.message)
  refresh()
}

async function prune(kind: 'system' | 'systemAll' | 'volumes' | 'builder') {
  const confirms: Record<string, { title: string; msg: string }> = {
    system: { title: '清理未使用', msg: '将删除所有停止的容器、未使用的镜像和网络。是否继续？' },
    systemAll: { title: '全面清理', msg: '将删除所有未使用的镜像（含悬空镜像）、停止的容器和网络，可能耗时较长。是否继续？' },
    volumes: { title: '清理未使用卷', msg: '将删除所有未使用的匿名卷，卷内数据将永久丢失！是否继续？' },
    builder: { title: '清理构建缓存', msg: '将删除所有构建缓存。是否继续？' }
  }
  const ok = props.confirm
    ? await props.confirm(confirms[kind].title, confirms[kind].msg, kind === 'volumes')
    : window.confirm(confirms[kind].msg)
  if (!ok) return
  const r =
    kind === 'system'
      ? await window.services.docker.systemPrune(false)
      : kind === 'systemAll'
        ? await window.services.docker.systemPrune(true)
        : kind === 'volumes'
          ? await window.services.docker.volumePrune()
          : await window.services.docker.builderPrune()
  emit('toast', r.ok === true ? '清理完成' : r.error.message)
  if (kind !== 'builder') refresh()
}

onMounted(refresh)
</script>

<template>
  <div class="res">
    <div class="res-head">
      <span class="res-title">{{ title }}</span>
      <button class="btn" :disabled="loading" @click="refresh">刷新</button>
    </div>

    <!-- 镜像列表 -->
    <template v-if="type === 'images'">
      <div v-for="img in images" :key="img.id + img.tag" class="res-row">
        <span class="cell name" :title="img.id">{{ img.repository }}:{{ img.tag }}</span>
        <span class="cell">{{ img.size }}</span>
        <span class="cell muted">{{ img.created }}</span>
        <button class="btn danger" @click="removeImage(img)">删除</button>
      </div>
      <div v-if="!images.length && !loading" class="empty">暂无镜像</div>
    </template>

    <!-- 卷列表 -->
    <template v-else-if="type === 'volumes'">
      <div v-for="v in volumes" :key="v.name" class="res-row">
        <span class="cell name" :title="v.mountpoint">{{ v.name }}</span>
        <span class="cell">{{ v.driver }}</span>
        <span class="cell muted">{{ v.mountpoint }}</span>
        <button class="btn danger" @click="removeVolume(v)">删除</button>
      </div>
      <div v-if="!volumes.length && !loading" class="empty">暂无卷</div>
    </template>

    <!-- 网络列表 -->
    <template v-else-if="type === 'networks'">
      <div v-for="n in networks" :key="n.id" class="res-row">
        <span class="cell name">{{ n.name }}</span>
        <span class="cell">{{ n.driver }}</span>
        <span class="cell muted">{{ n.scope }}</span>
        <button class="btn danger" @click="removeNetwork(n)">删除</button>
      </div>
      <div v-if="!networks.length && !loading" class="empty">暂无网络</div>
    </template>

    <!-- 清理 -->
    <template v-else>
      <pre class="df">{{ dfText || '加载中…' }}</pre>
      <div class="prune-actions">
        <button class="btn" @click="prune('system')">清理未使用</button>
        <button class="btn" @click="prune('systemAll')">全面清理</button>
        <button class="btn danger" @click="prune('volumes')">清理未使用卷</button>
        <button class="btn" @click="prune('builder')">清理构建缓存</button>
      </div>
      <p class="hint danger-hint">⚠ 清理会删除数据（尤其卷，删除后无法恢复），执行前请确认。</p>
    </template>
  </div>
</template>

<style scoped>
.res { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 12px 16px; }
.res-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.res-title { font-weight: 600; font-size: 14px; margin-right: auto; }
.res-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
}
.res-row:hover { background: var(--panel-bg); }
.cell { font-size: 13px; }
.cell.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.cell.muted { color: var(--text-secondary); font-size: 12px; }
.empty { color: var(--text-secondary); text-align: center; padding: 30px 0; font-size: 13px; }
.df {
  background: rgba(0, 0, 0, 0.06);
  border-radius: var(--ctrl-radius);
  padding: 10px;
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
  white-space: pre-wrap;
  margin: 0 0 14px;
}
.prune-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.hint { font-size: 12px; margin-top: 10px; }
.danger-hint { color: var(--danger); }
</style>
