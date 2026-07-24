<script setup lang="ts">
import { ref, watch } from "vue";
import type MarkdownIt from "markdown-it";

const props = defineProps<{
  content: string;
}>();

const renderedHtml = ref("");
let markdown: MarkdownIt | undefined;

watch(
  () => props.content,
  async (content) => {
    renderedHtml.value = await renderMarkdown(content);
  },
  { immediate: true },
);

async function renderMarkdown(content: string) {
  if (!markdown) {
    const MarkdownIt = (await import("markdown-it")).default;
    markdown = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: false,
    });
  }

  return markdown.render(content);
}
</script>

<template>
  <article class="markdown-preview" v-html="renderedHtml"></article>
</template>

<style scoped>
.markdown-preview {
  overflow: auto;
  padding: 12px 16px 20px;
  color: #f5f7fa;
  font-size: 13px;
  line-height: 1.55;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3) {
  margin: 0.8em 0 0.45em;
  color: #ffffff;
  line-height: 1.25;
}

.markdown-preview :deep(h1) {
  font-size: 20px;
}

.markdown-preview :deep(h2) {
  font-size: 17px;
}

.markdown-preview :deep(h3) {
  font-size: 15px;
}

.markdown-preview :deep(p),
.markdown-preview :deep(ul),
.markdown-preview :deep(ol),
.markdown-preview :deep(pre),
.markdown-preview :deep(blockquote) {
  margin: 0.55em 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: 1.4em;
}

.markdown-preview :deep(code) {
  padding: 0.1em 0.3em;
  background: #24272c;
  border-radius: 3px;
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 0.92em;
}

.markdown-preview :deep(pre) {
  overflow: auto;
  padding: 10px 12px;
  background: #181b20;
  border-radius: 4px;
}

.markdown-preview :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-preview :deep(blockquote) {
  padding-left: 10px;
  color: #c3c8cf;
  border-left: 3px solid #555b63;
}

.markdown-preview :deep(a) {
  color: #8ab4f8;
}

@media (prefers-color-scheme: light) {
  .markdown-preview {
    color: #1f2937;
    background: #ffffff;
  }

  .markdown-preview :deep(h1),
  .markdown-preview :deep(h2),
  .markdown-preview :deep(h3) {
    color: #111827;
  }

  .markdown-preview :deep(code) {
    background: #eef2f7;
  }

  .markdown-preview :deep(pre) {
    background: #f6f8fb;
  }

  .markdown-preview :deep(blockquote) {
    color: #667085;
    border-left-color: #c8d0da;
  }

  .markdown-preview :deep(a) {
    color: #2563eb;
  }
}
</style>
