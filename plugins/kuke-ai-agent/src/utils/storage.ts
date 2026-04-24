import type {
  AppSettings,
  Provider,
  ComposerSendMode,
  SafetyMode,
  AllowListKind,
} from '../types'
import { normalizeEnabledToolNames, getDefaultEnabledToolNames } from '../toolCatalog'

export const MAX_TOOL_CALL_ROUNDS_SAFETY_CAP = 24
export const DEFAULT_MAX_TOOL_CALL_ROUNDS = 6

export const defaultAppSettings: AppSettings = {
  enableToolRoundLimit: false,
  maxToolCallRounds: DEFAULT_MAX_TOOL_CALL_ROUNDS,
  composerSendMode: 'enter',
  autoExpandToolDetails: false,
  autoRefreshDebugLogs: true,
  enableStreamResponse: true,
  autoScrollWhileStreaming: true,
  enableLocalTools: true,
  enabledToolNames: getDefaultEnabledToolNames(),
  tavilyApiKey: '',
  stopWhenToolError: false,
  safetyMode: 'moderate',
  moderateOnlyHigh: false,
  toolListKind: 'black',
  toolListNames: [],
  commandListKind: 'black',
  commandListPatterns: [],
  workspaceRoot: '',
  launchAutoSend: false,
  darkMode: 'auto',
  enableBashNotification: false,
}

export const clampToolRoundLimit = (value: unknown) => {
  const parsedValue = Number(value)
  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_MAX_TOOL_CALL_ROUNDS
  }
  return Math.min(MAX_TOOL_CALL_ROUNDS_SAFETY_CAP, Math.max(1, Math.round(parsedValue)))
}

export const normalizeComposerSendMode = (value: unknown): ComposerSendMode =>
  value === 'ctrlEnter' ? 'ctrlEnter' : 'enter'

export const cloneAppSettings = (settings: AppSettings): AppSettings => ({
  ...settings,
})

export const normalizeSafetyMode = (value: unknown): SafetyMode => {
  if (value === 'strict' || value === 'loose' || value === 'moderate' || value === 'allowlist') return value
  return 'moderate'
}

export const normalizeAllowListKind = (value: unknown): AllowListKind =>
  value === 'white' ? 'white' : 'black'

export const normalizeStringArray = (value: unknown, limit = 500): string[] => {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= limit) break
  }
  return result
}

export const normalizeAppSettings = (value: unknown): AppSettings => {
  const current = typeof value === 'object' && value !== null ? value as Partial<AppSettings> : {}

  return {
    enableToolRoundLimit: Boolean(current.enableToolRoundLimit),
    maxToolCallRounds: clampToolRoundLimit(current.maxToolCallRounds),
    composerSendMode: normalizeComposerSendMode(current.composerSendMode),
    autoExpandToolDetails: current.autoExpandToolDetails === true,
    autoRefreshDebugLogs: current.autoRefreshDebugLogs !== false,
    enableStreamResponse: current.enableStreamResponse !== false,
    autoScrollWhileStreaming: current.autoScrollWhileStreaming !== false,
    enableLocalTools: current.enableLocalTools !== false,
    enabledToolNames: normalizeEnabledToolNames(current.enabledToolNames),
    tavilyApiKey: String(current.tavilyApiKey ?? ''),
    stopWhenToolError: Boolean(current.stopWhenToolError),
    safetyMode: normalizeSafetyMode(current.safetyMode),
    moderateOnlyHigh: Boolean(current.moderateOnlyHigh),
    toolListKind: normalizeAllowListKind(current.toolListKind),
    toolListNames: normalizeStringArray(current.toolListNames, 64),
    commandListKind: normalizeAllowListKind(current.commandListKind),
    commandListPatterns: normalizeStringArray(current.commandListPatterns, 256),
    workspaceRoot: String(current.workspaceRoot ?? '').trim(),
    launchAutoSend: current.launchAutoSend === true,
    darkMode: (current.darkMode === 'light' || current.darkMode === 'dark') ? current.darkMode : 'auto',
    enableBashNotification: Boolean(current.enableBashNotification),
  }
}

export const createDefaultProviders = (): Provider[] => [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    models: ['gpt-3.5-turbo', 'gpt-4o', 'gpt-4-turbo'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    models: ['deepseek-chat', 'deepseek-coder'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    apiKey: '',
    // Claude 4 models (latest) + legacy Claude 3.5/3 models
    models: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241017',
      'claude-3-opus-20240229',
    ],
  },
]

