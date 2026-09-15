<template>
  <div class="wallpaper-card" @click="$emit('click', wallpaper)">
    <div class="wallpaper-image">
      <img :src="wallpaper.thumbs.large" :alt="wallpaper.id" loading="lazy" />
      <div class="wallpaper-info">
        <div class="wallpaper-stats">
          <span><View /> {{ formatNumber(wallpaper.views) }}</span>
          <span><Star /> {{ formatNumber(wallpaper.favorites) }}</span>
        </div>
        <div class="wallpaper-resolution">{{ wallpaper.resolution }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Wallpaper } from '../types/wallpaper';
import { View, Star } from '@element-plus/icons-vue';

defineProps<{
  wallpaper: Wallpaper;
}>();

defineEmits<{
  (e: 'click', wallpaper: Wallpaper): void;
}>();

const formatNumber = (num: number) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};
</script>

<style scoped>
.wallpaper-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease;
  background-color: #f5f5f5;
}

.wallpaper-card:hover {
  transform: translateY(-4px);
}

.wallpaper-image {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 Aspect Ratio */
}

.wallpaper-image img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wallpaper-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.wallpaper-card:hover .wallpaper-info {
  opacity: 1;
}

.wallpaper-stats {
  display: flex;
  gap: 12px;
  font-size: 0.9rem;
}

.wallpaper-stats :deep(svg) {
  width: 1em;
  height: 1em;
  margin-right: 4px;
  vertical-align: middle;
}

.wallpaper-resolution {
  font-size: 0.9rem;
  font-weight: 500;
}
</style> 