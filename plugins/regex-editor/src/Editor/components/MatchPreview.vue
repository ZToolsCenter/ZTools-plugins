<script setup lang="ts">
import type { MatchSegment } from '../../composables/useRegexEditor'

defineProps<{
  segments: MatchSegment[]
}>()
</script>

<template>
  <pre class="match-preview"><template v-for="(seg, i) in segments" :key="i"><mark v-if="seg.matched" class="matched">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></pre>
</template>

<style scoped>
.match-preview {
  margin: 0;
  flex: 1;
  padding: 12px;
  min-height: 120px;
  border-radius: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
}

.matched {
  background: rgba(88, 164, 246, 0.35);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
}
</style>
