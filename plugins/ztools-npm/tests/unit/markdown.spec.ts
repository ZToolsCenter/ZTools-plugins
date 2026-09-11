import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/lib/markdown'

describe('renderMarkdown', () => {
  it('标题', () => {
    expect(renderMarkdown('# Hello')).toContain('<h1>Hello</h1>')
    expect(renderMarkdown('## World')).toContain('<h2>World</h2>')
  })
  it('围栏代码块保留换行与缩进', () => {
    const out = renderMarkdown('```bash\nnpm install vue\nnpm run dev\n```')
    expect(out).toContain('<pre><code class="lang-bash">npm install vue\nnpm run dev</code></pre>')
  })
  it('行内代码 / 粗体 / 链接', () => {
    const out = renderMarkdown('use `npm run` and **bold** and [vue](https://vuejs.org)')
    expect(out).toContain('<code>npm run</code>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<a href="https://vuejs.org"')
  })
  it('无序 / 有序列表', () => {
    expect(renderMarkdown('- a\n- b')).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol><li>a</li><li>b</li></ol>')
  })
  it('HTML 标签被转义（防 XSS）', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
  it('javascript: 链接被中和', () => {
    const out = renderMarkdown('[x](javascript:alert(1))')
    expect(out).not.toContain('href="javascript:')
    expect(out).toContain('href="#"')
  })
  it('简单表格', () => {
    const out = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(out).toContain('<table>')
    expect(out).toContain('<th>a</th>')
    expect(out).toContain('<td>1</td>')
  })
  it('URL 只转义一次（& 在查询串中）', () => {
    const out = renderMarkdown('[x](https://e.com?a=1&b=2)')
    expect(out).toContain('href="https://e.com?a=1&amp;b=2"')
    expect(out).not.toContain('&amp;amp;')
  })
  it('data:/vbscript:/大小写协议被中和', () => {
    expect(renderMarkdown('[x](data:text/html,x)')).toContain('href="#"')
    expect(renderMarkdown('[x](vbscript:msgbox(1))')).toContain('href="#"')
    expect(renderMarkdown('[x](JaVaScRiPt:alert(1))')).toContain('href="#"')
  })
  it('URL 中的引号被转义，无法逃逸出属性', () => {
    const out = renderMarkdown('[x](https://e.com/a"onclick=alert(1))')
    expect(out).not.toContain('href="https://e.com/a"')
    expect(out).toContain('&quot;')
  })
  it('链接带 rel="noopener"', () => {
    expect(renderMarkdown('[vue](https://vuejs.org)')).toContain('rel="noopener"')
  })
  it('行内代码内部不渲染 markdown', () => {
    expect(renderMarkdown('`**bold**`')).toBe('<p><code>**bold**</code></p>')
  })
})
