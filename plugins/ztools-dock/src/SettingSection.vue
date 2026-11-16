<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{ id: string; title: string; description?: string; icon: string }>();
</script>
<template>
  <section :id="`preference-${id}`" class="preference-group" :aria-labelledby="`heading-${id}`">
    <header class="preference-heading"><span class="section-icon"><Icon :name="icon" :size="20" /></span><div><h3 :id="`heading-${id}`">{{ title }}</h3><p v-if="description">{{ description }}</p></div></header>
    <div class="preference-fields"><slot /></div>
  </section>
</template>
