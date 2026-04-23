import type {
  SourceLine,
  Environment,
  EnvironmentType,
  ParsedEnvironmentBlock,
} from '../types/hosts'

const DEFAULT_PUBLIC_HEADER = '#-------- 公共配置 --------'
const GROUP_HEADER_PATTERN = /^#--------\s*(.*?)\s*--------$/
const TAILSCALE_SECTION_START = '# TailscaleHostsSectionStart'
const TAILSCALE_SECTION_END = '# TailscaleHostsSectionEnd'
const DOCKER_SECTION_START = '# Added by Docker Desktop'
const DOCKER_SECTION_END = '# End of section'

type ExternalSectionKind = 'tailscale' | 'docker'

interface GroupMeta {
  matchKey: string
  name: string
  type: EnvironmentType
  header: string
  endMarker: string
}

const PUBLIC_GROUP = {
  name: 'hosts 文件',
  markerName: '公共配置',
  header: DEFAULT_PUBLIC_HEADER,
  endMarker: '',
}

const RESERVED_GROUPS = [
  PUBLIC_GROUP,
  {
    name: '开发配置',
    markerName: '开发配置',
    header: '#-------- 开发配置 --------',
    endMarker: '#-------- 开发配置 结束 --------',
  },
  {
    name: '测试配置',
    markerName: '测试配置',
    header: '#-------- 测试配置 --------',
    endMarker: '#-------- 测试配置 结束 --------',
  },
  {
    name: '生产配置',
    markerName: '生产配置',
    header: '#-------- 生产配置 --------',
    endMarker: '#-------- 生产配置 结束 --------',
  },
]

const RESERVED_MARKER_ALIASES: Record<string, string[]> = {
  [PUBLIC_GROUP.name]: ['公共配置'],
  开发配置: ['开发配置', '开发环境'],
  测试配置: ['测试配置', '测试环境'],
  生产配置: ['生产配置', '生产环境'],
}

const RESERVED_BY_HEADER = new Map(RESERVED_GROUPS.map((group) => [group.header, group]))
const RESERVED_BY_MARKER_NAME = new Map(
  RESERVED_GROUPS.flatMap((group) =>
    (RESERVED_MARKER_ALIASES[group.name] ?? [group.markerName]).map(
      (markerName) => [markerName, group] as const
    )
  )
)
const PUBLIC_RESERVED_NAMES = new Set(['公共配置'])

function buildGroupMatchKey(type: EnvironmentType, name: string): string {
  return type === 'public' ? 'public' : `custom:${name.trim()}`
}

function generateLineId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

export function buildGroupHeader(name: string): string {
  return `#-------- ${name.trim()} --------`
}

export function buildGroupEndMarker(name: string): string {
  return `#-------- ${name.trim()} 结束 --------`
}

export function normalizeHostsContent(content: string): string {
  return content.replace(/^\uFEFF/, '')
}

export function isReservedEnvironmentName(name: string): boolean {
  const normalizedName = name.trim()
  return normalizedName ? PUBLIC_RESERVED_NAMES.has(normalizedName) : false
}

function splitContentLines(content: string): string[] {
  if (content === '') return []
  const lines = content.split(/\r?\n/)
  if (content.endsWith('\n')) {
    lines.pop()
  }
  return lines
}

function parseManagedMarker(
  line: string
): { kind: 'start' | 'end'; name: string; header: string } | null {
  const header = line.trim()
  const match = header.match(GROUP_HEADER_PATTERN)
  if (!match) return null

  const markerName = match[1]?.trim()
  if (!markerName) return null

  if (markerName.startsWith('/')) {
    return {
      kind: 'end',
      name: markerName.slice(1).trim(),
      header,
    }
  }

  if (markerName.endsWith(' 结束')) {
    return {
      kind: 'end',
      name: markerName.slice(0, -3).trim(),
      header,
    }
  }

  return {
    kind: 'start',
    name: markerName,
    header,
  }
}

