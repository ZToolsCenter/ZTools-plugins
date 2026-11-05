import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildReplyThreads } from './reply-threads.ts'
import type { TopicReply } from './types.ts'

const source = readFileSync(new URL('./rich-content.ts', import.meta.url), 'utf8')

test('只保留正文可用的 HTML 标签和属性', () => {
  const allowedTags = /const ALLOWED_TAGS = \[([\s\S]*?)\]/.exec(source)?.[1] ?? ''
  for (const tag of ['p', 'h1', 'h6', 'pre', 'code', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'del', 'br']) {
    assert.match(allowedTags, new RegExp(`['"]${tag}['"]`))
  }
  assert.match(source, /ALLOWED_ATTR: \['href', 'src', 'alt', 'loading', 'class'\]/)
  assert.doesNotMatch(allowedTags, /script|iframe|style|form/)
  assert.doesNotMatch(source, /on\w+:/)
})

test('仅接受 HTTP(S) 链接，其他链接和图片地址清除', () => {
  assert.match(source, /https\?:/)
  assert.match(source, /ALLOWED_URI_REGEXP/)
  assert.match(source, /FORBID_ATTR: \['style'\]/)
})

test('渲染结果可回退到原始正文，嵌套回复保留渲染 HTML', () => {
  const component = readFileSync(new URL('../V2exBrowser/RichContent.vue', import.meta.url), 'utf8')
  assert.match(component, /sanitized \|\| props\.content \|\| ''/)
  const reply = (id: number, username: string, content: string, content_rendered: string): TopicReply => ({
    id, content, content_rendered, created: 1_000,
    member: { username, avatar_normal: '' }
  })
  const threads = buildReplyThreads([
    reply(1, 'alice', '@bob 原文', '<p>@<a href="/member/bob">bob</a> 原文</p>'),
    reply(2, 'bob', '回复', '<p>回复</p>')
  ])
  assert.equal(threads[0].reply.content_rendered, '<p>@<a href="/member/bob">bob</a> 原文</p>')
  assert.equal(threads[1].reply.content_rendered, '<p>回复</p>')
})

test('按图片尺寸和相邻内容识别表情，不按 embedded_image 类名强制缩小', () => {
  const component = readFileSync(new URL('../V2exBrowser/RichContent.vue', import.meta.url), 'utf8')
  assert.match(component, /images\.length > 1/)
  assert.match(component, /<= 64/)
  assert.match(component, /adjacentText/)
  assert.match(component, /image\.classList\.toggle\('rich-content-emoji'/)
  assert.doesNotMatch(component, /container\.classList\.toggle/)
})
