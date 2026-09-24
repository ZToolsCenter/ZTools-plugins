// ZTools CCToggle 类型定义
// 为 window.ztoolsCctoggle preload API 提供完整类型覆盖

// ——————————— 通用 ———————————

export interface SuccessResult {
  success: boolean;
  error?: string;
}

export interface IdResult {
  success: true;
  id: string;
}

// ——————————— 供应商 ———————————

export type AppType = 'codex' | 'claude' | 'claude-desktop' | 'openclaw' | 'gemini' | 'opencode';

export interface Provider {
  id: string;
  appType?: AppType;
  name: string;
  baseUrl: string;
  apiKey?: string;
  encryptedApiKey?: string;
  model: string;
  models: string[];
  websiteUrl: string;
  remark: string;
  icon: string;
  iconColor: string;
  category: string;
  configType: string;
  authType?: string;
  authField?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  apiKeyUrl?: string;
  apiFormat?: string;
  wireApi?: string;
  apiProtocol?: string;
  authMethod?: string;
  authData?: Record<string, string>;
  extraConfig?: string;
  extraHeaders?: string;
  headersOverride?: string;
  bodyOverride?: string;
  customUserAgent?: string;
  settingsConfig?: Record<string, any>;
  reasoningEffort?: string;
  maxTokens?: string | number;
  temperature?: string | number;
  modelCatalog?: ModelCatalogEntry[];
  endpointCandidates?: string[];
  impersonateClaudeCode?: boolean;
  suggestedDefaults?: Record<string, any> | null;
  isCurrent: boolean;
  sortOrder: number;
  createdAt: string;
  balance?: ProviderBalanceConfig | null;
}

export interface ModelCatalogEntry {
  slug?: string;
  model?: string;
  display_name?: string;
  displayName?: string;
  description?: string;
  context_window?: number;
  contextWindow?: number;
  max_context_window?: number;
  [key: string]: any;
}

// ——————————— 余额查询 ———————————

export interface ProviderBalanceConfig {
  enabled: boolean;
  path: string;
  balancePath: string;
  usedPath?: string;
  balanceTransform?: string;
  currency?: 'AUTO' | 'USD' | 'CNY';
  lowThreshold?: number;
  autoRefresh?: boolean;
  refreshIntervalSec?: number;
  timeoutMs?: number;
}

export interface BalanceResult {
  success: boolean;
  balance?: number;
  used?: number;
  currency?: string;
  queriedAt: number;
  error?: string;
}

export interface BalanceCacheEntry {
  providerId: string;
  appType: string;
  result: BalanceResult;
  queriedAt: number;
}

export interface BalanceNotifyEntry {
  balance: number;
  at: number;
}

// ——————————— 桌面小组件 ———————————

export interface WidgetInfo {
  id: string;
  title: string;
}

export interface WidgetWindowState {
  open: boolean;
}

export interface ExportData {
  codex: Provider[];
  claude: Provider[];
  gemini: Provider[];
  exportTime: string;
}

// ——————————— 项目配置方案 ———————————

export interface ProjectProfile {
  id: string;
  name: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  providers: Record<string, Record<string, Provider>>; // appType → providerId → Provider
  lastActiveApp?: string;
  balanceNotify?: Record<string, BalanceNotifyEntry>; // `${appType}_${providerId}` → 低余额告警标记
}

// ——————————— Skill ———————————

export interface NestSkill {
  name: string;
  path: string;
  hasSkillMd: boolean;
  repo: string;
  version: string;
  installedAt: string;
}

export interface SkillInDir {
  name: string;
  path: string;
  hasSkillMd: true;
}

export interface SearchSkill {
  name: string;
  repo: string;
  path: string;
  desc: string;
  installs: number;
}

export interface SkillRepo {
  url: string;
  branch: string;
  addedAt: string;
}

export interface ProjectTarget {
  id: string;
  path: string;
  label: string;
  addedAt: string;
}

export interface DeployEntry {
  target: string;
  mode: string;
  deployedAt: string;
}

export interface DeployResult {
  success: boolean;
  mode?: string;
  action?: string;
  error?: string;
}

export interface SyncResult {
  success: boolean;
  results?: Array<{ skill: string; target: string; result: DeployResult }>;
  error?: string;
}

