import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { marked, Renderer } from 'marked'
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import { readPluginReadme } from '../../../api/pluginMarket'
import type { PluginDetailReadme, PluginMarketUiPlugin } from '../../../types/pluginMarket'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)

const markdownRenderer = new Renderer()
markdownRenderer.code = ({ text, lang }) => {
  const language = lang?.trim().toLowerCase() || ''
  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(text, { language }).value
    : hljs.highlightAuto(text).value

  const languageClass = language && hljs.getLanguage(language) ? ` language-${language}` : ''
  return `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>`
}

marked.setOptions({ breaks: true, gfm: true, renderer: markdownRenderer })

export function usePluginReadme(
  plugin: Ref<PluginMarketUiPlugin>,
  remoteReadme?: Ref<PluginDetailReadme | null | undefined>,
) {
  const readmeContent = ref('')
  const readmeLoading = ref(false)
  const readmeError = ref('')
  const showAiGeneratedBadge = ref(false)

  const renderedMarkdown = computed(() => {
    if (!readmeContent.value) {
      return ''
    }

    return marked(readmeContent.value) as string
  })

  async function loadReadme(): Promise<void> {
    readmeLoading.value = true
    readmeError.value = ''
    readmeContent.value = ''
    showAiGeneratedBadge.value = false

    try {
      if (plugin.value.installed && plugin.value.path) {
        const localResult = await readPluginReadme(plugin.value.path)
        if (localResult.success && localResult.content) {
          readmeContent.value = localResult.content
          return
        }
      }

      const remoteResult = await readPluginReadme(plugin.value.name)
      if (remoteResult.success && remoteResult.content) {
        readmeContent.value = remoteResult.content
        return
      }

      const inlineReadme = remoteReadme?.value
      if (inlineReadme?.content) {
        readmeContent.value = inlineReadme.content
        showAiGeneratedBadge.value = !!inlineReadme.isAiGenerated
        return
      }

      readmeError.value = remoteResult.error || '暂无详情'
    } catch (error) {
      const inlineReadme = remoteReadme?.value
      if (inlineReadme?.content) {
        readmeContent.value = inlineReadme.content
        showAiGeneratedBadge.value = !!inlineReadme.isAiGenerated
      } else {
        console.error('[PluginDetail] README 加载失败:', error)
        readmeError.value = error instanceof Error ? error.message : 'README 加载失败'
      }
    } finally {
      readmeLoading.value = false
    }
  }

  onMounted(() => {
    if (plugin.value.name || plugin.value.path) {
      void loadReadme()
    }
  })

  watch(
    () => [plugin.value.name, plugin.value.path, remoteReadme?.value?.hash, remoteReadme?.value?.content],
    () => {
      if (plugin.value.name || plugin.value.path) {
        void loadReadme()
      }
    },
  )

  return {
    readmeLoading,
    readmeError,
    renderedMarkdown,
    showAiGeneratedBadge,
  }
}
