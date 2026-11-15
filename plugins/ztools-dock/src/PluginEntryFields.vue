<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { toast } from './bridge';
type Plugin = { id: string; title: string; commands: string[]; unavailable: string };
const props = defineProps<{ plugin: string; target: string }>();
const emit = defineEmits<{ select: [plugin: Plugin]; command: [target: string] }>();
const plugins = ref<Plugin[]>([]), loading = ref(false), authorized = ref(false), error = ref('');
const selected = computed(() => plugins.value.find(p => p.title === props.plugin));
const legacyPlugin = computed(() => props.plugin && !selected.value);
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
    const granted = await window.dock.call('plugin-authorize');
    if (!granted) toast('请在 ZTools 的授权窗口中确认，然后点击刷新列表');
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
  await load();
}
function select(event: Event) {
  const plugin = plugins.value.find(p => p.id === (event.target as HTMLSelectElement).value);
  if (plugin && !plugin.unavailable && plugin.commands.length) emit('select', plugin);
}
onMounted(load);
</script>
<template>
  <div class="field">
    <label for="dock-plugin-select">插件名称</label>
    <div class="input-with-button">
      <select id="dock-plugin-select" :value="selected?.id || (legacyPlugin ? '__legacy' : '')" required :disabled="loading || !authorized" @change="select">
        <option value="" disabled>{{ loading ? '正在读取插件…' : '选择已安装的插件' }}</option>
        <option v-if="legacyPlugin" value="__legacy" disabled>{{ plugin }}（原配置，当前不可用）</option>
        <option v-for="item in plugins" :key="item.id" :value="item.id" :disabled="!!item.unavailable || !item.commands.length">{{ item.title }}{{ item.unavailable ? `（${item.unavailable}）` : !item.commands.length ? '（没有可直接打开的指令）' : '' }}</option>
      </select>
      <button type="button" class="button" :disabled="loading" @click="load">刷新列表</button>
    </div>
    <div v-if="!authorized && !loading && !error" class="plugin-access"><span>读取已安装插件需要 ZTools 授权。</span><button type="button" class="button small" @click="authorize">授权读取</button></div>
    <small v-if="error" class="danger-text" role="alert">{{ error }}</small>
    <small v-else-if="authorized && !plugins.length" class="subtle">还没有其他已安装的插件。安装后刷新列表。</small>
    <small v-if="legacyPlugin || legacyCommand" class="subtle">原入口会保留。重新选择插件后，指令和图标会一并更新。</small>
  </div>
  <label class="field">插件指令
    <select aria-label="插件指令" :value="target" required :disabled="loading || !selected || !!selected.unavailable" @change="emit('command', ($event.target as HTMLSelectElement).value)">
      <option value="" disabled>选择插件指令</option>
      <option v-if="legacyCommand" :value="target" disabled>{{ target }}（原配置，当前不可用）</option>
      <option v-for="item in selected?.commands || []" :key="item" :value="item">{{ item }}</option>
    </select>
  </label>
</template>
