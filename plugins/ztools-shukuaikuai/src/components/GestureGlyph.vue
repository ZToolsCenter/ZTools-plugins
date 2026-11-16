<script setup>
import{computed}from'vue';const props=defineProps({strokes:Array});const view=computed(()=>{const all=props.strokes.flat(),xs=all.map(p=>p.x),ys=all.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),size=Math.max(Math.max(...xs)-x,Math.max(...ys)-y,1);return `${x-size*.15} ${y-size*.15} ${size*1.3} ${size*1.3}`});
</script>
<template><svg class="gesture-glyph" :viewBox="view" aria-label="自定义图形手势"><polyline v-for="(stroke,i) in strokes" :key="i" :points="stroke.map(p=>`${p.x},${p.y}`).join(' ')" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg></template>