function getGroupMeta(header: string): GroupMeta {
  const trimmedHeader = header.trim()
  const reservedByHeader = RESERVED_BY_HEADER.get(trimmedHeader)
  if (reservedByHeader) {
    return {
      matchKey: buildGroupMatchKey(
        reservedByHeader.header === DEFAULT_PUBLIC_HEADER ? 'public' : 'custom',
        reservedByHeader.name
      ),
      name: reservedByHeader.name,
      type: reservedByHeader.header === DEFAULT_PUBLIC_HEADER ? 'public' : 'custom',
      header: reservedByHeader.header,
      endMarker: reservedByHeader.endMarker,
    }
  }

  const marker = parseManagedMarker(trimmedHeader)
  const groupName = marker?.name || '自定义分组'
  const reservedByName = RESERVED_BY_MARKER_NAME.get(groupName)
  if (reservedByName) {
    return {
      matchKey: buildGroupMatchKey(
        reservedByName.header === DEFAULT_PUBLIC_HEADER ? 'public' : 'custom',
        reservedByName.name
      ),
      name: reservedByName.name,
      type: reservedByName.header === DEFAULT_PUBLIC_HEADER ? 'public' : 'custom',
      header: reservedByName.header,
      endMarker: reservedByName.endMarker,
    }
  }

  return {
    matchKey: buildGroupMatchKey('custom', groupName),
    name: groupName,
    type: 'custom',
    header: trimmedHeader,
    endMarker: buildGroupEndMarker(groupName),
  }
}

function getExternalSectionStart(
  trimmedLine: string
): { kind: ExternalSectionKind; endMarker: string } | null {
  if (trimmedLine === TAILSCALE_SECTION_START) {
    return { kind: 'tailscale', endMarker: TAILSCALE_SECTION_END }
  }

  if (trimmedLine === DOCKER_SECTION_START) {
    return { kind: 'docker', endMarker: DOCKER_SECTION_END }
  }

  return null
}

function isIpv4(value: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return false
  const parts = value.split('.').map(Number)
  return parts.every((part) => part >= 0 && part <= 255)
}

function isIpv6(value: string): boolean {
  return value.includes(':') && /^[0-9a-fA-F:.%]+$/.test(value)
}

function parseHostLine(line: string) {
  const commentIdx = line.indexOf('#')
  const mainPart = commentIdx !== -1 ? line.substring(0, commentIdx).trim() : line.trim()
  const inlineComment = commentIdx !== -1 ? line.substring(commentIdx + 1).trim() : undefined
  const parts = mainPart.split(/\s+/).filter(Boolean)

  if (parts.length < 2) return null

  const ip = parts[0]
  const domain = parts.slice(1).join(' ')
  if (!isIpv4(ip) && !isIpv6(ip)) return null

  return { ip, domain, comment: inlineComment }
}

