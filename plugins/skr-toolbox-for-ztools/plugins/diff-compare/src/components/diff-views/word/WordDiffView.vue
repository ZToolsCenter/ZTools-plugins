<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import ZBadge from "@/components/ui/ZBadge.vue";
import ZButton from "@/components/ui/ZButton.vue";
import ZTooltip from "@/components/ui/ZTooltip.vue";
import ZIcon from "@/components/ui/ZIcon.vue";
import FileDropzone from "@/components/shared/FileDropzone.vue";
import DiffBar from "@/components/shared/DiffBar.vue";
import DiffLegend from "@/components/shared/DiffLegend.vue";
import PrevNextButtons from "@/components/shared/PrevNextButtons.vue";
import { useWordDiff } from "@/composables/useWord";

const { t } = useI18n();

const leftPanelRef = ref<HTMLElement | null>(null)
const rightPanelRef = ref<HTMLElement | null>(null)
const diffBarRef = ref<HTMLElement | null>(null)

const {
  sourceFileName,
  targetFileName,
  loading,
  loadError,
  bothLoaded,
  paragraphBlocks,
  activeBlockIdx,
  diffCount,
  handleFile,
  clearItems,
  handlePaste,
  scrollToBlock,
  goToNextDiff,
  goToPrevDiff,
} = useWordDiff()

const handleScroll = (idx: number) => scrollToBlock(idx, leftPanelRef.value, rightPanelRef.value, diffBarRef.value)
const handleNext = () => {
  const next = goToNextDiff()
  if (next !== undefined) scrollToBlock(next, leftPanelRef.value, rightPanelRef.value, diffBarRef.value)
}
const handlePrev = () => {
  const prev = goToPrevDiff()
  if (prev !== undefined) scrollToBlock(prev, leftPanelRef.value, rightPanelRef.value, diffBarRef.value)
}

onMounted(() => {
  window.addEventListener("paste", handlePaste)
})

onUnmounted(() => {
  window.removeEventListener("paste", handlePaste)
})
</script>

