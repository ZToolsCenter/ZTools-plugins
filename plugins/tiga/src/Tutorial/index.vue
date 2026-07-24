<script setup lang="ts">
import { ref, onMounted } from 'vue'
import tutorialContent from '../assets/tutorial.md?raw'

const props = defineProps<{
  enterAction: any
}>()

const content = ref(tutorialContent)

// 简单 markdown 渲染
const renderedContent = ref('')

const renderMarkdown = (md: string) => {
  let html = md

  // 标题（从长到短匹配，避免 #### 被 ### 规则先吃掉）
  html = html.replace(/^#### (.*$)/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')

  // 引用块（合并连续的 > 开头行，包括 > 空行和 > - 列表）
  html = html.replace(/(^>.*$\n?)+/gm, (match) => {
    const inner = match
      .split('\n')
      .map(line => line.replace(/^>\s?/, ''))
      .join('\n')
    // 递归渲染引用块内部的 markdown（标题、列表、强调等）
    let innerHtml = inner
    innerHtml = innerHtml.replace(/^#### (.*$)/gm, '<h4>$1</h4>')
    innerHtml = innerHtml.replace(/^### (.*$)/gm, '<h3>$1</h3>')
    innerHtml = innerHtml.replace(/^## (.*$)/gm, '<h2>$1</h2>')
    innerHtml = innerHtml.replace(/^# (.*$)/gm, '<h1>$1</h1>')
    innerHtml = innerHtml.replace(/^- (.*$)/gm, '<li>$1</li>')
    innerHtml = innerHtml.replace(/(<li.*<\/li>\n?)+/g, '<ul>$&</ul>')
    innerHtml = innerHtml.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // 空行跳过，非标签行包 <p>
    innerHtml = innerHtml.replace(/^(?!<[hul]|<li|<\/|$)(.*$)/gm, (m, p1) => p1.trim() ? `<p>${p1}</p>` : '')
    return `<blockquote>${innerHtml}</blockquote>`
  })

  // 列表
  html = html.replace(/^\- ✅ (.*$)/gm, '<li class="good">$1</li>')
  html = html.replace(/^\- ❌ (.*$)/gm, '<li class="bad">$1</li>')
  html = html.replace(/^\- (.*$)/gm, '<li>$1</li>')
  html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul>$&</ul>')

  // 数字列表
  html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ol>$&</ol>')

  // 分割线
  html = html.replace(/^---$/gm, '<hr>')

  // 强调
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  // 段落（跳过空行/纯空白行，避免生成无意义的空 <p> 标签影响布局）
  html = html.replace(/^(?!<[hulolb]|<hr|<li|<\/)(.*$)/gm, (m, p1) =>
    p1.trim() ? `<p>${p1}</p>` : ''
  )

  return html
}

onMounted(() => {
  renderedContent.value = renderMarkdown(content.value)
})
</script>

<template>
  <div class="tutorial">
    <h1>提肛助手 - 教程</h1>
    <div class="tutorial-content" v-html="renderedContent"></div>
  </div>
</template>

<style scoped>
.tutorial {
  padding: 20px;
  max-width: 100%;
  overflow-y: auto;
}

.tutorial h1 {
  margin-bottom: 20px;
  font-size: 18px;
}

.tutorial-content {
  line-height: 1.8;
  overflow-wrap: break-word;
  word-break: break-word;
}

.tutorial-content h1 {
  font-size: 16px;
  margin-top: 20px;
  margin-bottom: 10px;
}

.tutorial-content h2 {
  font-size: 14px;
  margin-top: 15px;
  margin-bottom: 8px;
  color: var(--blue, #58a4f6);
}

.tutorial-content h3 {
  font-size: 13px;
  margin-top: 10px;
  margin-bottom: 5px;
}

.tutorial-content h4 {
  font-size: 12px;
  margin-top: 8px;
  margin-bottom: 4px;
}

.tutorial-content p {
  margin-bottom: 10px;
}

.tutorial-content ul,
.tutorial-content ol {
  margin-bottom: 10px;
  padding-left: 20px;
}

.tutorial-content li {
  margin-bottom: 5px;
}

.tutorial-content li.good {
  color: #4caf50;
}

.tutorial-content li.bad {
  color: #f44336;
}

.tutorial-content hr {
  border: none;
  border-top: 1px solid var(--border-color, #ddd);
  margin: 15px 0;
}

.tutorial-content blockquote {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--el-color-primary, #409eff);
  background: var(--el-fill-color-lighter);
  border-radius: 0 4px 4px 0;
  color: var(--el-text-color-regular);
}

.tutorial-content strong {
  color: var(--blue, #58a4f6);
}
</style>