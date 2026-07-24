'use strict'

/**
 * Scripty MCP 工具桥接层。
 *
 * ZTools 通过 `plugin.json` 的 `tools` 声明 + `window.ztools.registerTool(name, handler)`
 * 对外暴露 MCP 能力。宿主的 mcpServer 在收到 `tools/call` 时会后台预加载本插件、
 * 等待此处完成注册，再回调对应 handler。因此工具处理器运行在本 preload 上下文中，
 * 可以直接访问已构建好的 `window.scripty` API。
 *
 * 本模块把 Scripty 内部 `Result<T>` 信封统一解包：成功返回纯数据（交给 MCP 作为
 * structuredContent + JSON 文本），失败抛出携带错误码的 Error，让标准 MCP 客户端
 * 看到明确的错误信息。
 *
 * 图片标记协议（AI 编写输出图片的脚本时必须遵守）：
 *   开始标记：@@SCRIPTY_IMAGE_START:<mime>@@   例如 @@SCRIPTY_IMAGE_START:image/png@@
 *   结束标记：@@SCRIPTY_IMAGE_END@@
 * 两标记之间是 base64 数据，允许换行；前端 HistoryView.vue 会跨日志块重组并渲染。
 * 该协议的 AI 可见说明同步在 plugin.json 的 create_script / update_script / read_run_log
 * 描述里，解析实现与正则在 src/components/HistoryView.vue，改格式时三处必须一起更新。
 */

const SUPPORTED_LANGUAGES = ['javascript', 'python', 'powershell', 'shell']
const DEFAULT_INTERPRETERS = {
  javascript: 'node',
  python: 'python',
  powershell: 'powershell',
  shell: 'sh'
}

/** 解包 Scripty Result 信封；失败时抛出携带错误码的异常供 MCP 客户端展示。 */
function unwrap(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Scripty 未返回有效结果')
  }
  if (result.ok === false) {
    const code = result.error?.code || 'INTERNAL_ERROR'
    const message = result.error?.message || 'Scripty 操作失败'
    const fieldErrors = result.error?.fieldErrors
    const detail = fieldErrors
      ? `${message}（${Object.entries(fieldErrors)
          .map(([field, hint]) => `${field}: ${hint}`)
          .join('; ')}）`
      : message
    throw new Error(`[${code}] ${detail}`)
  }
  return result.data
}

/** Normalizes an interpreter request to a built-in command so the shared resolver can discover it automatically. */
function resolveInterpreter(interpreter) {
  const kind = interpreter?.kind
  if (!SUPPORTED_LANGUAGES.includes(kind)) {
    throw new Error(`interpreter.kind 必须是 ${SUPPORTED_LANGUAGES.join(' / ')} 之一`)
  }
  const executable = typeof interpreter?.executable === 'string' ? interpreter.executable.trim() : ''
  return { kind, executable: executable || DEFAULT_INTERPRETERS[kind] }
}

/** 从任务详情提取可复用的可编辑草稿字段，供合并式更新使用。 */
function toTaskDraft(task) {
  return {
    name: task.name,
    note: task.note,
    scriptId: task.scriptId,
    interpreter: { kind: task.interpreter.kind, executable: task.interpreter.executable },
    args: Array.isArray(task.args) ? task.args.slice() : [],
    workingDirectory: task.workingDirectory ?? null,
    cron: task.cron ?? null,
    timeoutMs: task.timeoutMs ?? null,
    enabled: Boolean(task.enabled),
    concurrency: {
      policy: task.concurrency?.policy ?? 'forbid',
      limit: task.concurrency?.limit ?? 1
    }
  }
}

/** 判断 MCP 输入是否显式提供某字段，供合并式更新区分“省略”和空值。 */
function hasOwn(input, field) {
  return Boolean(input) && Object.prototype.hasOwnProperty.call(input, field)
}

/**
 * 校验并规范化环境变量选择器。
 * 选择器只使用名称和作用域定位，不读取或返回变量值。
 */
function normalizeEnvironmentSelector(selector) {
  const name = typeof selector?.name === 'string' ? selector.name.trim() : ''
  if (!name) throw new Error('缺少环境变量 selector.name')

  const normalized = { name }
  if (hasOwn(selector, 'scope')) {
    if (!['global', 'task'].includes(selector.scope)) {
      throw new Error('selector.scope 必须是 global 或 task')
    }
    normalized.scope = selector.scope
  }
  if (hasOwn(selector, 'taskId')) {
    if (typeof selector.taskId !== 'string' || !selector.taskId.trim()) {
      throw new Error('selector.taskId 必须是非空字符串')
    }
    if (normalized.scope === 'global') {
      throw new Error('全局环境变量选择器不能指定 taskId')
    }
    normalized.taskId = selector.taskId
  }
  return normalized
}