<template>
  <div class="word-root flex flex-col h-full overflow-hidden">
    <!-- Toolbar: 左文件名 | 中间差异 | 右文件名 -->
    <div
      class="h-14 border-b border-[var(--color-border)] bg-[var(--color-background)] flex items-center gap-3 px-4 flex-shrink-0 z-30 shadow-sm">
      <!-- 左侧：源文件名 -->
      <div class="w-[180px] min-w-0 flex items-center gap-2 flex-shrink-0">
        <ZBadge v-if="sourceFileName" :title="sourceFileName" variant="surface" size="lg">{{ sourceFileName }}
        </ZBadge>
        <ZBadge v-else :title="t('wordSource')" variant="surface" size="lg">{{
          t("wordSource")
          }}</ZBadge>
      </div>

      <!-- 中间：差异数量 + 导航 + 清空 -->
      <div class="flex-1 flex items-center justify-center gap-2 min-w-0">
        <template v-if="bothLoaded">
          <div v-if="diffCount > 0"
            class="flex items-center gap-1.5 bg-[var(--color-surface)] rounded-md border border-[var(--color-border)] px-2 py-1">
            <PrevNextButtons :prev-label="t('prevChange')" :next-label="t('nextChange')" @prev="handlePrev"
              @next="handleNext" />
          </div>
          <span v-else class="text-xs text-[var(--color-secondary)]">{{
            t("wordNoDiff")
            }}</span>
        </template>
        <ZTooltip :content="t('clearItems')" v-if="bothLoaded">
          <ZButton variant="ghost" size="icon-sm" @click="clearItems"
            class="!w-6 !h-6 text-[var(--color-secondary)] hover:text-[var(--color-text)]">
            <ZIcon name="trash" :size="14" />
          </ZButton>
        </ZTooltip>
      </div>

      <!-- 右侧：目标文件名 -->
      <div class="w-[180px] min-w-0 flex items-center justify-end gap-2 flex-shrink-0">
        <ZBadge v-if="targetFileName" class="text-xs font-medium truncate text-right text-[var(--color-secondary)]"
          :title="targetFileName">{{ targetFileName }}</ZBadge>
        <ZBadge v-else class="text-xs text-[var(--color-secondary)] opacity-60">{{ t("wordTarget") }}</ZBadge>
      </div>
    </div>

    <!-- Main: Dropzones or Three-Column Layout -->
    <div class="flex-1 overflow-hidden relative bg-[var(--color-surface)]">
      <!-- Dropzones -->
      <div v-if="!bothLoaded" class="h-full flex gap-4 p-5">
        <FileDropzone side="source" :title="t('wordSource')" :hint="t('uploadWord')" :is-ready="!!sourceFileName"
          :fileName="sourceFileName" accept=".docx,.doc" @change="handleFile($event, 'source')">
          <template #icon>
            <ZIcon name="file-word" :size="28" />
          </template>
        </FileDropzone>
        <FileDropzone side="target" :title="t('wordTarget')" :hint="t('uploadWord')" :is-ready="!!targetFileName"
          :fileName="targetFileName" accept=".docx,.doc" @change="handleFile($event, 'target')">
          <template #icon>
            <ZIcon name="file-word" :size="28" />
          </template>
        </FileDropzone>
      </div>

      <!-- Error -->
      <div v-if="loadError"
        class="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-red-500/20 text-red-500 text-sm border border-red-500/30">
        {{ loadError }}
      </div>

      <!-- Three-Column Layout: Left | Center Diff Bar | Right -->
      <div v-else class="h-full flex overflow-hidden bg-[var(--color-background)]">
        <!-- Left: Source -->
        <div ref="leftPanelRef" class="flex-1 overflow-auto border-r border-[var(--color-border)] custom-scrollbar">
          <div class="word-doc-panel p-6 min-h-full">
            <div :id="'source-' + idx" v-for="(block, idx) in paragraphBlocks" :key="'src-' + idx" :class="[
              'word-block min-h-[32px] py-1.5 px-2 rounded',
              block.type === 'delete' && 'bg-[var(--color-delete-bg)]',
              block.type === 'modify' && 'bg-[var(--color-delete-bg)]',
              activeBlockIdx === idx && 'ring-2 ring-[var(--color-cta)]',
            ]">
              <div class="text-[var(--color-text)]" v-html="block.sourceHtml"></div>
            </div>
          </div>
        </div>

        <!-- Center: Slim Diff Bar -->
        <DiffBar ref="diffBarRef" :title="t('wordDiffShort') || t('diffResult')" :items="paragraphBlocks"
          :active-index="activeBlockIdx" @item-click="handleScroll" />

        <!-- Right: Target -->
        <div ref="rightPanelRef" class="flex-1 overflow-auto custom-scrollbar">
          <div class="word-doc-panel p-6 min-h-full">
            <div :id="'target-' + idx" v-for="(block, idx) in paragraphBlocks" :key="'tgt-' + idx" :class="[
              'word-block min-h-[32px] py-1.5 px-2 rounded',
              block.type === 'insert' && 'bg-[var(--color-insert-bg)]',
              block.type === 'modify' && 'bg-[var(--color-insert-bg)]',
              activeBlockIdx === idx && 'ring-2 ring-[var(--color-cta)]',
            ]">
              <div class="text-[var(--color-text)]" v-html="block.targetHtml"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Legend -->
      <DiffLegend v-if="bothLoaded" :items="[
        {
          label: t('removed'),
          swatchClass:
            'bg-[#fff5f5] border border-[#ffc9c9] dark:bg-[#3b1d1d] dark:border-[#555]',
        },
        {
          label: t('modified'),
          swatchClass:
            'bg-[#fff9db] border border-[#ffec99] dark:bg-[#3e3810] dark:border-[#555]',
        },
        {
          label: t('added'),
          swatchClass:
            'bg-[#ebfbee] border border-[#b2f2bb] dark:bg-[#1b3121] dark:border-[#555]',
        },
      ]" class="absolute bottom-0 left-0 right-0" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.word-root {
  background: var(--color-background);
}

.word-doc-panel {
  font-size: 14px;
  line-height: 1.6;

  :deep(p),
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6),
  :deep(li),
  :deep(td),
  :deep(div),
  :deep(span),
  :deep(table),
  :deep(tr),
  :deep(th) {
    margin: 0 0 0.5em 0;
    color: inherit;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(h1) {
    font-size: 2em;
    font-weight: bold;
  }

  :deep(h2) {
    font-size: 1.5em;
    font-weight: bold;
  }

  :deep(h3) {
    font-size: 1.25em;
    font-weight: bold;
  }

  :deep(h4) {
    font-size: 1em;
    font-weight: bold;
  }

  :deep(strong),
  :deep(b) {
    font-weight: 700;
  }

  :deep(em),
  :deep(i) {
    font-style: italic;
  }

  :deep(u) {
    text-decoration: underline;
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  :deep(li) {
    margin: 0.25em 0;
  }

  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
  }

  :deep(td),
  :deep(th) {
    border: 1px solid var(--color-border);
    padding: 0.25em 0.5em;
  }

  :deep(a) {
    color: var(--color-cta);
    text-decoration: underline;
  }

  :deep(code) {
    font-family: monospace;
    background: var(--color-surface);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }

  :deep(pre) {
    font-family: monospace;
    background: var(--color-surface);
    padding: 0.5em;
    border-radius: 3px;
    overflow-x: auto;
  }
}

.custom-scrollbar {
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 10px;

    &:hover {
      background: var(--color-secondary);
    }
  }
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
