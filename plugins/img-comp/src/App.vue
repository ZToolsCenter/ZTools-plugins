<script setup lang="ts">
import { ref } from 'vue'
import ImageCompressor from './ImageCompressor/index.vue'
import Settings from './Settings/index.vue'

const showSettings = ref(false)
</script>

<template>
  <ImageCompressor v-show="!showSettings" @open-settings="showSettings = true" />
  <Settings v-if="showSettings" @back="showSettings = false" />
</template>
