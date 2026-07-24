<script setup lang="ts">
import type { ComputedRef } from "vue";
import type { FinderResult } from "../core/finderLogic";
import AudioPreview from "../preview/AudioPreview.vue";
import CodePreview from "../preview/CodePreview.vue";
import EmptyPreview from "../preview/EmptyPreview.vue";
import ImagePreview from "../preview/ImagePreview.vue";
import MarkdownPreview from "../preview/MarkdownPreview.vue";
import PdfPreview from "../preview/PdfPreview.vue";
import TextPreview from "../preview/TextPreview.vue";
import TreePreview from "../preview/TreePreview.vue";
import VideoPreview from "../preview/VideoPreview.vue";
import { useFilePreview } from "../composables/useFilePreview";
import type { ContextMenuItem } from "../composables/useContextMenu";

const { selectedItem } = defineProps<{
  selectedItem: ComputedRef<FinderResult | undefined>;
}>();

const emit = defineEmits<{
  "context-menu": [event: MouseEvent, items: ContextMenuItem[]];
}>();

const {
  previewKind,
  previewStatus,
  previewContent,
  previewEncoding,
  previewLanguage,
  previewSource,
} = useFilePreview({
  selectedItem,
});

function openImagePreviewMenu(event: MouseEvent) {
  const imagePath = selectedItem.value?.fullPath ?? "";
  emit("context-menu", event, [
    {
      id: "copy-preview-image",
      label: "复制图片",
      disabled: !imagePath,
      action: () => {
        window.ztools.copyFile(imagePath);
      },
    },
  ]);
}
</script>

<template>
  <aside class="preview-pane">
    <div class="preview-body">
      <TextPreview
        v-if="previewKind === 'text' && previewContent"
        :content="previewContent"
        :encoding="previewEncoding"
        :status="previewStatus"
      />
      <MarkdownPreview
        v-else-if="previewKind === 'markdown' && previewContent"
        :content="previewContent"
      />
      <CodePreview
        v-else-if="previewKind === 'code' && previewContent"
        :content="previewContent"
        :language="previewLanguage"
      />
      <TreePreview
        v-else-if="previewKind === 'tree' && previewContent"
        :content="previewContent"
        :label="previewLanguage"
        :status="previewStatus"
      />
      <PdfPreview v-else-if="previewKind === 'pdf' && previewSource" :source="previewSource" />
      <ImagePreview
        v-else-if="previewKind === 'image' && previewSource"
        :source="previewSource"
        @context-menu="openImagePreviewMenu"
      />
      <VideoPreview v-else-if="previewKind === 'video' && previewSource" :source="previewSource" />
      <AudioPreview v-else-if="previewKind === 'audio' && previewSource" :source="previewSource" />
      <EmptyPreview v-else :status="previewStatus" />
    </div>
  </aside>
</template>

<style scoped>
.preview-pane {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
  background: #121315;
  user-select: text;
}

.preview-body {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preview-body > :deep(*) {
  min-width: 0;
  min-height: 0;
}

.preview-body > :deep(.image-preview),
.preview-body > :deep(.preview-media-shell),
.preview-body > :deep(.preview-audio-shell),
.preview-body > :deep(.text-preview),
.preview-body > :deep(.code-preview),
.preview-body > :deep(.tree-preview),
.preview-body > :deep(.markdown-preview),
.preview-body > :deep(.pdf-preview) {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

@media (prefers-color-scheme: light) {
  .preview-pane {
    background: #ffffff;
  }
}

@media (max-width: 560px) {
  .preview-pane {
    display: none;
  }
}
</style>
