/**
 * 以 Harness 的并发组和独占屏障调度一轮模型工具调用。
 *
 * 调度器只负责启动顺序、并发上限和结果顺序；确认、取消、超时以及
 * 工具状态更新由调用方提供的 execute 函数负责。
 */

/**
 * 规范化工具并发上限，避免设置值导致无限并发或完全无法执行。
 * @param {unknown} value 设置值或调度器调用方传入的上限。
 * @param {number} fallback 无效值时使用的默认上限。
 * @returns {number} 1 到 50 之间的整数上限。
 */
export function normalizeToolConcurrencyLimit(value, fallback = 10) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return Math.min(50, Math.max(1, Math.round(fallback)))
  return Math.min(50, Math.max(1, Math.round(parsed)))
}

/**
 * 判断工具调用是否已经被本轮取消。
 * @param {Record<string, unknown>} call 工具调用记录。
 * @param {() => boolean} isCancelled 当前会话是否已经停止。
 * @returns {boolean} 是否不应再启动该调用。
 */
function isCallCancelled(call, isCancelled) {
  return call?.status === 'cancelled' || isCancelled()
}

/**
 * 生成未启动工具调用的模型可读取消结果。
 * @param {Record<string, unknown>} call 工具调用记录。
 * @returns {string} 工具结果文本。
 */
function cancelledResult(call) {
  return String(call?.result || '用户已终止本轮对话，工具未执行。')
}

/**
 * 读取 Promise 池中任意一个已完成调用的索引。
 * @param {Map<number, Promise<number>>} inFlight 当前运行中的调用池。
 * @returns {Promise<number>} 已完成调用在原调用数组中的索引。
 */
async function raceInFlight(inFlight) {
  return Promise.race(inFlight.values())
}

/**
 * 执行单个工具并把意外拒绝转换为模型可读错误文本。
 * @param {Record<string, unknown>} call 工具调用记录。
 * @param {(call: Record<string, unknown>) => Promise<string>} execute 工具执行函数。
 * @returns {Promise<string>} 工具结果文本或错误文本。
 */
async function runToolSafely(call, execute) {
  try {
    return String(await execute(call) ?? '')
  } catch (error) {
    return `Tool error: ${error?.message || String(error)}`
  }
}

/**
 * 并发执行一组连续的只读工具，并在调用完成后补充滚动池中的下一个调用。
 * @param {Array<Record<string, unknown>>} calls 连续并发组调用。
 * @param {number} start 组在完整调用数组中的起始索引。
 * @param {number} limit 最大并发数。
 * @param {(call: Record<string, unknown>) => Promise<string>} execute 工具执行函数。
 * @param {() => boolean} isCancelled 当前会话停止状态读取函数。
 * @param {Array<string|undefined>} results 按模型顺序写入的结果数组。
 * @returns {Promise<{next: number, started: number}>} 组结束后的游标和实际启动数量。
 */
async function runParallelGroup(calls, start, limit, execute, isCancelled, results) {
  const inFlight = new Map()
  let next = start
  let started = 0

  /**
   * 启动一个调用并把结果绑定到模型顺序索引。
   * @param {number} index 调用在并行组中的索引。
   * @returns {boolean} 是否实际进入执行池。
   */
  const startCall = (index) => {
    const call = calls[index]
    if (isCallCancelled(call, isCancelled)) {
      results[index] = cancelledResult(call)
      return false
    }
    started += 1
    const promise = Promise.resolve()
      .then(() => runToolSafely(call, execute))
      .then((result) => {
        results[index] = result
        return index
      })
    inFlight.set(index, promise)
    return true
  }

  // 首次填满滚动池；如果本轮已经停止，剩余调用只写取消结果。
  while (next < calls.length && inFlight.size < limit) {
    if (isCancelled()) break
    startCall(next)
    next += 1
  }
  while (inFlight.size > 0) {
    const settledIndex = await raceInFlight(inFlight)
    inFlight.delete(settledIndex)
    // 只有仍在运行时才补充新调用，停止后不再扩大进程和 IPC 数量。
    if (!isCancelled() && next < calls.length) {
      startCall(next)
      next += 1
    }
  }
  // 停止期间尚未进入池的调用必须显式收口，保持结果数组完整。
  for (let index = next; index < calls.length; index += 1) {
    results[index] = cancelledResult(calls[index])
  }
  return { next, started }
}

/**
 * 调度一轮工具调用：并发安全调用组成滚动池，独占调用形成前后屏障。
 * @param {Array<Record<string, unknown>>} calls 模型按顺序返回的工具调用。
 * @param {{maxParallel?: unknown, getMode: (name: unknown, args?: unknown) => 'parallel'|'exclusive', execute: (call: Record<string, unknown>) => Promise<string>, isCancelled?: () => boolean}} options 调度选项。
 * @returns {Promise<{results: string[], started: number, skipped: number}>} 按模型顺序排列的结果与执行统计。
 */
export async function executeScheduledToolCalls(calls, options) {
  const list = Array.isArray(calls) ? calls : []
  const limit = normalizeToolConcurrencyLimit(options?.maxParallel)
  const getMode = typeof options?.getMode === 'function' ? options.getMode : () => 'exclusive'
  const execute = typeof options?.execute === 'function' ? options.execute : async () => ''
  const isCancelled = typeof options?.isCancelled === 'function' ? options.isCancelled : () => false
  const results = Array(list.length)
  let cursor = 0
  let started = 0

  while (cursor < list.length) {
    if (isCallCancelled(list[cursor], isCancelled)) {
      for (let index = cursor; index < list.length; index += 1) results[index] = cancelledResult(list[index])
      break
    }
    const mode = getMode(list[cursor]?.name, list[cursor]?.args)
    if (mode === 'parallel') {
      // 并行组只吸收连续的并发安全调用，独占调用在下一轮形成屏障。
      let groupEnd = cursor + 1
      while (groupEnd < list.length && getMode(list[groupEnd]?.name, list[groupEnd]?.args) === 'parallel') groupEnd += 1
      const group = list.slice(cursor, groupEnd)
      const groupResults = Array(group.length)
      const groupOutcome = await runParallelGroup(group, 0, limit, execute, isCancelled, groupResults)
      for (let index = 0; index < group.length; index += 1) {
        if (groupResults[index] === undefined) groupResults[index] = cancelledResult(group[index])
        results[cursor + index] = groupResults[index]
      }
      started += groupOutcome.started
      cursor = groupEnd
      continue
    }
    if (isCallCancelled(list[cursor], isCancelled)) {
      results[cursor] = cancelledResult(list[cursor])
      cursor += 1
      continue
    }
    started += 1
    results[cursor] = await runToolSafely(list[cursor], execute)
    cursor += 1
  }

  return {
    results: results.map((result, index) => result === undefined ? cancelledResult(list[index]) : result),
    started,
    skipped: list.length - started,
  }
}
