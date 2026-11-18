<script setup>
import {image,presets} from '../action-art';defineProps({action:Object,size:{type:Number,default:22}});
</script>
<template><span v-if="action?.icon&&!presets[action.icon]&&!action.image" class="action-symbol" :style="{fontSize:size+'px'}" aria-hidden="true">{{action.icon}}</span><img v-else class="action-image" :src="image(action)" :width="size" :height="size" alt=""></template>
