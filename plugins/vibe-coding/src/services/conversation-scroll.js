const DEFAULT_FOLLOW_THRESHOLD = 24

/**
 * 读取元素相对滚动容器顶部的流式布局坐标。
 * @param {HTMLElement} row 带稳定业务标识的消息行。
 * @param {HTMLElement} scroller 消息滚动容器。
 * @returns {number} 消息行相对滚动容器顶部的像素坐标。
 */
function flowTop(row, scroller) {
  return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
}

/**
 * 按稳定业务标识查找已经挂载的消息行。
 * @param {HTMLElement} content 消息内容根节点。
 * @param {string} key 消息业务标识。
 * @returns {HTMLElement|null} 匹配的消息行；未挂载时返回 null。
 */
function findAnchorRow(content, key) {
  for (const row of content.querySelectorAll('[data-chat-anchor-key]')) {
    if (row instanceof HTMLElement && row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/**
 * 选择当前视口内最靠前的稳定消息行，供会话切换和历史分页恢复。
 * @param {HTMLElement} content 消息内容根节点。
 * @param {HTMLElement} scroller 消息滚动容器。
 * @returns {HTMLElement|null} 当前可用的语义锚点行。
 */
function selectVisibleAnchor(content, scroller) {
  const viewport = scroller.getBoundingClientRect()

  // 优先通过浏览器命中测试定位可见行，避免长会话每次滚动都测量全部节点。
  if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function' && viewport.height > 0) {
    const contentRect = content.getBoundingClientRect()
    const left = Math.max(viewport.left, contentRect.left)
    const right = Math.min(viewport.right, contentRect.right)
    const x = left + Math.max(0, right - left) / 2
    const height = viewport.bottom - viewport.top
    const offsets = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of offsets) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement ? element.closest('[data-chat-anchor-key]') : null
        if (row instanceof HTMLElement && content.contains(row)) return row
      }
    }
  }

  // 预布局和测试环境回退到已挂载行的几何交集。
  const rows = [...content.querySelectorAll('[data-chat-anchor-key]')].filter((row) => row instanceof HTMLElement)
  const visible = rows.find((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < viewport.bottom
  })
  return visible || rows[0] || null
}

/**
 * 捕获可抵抗异步重排的会话阅读位置。
 * @param {HTMLElement} content 消息内容根节点。
 * @param {HTMLElement} scroller 消息滚动容器。
 * @returns {{anchorKey: string, anchorTop: number, scrollTop: number}|null} 语义阅读位置。
 */
function captureScrollPosition(content, scroller) {
  const row = selectVisibleAnchor(content, scroller)
  const anchorKey = row?.dataset?.chatAnchorKey
  if (!row || !anchorKey) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scroller),
    scrollTop: scroller.scrollTop,
  }
}

/**
 * 创建按会话隔离的聊天滚动状态机。
 * @param {{getActiveSessionId: () => string, isPinned: (sessionId: string) => boolean, setPinned: (sessionId: string, pinned: boolean) => void, threshold?: number}} options 会话定位和贴底状态适配器。
 * @returns {Record<string, Function>} 可由页面生命周期和 DOM 事件调用的滚动控制器。
 */
