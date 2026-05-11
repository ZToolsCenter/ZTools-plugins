// ============================================================
// Zhi 智能交互工具 - ZTools 插件 preload 脚本
// ============================================================

// 连续取消计数器
let consecutiveCancels = 0

// 防止并发弹窗
let popupLock = false

/**
 * 等待子窗口返回结果
 * 通过 executeJavaScript 轮询子窗口的 __zhiResult 变量
 */
function waitForPopupResult(win, onBeforeDestroy) {
  return new Promise((resolve) => {
    function poll() {
      setTimeout(async () => {
        try {
          // 检查窗口是否已关闭
          if (win.isDestroyed()) {
            resolve({ cancelled: true })
            return
          }

          // 轮询子窗口的结果变量
          const raw = await win.webContents.executeJavaScript(
            'JSON.stringify(window.__zhiResult || null)'
          )
          const result = JSON.parse(raw)

          if (result !== null) {
            // 处理窗口操作信号
            if (result._action === 'minimize') {
              try {
                win.minimize()
              } catch (e) {
                /* ignore */
              }
              await win.webContents.executeJavaScript('window.__zhiResult = null').catch(() => {})
              poll()
              return
            }
            if (result._action === 'togglePin') {
              try {
                win.setAlwaysOnTop(!!result.value)
              } catch (e) {
                /* ignore */
              }
              await win.webContents.executeJavaScript('window.__zhiResult = null').catch(() => {})
              poll()
              return
            }

            // 拿到结果后关闭窗口（先保存 bounds）
            try {
              if (onBeforeDestroy) onBeforeDestroy(win)
            } catch (e) { /* ignore */ }
            try {
              win.destroy()
            } catch (e) {
              /* ignore */
            }
            resolve(result)
            return
          }
        } catch (e) {
          // executeJavaScript 失败（窗口已销毁等情况）
          resolve({ cancelled: true })
          return
        }

        // 继续轮询
        poll()
      }, 150)
    }

    poll()
  })
}

/**
 * 创建交互弹窗并等待用户响应
 */
async function showZhiPopup(input) {
  if (popupLock) {
    return {
      cancelled: false,
      userInput: '当前已有弹窗在等待响应，请先处理',
      selectedOptions: []
    }
  }

  popupLock = true

  try {
    const result = await new Promise((resolve) => {
      // 读取上次保存的窗口大小和位置
      let savedBounds = null
      try {
        const raw = window.ztools.dbStorage.getItem('zhi-popup-bounds')
        if (raw) savedBounds = JSON.parse(raw)
      } catch (e) { /* ignore */ }

      const winOptions = savedBounds
        ? {
            title: 'Zhi - 等待响应',
            width: savedBounds.width || 640,
            height: savedBounds.height || 556,
            x: savedBounds.x,
            y: savedBounds.y,
            center: false,
            alwaysOnTop: true,
            resizable: true,
            minimizable: true,
            maximizable: false,
            show: false,
            frame: false
          }
        : {
            title: 'Zhi - 等待响应',
            width: 640,
            height: 556,
            center: true,
            alwaysOnTop: true,
            resizable: true,
            minimizable: true,
            maximizable: false,
            show: false,
            frame: false
          }

      // 创建弹窗窗口
      const win = window.ztools.createBrowserWindow(
        'popup.html',
        winOptions,
        () => {
          // dom-ready 回调：注入请求数据，然后显示窗口
          const requestData = {
            message: input.message || '',
            options: input.options || [],
            project_root_path: input.project_root_path || null
          }

          win.webContents
            .executeJavaScript(
              `window.__zhiRequest = ${JSON.stringify(requestData)};` +
                `if (typeof window.__zhiInit === 'function') window.__zhiInit();`
            )
            .then(() => {
              win.show()
              win.focus()
            })
            .catch(() => {
              // 窗口可能已关闭
              resolve({ cancelled: true })
            })
        }
      )

      // 开始轮询结果（关窗前保存 bounds）
      waitForPopupResult(win, (w) => {
        window.ztools.dbStorage.setItem('zhi-popup-bounds', JSON.stringify(w.getBounds()))
      }).then(resolve)
    })

    return result
  } finally {
    popupLock = false
  }
}

/**
 * 构建返回给 Agent 的文本内容
 */
function buildResponseContent(result) {
  const parts = []

  if (result.userInput && result.userInput.trim()) {
    parts.push(result.userInput.trim())
  }

  if (result.selectedOptions && result.selectedOptions.length > 0) {
    parts.push('用户选择了: ' + result.selectedOptions.join(', '))
  }

  if (result.images && result.images.length > 0) {
    parts.push(`用户附加了 ${result.images.length} 张图片`)
  }

  if (parts.length === 0) {
    parts.push('用户确认继续')
  }

  return parts.join('\n\n')
}

/**
 * 构建 MCP 标准 content 数组（支持 text + image 多模态）
 */
function buildMcpContent(result, rule) {
  const content = []

  // 先添加图片（AI 直接可视）
  if (result.images && result.images.length > 0) {
    for (const img of result.images) {
      content.push({
        type: 'image',
        data: img.data,
        mimeType: img.media_type
      })
    }
  }

  // 添加文本
  const text = buildResponseContent(result) + (rule ? '\n\n' + rule : '')
  content.push({ type: 'text', text })

  return content
}

// ── 注册 MCP 工具 ──

window.ztools.registerTool('zhi', async (input) => {
  if (!input.message) {
    return { error: '缺少 message 参数' }
  }

  const result = await showZhiPopup(input)

  // 处理取消
  if (result.cancelled) {
    // 用户点击"结束会话"，立即终止对话
    if (result.endSession) {
      consecutiveCancels = 0
      return {
        content: '用户主动结束了对话。不要再调用 zhi。',
        cancelled: true,
        _rule: 'STOP. The user has ended the session. Do NOT call zhi again.'
      }
    }

    consecutiveCancels++

    if (consecutiveCancels >= 2) {
      consecutiveCancels = 0
      return {
        content: '用户连续取消两次，对话结束。不要再调用 zhi。',
        cancelled: true,
        _rule: 'STOP. Do NOT call zhi again. The conversation is over.'
      }
    }

    return {
      content: '用户取消了操作，请调用 zhi 询问用户想做什么。如果用户再次取消，立即结束对话。',
      cancelled: true,
      _rule: '[RULE] User cancelled once. Call zhi to ask what they want. If cancelled again, stop.'
    }
  }

  // 正常响应，重置取消计数
  consecutiveCancels = 0

  const rule =
    '[RULE] You MUST call zhi again as the last step of your next response. Do NOT end your turn without calling zhi.'

  // 有图片时返回 MCP 标准 content 数组（多模态）
  if (result.images && result.images.length > 0) {
    return { content: buildMcpContent(result, rule) }
  }

  // 纯文本响应
  const content = buildResponseContent(result)

  return {
    content: content + '\n\n' + rule,
    user_input: result.userInput || null,
    selected_options: result.selectedOptions || []
  }
})

console.log('[zhi-interaction] 工具已注册')
