<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { toast } from './bridge';
import RichSelect from './RichSelect.vue';
type Plugin = { id: string; title: string; commands: string[]; unavailable: string; iconVersion?: string };
const props = defineProps<{ plugin: string; target: string }>();
const emit = defineEmits<{ select: [plugin: Plugin]; command: [target: string]; manage: [] }>();
const accepted = ref<string[]>([]);
const accessItems = [{id:'internal:get-plugins',name:'读取插件名称、指令和图标'},{id:'internal:get-disabled-plugins',name:'读取插件停用状态'}];
const plugins = ref<Plugin[]>([]), loading = ref(false), authorized = ref(false), error = ref('');
const selected = computed(() => plugins.value.find(p => p.title === props.plugin));
const legacyPlugin = computed(() => props.plugin && !selected.value);
const pluginOptions = computed(() => [
 ...(legacyPlugin.value ? [{value:'__legacy',label:props.plugin,disabled:true,detail:'原配置，当前不可用',icon:'Box'}] : []),
 ...plugins.value.map(p=>({value:p.id,label:p.title,pluginId:p.id,iconVersion:p.iconVersion,disabled:!!p.unavailable||!p.commands.length,detail:p.unavailable||(!p.commands.length?'没有可直接打开的指令':'')}))
]);
const commandOptions = computed(() => [...(legacyCommand.value ? [{value:props.target,label:props.target,disabled:true,detail:'原配置，当前不可用'}] : []), ...(selected.value?.commands || []).map(value=>({value,label:value}))]);
const legacyCommand = computed(() => props.target && !selected.value?.commands.includes(props.target));
async function load() {
  if (loading.value) return;
  loading.value = true; error.value = '';
  try { const result = await window.dock.call('plugin-catalog'); plugins.value = result.plugins; authorized.value = result.authorized; }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function authorize() {
  loading.value = true; error.value = '';
  try {
    if(accepted.value.length!==2)return;
    const granted = await window.dock.call('plugin-authorize', [...accepted.value]);
    if (!granted) toast('请在 ZTools 的授权窗口中确认，然后点击刷新列表');
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
  await load();
}
function select(id: string | number) {
  const plugin = plugins.value.find(p => p.id === id);
  if (plugin && !plugin.unavailable && plugin.commands.length) emit('select', plugin);
}
function permissionsChanged(){accepted.value=[];void load();}
onMounted(()=>{load();window.addEventListener('dock-permissions-changed',permissionsChanged);});
onBeforeUnmount(()=>window.removeEventListener('dock-permissions-changed',permissionsChanged));
</script>
<template>
  <div class="field">
    <label for="dock-plugin-select">插件名称</label>
    <div class="input-with-button">
      <RichSelect id="dock-plugin-select" label="插件名称" :model-value="selected?.id || (legacyPlugin ? '__legacy' : '')" :options="pluginOptions" :placeholder="loading?'正在读取插件…':'选择已安装的插件'" :disabled="loading || !authorized" required searchable @change="select" />
      <button type="button" class="button" :disabled="loading" @click="load">刷新列表</button>
    </div>
    <div v-if="!authorized && !loading && !error" class="plugin-consent">
      <strong>选择插件需要以下权限</strong>
      <label v-for="item in accessItems" :key="item.id"><input v-model="accepted" type="checkbox" :value="item.id">{{ item.name }}</label>
      <div class="plugin-consent-actions"><button type="button" class="button primary small" :disabled="loading || accepted.length!==2" @click="authorize">继续授权</button><button type="button" class="button small" @click="emit('manage')">查看授权</button></div>
    </div>
    <button v-if="authorized" type="button" class="text-button permission-entry" @click="emit('manage')">查看与管理授权</button>
    <small v-if="error" class="danger-text" role="alert">{{ error }}</small>
    <small v-else-if="authorized && !plugins.length" class="subtle">还没有其他已安装的插件。安装后刷新列表。</small>
    <small v-if="legacyPlugin || legacyCommand" class="subtle">原入口会保留。重新选择插件后，指令和图标会一并更新。</small>
  </div>
  <label class="field">插件指令
    <RichSelect label="插件指令" :model-value="target" :options="commandOptions" placeholder="选择插件指令" :disabled="loading || !selected || !!selected.unavailable" required :searchable="commandOptions.length>8" @change="emit('command',String($event))" />
  </label>
</template>
