export type MessageRole = 'assistant' | 'user' | 'system' | 'tool'

export type ToolInvocationStatus = 'draft' | 'pending' | 'running' | 'success' | 'error'

export type AttachmentKind = 'image' | 'file' | 'folder'

export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  path: string
  size?: number
  mimeType?: string
  previewDataUrl?: string
}

export interface ToolDiff {
  filePath?: string
  addedLines: number
  removedLines: number
  diffText: string
  tooLarge?: boolean
  diffTruncated?: boolean
}

export interface ToolInvocation {
  id: string
  callId: string
  name: string
  argumentsText: string
  resultText: string
  status: ToolInvocationStatus
  expanded: boolean
  diff?: ToolDiff | null
}

export interface TextMessageBlock {
  id: string
  type: 'text'
  content: string
}

export interface ToolMessageBlock {
  id: string
  type: 'tool'
  toolInvocation: ToolInvocation
}

export type AssistantMessageBlock = TextMessageBlock | ToolMessageBlock

export interface ChangeSummaryFile {
  path: string
  added: number
  removed: number
  kind: string
}

export interface ChangeSummary {
  files: ChangeSummaryFile[]
  addedLines: number
  removedLines: number
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  isStreaming?: boolean
  toolInvocations: ToolInvocation[]
  blocks: AssistantMessageBlock[]
  attachments?: Attachment[]
  hasSnapshot?: boolean
  changeSummary?: ChangeSummary | null
}

export type ProviderType = 'openai' | 'anthropic'

export interface Provider {
  id: string
  name: string
  type: ProviderType
  baseURL: string
  apiKey: string
  models: string[]
  showApiKey?: boolean
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
  systemPromptSnapshot?: string
  titleGenerated?: boolean
}

export interface DebugLogEntry {
  id: string
  ts: string
  level: 'info' | 'error'
  scope: string
  event: string
  payload: Record<string, unknown>
}

export interface SessionRuntimeState {
  isLoading: boolean
  activeRequestId: string | null
  stopRequested: boolean
  todos: TodoItem[]
  todosUpdatedAt: number
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  activeForm: string
  status: TodoStatus
}

export type ComposerSendMode = 'enter' | 'ctrlEnter'

export type SafetyMode = 'strict' | 'moderate' | 'loose' | 'allowlist'

export type ToolRiskLevel = 'low' | 'medium' | 'high'

export type AllowListKind = 'white' | 'black'

export interface AppSettings {
  enableToolRoundLimit: boolean
  maxToolCallRounds: number
  composerSendMode: ComposerSendMode
  autoExpandToolDetails: boolean
  autoRefreshDebugLogs: boolean
  enableStreamResponse: boolean
  autoScrollWhileStreaming: boolean
  enableLocalTools: boolean
  enabledToolNames: string[]
  tavilyApiKey: string
  stopWhenToolError: boolean
  safetyMode: SafetyMode
  moderateOnlyHigh: boolean
  toolListKind: AllowListKind
  toolListNames: string[]
  commandListKind: AllowListKind
  commandListPatterns: string[]
  workspaceRoot: string
  launchAutoSend: boolean
  darkMode: 'auto' | 'light' | 'dark'
  enableBashNotification: boolean
}

export type ToolCategoryId = 'environment' | 'file' | 'task' | 'memory'

export interface ToolDefinitionSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export interface ToolDefinition {
  name: string
  label: string
  purpose: string
  summary: string
  category: ToolCategoryId
  categoryLabel: string
  capabilityLabel: string
  riskLabel: string
  description: string
  parameters: ToolDefinitionSchema
  legacyNames?: string[]
}

export type ToolConfirmationDecision = 'allow_once' | 'allow_always' | 'allow_and_remember' | 'deny'

export interface PendingToolConfirmation {
  id: string
  toolName: string
  toolLabel: string
  toolPurpose: string
  args: Record<string, unknown>
  argsPreview: string
  riskLevel: ToolRiskLevel
  riskReason: string
  sessionId: string
  allowlistAction?: 'add_to_white' | 'remove_from_black'
  bashCommand?: string
  resolve: (decision: ToolConfirmationDecision) => void
}

export type ToolGateDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | {
      kind: 'confirm'
      allowlistAction?: 'add_to_white' | 'remove_from_black'
      bashCommand?: string
    }

export interface DiscoveredSkill {
  name: string
  description: string
  path: string
  entry: string
}

export interface MemoryBlock {
  label: string
  description: string
  value: string
  chars_current: number
  chars_limit: number
  read_only: boolean
  updatedAt: number
}

export interface MemoryEditResult {
  success: boolean
  error?: string
}
