import type {
  AgentCapabilityManifest,
  AgentCommitHandler,
} from "@/agent/core/types";
import {
  markdownNoteCommitHandler,
  noteAppendCapability,
  noteChatCapability,
  noteCreateCapability,
  noteReplaceCapability,
} from "@/agent/capabilities/note";

const AGENT_CAPABILITIES: AgentCapabilityManifest[] = [
  noteAppendCapability,
  noteReplaceCapability,
  noteCreateCapability,
  noteChatCapability,
];

const AGENT_COMMIT_HANDLERS: AgentCommitHandler[] = [
  markdownNoteCommitHandler,
];

export function getAgentCapabilities() {
  return AGENT_CAPABILITIES;
}

export function getAgentCapabilityById(id: string) {
  return AGENT_CAPABILITIES.find((capability) => capability.id === id) ?? null;
}

export function getAgentCommitHandler(artifactType: string) {
  return AGENT_COMMIT_HANDLERS.find((handler) => handler.artifactType === artifactType) ?? null;
}
