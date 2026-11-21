import React, { useState } from "react";
import { X } from "lucide-react";
import type { AgentOrchestrationConfig } from "../types/aiOrchestration";
import { ROLE_PRESETS } from "../core/ai/agentOrchestrator";

interface Props {
  config: AgentOrchestrationConfig;
  onChange: (patch: Partial<AgentOrchestrationConfig>) => void;
  onClose: () => void;
}

type SettingsTab = "roles" | "permissions" | "mcp" | "harness";
const HARNESS_LABELS: Record<keyof AgentOrchestrationConfig["harnessGates"], string> = {
  syntaxHealing: "Markdown 语法检查",
  panguSpacing: "中英文间距整理",
  stripChitchat: "过滤客套前后缀",
  securityLeakScan: "敏感凭证检测"
};

export const AiAssistantSettings: React.FC<Props> = ({ config, onChange, onClose }) => {
  const [tab, setTab] = useState<SettingsTab>("roles");
  return <section className="ty-ai-settings" role="dialog" aria-label="助手设置">
    <header><b>助手设置</b><button onClick={onClose} aria-label="关闭设置"><X size={15}/></button></header>
    <nav>{([["roles", "Prompt 角色"], ["permissions", "写回权限"], ["mcp", "MCP 权限"], ["harness", "Harness 门禁"]] as Array<[SettingsTab, string]>).map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === "roles" && <div className="ty-ai-settings-body">
      <label>默认写作角色<select value={config.activeRoleId} onChange={(e) => onChange({ activeRoleId: e.target.value })}>{ROLE_PRESETS.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
      <label>自定义系统提示<textarea value={config.customSystemPrompt || ""} onChange={(e) => onChange({ customSystemPrompt: e.target.value })} placeholder="留空时使用所选角色的提示词"/></label>
    </div>}
    {tab === "permissions" && <div className="ty-ai-settings-body">{(["read-only", "confirm", "auto"] as const).map((value) => <label className="ty-ai-radio" key={value}><input type="radio" name="ai-permission" checked={config.permissionLevel === value} onChange={() => onChange({ permissionLevel: value })}/>{value === "read-only" ? "只读预览" : value === "confirm" ? "每次手动确认应用" : "允许自动操作（文档修改仍需点击应用）"}</label>)}</div>}
    {tab === "mcp" && <div className="ty-ai-settings-body"><label className="ty-ai-radio"><input type="checkbox" checked={config.mcpPermissions.workspaceSearch} onChange={(e) => onChange({ mcpPermissions: { ...config.mcpPermissions, workspaceSearch: e.target.checked } })}/>工作区搜索</label><label className="ty-ai-radio"><input type="checkbox" checked={config.mcpPermissions.diagramTemplate} onChange={(e) => onChange({ mcpPermissions: { ...config.mcpPermissions, diagramTemplate: e.target.checked } })}/>图表模板</label><label className="ty-ai-radio"><input type="checkbox" checked={config.mcpPermissions.webFetch} onChange={(e) => onChange({ mcpPermissions: { ...config.mcpPermissions, webFetch: e.target.checked } })}/>外部内容抓取</label></div>}
    {tab === "harness" && <div className="ty-ai-settings-body">{(Object.keys(HARNESS_LABELS) as Array<keyof AgentOrchestrationConfig["harnessGates"]>).map((key) => <label className="ty-ai-radio" key={key}><input type="checkbox" checked={config.harnessGates[key]} onChange={(e) => onChange({ harnessGates: { ...config.harnessGates, [key]: e.target.checked } })}/>{HARNESS_LABELS[key]}</label>)}</div>}
  </section>;
};
