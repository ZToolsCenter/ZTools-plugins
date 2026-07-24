<script setup lang="ts">
import { ref, watch } from "vue";
import type { HighlighterCore, LanguageRegistration, ThemeRegistration } from "shiki/types";

const props = defineProps<{
  content: string;
  language: string;
}>();

type LanguageModule = { default: LanguageRegistration[] };
type ThemeModule = { default: ThemeRegistration };

const languageLoaders: Record<string, () => Promise<LanguageModule>> = {
  bash: () => import("shiki/dist/langs/bash.mjs"),
  bat: () => import("shiki/dist/langs/bat.mjs"),
  c: () => import("shiki/dist/langs/c.mjs"),
  cpp: () => import("shiki/dist/langs/cpp.mjs"),
  csharp: () => import("shiki/dist/langs/csharp.mjs"),
  css: () => import("shiki/dist/langs/css.mjs"),
  go: () => import("shiki/dist/langs/go.mjs"),
  html: () => import("shiki/dist/langs/html.mjs"),
  ini: () => import("shiki/dist/langs/ini.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  json: () => import("shiki/dist/langs/json.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  powershell: () => import("shiki/dist/langs/powershell.mjs"),
  properties: () => import("shiki/dist/langs/properties.mjs"),
  python: () => import("shiki/dist/langs/python.mjs"),
  rust: () => import("shiki/dist/langs/rust.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
  toml: () => import("shiki/dist/langs/toml.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
  vue: () => import("shiki/dist/langs/vue.mjs"),
  xml: () => import("shiki/dist/langs/xml.mjs"),
  yaml: () => import("shiki/dist/langs/yaml.mjs"),
};

const highlightedHtml = ref("");
let highlighterPromise: Promise<HighlighterCore> | undefined;
const loadedLanguages = new Set<string>();

watch(
  () => [props.content, props.language] as const,
  async () => {
    await renderCode();
  },
  { immediate: true },
);

async function renderCode() {
  try {
    const highlighter = await getHighlighter();
    const language = await resolveLanguage(highlighter, props.language);
    const theme = window.matchMedia("(prefers-color-scheme: light)").matches
      ? "one-light"
      : "catppuccin-frappe";

    highlightedHtml.value = highlighter.codeToHtml(props.content, {
      lang: language,
      theme,
    });
  } catch {
    highlightedHtml.value = "";
  }
}

async function getHighlighter() {
  highlighterPromise ??= createHighlighter();
  return highlighterPromise;
}

async function createHighlighter() {
  const [core, engine, lightTheme, darkTheme] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/dist/themes/one-light.mjs") as Promise<ThemeModule>,
    import("shiki/dist/themes/catppuccin-frappe.mjs") as Promise<ThemeModule>,
  ]);

  return core.createHighlighterCore({
    themes: [lightTheme.default, darkTheme.default],
    langs: [],
    engine: engine.createJavaScriptRegexEngine(),
  });
}

async function resolveLanguage(highlighter: HighlighterCore, language: string) {
  const normalizedLanguage = language || "plaintext";
  const loadLanguage = languageLoaders[normalizedLanguage];

  if (!loadLanguage) return "plaintext";
  if (!loadedLanguages.has(normalizedLanguage)) {
    const languageModule = await loadLanguage();
    await highlighter.loadLanguage(languageModule.default);
    loadedLanguages.add(normalizedLanguage);
  }

  return normalizedLanguage;
}
</script>

<template>
  <div class="code-preview">
    <header class="code-info-bar">
      <span>{{ language }}</span>
    </header>
    <div class="code-body">
      <div v-if="highlightedHtml" class="code-highlight" v-html="highlightedHtml"></div>
      <pre v-else class="code-fallback">{{ content }}</pre>
    </div>
  </div>
</template>

<style scoped>
.code-preview {
  display: grid;
  grid-template-rows: 30px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: #303446;
}

.code-info-bar {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 12px;
  color: #c3c8cf;
  border-bottom: 1px solid #282a2d;
  font-size: 12px;
}

.code-info-bar span {
  min-width: 72px;
  color: #9ba1a8;
  font-family: Consolas, "Cascadia Mono", monospace;
}

.code-body {
  overflow: auto;
  min-width: 0;
  min-height: 0;
}

.code-highlight {
  min-width: max-content;
  font-size: 12px;
  line-height: 1.35;
}

.code-highlight :deep(pre) {
  margin: 0;
  padding: 12px 14px;
  background: transparent !important;
}

.code-highlight :deep(code) {
  counter-reset: step;
  counter-increment: step 0;
  font-family: Consolas, "Cascadia Mono", monospace;
}

.code-highlight :deep(code .line)::before {
  content: counter(step);
  counter-increment: step;
  display: inline-block;
  width: 1rem;
  margin-right: 1.5rem;
  color: rgba(115, 138, 148, 0.4);
  text-align: right;
}

.code-fallback {
  margin: 0;
  padding: 12px 14px;
  color: #ffffff;
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 12px;
  line-height: 1.35;
  white-space: pre;
}

@media (prefers-color-scheme: light) {
  .code-preview {
    background: #ffffff;
  }

  .code-info-bar {
    color: #667085;
    border-bottom-color: #d9dee7;
  }

  .code-info-bar span {
    color: #4f5b6a;
  }

  .code-fallback {
    color: #111827;
  }
}
</style>