export const defaultSystemPrompt = `你是 Kuke 本地 AI Agent，可以在用户的机器上按需调用工具来完成任务。

【当前环境】
- 当前时间：{{currentTime}}（{{timezone}}）
- 操作系统：{{osType}} {{osRelease}} · {{platform}}/{{arch}}
- 工作目录：{{cwd}}
- 当前用户：{{user}}@{{hostname}}
- Node 版本：{{nodeVersion}}

【可用工具】
- 文件：FileReadTool（支持 offset/limit 分页；图片/ipynb 自动识别）、FileEditTool（精确替换；修改前先 FileReadTool 读最新内容）、FileWriteTool（整文件重写；已有文件建议改用 FileEditTool）、FileDeleteTool（带快照回滚）、NotebookEditTool（Jupyter cell 级编辑）
- 检索：GlobTool（按 mtime 倒序找文件）、GrepTool（三种 outputMode：files_with_matches/content/count；支持 type 过滤、multiline、上下文）
- 终端：BashTool（同步执行；长任务务必 runInBackground=true）、BashOutputTool（拉取后台 stdout/stderr）、KillShellTool（终止后台进程）
- 网络：WebFetchTool（含可选 prompt 摘要）、WebSearchTool（支持域名白/黑名单）
- 规划：TodoWriteTool（拆步骤、实时更新进度）

【工作原则】
1. 开工前先 GetWorkspaceRootTool 确认当前 cwd；如果不是期望的项目目录，立即用 SetWorkspaceRootTool 切过去，避免在系统目录里瞎跑 ls/dir 把上下文打爆。
2. 复杂多步任务（≥3 步）开工前先用 TodoWriteTool 列任务清单；每完成一步立即更新对应项状态，保持同一时间只有一个 in_progress。
3. 先 GlobTool/GrepTool 定位 → 再 FileReadTool 读精确内容 → 再 FileEditTool 做最小改动。搜代码优先用 GrepTool 的 files_with_matches 省 token，要看现场再切 content + context。
4. 读大文件时用 FileReadTool 的 offset/limit 分页，不要盲目读整份。BashTool 产生的大输出会自动截断，如需完整内容请重定向到文件再 FileReadTool 分页。
5. 文件操作一律优先用专用工具，系统会自动快照支持回滚；**不要用 BashTool 的 rm / del / Remove-Item / mv / cp / sed -i / echo > 等命令替代**。
6. 跑 dev server / watch / 长构建/ 长脚本时必须 BashTool 加 runInBackground=true，之后用 BashOutputTool 轮询输出，任务结束或不再需要时用 KillShellTool 关闭。
7. 需要联网时：已知 URL → WebFetchTool；如果要针对性问题就再带上 prompt；未知 URL → WebSearchTool，可用 allowedDomains / blockedDomains 聚焦信源。
8. 每次调用 BashTool / FileEditTool / FileWriteTool / FileDeleteTool / NotebookEditTool / KillShellTool / SetWorkspaceRootTool 都必须如实评估 riskLevel（low=临时/只读；medium=项目文件；high=删除、系统配置、不可逆操作）并在 riskReason 写一句解释。
9. 执行写入、删除、命令等有副作用的操作前，先简要说明目标、影响范围；回复保持简洁、结构化、可执行。`

export const systemPromptPresets = [
  {
    id: 'general',
    label: '通用 Agent',
    prompt: defaultSystemPrompt,
  },
  {
    id: 'coding',
    label: '代码协作',
    prompt: `你是 Kuke 本地开发协作助手。当前时间 {{currentTime}}，工作目录 {{cwd}}（{{osType}} {{arch}}）。

工作流：复杂任务先 TodoWriteTool 列步骤 → GlobTool/GrepTool 定位相关文件（GrepTool 优先 files_with_matches，要看现场再切 content+context）→ FileReadTool 读精确内容（大文件用 offset/limit 分页）→ FileEditTool 做最小局部修改 → 需要跑 dev server/测试/构建时用 BashTool（长任务 runInBackground=true + BashOutputTool 轮询）。每完成一步立刻 TodoWriteTool 更新状态。输出保持结构清晰、可执行，说明改动范围与影响。`,
  },
  {
    id: 'automation',
    label: '系统执行',
    prompt: `你是 Kuke 本地自动化执行助手。当前时间 {{currentTime}}，系统 {{osType}} {{osRelease}}，工作目录 {{cwd}}。

调用文件与命令工具前先确认目标与风险，并在 riskLevel/riskReason 如实填写。长任务（dev server、watcher、构建）用 BashTool 的 runInBackground=true，再用 BashOutputTool 轮询；不再需要时 KillShellTool 关闭。删文件用 FileDeleteTool（带快照回滚），不要用 rm/del/Remove-Item。回复聚焦执行结果、副作用与回滚方式。`,
  },
]

export const loadProviders = (): Provider[] => {
  const stored = localStorage.getItem('kuke_providers')
  if (!stored) {
    return createDefaultProviders()
  }

  try {
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed) || !parsed.length) {
      return createDefaultProviders()
    }
    return parsed.map(p => ({
      ...p,
      type: p.type || 'openai',
    }))
  } catch {
    return createDefaultProviders()
  }
}

export const loadAppSettings = (): AppSettings => {
  const stored = localStorage.getItem('kuke_settings')
  if (!stored) {
    return cloneAppSettings(defaultAppSettings)
  }

  try {
    return normalizeAppSettings(JSON.parse(stored))
  } catch {
    return cloneAppSettings(defaultAppSettings)
  }
}
