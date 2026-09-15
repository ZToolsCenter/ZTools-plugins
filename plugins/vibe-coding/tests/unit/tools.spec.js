import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BASE_SYSTEM_PROMPT,
  buildSystemPrompt,
  getModelTools,
  getToolExecutionMode,
  isShellToolName,
  TOOL_GROUPS,
} from '../../src/tools.js'

test('Bash 超时参数明确使用毫秒并提供有界的前台执行时间', () => {
  const shellGroup = TOOL_GROUPS.find((group) => group.id === 'shell')
  const shellTool = shellGroup?.tools.find((tool) => tool.function.name === 'bash')
  const properties = shellTool?.function.parameters.properties || {}

  assert.equal(properties.timeout, undefined)
  assert.deepEqual(properties.timeoutMs, {
    type: 'integer',
    description: '前台命令超时时间，单位毫秒。默认 120000（120 秒），最大 600000（10 分钟）。不要传入秒数。',
    minimum: 1000,
    maximum: 600000,
    default: 120000,
  })
})

test('能力面板保留单个逻辑 Shell 开关', () => {
  const shellTool = TOOL_GROUPS.find((group) => group.id === 'shell')?.tools.find((tool) => tool.function.name === 'bash')
  const description = shellTool?.function.description || ''

  assert.match(description, /根据宿主平台将该能力装配为 Bash 或 PowerShell/)
})

test('macOS 只向模型装配 Bash 工具', () => {
  const tools = getModelTools(['bash', 'read'], 'darwin')
  const shellTool = tools.find((tool) => isShellToolName(tool.function.name))

  assert.equal(shellTool.function.name, 'bash')
  assert.match(shellTool.function.description, /在 macOS 中执行 Bash 命令/)
  assert.doesNotMatch(shellTool.function.description, /Windows|PowerShell/)
  assert.deepEqual(tools.map((tool) => tool.function.name), ['read', 'bash'])
})

test('Windows 只向模型装配 PowerShell 工具', () => {
  const tools = getModelTools(['bash', 'read'], 'win32')
  const shellTool = tools.find((tool) => isShellToolName(tool.function.name))

  assert.equal(shellTool.function.name, 'powershell')
  assert.match(shellTool.function.description, /在 Windows 中执行 PowerShell 命令/)
  assert.match(shellTool.function.description, /不要再次嵌套 powershell -Command/)
  assert.doesNotMatch(shellTool.function.description, /macOS|Linux|POSIX/)
  assert.deepEqual(tools.map((tool) => tool.function.name), ['read', 'powershell'])
})

test('平台未知时不向模型暴露可能使用错误方言的 Shell 工具', () => {
  assert.deepEqual(
    getModelTools(['read', 'bash', 'list_background_shells'], 'unknown').map((tool) => tool.function.name),
    ['read', 'list_background_shells'],
  )
})

test('系统提示词不重复工具定义已经提供的平台信息', () => {
  const prompt = buildSystemPrompt()

  assert.doesNotMatch(prompt, /运行环境|darwin|win32|Linux|Shell 工具/)
})

test('基础系统提示词只保留身份和跨工具行为约束', () => {
  assert.ok(BASE_SYSTEM_PROMPT.length < 100)
  assert.match(BASE_SYSTEM_PROMPT, /直接帮助用户完成任务/)
  assert.match(BASE_SYSTEM_PROMPT, /绑定工作区不代表要开发插件/)
  assert.doesNotMatch(BASE_SYSTEM_PROMPT, /工作规则|当前会话明确启用|工具确认状态/)
})

test('文件与搜索工具使用 Pi 风格的精简协议', () => {
  const fileNames = TOOL_GROUPS.find((group) => group.id === 'files')?.tools.map((tool) => tool.function.name)
  const searchNames = TOOL_GROUPS.find((group) => group.id === 'search')?.tools.map((tool) => tool.function.name)

  assert.deepEqual(fileNames, ['read', 'write', 'edit'])
  assert.deepEqual(searchNames, ['grep', 'find', 'ls'])
})

test('Python 执行统一通过 Bash 提供', () => {
  const groupIds = TOOL_GROUPS.map((group) => group.id)
  const toolNames = TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.function.name))

  assert.equal(groupIds.includes('python'), false)
  assert.equal(toolNames.some((name) => name.includes('python')), false)
  assert.equal(toolNames.includes('bash'), true)
})

test('当前时间统一通过 Bash 提供', () => {
  const groupIds = TOOL_GROUPS.map((group) => group.id)
  const toolNames = TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.function.name))

  assert.equal(groupIds.includes('time'), false)
  assert.equal(toolNames.includes('get_current_time'), false)
  assert.equal(toolNames.includes('bash'), true)
})

test('工具并发策略只放行无副作用的读取调用', () => {
  assert.equal(getToolExecutionMode('read'), 'parallel')
  assert.equal(getToolExecutionMode('grep'), 'parallel')
  assert.equal(getToolExecutionMode('builtin_web_search'), 'parallel')
  assert.equal(getToolExecutionMode('task_read'), 'parallel')
  assert.equal(getToolExecutionMode('write'), 'exclusive')
  assert.equal(getToolExecutionMode('edit'), 'exclusive')
  assert.equal(getToolExecutionMode('bash'), 'exclusive')
  assert.equal(getToolExecutionMode('powershell'), 'exclusive')
  assert.equal(getToolExecutionMode('unknown-tool'), 'exclusive')
})
