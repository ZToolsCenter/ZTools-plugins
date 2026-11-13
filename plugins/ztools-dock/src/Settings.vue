<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Category, Config, Entry, EntryType, Settings as DockSettings, State } from './types';
import Icon from './Icon.vue';
import TriggerArt from './TriggerArt.vue';
import { command, toast } from './bridge';
const props = defineProps<{ state: State }>();
const tab = ref('entries');
const selected = ref(props.state.config.settings.lastCategoryId);
const filter = ref('');
const editor = ref<'entry' | 'category' | null>(null);
const draft = ref<any>({});
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
watch([editor, () => draft.value.target, () => draft.value.type, () => draft.value.id], () => { iconGeneration++; fetchingIcon.value=false; });
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
function changeType() { draft.value.target = draft.value.type === 'system' ? 'desktop' : ''; delete draft.value.image; draft.value.icon = ({ app: 'AppWindow', folder: 'Folder', file: 'FileText', url: 'Globe', plugin: 'Box', system: 'Monitor' } as any)[draft.value.type]; }
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
async function setMaterial(event: Event) { const next=clone(); next.settings.material=value(event) as DockSettings['material']; if(next.settings.material !== 'solid' && next.settings.panelOpacity === 1) next.settings.panelOpacity=0.55; await save(next); }
function reset() { confirm('重置外观与行为？', '显示位置、停靠方向和位置、展开和收起延迟、触发条、面板外观与搜索设置将恢复默认。分类、快捷入口和启用状态会保留。', async () => { await command('reset', undefined, '外观与行为已重置'); }); }
</script>
<template>
  <main class="settings-shell" @dragover.prevent @drop.prevent="drop($event)">
    <header class="settings-header">
      <div class="brand"><span class="brand-icon"><Icon name="LayoutGrid" :size="23" /></span><div><h1>程序坞</h1><span class="subtitle">常用入口，触手可及</span></div></div>
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
    <section v-else-if="tab === 'appearance'" class="preferences">
      <div class="preference-preview"><div class="mini-screen"><span class="mini-trigger trigger" :style="{ width: Math.min(config.settings.triggerWidth, 180) + 'px', height: (config.settings.triggerTheme === 'bar' ? config.settings.triggerHeight : 32) + 'px', opacity: config.settings.triggerOpacity, color: config.settings.accent, background: 'transparent' }"><TriggerArt :theme="config.settings.triggerTheme" /></span><div class="mini-dock"><Icon name="Folder" :size="20" /><Icon name="BriefcaseBusiness" :size="20" /><Icon name="CodeXml" :size="20" /><Icon name="Bot" :size="20" /></div></div><div><h2>让程序坞适合你的桌面</h2><p>设置自动保存，并实时应用到悬浮窗口。</p></div></div>
      <div class="preference-group"><h3>触发与显示</h3>
        <label class="setting-row"><span><strong>显示位置</strong><small>在选定显示屏的工作区内停靠；断开后回到主屏</small></span><select :value="config.settings.displayId" @change="setting('displayId', value($event))"><option value="primary">主显示器</option><option v-for="display in state.displays" :key="display.id" :value="display.id">{{ display.label }} · {{ display.width }} × {{ display.height }}</option></select></label>
        <label class="setting-row"><span><strong>停靠方向</strong><small>面板始终向屏幕内侧展开</small></span><select aria-label="停靠方向" :value="config.settings.dockEdge" @change="setting('dockEdge', value($event))"><option value="top">上</option><option value="bottom">下</option><option value="left">左</option><option value="right">右</option></select></label>
        <label class="setting-row"><span><strong>位置方式</strong><small>{{['top','bottom'].includes(config.settings.dockEdge)?'沿左右方向调整':'沿上下方向调整'}}；超出当前屏幕的距离会自动限制</small></span><select aria-label="位置方式" :value="config.settings.positionMode" @change="setting('positionMode', value($event))"><option value="ratio">按比例</option><option value="distance">按距离</option></select></label>
        <label v-if="config.settings.positionMode === 'ratio'" class="setting-row"><span><strong>位置比例</strong><small>{{['top','bottom'].includes(config.settings.dockEdge)?'0% 靠左，50% 居中，100% 靠右':'0% 靠上，50% 居中，100% 靠下'}}</small></span><div class="position-controls"><input aria-label="位置比例滑块" type="range" min="0" max="100" step="0.5" :value="config.settings.positionRatio" @change="setting('positionRatio', +value($event))"><input aria-label="位置比例" type="number" min="0" max="100" step="0.5" :value="config.settings.positionRatio" @change="setting('positionRatio', +value($event))"><span>%</span></div></label>
        <label v-else class="setting-row"><span><strong>距离边缘</strong><small>相对工作区边缘的距离，使用逻辑像素</small></span><div class="position-controls"><select aria-label="距离参考边" :value="config.settings.positionAnchor" @change="setting('positionAnchor', value($event))"><option value="start">{{['top','bottom'].includes(config.settings.dockEdge)?'距左边':'距上边'}}</option><option value="end">{{['top','bottom'].includes(config.settings.dockEdge)?'距右边':'距下边'}}</option></select><input aria-label="位置距离" type="number" min="0" max="20000" step="1" :value="config.settings.positionDistance" @change="setting('positionDistance', +value($event))"><span>px</span></div></label>
        <label class="setting-row"><span><strong>展开延迟</strong><small>鼠标停留后展开，减少误触</small></span><div class="range-control"><input type="range" min="0" max="2000" step="20" :value="config.settings.openDelay" @change="setting('openDelay', +value($event))"><output>{{ config.settings.openDelay }} ms</output></div></label>
        <label class="setting-row"><span><strong>收起延迟</strong><small>鼠标离开整个程序坞后收起</small></span><div class="range-control"><input type="range" min="100" max="3000" step="50" :value="config.settings.closeDelay" @change="setting('closeDelay', +value($event))"><output>{{ config.settings.closeDelay }} ms</output></div></label>
      </div>
      <div class="preference-group"><h3>触发条</h3>
        <div class="setting-row"><span><strong>触发条主题</strong><small>虫仔、蜗牛为静态图案，高度为 32 px</small></span><div class="trigger-theme-options"><button v-for="item in [{key:'bar',label:'经典细条'},{key:'worm',label:'虫仔'},{key:'snail',label:'蜗牛'}]" class="trigger-theme-choice" :class="{selected:config.settings.triggerTheme===item.key}" :aria-pressed="config.settings.triggerTheme===item.key" @click="setting('triggerTheme', item.key as DockSettings['triggerTheme'])"><span :style="{color:config.settings.accent}"><TriggerArt :theme="item.key as DockSettings['triggerTheme']" /></span>{{item.label}}</button></div></div>
        <label class="setting-row"><span><strong>主题色</strong></span><input type="color" :value="config.settings.accent" @change="setting('accent', value($event))"></label>
        <label class="setting-row"><span><strong>{{['left','right'].includes(config.settings.dockEdge)?'长度':'宽度'}}</strong></span><div class="range-control"><input type="range" min="24" max="400" step="4" :value="config.settings.triggerWidth" @change="setting('triggerWidth', +value($event))"><output>{{ config.settings.triggerWidth }} px</output></div></label>
        <label class="setting-row"><span><strong>{{['left','right'].includes(config.settings.dockEdge)?'厚度':'高度'}}</strong></span><div class="range-control"><input type="range" min="3" max="16" :disabled="config.settings.triggerTheme !== 'bar'" :value="config.settings.triggerHeight" @change="setting('triggerHeight', +value($event))"><output>{{ config.settings.triggerTheme === 'bar' ? config.settings.triggerHeight : 32 }} px</output></div></label>
        <label class="setting-row"><span><strong>不透明度</strong></span><div class="range-control"><input type="range" min="0.1" max="1" step="0.05" :value="config.settings.triggerOpacity" @change="setting('triggerOpacity', +value($event))"><output>{{ Math.round(config.settings.triggerOpacity * 100) }}%</output></div></label>
      </div>
      <div class="preference-group"><h3>面板外观</h3>
        <label class="setting-row"><span><strong>面板材质</strong><small>{{state.materialsSupported ? '原生系统材质；切换时面板会重新打开' : '云母、亚克力需要 Windows 11 22H2 或更新版本'}}</small></span><select aria-label="面板材质" :value="config.settings.material" @change="setMaterial"><option value="solid">纯色</option><option value="mica" :disabled="!state.materialsSupported">云母 Mica</option><option value="acrylic" :disabled="!state.materialsSupported">亚克力 Acrylic</option></select></label>
        <label class="setting-row"><span><strong>背景不透明度</strong><small>仅调整背景着色，文字和图标保持清晰；材质模糊由系统控制</small></span><div class="range-control"><input aria-label="背景不透明度" type="range" min="0.1" max="1" step="0.05" :value="config.settings.panelOpacity" @change="setting('panelOpacity', +value($event))"><output>{{Math.round(config.settings.panelOpacity * 100)}}%</output></div></label>
        <label class="setting-row"><span><strong>图标大小</strong><small>同时调整分类与入口图标</small></span><select aria-label="图标大小" :value="config.settings.iconSize" @change="setting('iconSize', value($event))"><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label>
        <label class="setting-row"><span><strong>显示菜单栏名称</strong><small>关闭后分类导航只显示图标，悬停仍可查看名称</small></span><input class="switch" type="checkbox" aria-label="显示菜单栏名称" :checked="config.settings.showCategoryNames" @change="setting('showCategoryNames', ($event.target as HTMLInputElement).checked)"></label>
        <label class="setting-row"><span><strong>显示入口名称</strong><small>关闭后入口卡片只显示图标，悬停仍可查看名称</small></span><input class="switch" type="checkbox" aria-label="显示入口名称" :checked="config.settings.showEntryNames" @change="setting('showEntryNames', ($event.target as HTMLInputElement).checked)"></label>
        <label class="setting-row"><span><strong>颜色模式</strong></span><select :value="config.settings.theme" @change="setting('theme', value($event))"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <label class="setting-row"><span><strong>每行列数</strong></span><select :value="config.settings.columns" @change="setting('columns', +value($event))"><option v-for="n in [2,3,4,5,6]" :value="n">{{ n }} 列</option></select></label>
        <label class="setting-row"><span><strong>显示搜索框</strong><small>在卡片面板中搜索所有入口，默认关闭</small></span><input class="switch" type="checkbox" :checked="config.settings.searchEnabled" aria-label="显示搜索框" @change="setting('searchEnabled', ($event.target as HTMLInputElement).checked)"></label>
        <label class="setting-row"><span><strong>卡片高度</strong></span><div class="range-control"><input type="range" min="76" max="144" step="4" :value="config.settings.cardSize" @change="setting('cardSize', +value($event))"><output>{{ config.settings.cardSize }} px</output></div></label>
      </div>
      <div class="reset-row"><span>仅恢复本页设置，保留分类和快捷入口</span><button class="button danger-text" @click="reset"><Icon name="RotateCcw" :size="15" />重置外观与行为</button></div>
    </section>
    <section v-else class="backup-page">
      <div class="backup-intro"><Icon name="Package" :size="32" /><h2>把你的程序坞保存下来</h2><p>导出分类、入口和外观。换一台电脑时，可以重新导入。</p></div>
      <div class="backup-actions"><button class="backup-action" @click="command('export', undefined, '配置已导出')"><Icon name="Download" :size="25" /><strong>导出配置</strong><span>保存为 JSON 文件</span></button><button class="backup-action" @click="importConfig"><Icon name="Upload" :size="25" /><strong>导入配置</strong><span>检查内容后替换当前配置</span></button></div>
      <div class="help-block"><h3>使用提示</h3><p><strong>快速打开：</strong>在 ZTools 输入“程序坞”或“dock”。输入“程序坞设置”管理入口。</p><p><strong>后台运行：</strong>在 ZTools 的插件管理中关闭本插件的“退出即结束”。如宿主提供“跟随启动”，可按需开启，随后重启验证。</p><p><strong>悬浮窗口：</strong>悬停屏幕边缘触发条展开；右键细条打开设置；导航栏右侧图钉开关可钉住或取消钉住导航条，卡片区仍随鼠标移出收起；右键面板也可打开设置。搜索可在“外观与行为”中开启，默认关闭。</p><p><strong>迁移配置：</strong>本地路径仍指向原位置，换机后可能需要重新选择。程序坞依赖 ZTools 运行。</p><p><strong>首版范围：</strong>Windows 单个显示屏四边停靠。全屏自动避让、管理员窗口兼容和文件拖到应用执行尚未支持。</p></div>
      <div class="reset-row"><span>程序坞 <b>0.1.11</b></span></div>
    </section>
    <div v-if="editor" class="modal-overlay" @click.self="editor = null" @keydown.esc="editor = null">
      <form class="editor-modal" @submit.prevent="submit">
        <header class="modal-heading"><h2>{{ isNew ? '添加' : '编辑' }}{{ editor === 'category' ? '分类' : '入口' }}</h2><button type="button" class="icon-button" title="关闭编辑" @click="editor = null"><Icon name="X" /></button></header>
        <div class="modal-body">
          <label class="field">名称<input v-model="draft.name" required maxlength="60" placeholder="例如：工作文档" autofocus></label>
          <template v-if="editor === 'entry'">
            <div class="field-pair"><label class="field">类型<select v-model="draft.type" @change="changeType"><option v-for="(name, key) in typeNames" :value="key">{{ name }}</option></select></label><label class="field">所属分类<select v-model="draft.categoryId"><option v-for="item in categoryOptions" :value="item.id">{{ item.name }}</option></select></label></div>
            <label v-if="draft.type === 'plugin'" class="field">插件名称<input v-model="draft.plugin" required maxlength="100" placeholder="填写 ZTools 中显示的完整插件名称"><small class="subtle">请使用唯一的插件名称。同名插件无法区分；是否找到指令由 ZTools 提示。</small></label>
            <label class="field">{{ draft.type === 'plugin' ? '插件指令' : draft.type === 'url' ? '网址' : draft.type === 'system' ? '系统目录' : '目标路径' }}
              <select v-if="draft.type === 'system'" v-model="draft.target"><option v-for="(name, key) in systemNames" :value="key">{{ name }}</option></select>
              <div v-else class="input-with-button"><input v-model="draft.target" required maxlength="4096" :placeholder="draft.type === 'url' ? 'https://example.com' : draft.type === 'plugin' ? '填写可在 ZTools 搜索到的指令' : '选择或拖入应用、快捷方式、文件夹'"><button v-if="draft.type==='url'" type="button" class="button" :disabled="fetchingIcon || !draft.target.trim()" @click="fetchWebsiteIcon">{{fetchingIcon?'获取中…':'获取图标'}}</button><button v-if="['app','file','folder'].includes(draft.type)" type="button" class="button" @click="pick">选择</button></div>
            </label>
          </template>
          <div class="field">图标<div class="icon-picker"><button v-for="icon in icons" type="button" class="icon-choice" :class="{ selected: draft.icon === icon && !draft.image }" :title="icon" :style="{ color: draft.color }" @click="selectIcon(icon)"><Icon :name="icon" :size="21" /></button></div><div class="custom-icon"><button type="button" class="button small" @click="pickIcon"><Icon name="Image" :size="15" />选择图片</button><span v-if="draft.image" class="custom-icon-preview"><Icon :image="draft.image" :size="24" /><button type="button" class="text-button" @click="removeImage">移除</button></span></div></div>
          <div class="field">颜色<div class="color-picker"><button v-for="color in colors" type="button" class="color-choice" :style="{ background: color }" :class="{ selected: color === draft.color }" :title="color" @click="draft.color = color"><Icon v-if="color === draft.color" name="Check" :size="15" /></button><input type="color" v-model="draft.color" aria-label="自定义颜色"></div></div>
          <div v-if="editor === 'category' && !isNew" class="category-editor-tools"><button type="button" class="button small" @click="reorder(draft.id, -1, 'category')">上移分类</button><button type="button" class="button small" @click="reorder(draft.id, 1, 'category')">下移分类</button><button type="button" class="text-button danger-text" :disabled="config.categories.length === 1" @click="removeCategory(draft)">删除分类</button></div>
        </div>
        <footer class="modal-footer"><button v-if="editor === 'entry'" type="button" class="button ghost" @click="command('test', draft, '已发送打开请求')"><Icon name="ExternalLink" :size="15" />测试打开</button><span class="spacer"></span><button type="button" class="button" @click="editor = null">取消</button><button type="submit" class="button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></footer>
      </form>
    </div>
    <div v-if="confirmation" class="modal-overlay" @keydown.esc="confirmation = undefined"><div class="confirm-modal" role="alertdialog" aria-modal="true"><h2>{{ confirmation.title }}</h2><p>{{ confirmation.detail }}</p><footer class="modal-footer"><span class="spacer"></span><button class="button" @click="confirmation = undefined">取消</button><button class="button primary" @click="accept">确认</button></footer></div></div>
  </main>
</template>
