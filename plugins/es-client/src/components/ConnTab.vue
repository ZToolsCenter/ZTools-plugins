<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { AuthType, ConnectionInput, ConnectionProfile } from '../types'
import LoadingMask from './LoadingMask.vue'
import SearchableSelect from './SearchableSelect.vue'

const emit = defineEmits<{ changed: [] }>()

const list = ref<ConnectionProfile[]>([])
const activeId = ref<string | null>(null)
const loading = ref(false)
const testing = ref(false)
const saving = ref(false)
const error = ref('')
const testOk = ref('')
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  baseUrl: 'http://localhost:9200',
  authType: 'none' as AuthType,
  username: 'elastic',
  password: '',
  apiKey: '',
  rejectUnauthorized: true,
})

const authOptions = [
  { value: 'none', label: '无' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apiKey', label: 'API Key' },
]

const authTypeModel = computed({
  get: () => form.authType,
  set: (v: string) => {
    form.authType = (v as AuthType) || 'none'
  },
})

function formInput(): ConnectionInput {
  return {
    name: form.name || '未命名连接',
    baseUrl: form.baseUrl,
    authType: form.authType,
    username: form.username,
    password: form.password,
    apiKey: form.apiKey,
    rejectUnauthorized: form.rejectUnauthorized,
  }
}

function resetForm() {
  editingId.value = null
  form.name = ''
  form.baseUrl = 'http://localhost:9200'
  form.authType = 'none'
  form.username = 'elastic'
  form.password = ''
  form.apiKey = ''
  form.rejectUnauthorized = true
  error.value = ''
  testOk.value = ''
}

async function startEdit(c: ConnectionProfile) {
  error.value = ''
  testOk.value = ''
  try {
    const full = (await window.services.getConnection(c._id)) ?? c
    editingId.value = full._id
    form.name = full.name
    form.baseUrl = full.baseUrl
    form.authType = full.authType
    form.username = full.username ?? 'elastic'
    form.password = full.password ?? ''
    form.apiKey = full.apiKey ?? ''
    form.rejectUnauthorized = full.rejectUnauthorized !== false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function reload() {
  loading.value = true
  error.value = ''
  try {
    list.value = await window.services.listConnections()
    const active = await window.services.getActiveConnection()
    activeId.value = active?._id ?? null
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function save() {
  error.value = ''
  testOk.value = ''
  saving.value = true
  try {
    const id = editingId.value ?? undefined
    await window.services.saveConnection(formInput(), id)
    window.services.toast(id ? '连接已更新' : '连接已保存', 'success')
    resetForm()
    await reload()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function activate(id: string) {
  loading.value = true
  try {
    await window.services.setActiveConnection(id)
    await reload()
  } finally {
    loading.value = false
  }
}

async function remove(id: string) {
  if (!confirm('确定删除该连接？')) return
  loading.value = true
  try {
    await window.services.deleteConnection(id)
    if (editingId.value === id) resetForm()
    await reload()
  } finally {
    loading.value = false
  }
}

async function testSaved(id: string) {
  testing.value = true
  error.value = ''
  testOk.value = ''
  try {
    const res = await window.services.testConnection(id)
    if (res.ok) {
      const ver = (res.body as { version?: { number?: string } })?.version?.number
      const msg = `连通成功${ver ? ` · ES ${ver}` : ''}`
      testOk.value = msg
      window.services.toast(msg, 'success')
    } else {
      error.value = res.error?.message || `失败 HTTP ${res.status}`
    }
  } finally {
    testing.value = false
  }
}

async function testForm() {
  testing.value = true
  error.value = ''
  testOk.value = ''
  try {
    if (!form.baseUrl.trim()) {
      error.value = '请先填写 Base URL'
      return
    }
    const res = await window.services.testConnectionInput(formInput())
    if (res.ok) {
      const ver = (res.body as { version?: { number?: string } })?.version?.number
      const cluster = (res.body as { cluster_name?: string })?.cluster_name
      const msg = `连通成功${ver ? ` · ES ${ver}` : ''}${cluster ? ` · ${cluster}` : ''}`
      testOk.value = msg
      window.services.toast(msg, 'success')
    } else {
      error.value = res.error?.message || `失败 HTTP ${res.status}`
    }
  } finally {
    testing.value = false
  }
}

onMounted(reload)
</script>

<template>
  <div class="grid relative">
    <LoadingMask
      :show="loading || testing || saving"
      :text="testing ? '正在测试连接…' : saving ? '正在保存…' : '加载中…'"
    />

    <section class="panel">
      <div class="hrow" style="justify-content: space-between; margin-bottom: 8px">
        <strong>已保存连接</strong>
        <button class="btn btn-sm btn-secondary" type="button" :disabled="loading" @click="reload">
          刷新
        </button>
      </div>
      <div v-if="!list.length" class="muted">暂无连接，请在右侧添加。</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>URL</th>
            <th>认证</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in list" :key="c._id" :class="{ active: c._id === activeId }">
            <td>{{ c.name }}</td>
            <td class="mono">{{ c.baseUrl }}</td>
            <td>{{ c.authType }}</td>
            <td class="hrow">
              <button class="btn btn-sm btn-primary" type="button" @click="activate(c._id)">
                {{ c._id === activeId ? '当前' : '启用' }}
              </button>
              <button
                class="btn btn-sm btn-secondary"
                type="button"
                :disabled="testing"
                @click="testSaved(c._id)"
              >
                测试
              </button>
              <button class="btn btn-sm btn-secondary" type="button" @click="startEdit(c)">
                编辑
              </button>
              <button class="btn btn-sm btn-danger" type="button" @click="remove(c._id)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <strong>{{ editingId ? '编辑连接' : '新建连接' }}</strong>
      <div class="field" style="margin-top: 10px">
        <label>名称</label>
        <input v-model="form.name" class="form-control form-control-sm" placeholder="本地开发" />
      </div>
      <div class="field">
        <label>Base URL</label>
        <input
          v-model="form.baseUrl"
          class="form-control form-control-sm"
          placeholder="http://localhost:9200"
        />
      </div>
      <div class="field">
        <label>认证方式</label>
        <SearchableSelect v-model="authTypeModel" :options="authOptions" width="100%" />
      </div>
      <template v-if="form.authType === 'basic'">
        <div class="field">
          <label>用户名</label>
          <input v-model="form.username" class="form-control form-control-sm" />
        </div>
        <div class="field">
          <label>密码</label>
          <input
            v-model="form.password"
            class="form-control form-control-sm"
            type="password"
            autocomplete="off"
          />
        </div>
      </template>
      <div v-if="form.authType === 'apiKey'" class="field">
        <label>API Key（id:key 或 Base64）</label>
        <input
          v-model="form.apiKey"
          class="form-control form-control-sm"
          type="password"
          autocomplete="off"
        />
      </div>
      <div class="form-check cert-check">
        <input
          id="rejectUnauthorized"
          v-model="form.rejectUnauthorized"
          class="form-check-input"
          type="checkbox"
        />
        <label class="form-check-label" for="rejectUnauthorized">
          校验证书（自签证书请取消勾选）
        </label>
      </div>
      <div class="hrow">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="saving || testing"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="testing || saving"
          @click="testForm"
        >
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button class="btn btn-secondary" type="button" @click="resetForm">清空</button>
      </div>
      <div v-if="testOk" class="ok" style="margin-top: 10px">{{ testOk }}</div>
      <div v-if="error" class="err" style="margin-top: 10px">{{ error }}</div>
    </section>
  </div>
</template>

<style scoped>
.relative {
  position: relative;
  min-height: 200px;
}
.grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
}
.cert-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  min-height: 1.5rem;
  padding-left: 0;
}
.cert-check .form-check-input {
  float: none;
  margin: 0;
  flex-shrink: 0;
}
.cert-check .form-check-label {
  margin: 0;
  line-height: 1.4;
}
@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
