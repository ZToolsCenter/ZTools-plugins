import http from 'node:http'

let lastRequest = null
let requests = []
let overflowRejected = false

/**
 * 等待流式响应被客户端关闭，或在超时后主动结束等待。
 * @param {import('node:http').ServerResponse} response 当前 HTTP 响应。
 * @param {number} timeoutMs 最长等待毫秒数。
 * @returns {Promise<void>} 响应关闭或超时后结束的 Promise。
 */
function waitForResponseClose(response, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    response.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
    return
  }

  if (request.method === 'GET' && request.url === '/last-request') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(lastRequest))
    return
  }

  if (request.method === 'GET' && request.url === '/requests') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(requests))
    return
  }

  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404)
    response.end()
    return
  }

  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  request.on('end', async () => {
    lastRequest = JSON.parse(body)
    requests = [...requests.slice(-99), lastRequest]

    const latestUserMessage = [...lastRequest.messages].reverse().find((message) => message.role === 'user')
    if (latestUserMessage?.content?.includes('你现在是 AI 助手的上下文压缩引擎')) {
      // 保留一个可观察的压缩窗口，验证界面会在摘要请求期间发布运行状态。
      await new Promise((resolve) => setTimeout(resolve, 500))
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const summary = '## 用户目标与意图\n- 继续完成当前测试任务。\n\n## 关键技术与约束\n- 保留完整界面历史。\n\n## 文件与实现\n- ZVC 上下文压缩已启用。\n\n## 错误与处理\n- 无。\n\n## 待办事项\n- 完成当前请求。\n\n## 当前进展\n- 正在验证摘要检查点。\n\n## 下一步\n- 继续处理后续消息。\n\n## 关键上下文\n- 模拟服务摘要。'
      response.write(`data: ${JSON.stringify({ id: 'compaction-test', choices: [{ index: 0, delta: { content: summary }, finish_reason: 'stop' }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: 'compaction-usage', choices: [], usage: { prompt_tokens: 2400, completion_tokens: 120, total_tokens: 2520 } })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }

    if (latestUserMessage?.content === '测试上下文超限恢复' && !overflowRejected) {
      overflowRejected = true
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'context_length_exceeded', type: 'invalid_request_error', message: 'maximum context length is 65536 tokens' } }))
      return
    }

    if (latestUserMessage?.content === '测试模型自动重试') {
      const attempt = requests.filter((item) => [...item.messages].reverse().find((message) => message.role === 'user')?.content === latestUserMessage.content).length
      if (attempt <= 2) {
        // 前两次返回可重试 503，并使用短响应头缩短端到端测试等待时间。
        response.writeHead(503, { 'content-type': 'application/json', 'retry-after-ms': '600' })
        response.end(JSON.stringify({ error: { type: 'server_error', message: 'Upstream service temporarily unavailable' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      response.write(`data: ${JSON.stringify({ id: 'retry-recovered', choices: [{ index: 0, delta: { content: '模型自动重试已恢复。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }

    if (latestUserMessage?.content === '测试停止模型重试') {
      // 保持较长退避窗口，用于验证停止按钮能够立即取消等待。
      response.writeHead(503, { 'content-type': 'application/json', 'retry-after-ms': '1200' })
      response.end(JSON.stringify({ error: { type: 'server_error', message: 'Upstream service temporarily unavailable' } }))
      return
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    const hasToolResult = lastRequest.messages.some((message) => message.role === 'tool')
    const imageContent = Array.isArray(latestUserMessage?.content) ? latestUserMessage.content : []
    if (imageContent.some((part) => part?.type === 'image_url')) {
      response.write(`data: ${JSON.stringify({ id: 'image-test', choices: [{ index: 0, delta: { content: '已收到图片。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (typeof latestUserMessage?.content === 'string' && latestUserMessage.content.startsWith('测试工具读取图片：') && !hasToolResult) {
      const filePath = latestUserMessage.content.slice('测试工具读取图片：'.length)
      response.write(`data: ${JSON.stringify({ id: 'read-image-test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-read-image', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: filePath }) } }] }, finish_reason: 'tool_calls' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试上下文超限恢复') {
      response.write(`data: ${JSON.stringify({ id: 'overflow-recovered', choices: [{ index: 0, delta: { content: '上下文压缩后已恢复。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试自动压缩提示') {
      response.write(`data: ${JSON.stringify({ id: 'automatic-compaction-finished', choices: [{ index: 0, delta: { content: '自动压缩提示验证完成。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试 OpenAI 推理映射') {
      response.write(`data: ${JSON.stringify({ id: 'openai-reasoning-test', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '已使用 OpenAI 推理强度。' } }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: 'openai-reasoning-test', choices: [{ index: 0, delta: { content: 'OpenAI 推理映射完成。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试超过二十轮工具调用') {
      const latestUserIndex = lastRequest.messages.findLastIndex((message) => message.role === 'user')
      const currentTurnToolCount = lastRequest.messages
        .slice(latestUserIndex + 1)
        .filter((message) => message.role === 'tool').length
      if (currentTurnToolCount < 21) {
        const callNumber = currentTurnToolCount + 1
        response.write(`data: ${JSON.stringify({ id: `long-loop-${callNumber}`, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call-shell-${callNumber}`, type: 'function', function: { name: 'bash', arguments: '{"command":"date"}' } }] }, finish_reason: null }] })}\n\n`)
        response.write('data: {"id":"long-loop","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n')
      } else {
        response.write(`data: ${JSON.stringify({ id: 'long-loop-final', choices: [{ index: 0, delta: { content: '已完成超过二十轮工具调用。' }, finish_reason: 'stop' }] })}\n\n`)
      }
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试多会话 A' || latestUserMessage?.content === '测试多会话 B') {
      const label = latestUserMessage.content.endsWith('A') ? 'A' : 'B'
      const delayMs = label === 'A' ? 1800 : 700
      response.write(`data: ${JSON.stringify({ id: `multi-${label}`, choices: [{ index: 0, delta: { content: `会话 ${label} 已开始。` }, finish_reason: null }] })}\n\n`)
      // 两个响应保持重叠，以验证前端能够按会话隔离并发流。
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (response.destroyed) return
      response.write(`data: ${JSON.stringify({ id: `multi-${label}`, choices: [{ index: 0, delta: { content: `会话 ${label} 已完成。` }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试排队首轮') {
      response.write(`data: ${JSON.stringify({ id: 'queue-first', choices: [{ index: 0, delta: { content: '排队首轮已开始。' }, finish_reason: null }] })}\n\n`)
      // 保持首轮运行窗口，供第二条消息进入 Session Inbox。
      await new Promise((resolve) => setTimeout(resolve, 1200))
      if (response.destroyed) return
      response.write(`data: ${JSON.stringify({ id: 'queue-first', choices: [{ index: 0, delta: { content: '排队首轮已完成。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试排队次轮') {
      response.write(`data: ${JSON.stringify({ id: 'queue-second', choices: [{ index: 0, delta: { content: '排队次轮已执行。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试插话首轮') {
      response.write(`data: ${JSON.stringify({ id: 'steer-first', choices: [{ index: 0, delta: { content: '插话首轮正在处理。' }, finish_reason: null }] })}\n\n`)
      // 模型流自然结束后，前端才可在安全步骤边界领取插话。
      await new Promise((resolve) => setTimeout(resolve, 1200))
      if (response.destroyed) return
      response.write(`data: ${JSON.stringify({ id: 'steer-first', choices: [{ index: 0, delta: { content: '插话首轮阶段完成。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试安全插话') {
      response.write(`data: ${JSON.stringify({ id: 'steer-second', choices: [{ index: 0, delta: { content: '插话已在当前 Turn 继续。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试停止保留队列') {
      response.write(`data: ${JSON.stringify({ id: 'stop-queue-first', choices: [{ index: 0, delta: { content: '停止测试首轮已开始。' }, finish_reason: null }] })}\n\n`)
      await waitForResponseClose(response, 5_000)
      if (!response.destroyed) response.end()
      return
    }
    if (latestUserMessage?.content === '测试停止后的队列') {
      response.write(`data: ${JSON.stringify({ id: 'stop-queue-second', choices: [{ index: 0, delta: { content: '停止后队列继续执行。' }, finish_reason: 'stop' }] })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    if (latestUserMessage?.content === '测试停止未完成工具') {
      // 只发送部分参数并保持连接，用真实流式中断复现“准备中”卡片残留问题。
      response.write(`data: ${JSON.stringify({ id: 'stop-test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-stop-write', type: 'function', function: { name: 'write', arguments: '{"path":' } }] }, finish_reason: null }] })}\n\n`)
      await waitForResponseClose(response, 5_000)
      if (!response.destroyed) response.end()
      return
    }
    response.write(`data: ${JSON.stringify({ id: 'reasoning-test', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: hasToolResult ? '命令执行完成，整理最终回答。' : '先理解用户的问题。' } }] })}\n\n`)
    await new Promise((resolve) => setTimeout(resolve, 350))
    if (!hasToolResult) {
      response.write(`data: ${JSON.stringify({ id: 'reasoning-test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-shell-test', type: 'function', function: { name: 'bash', arguments: '{"command":"printf zvc-tool-test"}' } }] }, finish_reason: null }] })}\n\n`)
      response.write('data: {"id":"reasoning-test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    const longReasoning = Array.from({ length: 28 }, (_, index) => `推理步骤 ${index + 1}：继续分析细节。`).join('\n')
    response.write(`data: ${JSON.stringify({ id: 'reasoning-test', choices: [{ index: 0, delta: { reasoning: `再组织最终答案。\n${longReasoning}` } }] })}\n\n`)
    await new Promise((resolve) => setTimeout(resolve, 350))
    const paragraphs = Array.from({ length: 24 }, (_, index) => `正文段落 ${index + 1}：用于验证消息输出时自动滚动。`).join('\n\n')
    const answer = `# 测试答案\n\n这是最终回答。\n\n## Markdown 样式\n\n- 使用 \`preload.js\` 暴露本地能力\n  - 读取 \`AGENTS.md\` 和插件契约\n- 通过 [ZTools 文档](https://ztools.app) 查看接口\n\n> 引用内容使用弱化边框，不抢占正文层级。\n\n\`\`\`text\n/Users/zing/Workspace/zTools/ZTools-plugins/ZTools-plugins/plugins/example\n\`\`\`\n\n行内公式：$E=mc^2$\n\n| 项目 | 结果 |\n| --- | --- |\n| Markdown | 正常 |\n| KaTeX | 正常 |\n\n${paragraphs}`
    for (let index = 0; index < answer.length; index += 12) {
      const content = answer.slice(index, index + 12)
      response.write(`data: ${JSON.stringify({ id: 'reasoning-test', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`)
      // 在正文已开始但整轮尚未结束的位置保留观察窗口，验证思考生命周期能提前结束。
      await new Promise((resolve) => setTimeout(resolve, index === 12 ? 350 : 4))
    }
    response.write('data: {"id":"reasoning-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n')
    response.write('data: [DONE]\n\n')
    response.end()
  })
})

server.listen(15241, '127.0.0.1')

/**
 * 关闭模拟模型服务并结束测试子进程。
 * @returns {void} 无返回值。
 */
const close = () => server.close(() => process.exit(0))
process.on('SIGTERM', close)
process.on('SIGINT', close)