/**
 * 按名称及可选作用域唯一定位环境变量。
 * 查询得到的摘要仅在 preload 内使用；错误和返回值均不包含值或遮罩值。
 */
async function findEnvironmentBySelector(scripty, selector) {
  const normalized = normalizeEnvironmentSelector(selector)
  const query = { search: normalized.name }
  if (normalized.scope) query.scope = normalized.scope
  if (normalized.taskId) query.taskId = normalized.taskId

  const summaries = unwrap(await scripty.environments.list(query))
  const matches = summaries.filter(variable =>
    variable.name === normalized.name &&
    (!normalized.scope || variable.scope === normalized.scope) &&
    (!normalized.taskId || variable.taskId === normalized.taskId)
  )
  if (matches.length === 0) throw new Error(`未找到环境变量 "${normalized.name}"`)
  if (matches.length > 1) {
    throw new Error(`环境变量 "${normalized.name}" 匹配到多个结果，请补充 scope 或 taskId`)
  }
  return matches[0]
}

/**
 * 构造环境变量合并式更新输入。
 * 省略 value 时仅在 preload 内读取旧值以完成持久化，旧值不会进入 MCP 响应。
 */
async function buildEnvironmentUpdateInput(scripty, current, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('缺少环境变量 changes 对象')
  }
  const supportedFields = ['name', 'value', 'note', 'scope', 'taskId', 'enabled', 'sensitive']
  if (!supportedFields.some(field => hasOwn(changes, field))) {
    throw new Error('changes 至少需要提供一个可编辑字段')
  }

  if (hasOwn(changes, 'name') && typeof changes.name !== 'string') throw new Error('changes.name 必须是字符串')
  if (hasOwn(changes, 'value') && typeof changes.value !== 'string') throw new Error('changes.value 必须是字符串')
  if (hasOwn(changes, 'note') && typeof changes.note !== 'string') throw new Error('changes.note 必须是字符串')
  if (hasOwn(changes, 'scope') && !['global', 'task'].includes(changes.scope)) {
    throw new Error('changes.scope 必须是 global 或 task')
  }
  if (hasOwn(changes, 'taskId') && changes.taskId !== null && typeof changes.taskId !== 'string') {
    throw new Error('changes.taskId 必须是字符串或 null')
  }
  if (hasOwn(changes, 'enabled') && typeof changes.enabled !== 'boolean') throw new Error('changes.enabled 必须是布尔值')
  if (hasOwn(changes, 'sensitive') && typeof changes.sensitive !== 'boolean') throw new Error('changes.sensitive 必须是布尔值')

  let value = changes.value
  if (!hasOwn(changes, 'value')) {
    const revealed = unwrap(await scripty.environments.reveal(current.id))
    value = revealed.value
  }

  const scope = hasOwn(changes, 'scope') ? changes.scope : current.scope
  return {
    name: hasOwn(changes, 'name') ? changes.name : current.name,
    value,
    note: hasOwn(changes, 'note') ? changes.note : current.note,
    scope,
    taskId: scope === 'global' ? null : (hasOwn(changes, 'taskId') ? changes.taskId : current.taskId),
    enabled: hasOwn(changes, 'enabled') ? changes.enabled : current.enabled,
    sensitive: hasOwn(changes, 'sensitive') ? changes.sensitive : current.sensitive
  }
}

/**
 * 构造 Scripty 对外暴露的 MCP 工具集合。
 * 环境变量读取会在本层投影为名称，任何已存值或遮罩值都不会进入 MCP 响应。
 * 每个条目包含 handler（实际执行逻辑）。工具名称、描述与 inputSchema 需与 plugin.json
 * 的 `tools` 声明保持一致——plugin.json 供宿主校验与展示，这里提供运行时实现。
 */
