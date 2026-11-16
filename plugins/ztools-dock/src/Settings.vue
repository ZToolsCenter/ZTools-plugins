<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Category, Config, Entry, EntryType, Settings as DockSettings, State } from './types';
import Icon from './Icon.vue';
import AppearanceSettings from './AppearanceSettings.vue';
import PluginEntryFields from './PluginEntryFields.vue';
import './settings.css';
import { command, toast } from './bridge';
const props = defineProps<{ state: State }>();
const tab = ref('entries');
const selected = ref(props.state.config.settings.lastCategoryId);
const filter = ref('');
const editor = ref<'entry' | 'category' | null>(null);
const draft = ref<any>({});
const pickingTrigger = ref(false);
const pendingCategories = ref<Category[]>([]), fetchingIcon = ref(false);
const categoryOptions = computed(() => [...config.value.categories, ...pendingCategories.value.filter(c=>!config.value.categories.some(existing=>existing.id===c.id))]);
let iconGeneration = 0;
const isNew = ref(false), saving = ref(false), draggingOver = ref(false);
const confirmation = ref<{ title: string; detail: string; action: () => Promise<void> }>();
const icons = ['Folder', 'BriefcaseBusiness', 'FilePenLine', 'CodeXml', 'Bot', 'SlidersHorizontal', 'Zap', 'House', 'Monitor', 'Download', 'FileText', 'Image', 'Music', 'Video', 'AppWindow', 'Globe', 'Box', 'Search', 'Pin', 'Keyboard', 'LayoutGrid', 'Package'];
const colors = ['#087fe7', '#0c9c83', '#08a7cd', '#ef9309', '#6475e8', '#855ce7', '#e64960', '#61778b'];
const typeNames: Record<EntryType, string> = { app: '应用', folder: '文件夹', file: '文件', url: '网址', plugin: 'ZTools 插件', system: '系统目录' };
const systemNames: Record<string, string> = { home: '用户目录', desktop: '桌面', downloads: '下载', documents: '文档', pictures: '图片', music: '音乐', videos: '视频' };
const config = computed(() => props.state.config);
const scaleDraft = ref(config.value.settings.cardScale);
watch(() => config.value.settings.cardScale, scale => { scaleDraft.value = scale; });
const category = computed(() => config.value.categories.find(c => c.id === selected.value));
const entries = computed(() => config.value.entries.filter(e => e.categoryId === selected.value && (!filter.value || `${e.name} ${e.target}`.toLowerCase().includes(filter.value.toLowerCase()))));
watch(() => config.value.categories, list => { if (!list.some(c => c.id === selected.value)) selected.value = list[0]?.id || ''; }, { immediate: true });
const clone = (): Config => JSON.parse(JSON.stringify(config.value));
const uid = () => crypto.randomUUID();
const value = (event: Event) => (event.target as HTMLInputElement).value;
async function save(next: Config, message?: string) { return Boolean(await command('save', next, message)); }
async function setting(key: keyof DockSettings, val: any) { const next = clone(); (next.settings as any)[key] = val; await save(next); }
function openCategory(item?: Category) { isNew.value = !item; draft.value = item ? { ...item } : { id: uid(), name: '', icon: 'Folder', color: colors[config.value.categories.length % colors.length] }; editor.value = 'category'; }
function openEntry(item?: Entry) { pendingCategories.value=[]; isNew.value = !item; draft.value = item ? { ...item } : { id: uid(), categoryId: selected.value, name: '', type: 'app', target: '', plugin: '', icon: 'AppWindow', color: category.value?.color || colors[0] }; editor.value = 'entry'; }
async function submit() {
  if (editor.value === 'entry' && draft.value.type === 'plugin' && (!draft.value.plugin || !draft.value.target)) { toast('请选择插件和指令', true); return; }
  if (saving.value) return; saving.value = true;
  try {
    const next = clone(); if(editor.value==='entry') next.categories.push(...pendingCategories.value.filter(c=>c.id===draft.value.categoryId&&!next.categories.some(existing=>existing.id===c.id)).map((c:Category)=>({...c})));
    const collection = editor.value === 'category' ? next.categories : next.entries;
    const item = { ...draft.value, name: draft.value.name.trim() }; const index = collection.findIndex(c => c.id === item.id);
    if (index >= 0) collection[index] = item; else collection.push(item);
    if (await save(next, '已保存')) { if (editor.value === 'category') selected.value = item.id; editor.value = null; }
  } finally { saving.value = false; }
}
function confirm(title: string, detail: string, action: () => Promise<void>) { confirmation.value = { title, detail, action }; }
async function accept() { const fn = confirmation.value?.action; confirmation.value = undefined; if (fn) await fn(); }
function removeEntry(entry: Entry) { confirm(`删除“${entry.name}”？`, '只删除程序坞中的快捷入口，原文件和应用不受影响。', async () => { const next = clone(); next.entries = next.entries.filter(e => e.id !== entry.id); await save(next, '入口已删除'); }); }
function removeCategory(item: Category) {
  if (config.value.categories.length === 1) { toast('请至少保留一个分类', true); return; }
  editor.value = null;
  const count = config.value.entries.filter(e => e.categoryId === item.id).length;
  confirm(`删除“${item.name}”分类？`, `会同时删除该分类下的 ${count} 个快捷入口，原文件和应用不受影响。`, async () => {
    const next = clone(); next.categories = next.categories.filter(c => c.id !== item.id); next.entries = next.entries.filter(e => e.categoryId !== item.id);
    if (next.settings.lastCategoryId === item.id) next.settings.lastCategoryId = next.categories[0].id;
    await save(next, '分类已删除');
  });
}
async function pick() { const picked = await command('pick', draft.value.type); if (picked) draft.value = { ...draft.value, ...picked, name: draft.value.name || picked.name }; }
async function pickIcon() { iconGeneration++;fetchingIcon.value=false; const image = await command('icon'); if (image) draft.value.image = image; }
function selectIcon(icon:string) {iconGeneration++;fetchingIcon.value=false;draft.value.icon=icon;delete draft.value.image;}
function removeImage() {iconGeneration++;fetchingIcon.value=false;delete draft.value.image;}
function selectPluginCommand(target: string) {
  if (!draft.value.name || draft.value.name === draft.value.target) draft.value.name = target.slice(0, 60);
  draft.value.target = target;
}
async function selectPlugin(plugin: { id: string; title: string; commands: string[] }) {
  const autoName = !draft.value.name || draft.value.name === draft.value.plugin || draft.value.name === draft.value.target;
  draft.value.plugin = plugin.title; draft.value.target = plugin.commands[0] || '';
  if (autoName) draft.value.name = (draft.value.target || plugin.title).slice(0, 60);
  draft.value.icon = 'Box'; delete draft.value.image;
  await nextTick();
  const generation = ++iconGeneration, id = draft.value.id;
  fetchingIcon.value = true;
  try {
    const source = await window.dock.call('plugin-icon', plugin.id);
    if (!source) throw new Error('未找到可用的插件图标，可手动选择图片');
    const image = new window.Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'), scale = Math.min(1, 64 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (generation === iconGeneration && editor.value === 'entry' && draft.value.id === id) draft.value.image = canvas.toDataURL('image/png');
  } catch (e) { if (generation === iconGeneration) toast(e instanceof Error ? e.message : String(e), true); }
  finally { if (generation === iconGeneration) fetchingIcon.value = false; }
}
watch([editor, () => draft.value.type === 'url' ? draft.value.target : '', () => draft.value.plugin, () => draft.value.type, () => draft.value.id], () => { iconGeneration++; fetchingIcon.value=false; });
async function fetchWebsiteIcon() {
  const generation=++iconGeneration, target=draft.value.target, id=draft.value.id; fetchingIcon.value=true;
  try {
    const source=await window.dock.call('website-icon',target);
    const image=new window.Image(); image.src=source; await image.decode();
    const canvas=document.createElement('canvas'); const scale=Math.min(1,64/Math.max(image.naturalWidth,image.naturalHeight));
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
    if(generation===iconGeneration && editor.value==='entry' && draft.value.id===id && draft.value.target===target) { draft.value.image=canvas.toDataURL('image/png'); toast('网站图标已获取'); }
  } catch(error) { if(generation===iconGeneration) toast(error instanceof Error?error.message:String(error),true); }
  finally { if(generation===iconGeneration)fetchingIcon.value=false; }
}
watch(() => props.state.additionId, async id => {
  if(!id)return;
  const incoming=await command('take-addition'); if(!incoming?.entries?.length)return;
  tab.value='entries'; pendingCategories.value=incoming.categories;
  if(incoming.entries.length===1) { openEntry();pendingCategories.value=incoming.categories;draft.value=incoming.entries[0];selected.value=draft.value.categoryId; }
  else confirm('添加到程序坞',incoming.entries.map((entry:Entry)=>`${entry.name} → ${categoryOptions.value.find(c=>c.id===entry.categoryId)?.name||''}`).join('\n'),async()=>{
    const next=clone();next.categories.push(...incoming.categories.filter((c:Category)=>!next.categories.some(existing=>existing.id===c.id)).map((c:Category)=>({...c})));next.entries.push(...incoming.entries);await save(next,`已添加 ${incoming.entries.length} 个入口`);
  });
}, {immediate:true});
function changeType() { draft.value.plugin = ''; draft.value.target = draft.value.type === 'system' ? 'desktop' : ''; delete draft.value.image; draft.value.icon = ({ app: 'AppWindow', folder: 'Folder', file: 'FileText', url: 'Globe', plugin: 'Box', system: 'Monitor' } as any)[draft.value.type]; }
function drag(event: DragEvent, kind: 'entry' | 'category', id: string) { event.dataTransfer?.setData('application/x-dock', JSON.stringify({ kind, id })); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
async function drop(event: DragEvent, categoryId = selected.value, beforeId?: string) {
  event.preventDefault(); draggingOver.value = false;
  try {
    const raw = event.dataTransfer?.getData('application/x-dock');
    if (raw) {
      const source = JSON.parse(raw); const next = clone();
      if (source.kind === 'category') { const i = next.categories.findIndex(c => c.id === source.id); const j = next.categories.findIndex(c => c.id === categoryId); if (i < 0 || j < 0 || i === j) return; const [moved] = next.categories.splice(i, 1); next.categories.splice(j, 0, moved); }
      else { const index = next.entries.findIndex(e => e.id === source.id); if (index < 0 || source.id === beforeId) return; const [moved] = next.entries.splice(index, 1); moved.categoryId = categoryId; const before = beforeId ? next.entries.findIndex(e => e.id === beforeId) : -1; next.entries.splice(before < 0 ? next.entries.length : before, 0, moved); }
      await save(next); return;
    }
    const files = event.dataTransfer?.files;
    if (files?.length) {
      const descriptions = await command('describe', window.dock.filePaths(files));
      if (descriptions) { const next = clone(); descriptions.forEach((item: Partial<Entry>) => next.entries.push({ id: uid(), categoryId, color: category.value?.color || colors[0], ...item } as Entry)); await save(next, `已添加 ${descriptions.length} 个入口`); }
    }
  } catch (error) { toast(String(error), true); }
}
async function reorder(id: string, offset: number, kind: 'entry' | 'category') {
  const next = clone(); const list = kind === 'category' ? next.categories : next.entries;
  const subset = kind === 'category' ? list : next.entries.filter(e => e.categoryId === selected.value);
  const i = subset.findIndex(e => e.id === id), neighbour = subset[i + offset]; if (!neighbour) return;
  const a = list.findIndex(e => e.id === id), b = list.findIndex(e => e.id === neighbour.id); [list[a], list[b]] = [list[b], list[a]]; await save(next);
}
async function importConfig() {
  const imported = await command('import');
  if (imported) confirm('替换当前配置？', `将导入 ${imported.categories.length} 个分类、${imported.entries.length} 个入口。建议先导出当前配置。`, async () => { await save(imported, '配置已导入'); });
}

function reset() { confirm('重置外观与行为？', '显示位置、停靠方向和位置、展开和收起延迟、触发条、面板外观与搜索设置将恢复默认。分类、快捷入口和启用状态会保留。', async () => { await command('reset', undefined, '外观与行为已重置'); }); }
</script>
<template>
  <main class="settings-shell" @dragover.prevent @drop.prevent="drop($event)">
    <header class="settings-header">
      <div class="brand"><span class="brand-icon"><Icon name="LayoutGrid" :size="23" /></span><div><h1>程序坞</h1><span class="subtitle">管理常用入口与桌面外观</span></div></div>
      <div class="header-actions"><button class="button ghost preview" @click="command('expand')"><Icon name="ArrowUpRight" :size="17" />展开预览</button><label class="enable-control"><span>{{ config.settings.enabled ? '已启用' : '已暂停' }}</span><input class="switch" type="checkbox" :checked="config.settings.enabled" aria-label="启用程序坞" @change="setting('enabled', ($event.target as HTMLInputElement).checked)"></label></div>
    </header>
    <nav class="settings-tabs" aria-label="设置页面">
      <button :class="{ active: tab === 'entries' }" @click="tab = 'entries'"><Icon name="LayoutGrid" :size="17" />快捷入口</button>
      <button :class="{ active: tab === 'appearance' }" @click="tab = 'appearance'"><Icon name="SlidersHorizontal" :size="17" />外观与行为</button>
      <button :class="{ active: tab === 'backup' }" @click="tab = 'backup'"><Icon name="Package" :size="17" />备份与帮助</button>
    </nav>
    <div v-if="state.error" class="inline-error" role="alert">{{ state.error }}</div>
    <section v-if="tab === 'entries'" class="manager">
      <aside class="category-sidebar">
        <div class="sidebar-heading"><span>我的分类</span><button class="icon-button" title="添加分类" @click="openCategory()"><Icon name="Plus" :size="18" /></button></div>
        <button v-for="item in config.categories" :key="item.id" class="category-row" :class="{ selected: selected === item.id }" draggable="true" @dragstart="drag($event, 'category', item.id)" @dragover.prevent @drop.stop="drop($event, item.id)" @click="selected = item.id; filter = ''">
          <span :style="{ color: item.color }"><Icon :name="item.icon" :image="item.image" :size="20" /></span><span class="category-label">{{ item.name }}</span><span class="count">{{ config.entries.filter(e => e.categoryId === item.id).length }}</span>
        </button>
        <div class="sidebar-note">拖动调整顺序<br>空分类不会显示在程序坞中</div>
      </aside>
      <div class="content-manager" :class="{ 'drag-over': draggingOver }" @dragenter.prevent="draggingOver = true" @dragleave.self="draggingOver = false" @drop.stop="drop($event)">
        <div class="content-heading"><div class="category-title"><span :style="{ color: category?.color }"><Icon :name="category?.icon" :image="category?.image" :size="23" /></span><h2>{{ category?.name }}</h2><button class="icon-button" title="编辑分类" @click="openCategory(category)"><Icon name="Pencil" :size="15" /></button></div><button class="button primary" @click="openEntry()"><Icon name="Plus" :size="17" />添加入口</button></div>
        <div class="content-toolbar"><label class="search-field"><Icon name="Search" :size="16" /><input v-model="filter" placeholder="筛选当前分类" aria-label="筛选当前分类"></label><span class="subtle">{{ entries.length }} 个入口</span><button v-if="category" class="button small danger-text category-delete" :disabled="config.categories.length === 1" :title="config.categories.length === 1 ? '请至少保留一个分类' : '删除当前分类及其快捷入口'" @click="removeCategory(category)"><Icon name="Trash2" :size="15" />删除分类</button></div>
        <div class="entry-list">
          <div v-for="entry in entries" :key="entry.id" class="entry-row" draggable="true" @dragstart="drag($event, 'entry', entry.id)" @dragover.prevent @drop.stop="drop($event, selected, entry.id)" @dblclick="openEntry(entry)">
            <span class="drag-grip"><Icon name="GripVertical" :size="16" /></span><span class="entry-icon" :style="{ color: entry.color }"><Icon :name="entry.icon" :image="entry.image" :size="25" /></span>
            <div class="entry-copy"><strong>{{ entry.name }}</strong><span :title="entry.target">{{ entry.type === 'system' ? systemNames[entry.target] : entry.type === 'plugin' ? entry.plugin + ' / ' + entry.target : entry.target }}</span></div>
            <span class="type-tag">{{ typeNames[entry.type] }}</span>
            <div class="row-actions"><button class="icon-button" :title="'打开' + entry.name" @click="command('run', entry.id)"><Icon name="ArrowUpRight" :size="17" /></button><button class="icon-button" :title="'编辑' + entry.name" @click="openEntry(entry)"><Icon name="Pencil" :size="15" /></button><button class="icon-button" :title="'上移' + entry.name" @click="reorder(entry.id, -1, 'entry')"><Icon name="ChevronUp" :size="15" /></button><button class="icon-button" :title="'下移' + entry.name" @click="reorder(entry.id, 1, 'entry')"><Icon name="ChevronDown" :size="15" /></button><button class="icon-button danger" :title="'删除' + entry.name" @click="removeEntry(entry)"><Icon name="Trash2" :size="15" /></button></div>
          </div>
          <div v-if="!entries.length" class="empty-state"><span class="empty-icon"><Icon :name="filter ? 'Search' : 'Folder'" :size="34" /></span><h3>{{ filter ? '没有匹配的入口' : '给这个分类添加一些常用入口' }}</h3><p>{{ filter ? '试试其他名称或路径。' : '拖入应用、快捷方式或文件夹，也可以手动添加网址和插件。' }}</p><button v-if="!filter" class="button" @click="openEntry()"><Icon name="Plus" :size="16" />添加入口</button></div>
        </div>
        <div class="drop-hint"><Icon name="Upload" :size="15" /><span>拖入文件即可添加 · 拖到左侧分类可以移动入口</span></div>
      </div>
    </section>
    <AppearanceSettings v-else-if="tab === 'appearance'" :state="state" @reset="reset" />
    <section v-else class="backup-page">
      <div class="backup-intro"><h2>备份与迁移</h2><p>把分类、入口、图标和外观一起保存。</p></div>
      <div class="backup-actions"><button class="backup-action" @click="command('export', undefined, '配置已导出')"><Icon name="Download" :size="25" /><strong>导出配置</strong><span>保存为 JSON 文件</span></button><button class="backup-action" @click="importConfig"><Icon name="Upload" :size="25" /><strong>导入配置</strong><span>检查内容后替换当前配置</span></button></div>
      <div class="help-block"><h3>常见问题</h3>
        <details open><summary>怎么打开和添加入口？</summary><p>在 ZTools 输入“程序坞”或“dock”展开，输入“程序坞设置”管理入口。复制网址、应用或文件后，选择“添加到程序坞”。</p></details>
        <details><summary>怎样保持后台运行？</summary><p>在 ZTools 插件管理中关闭“退出即结束”。需要随宿主启动时开启“跟随启动”（若提供）。退出 ZTools 会同时结束程序坞。</p></details>
        <details><summary>钉住后为什么卡片还会收起？</summary><p>图钉只固定菜单导航。鼠标离开后卡片收起，移回菜单再次展开。右键程序坞可打开设置。</p></details>
        <details><summary>换电脑后需要调整什么？</summary><p>导入备份后，本地路径仍指向原位置，失效入口需要重新选择。仅支持 Windows 单个显示屏停靠；暂不支持全屏自动避让，管理员窗口兼容性尚未保证。</p></details>
      </div>
      <div class="reset-row"><span>程序坞 <b>0.1.17</b></span></div>
    </section>
    <div v-if="editor" class="modal-overlay" @click.self="editor = null" @keydown.esc="editor = null">
      <form class="editor-modal" @submit.prevent="submit">
        <header class="modal-heading"><h2>{{ isNew ? '添加' : '编辑' }}{{ editor === 'category' ? '分类' : '入口' }}</h2><button type="button" class="icon-button" title="关闭编辑" @click="editor = null"><Icon name="X" /></button></header>
        <div class="modal-body">
          <h3 class="form-section-title">基本信息</h3>
          <label class="field">名称<input v-model="draft.name" required maxlength="60" placeholder="例如：工作文档" autofocus></label>
          <template v-if="editor === 'entry'">
            <div class="field-pair"><label class="field">类型<select v-model="draft.type" @change="changeType"><option v-for="(name, key) in typeNames" :value="key">{{ name }}</option></select></label><label class="field">所属分类<select v-model="draft.categoryId"><option v-for="item in categoryOptions" :value="item.id">{{ item.name }}</option></select></label></div>
            <PluginEntryFields v-if="draft.type === 'plugin'" :plugin="draft.plugin || ''" :target="draft.target" @select="selectPlugin" @command="selectPluginCommand" />
            <label v-else class="field">{{ draft.type === 'url' ? '网址' : draft.type === 'system' ? '系统目录' : '目标路径' }}
              <select v-if="draft.type === 'system'" v-model="draft.target"><option v-for="(name, key) in systemNames" :value="key">{{ name }}</option></select>
              <div v-else class="input-with-button"><input v-model="draft.target" required maxlength="4096" :placeholder="draft.type === 'url' ? 'https://example.com' : draft.type === 'plugin' ? '填写可在 ZTools 搜索到的指令' : '选择或拖入应用、快捷方式、文件夹'"><button v-if="draft.type==='url'" type="button" class="button" :disabled="fetchingIcon || !draft.target.trim()" @click="fetchWebsiteIcon">{{fetchingIcon?'获取中…':'获取图标'}}</button><button v-if="['app','file','folder'].includes(draft.type)" type="button" class="button" @click="pick">选择</button></div>
            </label>
          </template>
          <h3 class="form-section-title">图标与颜色</h3>
          <div class="field">图标<div class="icon-picker"><button v-for="icon in icons" type="button" class="icon-choice" :class="{ selected: draft.icon === icon && !draft.image }" :title="icon" :style="{ color: draft.color }" @click="selectIcon(icon)"><Icon :name="icon" :size="21" /></button></div><div class="custom-icon"><button type="button" class="button small" @click="pickIcon"><Icon name="Image" :size="15" />选择图片</button><span v-if="draft.image" class="custom-icon-preview"><Icon :image="draft.image" :size="24" /><button type="button" class="text-button" @click="removeImage">移除</button></span></div></div>
          <div class="field">颜色<div class="color-picker"><button v-for="color in colors" type="button" class="color-choice" :style="{ background: color }" :class="{ selected: color === draft.color }" :title="color" @click="draft.color = color"><Icon v-if="color === draft.color" name="Check" :size="15" /></button><input type="color" v-model="draft.color" aria-label="自定义颜色"></div></div>
          <div v-if="editor === 'category' && !isNew" class="category-editor-tools"><button type="button" class="button small" @click="reorder(draft.id, -1, 'category')">上移分类</button><button type="button" class="button small" @click="reorder(draft.id, 1, 'category')">下移分类</button><button type="button" class="text-button danger-text" :disabled="config.categories.length === 1" @click="removeCategory(draft)">删除分类</button></div>
        </div>
        <footer class="modal-footer"><button v-if="editor === 'entry'" type="button" class="button ghost" :disabled="draft.type === 'plugin' && (!draft.plugin || !draft.target)" @click="command('test', draft, '已发送打开请求')"><Icon name="ExternalLink" :size="15" />测试打开</button><span class="spacer"></span><button type="button" class="button" @click="editor = null">取消</button><button type="submit" class="button primary" :disabled="saving || fetchingIcon">{{ saving ? '保存中…' : fetchingIcon ? '读取图标…' : '保存' }}</button></footer>
      </form>
    </div>
    <div v-if="confirmation" class="modal-overlay" @keydown.esc="confirmation = undefined"><div class="confirm-modal" role="alertdialog" aria-modal="true"><h2>{{ confirmation.title }}</h2><p>{{ confirmation.detail }}</p><footer class="modal-footer"><span class="spacer"></span><button class="button" @click="confirmation = undefined">取消</button><button class="button primary" @click="accept">确认</button></footer></div></div>
  </main>
</template>
