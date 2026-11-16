<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch,useId} from 'vue';
import Icon from './Icon.vue';
import PluginIcon from './PluginIcon.vue';
export interface SelectOption {value:string|number;label:string;icon?:string;image?:string;color?:string;pluginId?:string;iconVersion?:string;disabled?:boolean;detail?:string}
const props=withDefaults(defineProps<{modelValue:string|number;options:SelectOption[];label:string;placeholder?:string;disabled?:boolean;required?:boolean;id?:string;searchable?:boolean}>(),{placeholder:'请选择'});
const listId=useId();
const emit=defineEmits<{'update:modelValue':[value:string|number];change:[value:string|number]}>();
const trigger=ref<HTMLButtonElement>(),popup=ref<HTMLElement>(),filter=ref<HTMLInputElement>();
const opened=ref(false),query=ref(''),active=ref(-1),position=ref({left:'0px',top:'0px',width:'200px',maxHeight:'280px'});
const selected=computed(()=>props.options.find(o=>String(o.value)===String(props.modelValue)));
const visible=computed(()=>props.options.filter(o=>o.label.toLowerCase().includes(query.value.trim().toLowerCase())));
function choose(option:SelectOption){if(option.disabled)return;emit('update:modelValue',option.value);emit('change',option.value);close(true);}
function close(focus=false){opened.value=false;document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',reposition);document.removeEventListener('scroll',scroll,true);if(focus)trigger.value?.focus();}
function outside(event:Event){if(!trigger.value?.contains(event.target as Node)&&!popup.value?.contains(event.target as Node))close();}
function scroll(event:Event){if(!popup.value?.contains(event.target as Node))reposition();}
function reposition(){const r=trigger.value?.getBoundingClientRect();if(!r)return;const width=Math.min(Math.max(r.width,180),innerWidth-24),below=innerHeight-r.bottom-10,above=r.top-10;const flip=below<220&&above>below;const height=Math.min(320,Math.max(96,flip?above:below));position.value={left:`${Math.max(12,Math.min(r.left,innerWidth-width-12))}px`,top:flip?'auto':`${r.bottom+6}px`,width:`${width}px`,maxHeight:`${height}px`,...(flip?{bottom:`${innerHeight-r.top+6}px`}:{bottom:'auto'})};}
async function open(){if(props.disabled)return;query.value='';opened.value=true;active.value=props.options.findIndex(o=>String(o.value)===String(props.modelValue)&&!o.disabled);if(active.value<0)active.value=props.options.findIndex(o=>!o.disabled);reposition();document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',reposition);document.addEventListener('scroll',scroll,true);await nextTick();if(props.searchable)filter.value?.focus();else popup.value?.focus();reveal();}
function reveal(){void nextTick(()=>popup.value?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({block:'nearest'}));}
function move(delta:number){if(!visible.value.some(o=>!o.disabled))return;let index=active.value;for(let i=0;i<visible.value.length;i++){index=(index+delta+visible.value.length)%visible.value.length;if(!visible.value[index].disabled){active.value=index;break;}}reveal();}
function key(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}else if(event.key==='Tab')close(true);else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!opened.value)void open();else move(event.key==='ArrowDown'?1:-1);}else if(event.key==='Enter'||event.key===' '&&event.target!==filter.value){event.preventDefault();if(!opened.value)void open();else if(visible.value[active.value])choose(visible.value[active.value]);}else if(event.key==='Home'||event.key==='End'){if(event.target===filter.value)return;event.preventDefault();active.value=event.key==='Home'?visible.value.findIndex(o=>!o.disabled):visible.value.map((o,i)=>o.disabled?-1:i).filter(i=>i>=0).pop() ?? -1;reveal();}}
watch(query,()=>{active.value=visible.value.findIndex(o=>!o.disabled);});
watch(()=>props.disabled,value=>{if(value)close();});
onBeforeUnmount(()=>close());
function nativeChange(event:Event){const option=props.options.find(o=>String(o.value)===(event.target as HTMLSelectElement).value);if(option)choose(option);}
</script>
<template>
 <div class="rich-select" :class="{disabled,open:opened}">
  <button ref="trigger" type="button" class="rich-select-trigger" role="combobox" :aria-label="label" :aria-expanded="opened" :aria-controls="opened?listId:undefined" :aria-activedescendant="opened && active>=0?`${listId}-${active}`:undefined" aria-haspopup="listbox" :aria-required="required" :disabled="disabled" @click="opened?close():open()" @keydown="key">
   <PluginIcon v-if="selected?.pluginId" :plugin-id="selected.pluginId" :version="selected.iconVersion" :size="20" />
   <span v-else-if="selected?.icon || selected?.image" class="select-icon" :style="{color:selected.color}"><Icon :name="selected.icon" :image="selected.image" :size="19" /></span>
   <span class="rich-select-value" :class="{placeholder:!selected}">{{selected?.label || placeholder}}</span><Icon name="ChevronDown" :size="16" />
  </button>
  <select :id="id" class="rich-select-native" tabindex="-1" aria-hidden="true" :value="modelValue" :disabled="disabled" :required="required" @change="nativeChange" @invalid.prevent="trigger?.focus();open()"><option v-if="!selected" value="" disabled>{{placeholder}}</option><option v-for="item in options" :key="item.value" :value="item.value" :disabled="item.disabled">{{item.label}}</option></select>
  <Teleport to="body"><div v-if="opened" ref="popup" class="rich-select-popup" :style="position" tabindex="-1" @keydown="key">
   <div v-if="searchable" class="rich-select-search"><Icon name="Search" :size="15" /><input ref="filter" v-model="query" placeholder="搜索" :aria-label="`搜索${label}`"></div>
   <div class="rich-select-options" :id="listId" role="listbox" :aria-label="`${label}选项`"><button v-for="(item,index) in visible" :key="item.value" type="button" role="option" :id="`${listId}-${index}`" :aria-selected="String(item.value)===String(modelValue)" :disabled="item.disabled" :data-active="index===active" @pointermove="active=index" @click="choose(item)">
    <PluginIcon v-if="item.pluginId" :plugin-id="item.pluginId" :version="item.iconVersion" :size="20" />
    <span v-else-if="item.icon || item.image" class="select-icon" :style="{color:item.color}"><Icon :name="item.icon" :image="item.image" :size="19" /></span>
    <span class="rich-select-option-copy"><span>{{item.label}}</span><small v-if="item.detail">{{item.detail}}</small></span><Icon v-if="String(item.value)===String(modelValue)" name="Check" :size="16" />
   </button><div v-if="!visible.length" class="rich-select-empty">没有匹配项</div></div>
  </div></Teleport>
 </div>
</template>