function buildToolHandlers(scripty) {
  return {
    // ==================== 脚本管理 ====================
    list_scripts: async (input) => {
      const query = {}
      if (typeof input?.search === 'string') query.search = input.search
      if (SUPPORTED_LANGUAGES.includes(input?.language)) query.language = input.language
      const scripts = unwrap(await scripty.scripts.list(query))
      return { scripts }
    },

    get_script: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少脚本 id')
      return unwrap(await scripty.scripts.get(input.id))
    },

    create_script: async (input) => {
      if (typeof input?.name !== 'string' || !input.name.trim()) throw new Error('缺少脚本 name')
      if (!SUPPORTED_LANGUAGES.includes(input?.language)) {
        throw new Error(`language 必须是 ${SUPPORTED_LANGUAGES.join(' / ')} 之一`)
      }
      if (typeof input?.content !== 'string') throw new Error('缺少脚本 content')
      return unwrap(
        await scripty.scripts.create({
          name: input.name,
          language: input.language,
          content: input.content,
          relativePath: typeof input.relativePath === 'string' ? input.relativePath : undefined,
          note: typeof input.note === 'string' ? input.note : ''
        })
      )
    },

    update_script: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少脚本 id')
      // 合并式更新：已有脚本不能改语言，未提供的字段沿用当前值。
      const current = unwrap(await scripty.scripts.get(input.id))
      return unwrap(
        await scripty.scripts.update(input.id, {
          name: typeof input.name === 'string' ? input.name : current.name,
          language: current.language,
          content: typeof input.content === 'string' ? input.content : current.content,
          relativePath:
            typeof input.relativePath === 'string' ? input.relativePath : current.relativePath,
          note: typeof input.note === 'string' ? input.note : current.note
        })
      )
    },

    delete_script: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少脚本 id')
      unwrap(await scripty.scripts.remove(input.id))
      return { deleted: true, id: input.id }
    },

    // ==================== 任务管理 ====================
    list_tasks: async (input) => {
      const query = {}
      if (typeof input?.search === 'string') query.search = input.search
      if (typeof input?.enabled === 'boolean') query.enabled = input.enabled
      if (typeof input?.readiness === 'string') query.readiness = input.readiness
      const tasks = unwrap(await scripty.tasks.list(query))
      return { tasks }
    },

    get_task: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少任务 id')
      return unwrap(await scripty.tasks.get(input.id))
    },

    create_task: async (input) => {
      if (typeof input?.name !== 'string' || !input.name.trim()) throw new Error('缺少任务 name')
      if (typeof input?.scriptId !== 'string') throw new Error('缺少 scriptId')
      const interpreter = resolveInterpreter(input.interpreter)
      const draft = {
        name: input.name,
        note: typeof input.note === 'string' ? input.note : '',
        scriptId: input.scriptId,
        interpreter,
        args: Array.isArray(input.args) ? input.args : [],
        workingDirectory:
          typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
            ? input.workingDirectory
            : null,
        cron: typeof input.cron === 'string' && input.cron.trim() ? input.cron : null,
        timeoutMs: Number.isInteger(input.timeoutMs) ? input.timeoutMs : null,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
        concurrency: {
          policy: input.concurrency?.policy === 'limited' ? 'limited' : 'forbid',
          limit: Number.isInteger(input.concurrency?.limit) ? input.concurrency.limit : 1
        }
      }
      return unwrap(await scripty.tasks.create(draft))
    },

    update_task: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少任务 id')
      // 合并式更新：以当前任务为基线，仅覆盖显式提供的字段。
      const current = unwrap(await scripty.tasks.get(input.id))
      const draft = toTaskDraft(current)
      if (typeof input.name === 'string') draft.name = input.name
      if (typeof input.note === 'string') draft.note = input.note
      if (typeof input.scriptId === 'string') draft.scriptId = input.scriptId
      if (input.interpreter) draft.interpreter = resolveInterpreter(input.interpreter)
      if (Array.isArray(input.args)) draft.args = input.args
      if ('workingDirectory' in (input || {})) {
        draft.workingDirectory =
          typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
            ? input.workingDirectory
            : null
      }
      if ('cron' in (input || {})) {
        draft.cron = typeof input.cron === 'string' && input.cron.trim() ? input.cron : null
      }
      if ('timeoutMs' in (input || {})) {
        draft.timeoutMs = Number.isInteger(input.timeoutMs) ? input.timeoutMs : null
      }
      if (typeof input.enabled === 'boolean') draft.enabled = input.enabled
      if (input.concurrency) {
        draft.concurrency = {
          policy: input.concurrency.policy === 'limited' ? 'limited' : 'forbid',
          limit: Number.isInteger(input.concurrency.limit) ? input.concurrency.limit : 1
        }
      }
      return unwrap(await scripty.tasks.update(input.id, draft))
    },

    set_task_enabled: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少任务 id')
      if (typeof input?.enabled !== 'boolean') throw new Error('缺少 enabled 布尔值')
      return unwrap(await scripty.tasks.setEnabled(input.id, input.enabled))
    },

    duplicate_task: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少任务 id')
      return unwrap(await scripty.tasks.duplicate(input.id))
    },

    delete_task: async (input) => {
      if (typeof input?.id !== 'string') throw new Error('缺少任务 id')
      unwrap(await scripty.tasks.remove(input.id))
      return { deleted: true, id: input.id }
    },

    validate_task: async (input) => {
      if (typeof input?.scriptId !== 'string') throw new Error('缺少 scriptId')
      const interpreter = resolveInterpreter(input.interpreter)
      const draft = {
        name: typeof input.name === 'string' ? input.name : '',
        note: typeof input.note === 'string' ? input.note : '',
        scriptId: input.scriptId,
        interpreter,
        args: Array.isArray(input.args) ? input.args : [],
        workingDirectory:
          typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
            ? input.workingDirectory
            : null,
        cron: typeof input.cron === 'string' && input.cron.trim() ? input.cron : null,
        timeoutMs: Number.isInteger(input.timeoutMs) ? input.timeoutMs : null,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
        concurrency: {
          policy: input.concurrency?.policy === 'limited' ? 'limited' : 'forbid',
          limit: Number.isInteger(input.concurrency?.limit) ? input.concurrency.limit : 1
        }
      }
      return unwrap(await scripty.tasks.validate(draft))
    },

    preview_schedule: async (input) => {
      if (typeof input?.cron !== 'string') throw new Error('缺少 cron 表达式')
      return unwrap(await scripty.tasks.previewSchedule(input.cron))
    },

    // ==================== 环境变量管理 ====================
    /** 返回符合筛选条件的环境变量名称，绝不携带值、遮罩值或其余摘要字段。 */
    list_environment_variables: async (input) => {
      const query = {}
      if (typeof input?.search === 'string') query.search = input.search
      if (['global', 'task'].includes(input?.scope)) query.scope = input.scope
      if (typeof input?.taskId === 'string') query.taskId = input.taskId
      if (typeof input?.enabled === 'boolean') query.enabled = input.enabled
      const summaries = unwrap(await scripty.environments.list(query))
      const names = summaries.map(variable => variable.name)
      return { names }
    },

    /** 合并更新唯一匹配的变量；已有值仅在 preload 内保留且不会回显。 */
    update_environment_variable: async (input) => {
      const current = await findEnvironmentBySelector(scripty, input?.selector)
      const draft = await buildEnvironmentUpdateInput(scripty, current, input?.changes)
      const updated = unwrap(await scripty.environments.update(current.id, draft))
      return { updated: true, name: updated.name }
    },

    /** 删除唯一匹配的变量，仅返回名称和删除状态。 */
    delete_environment_variable: async (input) => {
      const current = await findEnvironmentBySelector(scripty, input?.selector)
      unwrap(await scripty.environments.remove(current.id))
      return { deleted: true, name: current.name }
    },

    // ==================== 运行控制 ====================
    run_task: async (input) => {
      if (typeof input?.taskId !== 'string') throw new Error('缺少 taskId')
      return unwrap(await scripty.runs.start(input.taskId, 'manual'))
    },

    stop_run: async (input) => {
      if (typeof input?.runId !== 'string') throw new Error('缺少 runId')
      return unwrap(await scripty.runs.stop(input.runId))
    },

    list_active_runs: async () => {
      const runs = unwrap(await scripty.runs.getActive())
      return { runs }
    },

    // ==================== 运行历史与日志 ====================
    list_run_history: async (input) => {
      const query = {
        page: Number.isInteger(input?.page) && input.page > 0 ? input.page : 1,
        pageSize: Number.isInteger(input?.pageSize) && input.pageSize > 0 ? input.pageSize : 20
      }
      if (typeof input?.search === 'string') query.search = input.search
      if (typeof input?.taskId === 'string') query.taskId = input.taskId
      if (typeof input?.status === 'string') query.status = input.status
      if (typeof input?.trigger === 'string') query.trigger = input.trigger
      return unwrap(await scripty.history.list(query))
    },

    get_run: async (input) => {
      if (typeof input?.runId !== 'string') throw new Error('缺少 runId')
      return unwrap(await scripty.history.get(input.runId))
    },

    read_run_log: async (input) => {
      if (typeof input?.runId !== 'string') throw new Error('缺少 runId')
      const offset = Number.isInteger(input?.offset) && input.offset >= 0 ? input.offset : 0
      const length =
        Number.isInteger(input?.length) && input.length > 0 ? Math.min(input.length, 262144) : 65536
      return unwrap(await scripty.history.readLog(input.runId, { offset, length }))
    },

    retry_run: async (input) => {
      if (typeof input?.runId !== 'string') throw new Error('缺少 runId')
      return unwrap(await scripty.history.retry(input.runId))
    }
  }
}

/**
 * 向 ZTools 注册 Scripty 全部 MCP 工具处理器。
 * 宿主不支持 registerTool（旧版本）时静默跳过，不影响插件其余功能。
 */
function registerScriptyMcpTools(scripty, ztools) {
  if (!scripty || typeof ztools?.registerTool !== 'function') {
    return { registered: [], skipped: true }
  }

  const handlers = buildToolHandlers(scripty)
  const registered = []
  for (const [name, handler] of Object.entries(handlers)) {
    try {
      ztools.registerTool(name, handler)
      registered.push(name)
    } catch (error) {
      // 单个工具注册失败不应阻断其余工具（如 plugin.json 漏声明该工具）。
      console.error(`[Scripty MCP] 工具 "${name}" 注册失败:`, error)
    }
  }
  return { registered, skipped: false }
}

module.exports = { registerScriptyMcpTools, buildToolHandlers, unwrap }
