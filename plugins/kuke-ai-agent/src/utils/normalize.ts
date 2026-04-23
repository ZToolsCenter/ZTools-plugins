import type {
  ToolInvocationStatus,
  ToolDiff,
  ChangeSummary,
  ChangeSummaryFile,
  ToolInvocation,
  TextMessageBlock,
  ToolMessageBlock,
  AssistantMessageBlock,
  ChatMessage,
  MessageRole,
  Attachment,
} from '../types'

export const createMessageId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

export const createBlockId = () => `block_${createMessageId()}`

export const normalizeToolDiff = (value: unknown): ToolDiff | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ToolDiff>
  if (typeof raw.diffText !== 'string') return null
  const added = Number(raw.addedLines)
  const removed = Number(raw.removedLines)
  if (!Number.isFinite(added) || !Number.isFinite(removed)) return null
  return {
    filePath: typeof raw.filePath === 'string' ? raw.filePath : undefined,
    addedLines: Math.max(0, Math.floor(added)),
    removedLines: Math.max(0, Math.floor(removed)),
    diffText: raw.diffText,
    tooLarge: Boolean(raw.tooLarge),
    diffTruncated: Boolean(raw.diffTruncated),
  }
}

export const normalizeChangeSummary = (value: unknown): ChangeSummary | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ChangeSummary>
  const files = Array.isArray(raw.files)
    ? raw.files
        .filter(Boolean)
        .map((file) => {
          const entry = file as Partial<ChangeSummaryFile>
          const path = String(entry?.path ?? '').trim()
          if (!path) return null
          return {
            path,
            added: Math.max(0, Math.floor(Number(entry?.added) || 0)),
            removed: Math.max(0, Math.floor(Number(entry?.removed) || 0)),
            kind: String(entry?.kind ?? ''),
          } satisfies ChangeSummaryFile
        })
        .filter((item): item is ChangeSummaryFile => item !== null)
    : []
  if (!files.length) return null
  const addedLines = files.reduce((sum, file) => sum + file.added, 0)
  const removedLines = files.reduce((sum, file) => sum + file.removed, 0)
  return { files, addedLines, removedLines }
}

export const normalizeToolInvocation = (value: unknown, index: number): ToolInvocation => {
  const current = value as Partial<ToolInvocation>
  const normalizedStatus = String(current.status ?? 'pending')
  const allowedStatus: ToolInvocationStatus[] = ['draft', 'pending', 'running', 'success', 'error']

  return {
    id: String(current.id ?? `tool_${index}`),
    callId: String(current.callId ?? current.id ?? `tool_${index}`),
    name: String(current.name ?? ''),
    argumentsText: String(current.argumentsText ?? ''),
    resultText: String(current.resultText ?? ''),
    status: allowedStatus.includes(normalizedStatus as ToolInvocationStatus)
      ? (normalizedStatus as ToolInvocationStatus)
      : 'pending',
    expanded: Boolean(current.expanded),
    diff: normalizeToolDiff(current.diff),
  }
}

export const normalizeToolInvocations = (value: unknown): ToolInvocation[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(Boolean)
    .map((tool, index) => normalizeToolInvocation(tool, index))
}

export const cloneToolInvocation = (toolInvocation: ToolInvocation): ToolInvocation => ({
  ...toolInvocation,
})

export const cloneMessageBlocks = (blocks: AssistantMessageBlock[]) =>
  blocks.map((block) => (
    block.type === 'text'
      ? { ...block }
      : {
          ...block,
          toolInvocation: cloneToolInvocation(block.toolInvocation),
        }
  ))

export const buildAssistantContentFromBlocks = (blocks: AssistantMessageBlock[]) =>
  blocks
    .filter((block): block is TextMessageBlock => block.type === 'text')
    .map((block) => block.content)
    .filter(Boolean)
    .join('\n\n')

export const buildToolInvocationsFromBlocks = (blocks: AssistantMessageBlock[]) =>
  blocks
    .filter((block): block is ToolMessageBlock => block.type === 'tool')
    .map((block) => cloneToolInvocation(block.toolInvocation))

export const normalizeMessageBlocks = (
  value: unknown,
  fallbackContent = '',
  fallbackToolInvocations: ToolInvocation[] = [],
): AssistantMessageBlock[] => {
  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((block, index) => {
        const current = block as Record<string, unknown>
        const type = current.type === 'tool' ? 'tool' : 'text'

        if (type === 'tool') {
          return {
            id: String(current.id ?? createBlockId()),
            type: 'tool' as const,
            toolInvocation: normalizeToolInvocation(
              current.toolInvocation ?? current.tool ?? current,
              index,
            ),
          }
        }

        return {
          id: String(current.id ?? createBlockId()),
          type: 'text' as const,
          content: String(current.content ?? ''),
        }
      })
  }

  const fallbackBlocks: AssistantMessageBlock[] = []
  if (fallbackContent) {
    fallbackBlocks.push({
      id: createBlockId(),
      type: 'text',
      content: fallbackContent,
    })
  }

  fallbackToolInvocations.forEach((toolInvocation) => {
    fallbackBlocks.push({
      id: createBlockId(),
      type: 'tool',
      toolInvocation: cloneToolInvocation(toolInvocation),
    })
  })

  return fallbackBlocks
}

