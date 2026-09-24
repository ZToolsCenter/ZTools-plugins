/**
 * 全局 + 项目本地上下文发现层。
 *
 * - paths / parse* / merge：纯逻辑，无 fs
 * - runtime：经 window.gooseAiContext 做 I/O（设置页 / runTurn）
 */

export type {
  ContextScope,
  DiscoveredMcpServer,
  DiscoveredSkill,
  LocalContextPathInput,
  McpTransport,
  PromptLayers,
  ScopedPath,
} from "./types";

export {
  joinPath,
  listLocalContextPaths,
  normalizeDir,
  resolveGlobalAgentsMdPath,
  resolveGlobalMcpConfigPath,
  resolveGlobalSkillsRoot,
  resolveProjectAgentsMdPath,
  resolveProjectMcpConfigPath,
  resolveProjectSkillsRoot,
} from "./paths";

export {
  fallbackSkillName,
  frontmatterValue,
  MAX_SKILL_CONTENT_CHARACTERS,
  normalizeSkillName,
  parseSkillFile,
  parseSkillFiles,
  type ParseSkillFileInput,
} from "./parseSkill";

export {
  extractMcpServerMap,
  inferMcpTransport,
  mergeMcpServers,
  parseMcpConfig,
  type ParseMcpConfigInput,
} from "./parseMcpConfig";

export {
  composeAgentsBody,
  mergePromptLayers,
  mergeSkills,
  type ComposeAgentsBodyOptions,
} from "./merge";

export {
  isAiContextAvailable,
  readGlobalAgentsPrompt,
  writeGlobalAgentsPrompt,
  readProjectAgentsPrompt,
  writeProjectAgentsPrompt,
  listGlobalDiscoveredSkills,
  listProjectDiscoveredSkills,
  listGlobalMcpServers,
  listProjectMcpServers,
  probeGlobalMcpSource,
  probeProjectMcpSource,
  GLOBAL_MCP_PATH_LABEL,
  PROJECT_MCP_PATH_LABEL,
  normalizeSkillId,
  type ListedMcpServer,
  type McpSourceProbe,
} from "./runtime";
