import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, LoaderCircle, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { AiDocumentSnapshot, AiEditProposal } from "../types/aiEditing";
import type { McpServerSummary, McpToolSummary, McpToolResult } from "../types/mcp";
import type { AgentOrchestrationConfig } from "../types/aiOrchestration";
import "../styles/ai-mcp.css";

interface Props {
  snapshot?: AiDocumentSnapshot;
  permissions: AgentOrchestrationConfig["mcpPermissions"];
  canInsert: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancelChange: (cancel: () => void) => void;
  onPropose: (proposal: AiEditProposal) => void;
}
interface ServerDraft { id?: string; name: string; url: string; token: string; clearToken?: boolean; enabled: boolean; }
const emptyDraft = (): ServerDraft => ({ name: "", url: "", token: "", enabled: true });
const toolKey = (serverId: string, name: string) => `${serverId}\u0000${name}`;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const permissionFor = (toolName: string, permissions: Props["permissions"], builtIn: boolean) => {
  if (!builtIn) return true;
  if (toolName === "search_workspace_references") return permissions.workspaceSearch;
  if (toolName === "get_diagram_template") return permissions.diagramTemplate;
  if (toolName === "fetch_markdown_snippet") return permissions.webFetch;
  return true;
};

function requiredMissing(tool: McpToolSummary, parsed: Record<string, unknown>): string[] {
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  return required.filter((key): key is string => typeof key === "string" && !(key in parsed));
}
function exampleValue(schema: unknown): unknown {
  if (!isRecord(schema)) return "";
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && Array.isArray(schema.enum)) return schema.enum[0] ?? "";
  switch (schema.type) {
    case "number": case "integer": return 0;
    case "boolean": return false;
    case "array": return [];
    case "object": return {};
    default: return "";
  }
}
function exampleArgs(tool: McpToolSummary): string {
  const properties = isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
  const required = new Set(Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required.filter((key): key is string => typeof key === "string") : []);
  const names = [...required, ...Object.keys(properties).filter((key) => !required.has(key))];
  return `${JSON.stringify(Object.fromEntries(names.map((key) => [key, exampleValue(properties[key])])), null, 2)}\n`;
}
function snapshotCopy(snapshot?: AiDocumentSnapshot): AiDocumentSnapshot | undefined {
  return snapshot ? { ...snapshot, selection: snapshot.selection ? { ...snapshot.selection } : null } : undefined;
}