export function parseSourceToLines(content: string): SourceLine[] {
  const lines = splitContentLines(content)
  if (lines.length === 0) return []

  return lines.map((line) => {
    const trimmed = line.trim()

    if (!trimmed) {
      return { id: generateLineId(), type: 'blank' as const, raw: line }
    }

    if (!trimmed.startsWith('#')) {
      const parsed = parseHostLine(trimmed)
      if (parsed) {
        return {
          id: generateLineId(),
          type: 'host' as const,
          raw: line,
          ip: parsed.ip,
          domain: parsed.domain,
          enabled: true,
          comment: parsed.comment,
        }
      }

      return { id: generateLineId(), type: 'comment' as const, raw: line }
    }

    const uncommented = trimmed.replace(/^#+\s*/, '')
    const parsed = parseHostLine(uncommented)
    if (parsed) {
      return {
        id: generateLineId(),
        type: 'host' as const,
        raw: line,
        ip: parsed.ip,
        domain: parsed.domain,
        enabled: false,
        comment: parsed.comment,
      }
    }

    return { id: generateLineId(), type: 'comment' as const, raw: line }
  })
}

export function renderLinesToSource(lines: SourceLine[]): string {
  return lines
    .map((l) => {
      if (l.type === 'host' && l.ip !== undefined && l.domain !== undefined) {
        const line = `${l.ip}\t${l.domain}`
        const base = l.enabled ? line : `# ${line}`
        return l.comment ? `${base} # ${l.comment}` : base
      }
      return l.raw
    })
    .join('\n')
}

function parseManagedHosts(fullHosts: string): {
  publicLines: string[]
  sections: Map<string, { meta: GroupMeta; lines: string[] }>
  normalizedContent: string
} {
  const normalized = normalizeHostsContent(fullHosts)
  const newline = normalized.includes('\r\n') ? '\r\n' : '\n'
  const hasTrailingNewline = normalized.endsWith('\n')
  const sections = new Map<string, { meta: GroupMeta; lines: string[] }>()
  const publicLines: string[] = []
  const normalizedLines: string[] = []
  const lines = splitContentLines(normalized)
  let managedState: { meta: GroupMeta; lines: string[] } | null = null
  let externalState: { kind: ExternalSectionKind; endMarker: string } | null = null

  const storeManagedState = (appendImplicitEndMarker: boolean) => {
    if (!managedState) return

    const section = sections.get(managedState.meta.matchKey)
    if (section) {
      section.lines.push(...managedState.lines)
    } else {
      sections.set(managedState.meta.matchKey, {
        meta: managedState.meta,
        lines: [...managedState.lines],
      })
    }

    if (appendImplicitEndMarker) {
      normalizedLines.push(managedState.meta.endMarker)
    }

    managedState = null
  }

  for (const line of lines) {
    let pendingLine: string | null = line

    while (pendingLine !== null) {
      const currentLine = pendingLine
      pendingLine = null
      const trimmed = currentLine.trim()
      const marker = parseManagedMarker(trimmed)
      const markerMeta = marker ? getGroupMeta(marker.header) : null
      const externalStart = getExternalSectionStart(trimmed)

      if (externalState) {
        publicLines.push(currentLine)
        normalizedLines.push(currentLine)
        if (trimmed === externalState.endMarker) {
          externalState = null
        }
        continue
      }

      if (managedState) {
        if (marker?.kind === 'end' && markerMeta?.matchKey === managedState.meta.matchKey) {
          normalizedLines.push(currentLine)
          storeManagedState(false)
          continue
        }

        if (marker || externalStart) {
          storeManagedState(true)
          pendingLine = currentLine
          continue
        }

        managedState.lines.push(currentLine)
        normalizedLines.push(currentLine)
        continue
      }

      if (externalStart) {
        publicLines.push(currentLine)
        normalizedLines.push(currentLine)
        externalState = externalStart
        continue
      }

      if (marker?.kind === 'start') {
        if (markerMeta?.type === 'public') {
          normalizedLines.push(currentLine)
          continue
        }

        managedState = {
          meta: markerMeta ?? getGroupMeta(marker.header),
          lines: [],
        }
        normalizedLines.push(currentLine)
        continue
      }

      publicLines.push(currentLine)
      normalizedLines.push(currentLine)
    }
  }

  storeManagedState(true)

  return {
    publicLines,
    sections,
    normalizedContent: normalizedLines.join(newline) + (hasTrailingNewline ? newline : ''),
  }
}

export function normalizeManagedEnvironmentMarkers(fullHosts: string): string {
  return parseManagedHosts(fullHosts).normalizedContent
}

export function parseEnvironmentBlocks(fullHosts: string): ParsedEnvironmentBlock[] {
  const parsed = parseManagedHosts(fullHosts)

  return [
    {
      type: 'public' as const,
      name: 'hosts 文件',
      header: DEFAULT_PUBLIC_HEADER,
      endMarker: '',
      lines: parseSourceToLines(parsed.publicLines.join('\n')),
    },
    ...Array.from(parsed.sections.values()).map(({ meta, lines }) => ({
      type: meta.type,
      name: meta.name,
      header: meta.header,
      endMarker: meta.endMarker,
      lines: parseSourceToLines(lines.join('\n')),
    })),
  ]
}

export function getEnabledEnvironmentTypesFromHosts(fullHosts: string): EnvironmentType[] {
  return parseEnvironmentBlocks(fullHosts).map((env) => env.type)
}

export function extractPublicContent(fullHosts: string): string {
  return renderLinesToSource(
    parseSourceToLines(parseManagedHosts(fullHosts).publicLines.join('\n'))
  )
}

export function renderEnvironmentBlock(environments: Environment[]): string {
  const blocks: string[] = []

  for (const env of environments) {
    const renderedSource = renderLinesToSource(env.lines)

    blocks.push(env.header || buildGroupHeader(env.name))
    if (renderedSource) {
      blocks.push(...renderedSource.split('\n'))
    }
    blocks.push(env.endMarker || buildGroupEndMarker(env.name))
  }

  return blocks.join('\n')
}

export function mergeHostsContent(original: string, environments: Environment[]): string {
  const baseContent = extractPublicContent(original)
  const rendered = renderEnvironmentBlock(environments)
  return rendered
    ? [baseContent.trimEnd(), rendered].filter(Boolean).join('\n\n').trimEnd() + '\n'
    : baseContent.trimEnd() + '\n'
}

export function validateEntry(entry: { ip: string; domain: string }): string | null {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (!ipRegex.test(entry.ip)) return 'IP 格式不正确'
  const parts = entry.ip.split('.').map(Number)
  if (parts.some((p) => p < 0 || p > 255)) return 'IP 格式不正确'

  const domains = entry.domain.split(/\s+/).filter(Boolean)
  if (domains.length === 0 || domains.some((domain) => /\s/.test(domain))) return '域名格式不正确'
  return null
}
