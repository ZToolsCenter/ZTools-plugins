<script setup lang="ts">
import DiffWorkbench from '@/components/layout/DiffWorkbench.vue'
import TextDiffView from '@/components/diff-views/text/TextDiffView.vue'
import ImageDiffView from '@/components/diff-views/image/ImageDiffView.vue'
import ExcelDiffView from '@/components/diff-views/excel/ExcelDiffView.vue'
import WordDiffView from '@/components/diff-views/word/WordDiffView.vue'
import PdfDiffView from '@/components/diff-views/pdf/PdfDiffView.vue'
import { usePluginEvents } from '@/composables/usePluginEvents'

const { currentMode } = usePluginEvents()
</script>

<template>
  <DiffWorkbench :initial-mode="currentMode">
    <template #text>
      <TextDiffView />
    </template>
    <template #image>
      <ImageDiffView />
    </template>
    <template #excel>
      <ExcelDiffView />
    </template>
    <template #word>
      <WordDiffView />
    </template>
    <template #pdf>
      <PdfDiffView />
    </template>
  </DiffWorkbench>
</template>

<style>
/* Global styles handled by main.css / tailwind */
</style>