export interface SkillListResult {
  nest: NestSkill[];
  [app: string]: SkillInDir[] | NestSkill[];
}

export interface SkillInstallResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface SkillDirs {
  [app: string]: string;
}

// ——————————— 代理路由 ———————————

export interface RouteGroupMember {
  providerId: string;
  weight: number;
  priority: number;
}

export interface RouteGroupHealth {
  intervalMs: number;
  timeoutMs: number;
  path: string;
}

export interface RouteGroupBreaker {
  failThreshold: number;
  cooldownMs: number;
  halfOpenProbe: number;
}

export interface RouteGroup {
  id: string;
  appType: string;
  name: string;
  listenPort: number;
  strategy: string;
  members: RouteGroupMember[];
  health: RouteGroupHealth;
  breaker: RouteGroupBreaker;
  timeoutMs: number;
  authToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyMemberStatus {
  id: string;
  name: string;
  state: string;
  fails: number;
  openUntil: number;
  latency: number;
  up: boolean;
}

export interface ProxyStatusRunning {
  running: true;
  port: number;
  groupId: string | null;
  startedAt: number;
  activeConn: number;
  reqTotal: number;
  reqSuccess: number;
  reqFail: number;
  lastMemberId: string | null;
  members: ProxyMemberStatus[];
}

export interface ProxyStatusStopped {
  running: false;
}

export type ProxyStatus = ProxyStatusRunning | ProxyStatusStopped;

export interface ProxyToggleResult {
  success: boolean;
  running?: boolean;
  port?: number;
  groupId?: string;
  baseUrl?: string;
  error?: string;
}

// ——————————— MCP 服务器 ———————————

export interface McpServerStdio {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpServerHttp {
  url: string;
  headers: Record<string, string>;
  authType?: string;
  apiKey?: string;
}

export interface McpServer {
  id: string;
  name: string;
  type: 'stdio' | 'streamable-http';
  enabled: boolean;
  stdio: McpServerStdio | null;
  sse: McpServerHttp | null;
  http: McpServerHttp | null;
  apps: string[];
}

export interface McpServerInput {
  name: string;
  apps: string[];
  stdio?: Partial<McpServerStdio>;
  sse?: Partial<McpServerHttp>;
  http?: Partial<McpServerHttp>;
}

// ——————————— 会话 ———————————

export interface SessionMeta {
  id: string;
  app: string;
  sessionId: string;
  title: string;
  projectPath: string;
  messageCount: number;
  tokenUsage: number;
  model: string;
  createdAt: string;
  updatedAt: string;
  filePath: string;
}

export interface SessionContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;
  input?: any;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  contentBlocks: SessionContentBlock[];
  timestamp: string;
}

export interface ScanSessionsOpts {
  offset?: number;
  limit?: number;
  search?: string;
  sort?: string;
}

export interface ScanSessionsResult {
  sessions: SessionMeta[];
  total: number;
  error?: string;
}

export interface ClearSessionsResult {
  success: boolean;
  count: number;
  errors: string[];
}

// ——————————— 提示词 ———————————

export interface Prompt {
  id: string;
  name: string;
  description: string;
  content: string;
  fileName?: string | null;
  fileNames?: string[] | null;
  files?: Record<string, string> | null;
  agents: string[];
  variables: string[];
  tags: string[];
  isTemplate: boolean;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptBackup {
  content: string;
  backedUpAt: string;
}

// 文件粒度备份：agent → fileName → PromptBackup
export type BackupMap = Record<string, Record<string, PromptBackup>>;

export interface PromptBackupSelection {
  agent: string;
  files?: string[];
}

export interface PromptSaveResult {
  success: boolean;
  prompt?: Prompt;
  error?: string;
}

export interface PromptToggleResult {
  success: boolean;
  prompt?: Prompt;
  associated?: boolean;
  error?: string;
}

export interface ImportPromptsResult {
  success: boolean;
  count?: number;
  error?: string;
}

// ——————————— 用量统计 ———————————

export interface UsageBucket {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  total: number;
}

export interface DailyUsage {
  appType: string;
  day: string;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  total: number;
  models: Record<string, UsageBucket>;
}

export interface ScanUsageResult {
  daily: DailyUsage[];
  error?: string;
}

// ——————————— Agent 路径配置 ———————————

export interface ConfigPaths {
  [app: string]: string;
}

// ——————————— 完整 API 接口 ———————————

export interface ZtoolsCctoggle {
  // 路径
  paths: {
    home: string;
    codexAuth: string;
    codexConfig: string;
    claudeSettings: string;
    claudeDesktopConfig: string;
    openclawConfig: string;
    geminiEnv: string;
    opencodeConfig: string;
  };

