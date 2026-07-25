<script setup>
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps({ client: { type: Object, required: true } })
const emit = defineEmits(['applied', 'toast'])
const bridge = window.ccSwitch
const data = ref({ profiles: [], currentIds: {} })
const open = ref(false)
const manage = ref(false)
const creating = ref(false)
const name = ref('')
const busy = ref('')
const scope = computed(() => ['claude', 'codex'].includes(props.client.id) ? props.client.id : null)
const current = computed(() => data.value.profiles.find((item) => item.id === data.value.currentIds?.[scope.value]) || null)

async function load() { if (scope.value) data.value = await bridge.listProfiles() }
async function apply(profile) {
  busy.value = profile.id
  try {
    const result = await bridge.applyProfile(profile.id, scope.value)
    await load(); open.value = false; emit('applied')
    emit('toast', result.warnings?.length ? `Profile 已应用；${result.warnings.join('；')}` : `已切换到「${profile.name}」`, result.warnings?.length ? 'warning' : 'success')
  } catch (error) { emit('toast', error.message, 'error') }
  finally { busy.value = '' }
}
async function create() {
  if (!name.value.trim()) return
  busy.value = 'create'
  try { await bridge.createProfile(name.value, scope.value); name.value = ''; creating.value = false; await load(); emit('toast', '已从当前配置创建 Profile') }
  catch (error) { emit('toast', error.message, 'error') }
  finally { busy.value = '' }
}
async function clear() { await bridge.clearCurrentProfile(scope.value); await load(); open.value = false; emit('toast', '已退出当前 Profile') }
async function rename(profile) {
  const next = window.prompt('重命名 Profile', profile.name)
  if (!next || next === profile.name) return
  try { await bridge.updateProfile(profile.id, { name: next }); await load(); emit('toast', 'Profile 已重命名') } catch (error) { emit('toast', error.message, 'error') }
}
async function remove(profile) {
  if (!window.confirm(`删除 Profile「${profile.name}」？不会修改当前客户端配置。`)) return
  try { await bridge.deleteProfile(profile.id); await load(); emit('toast', 'Profile 已删除') } catch (error) { emit('toast', error.message, 'error') }
}
async function resnapshot(profile) {
  try { await bridge.updateProfile(profile.id, { resnapshot: true, scope: scope.value }); await load(); emit('toast', `已用当前 ${props.client.name} 状态更新快照`) } catch (error) { emit('toast', error.message, 'error') }
}
watch(() => props.client.id, load)
onMounted(load)
</script>

<template>
  <div v-if="scope" class="profile-switcher">
    <button class="profile-trigger" :style="{ '--client-accent': client.accent }" @click="open = !open"><span>P</span><div><small>PROJECT PROFILE</small><strong>{{ current?.name || '未选择项目' }}</strong></div><i>⌄</i></button>
    <div v-if="open" class="profile-popover">
      <header><strong>切换项目</strong><button class="icon-button" @click="open = false">×</button></header>
      <button v-for="profile in data.profiles" :key="profile.id" class="profile-option" :class="{ active: current?.id === profile.id }" :disabled="busy === profile.id" @click="apply(profile)"><i /><span>{{ profile.name }}</span><small>{{ Object.hasOwn(profile.payload?.providers || {}, scope) ? '已保存快照' : '待首次保存' }}</small></button>
      <form v-if="creating" class="profile-create" @submit.prevent="create"><input v-model="name" maxlength="80" autofocus placeholder="项目名称" /><button class="primary-button">创建</button></form>
      <footer><button @click="creating = !creating">＋ 从当前创建</button><button v-if="current" @click="clear">不使用项目</button><button @click="manage = true; open = false">管理</button></footer>
    </div>
    <div v-if="manage" class="modal-backdrop" @click.self="manage = false">
      <section class="provider-modal profile-manage-modal">
        <header class="modal-header"><div><span class="eyebrow">PROJECT PROFILES</span><h2>Profile 管理</h2><p>项目实体跨应用共享；当前只更新 {{ client.name }} 分组的快照。</p></div><button class="icon-button" @click="manage = false">×</button></header>
        <div class="profile-manage-body">
          <article v-for="profile in data.profiles" :key="profile.id"><div class="profile-avatar">P</div><div><strong>{{ profile.name }}</strong><small>{{ new Date(profile.updatedAt || profile.createdAt).toLocaleString() }}</small></div><button class="secondary-button" @click="resnapshot(profile)">更新当前快照</button><button class="icon-button" @click="rename(profile)">✎</button><button class="icon-button danger" @click="remove(profile)">×</button></article>
          <div v-if="!data.profiles.length" class="empty-state"><h2>还没有 Profile</h2><p>关闭此窗口后，从当前配置创建第一个项目。</p></div>
        </div>
      </section>
    </div>
  </div>
</template>
