<script setup lang="ts">
import { ref, watch } from 'vue';
import type { TileMaterial } from './types';
import Icon from './Icon.vue';
import './tile-materials.css';
const props = defineProps<{ modelValue: TileMaterial; strength: number }>();
const emit = defineEmits<{ select: [material: TileMaterial]; strength: [value: number] }>();
const localStrength = ref(props.strength);
watch(() => props.strength, value => { localStrength.value = value; });
const choices: { id: TileMaterial; name: string; detail: string }[] = [
 {id:'plain',name:'经典纯色',detail:'原有简洁样式'},
 {id:'ice',name:'冰蓝厚玻璃',detail:'蓝色切边 · 底部反光'},
 {id:'frosted',name:'柔光磨砂',detail:'雾面底色 · 柔和高光'},
 {id:'liquid',name:'液态玻璃',detail:'圆润厚边 · 通透中心'},
 {id:'clear',name:'清透描边',detail:'轻透表面 · 细线反光'},
 {id:'iridescent',name:'虹彩玻璃',detail:'彩色折光 · 亮面边缘'}
];
</script>
<template>
 <div class="tile-material-picker">
  <div class="tile-material-heading"><strong>菜单与入口材质</strong><p>每个分类菜单和入口卡片单独呈现质感。</p></div>
  <div class="tile-material-options" role="group" aria-label="菜单与入口材质">
   <button v-for="item in choices" :key="item.id" type="button" class="tile-material-option" :data-tile-choice="item.id" :aria-pressed="modelValue===item.id" @click="emit('select',item.id)">
    <span class="tile-material-sample" :data-tile-material="item.id" :style="{'--glass-strength':localStrength/100}"><span class="tile-material"><Icon name="Folder" :size="25" /><span>文件夹</span></span><Icon v-if="modelValue===item.id" class="material-selected-mark" name="Check" :size="15" /></span>
    <strong>{{ item.name }}</strong><small>{{ item.detail }}</small>
   </button>
  </div>
  <label class="setting-row"><span><strong>材质强度</strong><small>调节边缘高光、厚度感与投影；图标和名称保持清晰</small></span><div class="range-control"><input type="range" aria-label="材质强度" min="0" max="100" step="1" :disabled="modelValue==='plain'" v-model.number="localStrength" @change="emit('strength',localStrength)"><output>{{localStrength}}%</output></div></label>
 </div>
</template>
