<script setup lang="ts">
defineProps<{ theme: 'bar' | 'worm' | 'snail' | 'custom'; image?: string }>();
</script>
<template>
  <span v-if="theme === 'bar'" class="trigger-line" aria-hidden="true"></span>
  <img v-else-if="theme === 'custom'" class="trigger-art" :src="image" alt="" draggable="false">
  <svg v-else-if="theme === 'worm'" class="trigger-art" viewBox="0 0 100 30" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <path d="M12 29h74" stroke="currentColor" stroke-width="2" opacity=".25" stroke-linecap="round"/>
    <g fill="currentColor"><circle cx="23" cy="22" r="7"/><circle cx="35" cy="20" r="8"/><circle cx="49" cy="21" r="8"/><circle cx="63" cy="19" r="9"/><circle cx="77" cy="17" r="10"/></g>
    <path d="m73 8-3-5m11 5 3-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <g fill="white"><circle cx="74" cy="15" r="2.5"/><circle cx="81" cy="15" r="2.5"/></g>
    <g fill="#183044"><circle cx="75" cy="15" r="1.1"/><circle cx="82" cy="15" r="1.1"/></g>
    <path d="M77 21q3 3 5-1" stroke="#183044" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>
  <svg v-else class="trigger-art" viewBox="0 0 100 30" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <path d="M14 29h72" stroke="currentColor" stroke-width="2" opacity=".25" stroke-linecap="round"/>
    <path d="M25 24q3-3 12-3h24q5 0 8-10l3 1-2 13q-1 4-9 4H29q-9 0-4-5Z" fill="currentColor"/>
    <circle cx="46" cy="16" r="12" fill="color-mix(in srgb,currentColor 55%,#fff)" stroke="currentColor" stroke-width="2"/>
    <path d="M49 23c-12 3-16-14-5-14 8 0 9 10 2 10-4 0-4-5 0-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="m69 13-2-7m7 6 4-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <g fill="#183044"><circle cx="67" cy="5" r="1.8"/><circle cx="79" cy="4" r="1.8"/></g>
  </svg>
</template>