export const AiMcpPanel: React.FC<Props> = ({ snapshot, permissions, canInsert, disabled, onBusyChange, onCancelChange, onPropose }) => {
  const api = window.typoraBridge?.mcp;
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [tools, setTools] = useState<Record<string, McpToolSummary[]>>({});
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<{ serverId: string; tool: McpToolSummary } | null>(null);
  const [argsText, setArgsText] = useState("{}\n");
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<McpToolResult | null>(null);
  const [insertProposal, setInsertProposal] = useState<AiEditProposal | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const requestRef = useRef<string | null>(null);
  const epochRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const invalidateTool = useCallback((message = "") => {
    epochRef.current += 1;
    const requestId = requestRef.current;
    requestRef.current = null;
    if (requestId) void api?.cancel(requestId).catch(() => undefined);
    setBusyTool(false);
    setResult(null);
    setInsertProposal(null);
    if (message) setError(message);
    onBusyChange(false);
  }, [api, onBusyChange]);

  const refresh = useCallback(async (silent = false) => {
    if (!api) { if (!silent) setError("当前宿主尚未接入 MCP 服务。"); return; }
    try {
      const next = await api.listServers();
      setServers(next);
      const firstConnected = next.find((server) => server.enabled && server.status === "connected");
      setExpanded((current) => current && next.some((server) => server.id === current && server.enabled && server.status === "connected") ? current : firstConnected?.id || null);
      setSelectedTool((current) => current && !next.some((server) => server.id === current.serverId && server.enabled && server.status === "connected") ? null : current);
      if (!silent) setError("");
      const connected = next.filter((server) => server.enabled && server.status === "connected");
      const discovered = await Promise.all(connected.map(async (server) => {
        try { return [server.id, await api.listTools(server.id)] as const; }
        catch (cause) { return [server.id, [] as McpToolSummary[]] as const; }
      }));
      setTools(Object.fromEntries(discovered));
    } catch (cause) { if (!silent) setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);

  const connect = async (server: McpServerSummary) => {
    if (!api || busyServer || disabled) return;
    setSelectedTool((current) => current?.serverId === server.id ? null : current);
    invalidateTool(); setBusyServer(server.id); onBusyChange(true); setError("");
    try {
      const connection = await api.connect(server.id);
      if (connection.status !== "connected") throw new Error(connection.error || "连接未成功。");
      const discovered = await api.listTools(server.id);
      setTools((previous) => ({ ...previous, [server.id]: discovered }));
      setExpanded(server.id);
      await refresh(true);
    } catch (cause) { await refresh(true); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyServer(null); onBusyChange(false); }
  };
  const disconnect = async (server: McpServerSummary) => {
    if (!api || busyServer || disabled) return;
    setSelectedTool((current) => current?.serverId === server.id ? null : current);
    invalidateTool(); setBusyServer(server.id); onBusyChange(true); setError("");
    try { await api.disconnect(server.id); setTools((previous) => { const next = { ...previous }; delete next[server.id]; return next; }); await refresh(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyServer(null); onBusyChange(false); }
  };
  const toggleEnabled = async (server: McpServerSummary) => {
    if (!api || busyServer || disabled) return;
    setSelectedTool((current) => current?.serverId === server.id ? null : current);
    invalidateTool(); setBusyServer(server.id); onBusyChange(true); setError("");
    try { await api.setEnabled(server.id, !server.enabled); if (server.enabled) setTools((prev) => { const next = { ...prev }; delete next[server.id]; return next; }); await refresh(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyServer(null); onBusyChange(false); }
  };
  const saveServer = async () => {
    if (!api || !draft || !draft.name.trim() || !draft.url.trim() || busyServer || disabled) return;
    try { const parsed = new URL(draft.url.trim()); if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("只支持 HTTP 或 HTTPS 地址。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "请输入有效的服务地址。"); return; }
    if (draft.id) setSelectedTool((current) => current?.serverId === draft.id ? null : current);
    invalidateTool(); setBusyServer(draft.id || "new"); onBusyChange(true); setError("");
    try {
      const saved = await api.upsertServer({ id: draft.id, name: draft.name.trim(), transport: "streamable-http", url: draft.url.trim(), token: draft.clearToken ? "" : draft.token || undefined, enabled: draft.enabled });
      setDraft(null); await refresh(true); setExpanded(saved.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyServer(null); onBusyChange(false); }
  };
  const removeServer = async (serverId: string) => {
    if (!api || busyServer || disabled) return;
    setSelectedTool((current) => current?.serverId === serverId ? null : current);
    invalidateTool(); setBusyServer(serverId); onBusyChange(true); setError("");
    try { await api.removeServer(serverId); setDeleteId(null); if (selectedTool?.serverId === serverId) setSelectedTool(null); setTools((prev) => { const next = { ...prev }; delete next[serverId]; return next; }); await refresh(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyServer(null); onBusyChange(false); }
  };
  const runTool = async () => {
    if (!api || !selectedTool || busyTool || disabled) return;
    const sourceServer = servers.find((server) => server.id === selectedTool.serverId);
    if (!sourceServer?.enabled || sourceServer.status !== "connected") { setError("工具所在服务未连接或已停用，请重新连接后再试。"); return; }
    if (!permissionFor(selectedTool.tool.name, permissions, sourceServer.builtIn)) { setError("此工具已在助手设置中禁用。"); return; }
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsText || "{}");
      if (!isRecord(parsed)) throw new Error("参数必须是 JSON 对象。");
      const missing = requiredMissing(selectedTool.tool, parsed);
      if (missing.length) throw new Error(`缺少必填参数：${missing.join("、")}`);
      args = parsed;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "参数 JSON 格式无效。"); return; }
    const frozenSnapshot = snapshotCopy(snapshotRef.current);
    const requestId = `mcp-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const requestEpoch = ++epochRef.current;
    requestRef.current = requestId; setBusyTool(true); onBusyChange(true); setError(""); setResult(null); setInsertProposal(null);
    try {
      const response = await api.callTool(selectedTool.serverId, selectedTool.tool.name, args, requestId);
      if (requestEpoch !== epochRef.current || requestRef.current !== requestId) return;
      if (response.serverId !== selectedTool.serverId || response.toolName !== selectedTool.tool.name) throw new Error("MCP 响应与当前服务/工具不匹配，已丢弃。");
      setResult(response);
      const text = [...response.content.map((item) => item.text || "").filter(Boolean), ...(response.structuredContent === undefined ? [] : [JSON.stringify(response.structuredContent, null, 2)])].join("\n\n");
      if (response.isError) setError(text || "MCP 工具返回错误。");
      else if (text.trim() && frozenSnapshot) setInsertProposal({ snapshot: frozenSnapshot, text, mode: "insert" });
    } catch (cause) {
      if (requestEpoch === epochRef.current && requestRef.current === requestId) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestEpoch === epochRef.current && requestRef.current === requestId) {
        requestRef.current = null; setBusyTool(false); onBusyChange(false);
      }
    }
  };
  const cancelTool = useCallback(() => invalidateTool("已取消工具调用。"), [invalidateTool]);
  useEffect(() => {
    onCancelChange(cancelTool);
    return () => {
      onCancelChange(() => undefined);
      epochRef.current += 1;
      const requestId = requestRef.current;
      requestRef.current = null;
      if (requestId) void api?.cancel(requestId).catch(() => undefined);
      onBusyChange(false);
    };
  }, [api, cancelTool, onBusyChange, onCancelChange]);
  const chooseTool = (serverId: string, tool: McpToolSummary) => {
    invalidateTool(); setSelectedTool({ serverId, tool }); setArgsText(exampleArgs(tool)); setResult(null); setInsertProposal(null); setError("");
  };
  const editServer = (server: McpServerSummary) => {
    setSelectedTool((current) => current?.serverId === server.id ? null : current);
    invalidateTool(); setDraft({ id: server.id, name: server.name, url: server.url, token: "", enabled: server.enabled }); setError("");
  };
  const selectedServer = selectedTool ? servers.find((server) => server.id === selectedTool.serverId) : undefined;
  const allowedTools = selectedTool ? permissionFor(selectedTool.tool.name, permissions, Boolean(selectedServer?.builtIn)) : true;
  const operationsBusy = Boolean(busyServer) || busyTool;
  useEffect(() => {
    if (busyTool && !allowedTools) invalidateTool("此工具权限已关闭，调用已取消。");
  }, [allowedTools, busyTool, invalidateTool]);

  if (!api) return <main className="ty-ai-mcp-panel"><p className="ty-ai-error">当前宿主没有提供 MCP 管理能力。</p></main>;
  return <main className="ty-ai-mcp-panel">
    <header><div><b>工具连接</b><small>连接服务后即可发现工具；Bearer 令牌只保存在当前宿主会话。</small></div><div><button type="button" disabled={disabled || operationsBusy} onClick={() => void refresh()} aria-label="刷新 MCP 服务"><RefreshCw size={14}/></button><button type="button" disabled={disabled || operationsBusy} onClick={() => { invalidateTool(); setDraft(emptyDraft()); }}><Plus size={14}/>添加服务</button></div></header>
    {error && <p className="ty-ai-error" role="alert">{error}</p>}
    {draft && <section className="ty-ai-mcp-form" aria-label="MCP 服务设置">
      <label>名称<input disabled={disabled || operationsBusy} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="off"/></label>
      <label>Streamable HTTP 地址<input disabled={disabled || operationsBusy} type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://mcp.example.com/mcp" autoComplete="url"/></label>
      <label>会话 Bearer Token <small>只用于当前宿主会话，不会写入设置文件。更改地址时请重新输入令牌。</small><input disabled={disabled || operationsBusy} type="password" value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value, clearToken: false })} autoComplete="new-password" placeholder={draft.id ? "地址不变时留空可保留" : "可选"}/>{draft.id && servers.find((server) => server.id === draft.id)?.hasToken && <span className="ty-ai-mcp-clear-token"><input disabled={disabled || operationsBusy} type="checkbox" aria-label="清除当前会话令牌" checked={Boolean(draft.clearToken)} onChange={(e) => setDraft({ ...draft, clearToken: e.target.checked, token: "" })}/><small>清除当前会话令牌</small></span>}</label>
      <div className="ty-ai-mcp-form-actions"><button type="button" disabled={disabled || operationsBusy} onClick={() => setDraft(null)}>取消</button><button type="button" className="primary" disabled={!draft.name.trim() || !draft.url.trim() || disabled || operationsBusy} onClick={() => void saveServer()}>保存连接</button></div>
    </section>}
    {!servers.length && !error && <p className="ty-ai-mcp-empty">还没有可用 MCP 服务。可以添加兼容 Streamable HTTP 的服务。</p>}
    <div className="ty-ai-mcp-servers">{servers.map((server) => <section className="ty-ai-mcp-server" key={server.id}>
      <header><button type="button" className="ty-ai-mcp-expand" onClick={() => setExpanded(expanded === server.id ? null : server.id)}>{expanded === server.id ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}<span><b>{server.name}</b><small>{server.builtIn ? "内置服务 · 不可删除" : server.url}</small></span></button><span className={`ty-ai-mcp-status is-${server.status}`}>{server.status === "connected" ? "已连接" : server.status === "connecting" ? "连接中" : server.status === "error" ? "错误" : "未连接"}</span></header>
      {server.error && <p className="ty-ai-error">{server.error}</p>}
      <div className="ty-ai-mcp-server-actions"><button type="button" role="switch" aria-checked={server.enabled} disabled={operationsBusy || disabled} onClick={() => void toggleEnabled(server)}>{server.enabled ? "已启用" : "已停用"}</button>
        {server.status === "connected" ? <button type="button" disabled={operationsBusy || disabled} onClick={() => void disconnect(server)}>断开</button> : <button type="button" className="primary" disabled={!server.enabled || operationsBusy || disabled} onClick={() => void connect(server)}>{busyServer === server.id ? <LoaderCircle size={13} className="spin"/> : <RefreshCw size={13}/>}连接并发现工具</button>}
        {!server.builtIn && <><button type="button" disabled={operationsBusy || disabled} onClick={() => editServer(server)}>编辑</button>{deleteId === server.id ? <span className="ty-ai-mcp-confirm-delete">删除此服务？ <button type="button" disabled={operationsBusy || disabled} onClick={() => void removeServer(server.id)}>删除</button><button type="button" disabled={operationsBusy || disabled} onClick={() => setDeleteId(null)}>取消</button></span> : <button type="button" disabled={operationsBusy || disabled} aria-label={`删除 ${server.name}`} onClick={() => { setSelectedTool((current) => current?.serverId === server.id ? null : current); invalidateTool(); setDeleteId(server.id); }}><Trash2 size={13}/></button>}</>}
      </div>
      {expanded === server.id && <div className="ty-ai-mcp-tools">{(tools[server.id] || []).length ? (tools[server.id] || []).map((tool) => <button type="button" className="ty-ai-mcp-tool" key={toolKey(server.id, tool.name)} disabled={disabled || operationsBusy} onClick={() => chooseTool(server.id, tool)}><b>{tool.name}</b><small>{tool.description}</small></button>) : <small>{server.status === "connected" ? "当前服务没有发现工具。" : "连接后发现工具。"}</small>}</div>}
    </section>)}</div>
    {selectedTool && <section className="ty-ai-mcp-call">
      <header><div><b>{selectedTool.tool.name}</b><small>服务：{servers.find((item) => item.id === selectedTool.serverId)?.name || selectedTool.serverId}</small></div><button type="button" disabled={disabled || busyServer !== null} onClick={() => { invalidateTool(); setSelectedTool(null); }} aria-label="关闭工具调用"><X size={14}/></button></header>
      {selectedTool.tool.description && <p>{selectedTool.tool.description}</p>}
      <label htmlFor="ty-ai-mcp-args">参数 JSON</label><textarea id="ty-ai-mcp-args" value={argsText} onChange={(e) => setArgsText(e.target.value)} spellCheck={false} disabled={busyTool || disabled}/>
      <small className="ty-ai-mcp-required">必填：{Array.isArray(selectedTool.tool.inputSchema.required) && selectedTool.tool.inputSchema.required.length ? (selectedTool.tool.inputSchema.required as string[]).join("、") : "无"} · 可查看工具 schema 作为参数说明</small>
      <details className="ty-ai-mcp-schema"><summary>查看参数 schema</summary><pre>{JSON.stringify(selectedTool.tool.inputSchema, null, 2)}</pre></details>
      {!allowedTools && <p className="ty-ai-error">此工具已在助手设置中禁用。</p>}
      {busyTool ? <button type="button" onClick={cancelTool}>取消调用</button> : <button type="button" className="primary" disabled={disabled || !allowedTools} onClick={() => void runTool()}><Play size={13}/>运行工具</button>}
      {result && <section className={`ty-ai-mcp-result ${result.isError ? "is-error" : ""}`}><header><b>{result.isError ? "工具返回错误" : "工具结果"}</b><span>{result.toolName}</span></header><pre>{result.content.map((item) => item.text || "").filter(Boolean).join("\n\n") || (result.structuredContent === undefined ? "（无文本结果）" : JSON.stringify(result.structuredContent, null, 2))}</pre>{insertProposal && !result.isError && <div><button type="button" onClick={() => setInsertProposal(null)}>不插入</button><button type="button" className="primary" disabled={!canInsert || !snapshot || snapshot.documentId !== insertProposal.snapshot.documentId || snapshot.revision !== insertProposal.snapshot.revision || snapshot.content !== insertProposal.snapshot.content || snapshot.readOnly || snapshot.selectionValid === false || (insertProposal.snapshot.cursor === null && !insertProposal.snapshot.selection)} onClick={() => { onPropose(insertProposal); setInsertProposal(null); }}>插入到原光标位置</button></div>}</section>}
    </section>}
  </main>;
};
