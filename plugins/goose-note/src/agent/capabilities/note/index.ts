// Re-export all intents and shared types/functions
export type { IntentRouterDeps } from "./intents/shared";
export { parseNoteAgentInput, markdownNoteCommitHandler } from "./intents/shared";
export { noteChatCapability } from "./intents/noteChat";
export { noteCreateCapability } from "./intents/noteCreate";
export { noteReplaceCapability } from "./intents/noteReplace";
export { noteAppendCapability } from "./intents/noteAppend";
