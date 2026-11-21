<script setup>
import IconSelect from './IconSelect.vue';
import {targetIcon} from '../action-art';
import {ref,computed,onMounted} from 'vue';
const props=defineProps({action:Object});const emit=defineEmits(['changed']);
const icons=ref({});
const rows=ref([]),authorized=ref(false),busy=ref(false),error=ref(''),pending=ref(false);
const selected=computed(()=>rows.value.find(p=>p.id===props.action.pluginId));
const missingPlugin=computed(()=>props.action.pluginId&&!selected.value);
const missingCommand=computed(()=>props.action.value&&!selected.value?.commands.includes(props.action.value));
async function refresh(){busy.value=true;error.value='';try{if(!window.skk?.pluginCatalog)throw Error('请在 ZTools 中选择插件');const r=await window.skk.pluginCatalog();rows.value=r.plugins;authorized.value=r.authorized;pending.value=false;if(r.authorized){void loadIcons();void loadCommandIcons()}}catch(e){error.value=e.message}finally{busy.value=false}}
async function authorize(){busy.value=true;error.value='';try{pending.value=!await window.skk.authorizePluginCatalog();if(!pending.value)await refresh()}catch(e){error.value=e.message}finally{busy.value=false}}
function choosePlugin(value){const p=rows.value.find(p=>p.id===value);if(!p)return;props.action.pluginId=p.id;props.action.pluginTitle=p.title;props.action.value=p.commands[0]||'';void loadCommandIcons();emit('changed')}
const pluginOptions=computed(()=>[...(missingPlugin.value?[{value:props.action.pluginId,label:props.action.pluginTitle+'（原配置）',disabled:true}]:[]),...rows.value.map(p=>({value:p.id,label:p.title+(p.unavailable?' · '+p.unavailable:''),image:icons.value[p.id],icon:'Plugin',disabled:!!p.unavailable||!p.commands.length}))]);
const commandOptions=computed(()=>[...(missingCommand.value?[{value:props.action.value,label:props.action.value+'（原配置）',disabled:true}]:[]),...(selected.value?.commands||[]).map(value=>({value,label:value,image:icons.value[props.action.pluginId+':'+value]||icons.value[props.action.pluginId],icon:'Plugin'}))]);
async function loadIcons(){const jobs=rows.value.map(p=>async()=>{try{icons.value[p.id]=await targetIcon({type:'plugin',pluginId:p.id,value:''})}catch{}});await Promise.all(Array.from({length:3},async()=>{while(jobs.length)await jobs.shift()()}))}
async function loadCommandIcons(){const p=selected.value;if(!p)return;await Promise.all(p.commands.map(async value=>{try{icons.value[p.id+':'+value]=await targetIcon({type:'plugin',pluginId:p.id,value})}catch{}}))}
onMounted(refresh);
</script>
<template>
 <div class="plugin-action-fields">
  <div class="plugin-selection-grid"><label>插件名称<IconSelect label="插件名称" :model-value="action.pluginId||''" :options="pluginOptions" placeholder="选择已安装的插件" :disabled="busy||!authorized" @change="choosePlugin" @open="loadIcons"/></label><label>插件指令<IconSelect label="插件指令" v-model="action.value" :options="commandOptions" placeholder="选择插件指令" :disabled="busy||!selected||!!selected.unavailable" @change="emit('changed')" @open="loadCommandIcons"/></label></div>
  <div class="plugin-catalog-tools"><button v-if="!authorized" type="button" :disabled="busy" @click="authorize">申请读取插件列表</button><button type="button" :disabled="busy" @click="refresh">刷新列表</button></div>
  <p v-if="!authorized&&!error" class="hint">选择插件需由 ZTools 授权读取插件列表和停用状态。{{pending?'申请已提交，批准后刷新列表。':''}}</p><p v-if="error" class="draft-error" role="alert">{{error}}</p><p v-if="authorized&&!rows.length" class="hint">没有其他可选插件，安装后刷新列表。</p>
 </div>
</template>
