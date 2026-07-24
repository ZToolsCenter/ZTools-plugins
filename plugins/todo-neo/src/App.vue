<script setup lang="ts">
import { useTodoStore } from './composables/useTodoStore'
import MainTodo from './components/MainTodo.vue'
import NoteWindow from './components/NoteWindow.vue'
import TomatoWindow from './components/TomatoWindow.vue'
import { featureFlags } from './featureFlags'

const store = useTodoStore()
</script>

<template>
  <NoteWindow v-if="featureFlags.noteWindow && store.route.value === 'note'" />
  <TomatoWindow v-else-if="featureFlags.tomatoWindow && store.route.value === 'tomato'" />
  <MainTodo v-else />
</template>