  // Agent 路径管理
  getConfigPaths(): ConfigPaths;
  setConfigPaths(paths: ConfigPaths): void;
  getDefaultConfigDirs(): SkillDirs;

  // 配置读取
  getCurrentConfigs(): {
    codex: { auth: Record<string, string>; config: string };
    claude: Record<string, any>;
    openclaw: Record<string, any>;
    gemini: string;
    opencode: Record<string, any>;
  };
  readCodexConfig(): { auth: Record<string, string>; config: string };
  readClaudeSettings(): Record<string, any>;
  readGeminiEnv(): string;
  readOpenClawConfig(): Record<string, any>;
  readOpenCodeConfig(): Record<string, any>;
  readClaudeDesktopConfig(): Record<string, any>;
  readClaudeOnboarding(): boolean;
  setClaudeOnboarding(skip: boolean): void;

  // 供应商 CRUD
  listProviders(appType: AppType): Provider[];
  getProvider(appType: AppType, providerId: string): Provider | null;
  saveProvider(appType: AppType, providerData: Partial<Provider>): { id: string; changed: boolean };
  deleteProvider(appType: AppType, providerId: string): void;
  sortProviders(appType: AppType, orderedIds: string[]): boolean;

  // 供应商切换
  switchProvider(appType: AppType, providerId: string): SuccessResult & { providerName?: string };
  getCurrentProviderId(appType: AppType): string | null;
  reapplyCurrent(onlyAppType?: AppType): Record<string, SuccessResult>;
  setLastActiveApp(appType: AppType): boolean;
  getLastActiveApp(): string;

  // 统计
  clearStats(appType?: string): SuccessResult;
  scanUsageLogs(): Promise<ScanUsageResult>;

  // 导入导出
  exportAll(): ExportData;
  importAll(data: ExportData): number;

  // Skill 管理
  getDefaultSkillDirs(): SkillDirs;
  getSkillStoragePaths(): SkillDirs;
  setSkillStoragePaths(paths: SkillDirs): void;
  listAllSkills(): SkillListResult;
  listSkillsInDir(dir: string): SkillInDir[];
  getSkillRepos(): SkillRepo[];
  addSkillRepo(repoUrl: string, branch?: string): SuccessResult;
  removeSkillRepo(repoUrl: string): SuccessResult;
  syncSkills(sourceApp: string, targetApps: string[]): SyncResult;
  toggleSkillToAgent(skillName: string, sourceApp: string, targetApp: string): DeployResult;
  searchSkills(query: string, source?: 'skillsh' | 'modelscope'): Promise<SearchSkill[]>;
  installSkill(name: string, repo?: string, subPath?: string, branch?: string): SkillInstallResult;
  removeNestSkill(skillName: string): SuccessResult;

  // SkillNest
  getNestDir(): string;
  setNestDir(dir: string | null): SuccessResult;
  listNestSkills(): NestSkill[];
  getNestSkillMeta(skillName: string): Record<string, any>;
  deploySkill(skillName: string, target: string): DeployResult;
  undeploySkill(skillName: string, target: string): DeployResult;
  getDeployRegistry(): Record<string, DeployEntry[]>;
  listDeployments(): Record<string, DeployEntry[]>;

  // 项目目标
  listProjectTargets(): ProjectTarget[];
  addProjectTarget(pathStr: string, label?: string): IdResult | SuccessResult;
  removeProjectTarget(id: string): SuccessResult;

  // 工具
  generateId(): string;
  getSyncMode(): string;
  setSyncMode(mode: string): void;

