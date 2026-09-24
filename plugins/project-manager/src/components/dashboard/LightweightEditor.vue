<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { editorLanguageExtension, type EditorLanguage } from '../../utils/editorLanguage';
import { editorHighlightExtension } from '../../utils/editorHighlight';

const props = withDefaults(defineProps<{
  modelValue: string;
  language: EditorLanguage;
  readOnly?: boolean;
  dark?: boolean;
}>(), {
  readOnly: false,
  dark: true,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  save: [];
}>();

const editorHost = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const highlightCompartment = new Compartment();

function highlightExtension(dark: boolean): Extension {
  return editorHighlightExtension(dark);
}

function themeExtension(dark: boolean): Extension {
  return EditorView.theme({
    '&': {
      color: dark ? '#d7dee8' : '#263241',
      backgroundColor: dark ? '#151a21' : '#ffffff',
      height: '100%',
    },
    '.cm-content': { caretColor: dark ? '#8bc8ff' : '#2167a7' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: dark ? '#8bc8ff' : '#2167a7' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': {
      backgroundColor: dark ? '#11161c' : '#f5f7fa',
      color: dark ? '#667384' : '#8b96a5',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: dark ? '#1b2430' : '#eef4fa' },
    '.cm-activeLineGutter': { backgroundColor: dark ? '#1b2430' : '#e7eff8' },
    '.cm-selectionBackground, ::selection': { backgroundColor: dark ? '#294b6b' : '#cfe4fb' },
    '.cm-panels': { backgroundColor: dark ? '#1b222c' : '#f7f9fb', color: 'inherit' },
    '.cm-search': { padding: '8px', borderBottom: `1px solid ${dark ? '#303b48' : '#d9e0e8'}` },
    '.cm-button': { color: 'inherit', backgroundColor: dark ? '#273342' : '#ffffff', border: `1px solid ${dark ? '#46586c' : '#cbd5e1'}` },
    '.cm-textfield': { color: 'inherit', backgroundColor: dark ? '#11161c' : '#ffffff', border: `1px solid ${dark ? '#46586c' : '#cbd5e1'}` },
  }, { dark });
}

function saveCommand(): boolean {
  emit('save');
  return true;
}

function createView(): void {
  if (!editorHost.value) return;
  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      foldGutter(),
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([
        { key: 'Mod-s', run: saveCommand },
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      readOnlyCompartment.of([
        EditorState.readOnly.of(props.readOnly),
        EditorView.editable.of(!props.readOnly),
      ]),
      languageCompartment.of(editorLanguageExtension(props.language)),
      themeCompartment.of(themeExtension(props.dark)),
      highlightCompartment.of(highlightExtension(props.dark)),
      EditorView.updateListener.of(update => {
        if (update.docChanged) emit('update:modelValue', update.state.doc.toString());
      }),
    ],
  });
  view = new EditorView({ state, parent: editorHost.value });
}

watch(() => props.modelValue, value => {
  if (!view || value === view.state.doc.toString()) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
});

watch(() => props.language, language => {
  view?.dispatch({ effects: languageCompartment.reconfigure(editorLanguageExtension(language)) });
});

watch(() => props.dark, dark => {
  view?.dispatch({
    effects: [
      themeCompartment.reconfigure(themeExtension(dark)),
      highlightCompartment.reconfigure(highlightExtension(dark)),
    ],
  });
});

watch(() => props.readOnly, readOnly => {
  view?.dispatch({
    effects: readOnlyCompartment.reconfigure([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]),
  });
});

onMounted(createView);
onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

defineExpose({
  focus: () => view?.focus(),
});
</script>

<template>
  <div ref="editorHost" class="lightweight-editor" :class="{ 'is-read-only': readOnly }" />
</template>

<style scoped>
.lightweight-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  font-size: var(--app-font-code);
  line-height: var(--app-line-height-code);
}
.lightweight-editor :deep(.cm-editor) {
  height: 100%;
}
.lightweight-editor :deep(.cm-scroller) {
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: var(--app-font-code);
  line-height: var(--app-line-height-code);
}
.lightweight-editor :deep(.cm-gutters) {
  min-width: 42px;
}
</style>
