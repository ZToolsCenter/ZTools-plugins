<script>
import { defineComponent, h, markRaw } from 'vue'
import { createMarkdownRenderer } from '../utils/markdown/renderer.js'

export default defineComponent({
  name: 'MarkdownContent',
  props: {
    content: { type: String, default: '' },
    streaming: { type: Boolean, default: false },
  },
  setup(props) {
    const renderer = markRaw(createMarkdownRenderer())

    /**
     * 根据当前消息状态生成 Markdown 容器和子节点。
     * @returns {import('vue').VNode} Markdown 内容 VNode。
     */
    return () => h(
      'div',
      { class: ['markdown-content', { 'is-streaming': props.streaming }] },
      renderer.render(props.content, props.streaming),
    )
  },
})
</script>
