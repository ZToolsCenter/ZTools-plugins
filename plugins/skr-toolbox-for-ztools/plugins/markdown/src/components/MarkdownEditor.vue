<script setup>
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'

const props = defineProps({
  initialValue: {
    type: String,
    default: ''
  },
  readOnly: {
    type: Boolean,
    default: false
  },
  id: {
    type: String,
    default: 'vditor'
  },
  isDark: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['change'])

const vditor = ref(null)
const editorRef = ref(null)

const isReady = ref(false)

onMounted(() => {
  initVditor()
})

watch(() => props.initialValue, (newValue) => {
  if (vditor.value && isReady.value) {
    const currentValue = vditor.value.getValue()
    if (currentValue !== newValue) {
      vditor.value.setValue(newValue)
    }
  }
})

watch(() => props.isDark, (newVal) => {
  if (vditor.value) {
    vditor.value.setTheme(
      newVal ? 'dark' : 'classic',
      newVal ? 'dark' : 'light',
      newVal ? 'native' : 'github'
    )
  }
})

onBeforeUnmount(() => {
  if (vditor.value) {
    vditor.value.destroy()
    vditor.value = null
  }
})

const initVditor = () => {
  vditor.value = new Vditor(editorRef.value, {
    height: '100%',
    width: '100%',
    value: props.initialValue,
    mode: 'wysiwyg',
    toolbarConfig: {
      pin: true,
    },
    toolbar: [
        "emoji",
        "headings",
        "bold",
        "italic",
        "strike",
        "link",
        "|",
        "list",
        "ordered-list",
        "check",
        "outdent",
        "indent",
        "|",
        "quote",
        "line",
        "code",
        "inline-code",
        "insert-before",
        "insert-after",
        "|",
        "upload",
        // "record",
        "table",
        "|",
        "undo",
        "redo",
        "|",
        "fullscreen",
        "edit-mode",
        {
            name: "more",
            toolbar: [
                "both",
                "code-theme",
                "content-theme",
                "export",
                "outline",
                "preview",
                "devtools",
                // "info",
                // "help",
            ],
        },
    ],
    upload: {
      url: '/upload',
      handler: async (files) => {
        try {
          for (const file of files) {
            const buffer = await file.arrayBuffer()
            const fileUrl = await window.ztools.saveMarkdownImage(file.name, buffer)
            vditor.value.insertValue(`![${file.name}](${fileUrl})`)
          }
        } catch (error) {
          console.error('Upload failed:', error)
        }
      }
    },
    cache: {
      enable: false,
    },
    counter: {
      enable: true,
    },
    after: () => {
      isReady.value = true
      if (vditor.value.getValue() !== props.initialValue) {
        vditor.value.setValue(props.initialValue)
      }
    },
    input: (value) => {
      emit('change', value)
    },
    preview: {
      theme: {
        current: props.isDark ? 'dark' : 'light',
        path: 'https://cdn.jsdelivr.net/npm/vditor/dist/css/content-theme',
      }
    },
    theme: props.isDark ? 'dark' : 'classic',
  })
}
</script>

<template>
  <div class="markdown-editor" ref="editorRef"></div>
</template>

<style scoped>
.markdown-editor {
  height: 100%;
  width: 100%;
  /* overflow: hidden; */
}
</style>
<style>
.markdown-editor.vditor {
  border: 0 !important;
}
</style>