  // 代理路由
  listRouteGroups(appType: string): RouteGroup[];
  getRouteGroup(appType: string, id: string): RouteGroup | null;
  saveRouteGroup(group: Partial<RouteGroup>): string;
  deleteRouteGroup(appType: string, id: string): boolean;
  startProxy(appType: string, groupId: string): SuccessResult;
  stopProxy(appType: string): SuccessResult;
  getProxyStatus(appType: string): ProxyStatus;
  onProxyEvent(cb: (channel: string, data: any) => void): void;
  takeoverApp(appType: string, listenPort?: number): ProxyToggleResult;
  restoreApp(appType: string): SuccessResult;
  toggleProxyQuick(appType: string): ProxyToggleResult;
  getProxyPort(appType: string): number;
  setProxyPort(appType: string, port: number): SuccessResult & { port?: number };

  // MCP 服务器
  listMcpServers(): McpServer[];
  getMcpServer(name: string): McpServer;
  saveMcpServer(data: McpServerInput): string;
  deleteMcpServer(name: string): void;
  toggleMcpServer(name: string): boolean;
  syncFromConfigFiles(): void;

  // 会话管理
  scanSessions(app?: string, opts?: ScanSessionsOpts): ScanSessionsResult;
  loadSessionDetail(filePath: string): Promise<SessionMessage[] | null>;
  deleteSession(filePath: string): SuccessResult;
  clearAllSessions(filePaths: string[]): ClearSessionsResult;
  clearSessionCache(): void;

  // 提示词管理
  listPrompts(): Prompt[];
  getPrompt(id: string): Prompt | null;
  savePrompt(data: Partial<Prompt> & { name: string }): PromptSaveResult;
  deletePrompt(id: string): SuccessResult;
  duplicatePrompt(id: string): PromptSaveResult;
  exportPrompts(): string;
  importPrompts(jsonString: string): ImportPromptsResult;
  readOriginalPrompt(agent: string): string;
  readAllOriginalPrompts(): Record<string, string>;
  getOpenClawPromptFiles(): string[];
  readOpenClawPromptFiles(): Record<string, string>;
  backupOriginalPrompts(): { success: boolean; backups?: BackupMap; error?: string };
  backupSelectedPrompts(selections: PromptBackupSelection[]): {
    success: boolean;
    backups?: BackupMap;
    error?: string;
  };
  getBackups(): BackupMap;
  restoreOriginalPrompt(agent: string, fileName?: string): SuccessResult;
  restoreAllOriginalPrompts(): Record<string, SuccessResult>;
  applyPromptToAgent(
    promptId: string,
    agent: string,
    fileName?: string | string[]
  ): PromptSaveResult;
  togglePromptAgent(
    promptId: string,
    agent: string,
    fileName?: string | string[]
  ): PromptToggleResult;

  // 项目配置方案
  listProfiles(): ProjectProfile[];
  getProfile(id: string): ProjectProfile | null;
  saveProfile(data: Partial<ProjectProfile>): string;
  deleteProfile(id: string): void;
  activateProfile(id: string): SuccessResult;
  deactivateProfile(): void;
  getActiveProfileId(): string | null;

  // 余额查询
  getBalanceCache(): Record<string, BalanceCacheEntry>;
  clearBalanceCache(providerId: string): void;
  queryBalance(appType: string, providerId: string): Promise<BalanceResult>;
  queryAllBalances(appType?: string): Promise<Record<string, BalanceResult>>;

  // 余额告警状态（持久化在项目文档 balanceNotify 字段，跨页面会话去重）
  getBalanceNotifyState(profileId: string): Record<string, BalanceNotifyEntry>;
  setBalanceNotified(profileId: string, scopeKey: string, balance: number): void;
  clearBalanceNotified(profileId: string, scopeKey: string): void;

  // 桌面小组件
  openWidget(id: string): SuccessResult;
  closeWidget(id: string): SuccessResult;
  toggleWidget(id: string): SuccessResult;
  getWidgetStates(): Record<string, WidgetWindowState>;
  listWidgets(): WidgetInfo[];

  // 文件保存
  saveTextFile(
    defaultName: string,
    content: string,
    filters?: Array<{ name: string; extensions: string[] }>
  ): { success: boolean; canceled?: boolean; path?: string; error?: string };
}