export function createConversationScrollController(options) {
  const threshold = Math.max(0, Number(options?.threshold) || DEFAULT_FOLLOW_THRESHOLD)
  const positions = new Map()
  const observedTops = new Map()
  const pagingAnchors = new Map()

  /**
   * 解析当前有效会话标识。
   * @param {string} sessionId 可选的显式会话标识。
   * @returns {string} 当前用于读写滚动状态的会话标识。
   */
  function resolveSessionId(sessionId = '') {
    return String(sessionId || options?.getActiveSessionId?.() || '')
  }

  /**
   * 将指定会话原子定位到底部并登记程序滚动账本。
   * @param {HTMLElement} scroller 消息滚动容器。
   * @param {string} sessionId 会话标识；省略时使用活动会话。
   * @returns {boolean} 是否完成了贴底写入。
   */
  function toBottom(scroller, sessionId = '') {
    const id = resolveSessionId(sessionId)
    if (!id || !scroller) return false
    // 贴底会清除阅读锚点，并同步所有权与程序滚动账本。
    pagingAnchors.delete(id)
    scroller.scrollTop = scroller.scrollHeight
    observedTops.set(id, scroller.scrollTop)
    positions.delete(id)
    options.setPinned(id, true)
    return true
  }

  /**
   * 在会话内容完成当前 DOM 提交后恢复阅读位置或首次贴底。
   * @param {string} sessionId 会话标识。
   * @param {HTMLElement} scroller 消息滚动容器。
   * @param {HTMLElement} content 消息内容根节点。
   * @returns {boolean} 是否完成恢复。
   */
  function restore(sessionId, scroller, content) {
    const id = resolveSessionId(sessionId)
    if (!id || !scroller || !content) return false
    const saved = positions.get(id)
    if (!saved) return toBottom(scroller, id)

    // 先恢复几何位置，再用稳定消息行抵消宽度变化和异步重排。
    scroller.scrollTop = saved.scrollTop
    const row = findAnchorRow(content, saved.anchorKey)
    if (row) scroller.scrollTop += flowTop(row, scroller) - saved.anchorTop
    observedTops.set(id, scroller.scrollTop)

    const floor = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const atBottom = floor - scroller.scrollTop <= threshold + 1
    options.setPinned(id, atBottom)
    if (atBottom) {
      positions.delete(id)
    } else {
      const normalized = captureScrollPosition(content, scroller)
      if (normalized) positions.set(id, normalized)
    }
    return true
  }

  /**
   * 处理滚动事件并区分程序位置交付与用户阅读行为。
   * @param {HTMLElement} scroller 消息滚动容器。
   * @param {HTMLElement} content 消息内容根节点。
   * @returns {void} 无返回值。
   */
  function handleScroll(scroller, content) {
    const id = resolveSessionId()
    if (!id || !scroller || !content) return
    const floor = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const deliveredTop = scroller.scrollTop
    const observedTop = observedTops.has(id) ? observedTops.get(id) : deliveredTop
    const expectedTop = Math.min(observedTop, floor)
    const movedByReader = Math.abs(deliveredTop - expectedTop) > 0.5
    const wasPinned = options.isPinned(id)
    const atBottom = movedByReader ? floor - deliveredTop <= threshold + 1 : wasPinned

    // 非阅读者滚动不能夺走贴底所有权，布局变化后直接重新校准到新底部。
    if (!movedByReader && atBottom) {
      toBottom(scroller, id)
      return
    }

    options.setPinned(id, atBottom)
    const position = atBottom ? null : captureScrollPosition(content, scroller)
    if (atBottom) {
      positions.delete(id)
      pagingAnchors.delete(id)
    } else if (position) {
      positions.set(id, position)
      // 历史请求期间继续采用用户最新阅读位置，排除同时发生的尾部增长。
      if (pagingAnchors.has(id)) pagingAnchors.set(id, { key: position.anchorKey, top: position.anchorTop })
    }
    observedTops.set(id, deliveredTop)
  }

  /**
   * 在历史请求发出前保存当前可见业务行及相对坐标。
   * @param {string} sessionId 会话标识。
   * @param {HTMLElement} scroller 消息滚动容器。
   * @param {HTMLElement} content 消息内容根节点。
   * @returns {boolean} 是否保存到可用的分页锚点。
   */
  function beginPrepend(sessionId, scroller, content) {
    const id = resolveSessionId(sessionId)
    if (!id || !scroller || !content) return false
    const position = captureScrollPosition(content, scroller)
    options.setPinned(id, false)
    observedTops.set(id, scroller.scrollTop)
    if (!position) return false
    positions.set(id, position)
    pagingAnchors.set(id, { key: position.anchorKey, top: position.anchorTop })
    return true
  }

  /**
   * 在旧历史插入后恢复同一业务行的视口位置。
   * @param {string} sessionId 会话标识。
   * @param {HTMLElement} scroller 消息滚动容器。
   * @param {HTMLElement} content 消息内容根节点。
   * @returns {boolean} 是否找到并恢复了分页锚点。
   */
  function finishPrepend(sessionId, scroller, content) {
    const id = resolveSessionId(sessionId)
    const anchor = pagingAnchors.get(id)
    pagingAnchors.delete(id)
    if (!id || !anchor || !scroller || !content) return false
    const row = findAnchorRow(content, anchor.key)
    if (!row) return false

    // 只抵消锚点业务行的实际位移，不受尾部流式内容或输入区变化影响。
    scroller.scrollTop += flowTop(row, scroller) - anchor.top
    observedTops.set(id, scroller.scrollTop)
    options.setPinned(id, false)
    const position = captureScrollPosition(content, scroller)
    if (position) positions.set(id, position)
    return true
  }

  /**
   * 清理失败或空分页遗留的锚点状态。
   * @param {string} sessionId 会话标识。
   * @returns {void} 无返回值。
   */
  function cancelPrepend(sessionId) {
    pagingAnchors.delete(resolveSessionId(sessionId))
  }

  /**
   * 在消息流或输入区尺寸改变后按贴底所有权决定是否继续跟随。
   * @param {HTMLElement} scroller 消息滚动容器。
   * @returns {void} 无返回值。
   */
  function handleResize(scroller) {
    const id = resolveSessionId()
    if (id && options.isPinned(id)) toBottom(scroller, id)
  }

  /**
   * 读取测试和诊断所需的会话阅读位置副本。
   * @param {string} sessionId 会话标识。
   * @returns {{anchorKey: string, anchorTop: number, scrollTop: number}|null} 保存的位置。
   */
  function readPosition(sessionId) {
    const position = positions.get(resolveSessionId(sessionId))
    return position ? { ...position } : null
  }

  /**
   * 释放控制器持有的全部会话内存状态。
   * @returns {void} 无返回值。
   */
  function clear() {
    positions.clear()
    observedTops.clear()
    pagingAnchors.clear()
  }

  return {
    beginPrepend,
    cancelPrepend,
    clear,
    finishPrepend,
    handleResize,
    handleScroll,
    readPosition,
    restore,
    toBottom,
  }
}