export const syncAssistantMessageState = (message: ChatMessage): ChatMessage => {
  if (message.role !== 'assistant') {
    return {
      ...message,
      blocks: [],
    }
  }

  const nextBlocks = cloneMessageBlocks(message.blocks ?? [])
  return {
    ...message,
    blocks: nextBlocks,
    content: buildAssistantContentFromBlocks(nextBlocks),
    toolInvocations: buildToolInvocationsFromBlocks(nextBlocks),
  }
}

export const normalizeAttachment = (value: unknown, index: number): Attachment | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const current = value as Partial<Attachment>
  const kind = current.kind === 'image' || current.kind === 'folder' ? current.kind : 'file'
  const path = String(current.path ?? '').trim()
  const name = String(current.name ?? '').trim()
  if (!path && !name) {
    return null
  }
  return {
    id: String(current.id ?? `att_${Date.now()}_${index}`),
    kind,
    name: name || path.split(/[\\/]/).pop() || '附件',
    path,
    size: typeof current.size === 'number' ? current.size : undefined,
    mimeType: typeof current.mimeType === 'string' ? current.mimeType : undefined,
  }
}

export const normalizeAttachments = (value: unknown): Attachment[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item, index) => normalizeAttachment(item, index))
    .filter((item): item is Attachment => item !== null)
}

export const serializeAttachmentForStorage = (attachment: Attachment): Attachment => ({
  id: attachment.id,
  kind: attachment.kind,
  name: attachment.name,
  path: attachment.path,
  size: attachment.size,
  mimeType: attachment.mimeType,
})

export const cloneAttachments = (list: Attachment[] | undefined): Attachment[] =>
  Array.isArray(list) ? list.map((item) => ({ ...item })) : []

export const createMessage = (
  role: MessageRole,
  content: string,
  options: Partial<Omit<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>> = {},
): ChatMessage => ({
  id: createMessageId(),
  role,
  content,
  createdAt: Date.now(),
  isStreaming: false,
  toolInvocations: [],
  blocks: role === 'assistant'
    ? (content
      ? [{ id: createBlockId(), type: 'text', content }]
      : [])
    : [],
  attachments: [],
  hasSnapshot: false,
  ...options,
})

export const normalizeMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(Boolean)
    .map((message, index) => {
      const current = message as Partial<ChatMessage>
      const role = (current.role ?? 'system') as MessageRole
      const normalizedToolInvocations = normalizeToolInvocations(current.toolInvocations)
      const normalizedAttachments = normalizeAttachments(
        (current as Partial<ChatMessage> & { attachments?: unknown }).attachments,
      )
      const normalizedMessage: ChatMessage = {
        id: String(current.id ?? `message_${Date.now()}_${index}`),
        role,
        content: String(current.content ?? ''),
        createdAt: Number(current.createdAt ?? Date.now() + index),
        isStreaming: false,
        toolInvocations: normalizedToolInvocations,
        blocks: role === 'assistant'
          ? normalizeMessageBlocks(
              (current as Partial<ChatMessage> & { blocks?: unknown }).blocks,
              String(current.content ?? ''),
              normalizedToolInvocations,
            )
          : [],
        attachments: normalizedAttachments,
        hasSnapshot: Boolean((current as Partial<ChatMessage>).hasSnapshot),
        changeSummary: normalizeChangeSummary((current as Partial<ChatMessage>).changeSummary),
      }

      return role === 'assistant' ? syncAssistantMessageState(normalizedMessage) : normalizedMessage
    })
}

export const tryParseJson = (value: string) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export const hasOwnKey = (target: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key)

export const getArgumentByAliases = (parsedArguments: Record<string, unknown>, aliases: string[]) => {
  for (const alias of aliases) {
    if (hasOwnKey(parsedArguments, alias)) {
      const value = parsedArguments[alias]
      if (value !== undefined && value !== null) {
        return value
      }
    }
  }
  return undefined
}

export const stringifyArgument = (value: unknown) => (value === undefined ? '' : String(value))

export const stringifyForBlock = (value: unknown) => {
  if (typeof value === 'string') {
    const parsed = tryParseJson(value)
    if (parsed !== null) {
      return JSON.stringify(parsed, null, 2)
    }
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value ?? '')
  }
}

export const isToolResultError = (value: unknown) =>
  typeof value === 'object' && value !== null && 'success' in value && (value as { success?: boolean }).success === false
