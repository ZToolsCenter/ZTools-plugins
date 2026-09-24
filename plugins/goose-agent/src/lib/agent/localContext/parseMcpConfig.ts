/**
 * MCP 配置解析（只读发现，不启动进程）。
 *
 * 只认根键 `mcpServers`（agents / Cursor 等主流约定）。
 * 不读取 VS Code 式 `servers` 旁支。
 */

import type {
  ContextScope,
  DiscoveredMcpServer,
  McpTransport,
} from "./types";

/** 单条原始 server 配置（宽松读取） */
type RawServerEntry = {
  command?: unknown;
  args?: unknown;
  url?: unknown;
  type?: unknown;
  transport?: unknown;
  serverUrl?: unknown;
  [key: string]: unknown;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const args = v.filter((x): x is string => typeof x === "string");
  return args.length > 0 ? args : undefined;
}

/**
 * 推断传输类型：
 * - 有 url / serverUrl → http（若 type/transport 标明 sse 则 sse）
 * - 有 command → stdio
 * - 否则 unknown
 */
export function inferMcpTransport(entry: RawServerEntry): McpTransport {
  const explicit = (
    asString(entry.type) ??
    asString(entry.transport) ??
    ""
  ).toLowerCase();

  if (explicit === "stdio") return "stdio";
  if (explicit === "sse") return "sse";
  if (explicit === "http" || explicit === "streamable-http") return "http";

  const url = asString(entry.url) ?? asString(entry.serverUrl);
  if (url) {
    if (explicit.includes("sse")) return "sse";
    return "http";
  }
  if (asString(entry.command)) return "stdio";
  return "unknown";
}

function normalizeServerEntry(
  name: string,
  entry: unknown,
  scope: ContextScope,
  sourcePath: string,
): DiscoveredMcpServer | null {
  if (!name.trim()) return null;
  if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      name: name.trim(),
      scope,
      sourcePath,
      transport: "unknown",
      raw: entry,
    };
  }

  const raw = entry as RawServerEntry;
  const transport = inferMcpTransport(raw);
  const command = asString(raw.command);
  const args = asStringArray(raw.args);
  const url = asString(raw.url) ?? asString(raw.serverUrl);

  return {
    name: name.trim(),
    scope,
    sourcePath,
    transport,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(url ? { url } : {}),
    raw,
  };
}

/**
 * 从已解析的 JSON 对象提取 server map。
 * 只认根键 `mcpServers`。
 */
export function extractMcpServerMap(
  json: unknown,
): Record<string, unknown> | null {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }
  const root = json as Record<string, unknown>;
  const c = root.mcpServers;
  if (c != null && typeof c === "object" && !Array.isArray(c)) {
    return c as Record<string, unknown>;
  }
  return null;
}

export type ParseMcpConfigInput = {
  /** 配置文件绝对路径（仅作 sourcePath 标注） */
  sourcePath: string;
  /** 文件文本或已 parse 的对象 */
  content: string | unknown;
  scope: ContextScope;
};

/**
 * 解析一份 MCP 配置文件内容。
 * JSON 非法时返回空数组（不抛错，便于批量扫描）。
 */
export function parseMcpConfig(
  input: ParseMcpConfigInput,
): DiscoveredMcpServer[] {
  let json: unknown = input.content;
  if (typeof input.content === "string") {
    const text = input.content.trim();
    if (!text) return [];
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return [];
    }
  }

  const map = extractMcpServerMap(json);
  if (!map) return [];

  const out: DiscoveredMcpServer[] = [];
  for (const [name, entry] of Object.entries(map)) {
    const server = normalizeServerEntry(
      name,
      entry,
      input.scope,
      input.sourcePath,
    );
    if (server) out.push(server);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 合并多份 MCP 配置发现结果。
 * 同名时：后出现的覆盖先出现的（调用方应按「低优先 → 高优先」顺序传入）。
 * 默认建议顺序：全局 ~/.agents/mcp.json → 项目 .agents/mcp.json
 */
export function mergeMcpServers(
  batches: DiscoveredMcpServer[][],
): DiscoveredMcpServer[] {
  const byName = new Map<string, DiscoveredMcpServer>();
  for (const batch of batches) {
    for (const s of batch) {
      byName.set(s.name, s);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
