<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import Icon from './Icon.vue';
import {pluginIcon} from './plugin-icons';
const props=withDefaults(defineProps<{pluginId:string;version?:string;size?:number}>(),{size:20});
const element=ref<HTMLElement>(),image=ref<string>();
let observer:IntersectionObserver|undefined,generation=0,visible=false;
async function load(){const token=++generation;image.value=undefined;const src=await pluginIcon({id:props.pluginId,iconVersion:props.version});if(token===generation)image.value=src;}
watch(()=>[props.pluginId,props.version],()=>{if(visible)void load();});
onMounted(()=>{observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){visible=true;observer?.disconnect();void load();}},{rootMargin:'24px'});if(element.value)observer.observe(element.value);});
onBeforeUnmount(()=>{generation++;observer?.disconnect();});
</script>
<template><span ref="element" class="select-icon" :style="{width:`${size}px`,height:`${size}px`}"><Icon name="Box" :image="image" :size="size" /></span></template>
