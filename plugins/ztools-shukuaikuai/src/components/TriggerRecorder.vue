<script setup>
import{ref,onUnmounted,watch}from'vue';
const props=defineProps({value:Object});const emit=defineEmits(['recorded','start']);const recording=ref(false),hint=ref(''),pending=ref(null);let surface;watch(()=>props.value,()=>{recording.value=false;pending.value=null});
const names={middle:'中键',right:'右键',x1:'侧键 X1',x2:'侧键 X2'};
function start(){recording.value=true;hint.value='按住修饰键，再按鼠标中键、右键或侧键；Esc 取消';emit('start');queueMicrotask(()=>surface?.focus())}
function down(e){if(!recording.value)return;e.preventDefault();e.stopPropagation();pending.value=window.skkModel.captureTrigger(e);if(!pending.value)hint.value='左键用于日常点击，请使用中键、右键或侧键';else hint.value=[...pending.value.modifiers,names[pending.value.button]].join(' + ');try{e.currentTarget.setPointerCapture(e.pointerId)}catch{}}
function up(e){if(!recording.value)return;e.preventDefault();e.stopPropagation();if(pending.value){emit('recorded',pending.value);pending.value=null;recording.value=false}}
onUnmounted(()=>pending.value=null);
</script>
<template><div class="trigger-recorder" @contextmenu.prevent @auxclick.prevent><button type="button" :class="{primary:recording}" @click="start">{{recording?'等待鼠标组合键…':'录入触发按键'}}</button><span>{{[...value.modifiers,names[value.button]].join(' + ')}}</span><div v-if="recording" ref="surface" class="trigger-capture" tabindex="0" @pointerdown="down" @pointerup="up" @pointercancel="pending=null" @keydown.esc.prevent="recording=false"><strong>{{hint}}</strong><small>在此区域按键录入，鼠标抬起后完成</small></div></div></template>
