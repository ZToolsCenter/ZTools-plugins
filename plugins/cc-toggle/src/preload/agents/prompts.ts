// ZTools ccToggle - prompts.ts
// 提示词管理：使用 ztools.db 存储提示词数据

const utils = require('../utils');
const configRw = require('../config/config-rw');
const fs = utils.fs;
const path = utils.path;

const DB_KEY = 'cctoggle_prompts';
const BACKUP_KEY = 'cctoggle_prompts_backup';

interface Prompt {
  id: string;
  name: string;
  description: string;
  content: string;
  fileName?: string | null; // 主目标文件名（仅 openclaw 可选）
  fileNames?: string[] | null; // 已应用的文件列表（仅 openclaw；支持多文件）
  files?: Record<string, string> | null; // 人设包模式：fileName → content
  agents: string[];
  variables: string[];
  tags: string[];
  isTemplate: boolean;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PromptSaveData {
  id?: string;
  name: string;
  description?: string;
  content?: string;
  fileName?: string | null;
  fileNames?: string[];
  files?: Record<string, string>;
  agents?: string[];
  variables?: string[];
  tags?: string[];
  isTemplate?: boolean;
  templateId?: string | null;
  createdAt?: string;
}

interface PromptImportItem {
  id?: string;
  name: string;
  description?: string;
  content: string;
  fileName?: string | null;
  fileNames?: string[];
  files?: Record<string, string>;
  agents?: string[];
  variables?: string[];
  tags?: string[];
  isTemplate?: boolean;
  templateId?: string | null;
  createdAt?: string;
}

interface ResultWithPrompt {
  success: boolean;
  prompt?: Prompt;
  error?: string;
}

interface ResultBasic {
  success: boolean;
  error?: string;
}

interface ResultWithCount {
  success: boolean;
  count?: number;
  error?: string;
}

interface BackupEntry {
  content: string;
  backedUpAt: string;
}

// 文件粒度备份：agent → fileName → BackupEntry
interface BackupsMap {
  [agent: string]: {
    [fileName: string]: BackupEntry;
  };
}

// 各 Agent 的默认提示词文件
const DEFAULT_AGENT_FILES: Record<string, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
  openclaw: 'AGENTS.md',
  opencode: 'AGENTS.md'
};

interface BackupResult {
  success: boolean;
  backups?: BackupsMap;
  error?: string;
}

interface RestoreResults {
  [agent: string]: ResultBasic;
}

interface ToggleResult {
  success: boolean;
  prompt?: Prompt;
  associated?: boolean;
  error?: string;
}

interface OriginalPrompts {
  codex: string;
  claude: string;
  openclaw: string;
  gemini: string;
  opencode: string;
}

export class PromptManager {
  // ─────────── 数据库操作 ───────────

  private static _getAll(): Prompt[] {
    try {
      const doc = ztools.db.get(DB_KEY);
      if (!doc) return [];
      return Array.isArray(doc.prompts) ? doc.prompts : [];
    } catch (e) {
      return [];
    }
  }

  private static _saveAll(prompts: Prompt[]): void {
    try {
      let existing: any = null;
      try {
        existing = ztools.db.get(DB_KEY);
      } catch (e) {}
      // 深拷贝确保是纯 JSON 对象
      const cleanPrompts: Prompt[] = JSON.parse(JSON.stringify(prompts));
      const doc: any = { _id: DB_KEY, prompts: cleanPrompts };
      if (existing && existing._rev) doc._rev = existing._rev;
      ztools.db.put(doc);
    } catch (e: any) {
      throw new Error('Failed to save to db: ' + (e.message || e));
    }
  }

  private static _generateId(): string {
    return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ─────────── CRUD ───────────

  static listPrompts(): Prompt[] {
    return PromptManager._getAll();
  }

  static getPrompt(id: string): Prompt | null {
    const prompts = PromptManager._getAll();
    for (let i = 0; i < prompts.length; i++) {
      if (prompts[i].id === id) return prompts[i];
    }
    return null;
  }

  static savePrompt(data: PromptSaveData): ResultWithPrompt {
    if (!data || !data.name) {
      return { success: false, error: 'Name is required' };
    }

    const prompts = PromptManager._getAll();
    const now = new Date().toISOString();

    const prompt: Prompt = {
      id: data.id || PromptManager._generateId(),
      name: data.name,
      description: data.description || '',
      content: data.content || '',
      fileName: data.fileName || null,
      fileNames:
        Array.isArray(data.fileNames) && data.fileNames.length ? data.fileNames.slice() : null,
      files: data.files && typeof data.files === 'object' ? data.files : null,
      agents: Array.isArray(data.agents) ? data.agents : [],
      variables: Array.isArray(data.variables) ? data.variables : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
      isTemplate: !!data.isTemplate,
      templateId: data.templateId || null,
      createdAt: data.createdAt || now,
      updatedAt: now
    };

    let found = false;
    for (let i = 0; i < prompts.length; i++) {
      if (prompts[i].id === prompt.id) {
        prompts[i] = prompt;
        found = true;
        break;
      }
    }

    if (!found) {
      prompts.push(prompt);
    }

    PromptManager._saveAll(prompts);
    return { success: true, prompt: prompt };
  }

  static deletePrompt(id: string): ResultBasic {
    const prompts = PromptManager._getAll();
    const filtered = prompts.filter(function (p) {
      return p.id !== id;
    });

    if (filtered.length === prompts.length) {
      return { success: false, error: 'Prompt not found' };
    }

    PromptManager._saveAll(filtered);
    return { success: true };
  }

  static duplicatePrompt(id: string): ResultWithPrompt {
    const prompts = PromptManager._getAll();
    let source: Prompt | null = null;

    for (let i = 0; i < prompts.length; i++) {
      if (prompts[i].id === id) {
        source = prompts[i];
        break;
      }
    }

    if (!source) {
      return { success: false, error: 'Source prompt not found' };
    }

    const now = new Date().toISOString();
    const newPrompt: Prompt = {
      id: PromptManager._generateId(),
      name: source.name + ' (副本)',
      description: source.description,
      content: source.content,
      fileName: source.fileName || null,
      fileNames: source.fileNames ? source.fileNames.slice() : null,
      files: source.files ? JSON.parse(JSON.stringify(source.files)) : null,
      agents: source.agents ? source.agents.slice() : [],
      variables: source.variables ? source.variables.slice() : [],
      tags: source.tags ? source.tags.slice() : [],
      isTemplate: false,
      templateId: source.templateId || source.id,
      createdAt: now,
      updatedAt: now
    };

    prompts.push(newPrompt);
    PromptManager._saveAll(prompts);
    return { success: true, prompt: newPrompt };
  }

  // ─────────── 导入导出 ───────────

  static exportPrompts(): string {
    const prompts = PromptManager._getAll();
    return JSON.stringify(prompts, null, 2);
  }

  static importPrompts(jsonString: string): ResultWithCount {
    try {
      const data: PromptImportItem[] = JSON.parse(jsonString);
      if (!Array.isArray(data)) {
        return { success: false, error: 'Invalid format: expected array' };
      }

      const existing = PromptManager._getAll();
      const existingIds: { [id: string]: boolean } = {};
      existing.forEach(function (p) {
        existingIds[p.id] = true;
      });

      const now = new Date().toISOString();
      let imported = 0;

      data.forEach(function (item) {
        if (!item.name || !item.content) return;

        const prompt: Prompt = {
          id: item.id && !existingIds[item.id] ? item.id : PromptManager._generateId(),
          name: item.name,
          description: item.description || '',
          content: item.content,
          fileName: item.fileName || null,
          fileNames:
            Array.isArray(item.fileNames) && item.fileNames.length ? item.fileNames.slice() : null,
          files: item.files && typeof item.files === 'object' ? item.files : null,
          agents: Array.isArray(item.agents) ? item.agents : [],
          variables: Array.isArray(item.variables) ? item.variables : [],
          tags: Array.isArray(item.tags) ? item.tags : [],
          isTemplate: !!item.isTemplate,
          templateId: item.templateId || null,
          createdAt: item.createdAt || now,
          updatedAt: now
        };

        existing.push(prompt);
        imported++;
      });

      PromptManager._saveAll(existing);
      return { success: true, count: imported };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // ─────────── 读取各 Agent 原始提示词 ───────────

  // 获取 Agent 对应的提示词文件路径
  private static _getAgentPromptPath(agent: string, fileName?: string): string | null {
    switch (agent) {
      case 'claude':
        return utils.getClaudeMdPath();
      case 'codex':
        return utils.getCodexAgentsMdPath();
      case 'gemini':
        return utils.getGeminiMdPath();
      case 'openclaw':
        return fileName ? utils.getOpenClawPromptPath(fileName) : utils.getOpenClawAgentsMdPath();
      case 'opencode':
        return utils.getOpenCodeMdPath();
      default:
        return null;
    }
  }

  // 读取指定 Agent 的提示词文件（openclaw 可按 fileName 定位）
  private static _readPromptFile(agent: string, fileName?: string): string {
    try {
      const filePath = PromptManager._getAgentPromptPath(agent, fileName);
      if (filePath && fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  // 写入提示词到指定 Agent 的文件（openclaw 可按 fileName 定位；MEMORY.md 拒绝写入）
  private static _writePromptFile(agent: string, content: string, fileName?: string): void {
    if (agent === 'openclaw' && fileName === 'MEMORY.md') {
      throw new Error('MEMORY.md is read-only');
    }
    const filePath = PromptManager._getAgentPromptPath(agent, fileName);
    if (!filePath) {
      throw new Error('Unsupported agent: ' + agent);
    }
    if (agent === 'openclaw' && !utils.getOpenClawWorkspaceDir()) {
      throw new Error('OpenClaw workspace not found');
    }
    utils.ensureDir(filePath);
    fs.writeFileSync(filePath, content, 'utf8');
  }

  static readOriginalPrompt(agent: string): string {
    return PromptManager._readPromptFile(agent);
  }

  static readAllOriginalPrompts(): OriginalPrompts {
    return {
      codex: PromptManager._readPromptFile('codex'),
      claude: PromptManager._readPromptFile('claude'),
      openclaw: PromptManager._readPromptFile('openclaw'),
      gemini: PromptManager._readPromptFile('gemini'),
      opencode: PromptManager._readPromptFile('opencode')
    };
  }

  // OpenClaw 预定义提示词文件清单（不含 MEMORY.md）
  static getOpenClawPromptFiles(): string[] {
    return utils.getOpenClawPromptFiles();
  }

  // 读取 OpenClaw 全部提示词文件（6 文件 + MEMORY.md 只读内容）
  static readOpenClawPromptFiles(): { [fileName: string]: string } {
    const result: { [fileName: string]: string } = {};
    const files = utils.getOpenClawPromptFiles();
    files.forEach(function (f) {
      result[f] = PromptManager._readPromptFile('openclaw', f);
    });
    result['MEMORY.md'] = PromptManager._readPromptFile('openclaw', 'MEMORY.md');
    return result;
  }

  // ─────────── 备份与恢复 ───────────

  // 旧格式 { content, backedUpAt } → 新格式 { 默认文件: { content, backedUpAt } }
  private static _normalizeAgentBackup(
    agent: string,
    backup: any
  ): { [fileName: string]: BackupEntry } {
    if (!backup || typeof backup !== 'object') return {};
    if (typeof backup.content === 'string') {
      const file = DEFAULT_AGENT_FILES[agent];
      if (!file) return {};
      return { [file]: { content: backup.content, backedUpAt: backup.backedUpAt || '' } };
    }
    return backup;
  }

  private static _getBackups(): BackupsMap {
    try {
      const doc = ztools.db.get(BACKUP_KEY);
      if (!doc) return {};
      const raw = doc.backups || {};
      const result: BackupsMap = {};
      Object.keys(raw).forEach(function (agent) {
        result[agent] = PromptManager._normalizeAgentBackup(agent, raw[agent]);
      });
      return result;
    } catch (e) {
      return {};
    }
  }

  private static _saveBackups(backups: BackupsMap): any {
    try {
      let existing: any = null;
      try {
        existing = ztools.db.get(BACKUP_KEY);
      } catch (e) {}
      // 深拷贝确保是纯 JSON 对象
      const cleanBackups: BackupsMap = JSON.parse(JSON.stringify(backups));
      const doc: any = { _id: BACKUP_KEY, backups: cleanBackups };
      if (existing && existing._rev) doc._rev = existing._rev;
      const result = ztools.db.put(doc);
      return result;
    } catch (e: any) {
      throw new Error('Failed to save backups: ' + (e.message || e));
    }
  }

  // 某 Agent 需要备份的文件清单（openclaw 为 6 个提示词文件，MEMORY.md 排除）
  private static _defaultBackupFiles(agent: string): string[] {
    if (agent === 'openclaw') {
      return utils.getOpenClawPromptFiles();
    }
    const file = DEFAULT_AGENT_FILES[agent];
    return file ? [file] : [];
  }

  // 备份当前各 Agent 的提示词
  static backupOriginalPrompts(): BackupResult {
    try {
      const backups = PromptManager._getBackups();
      const now = new Date().toISOString();
      const agents = ['codex', 'claude', 'openclaw', 'gemini', 'opencode'];

      agents.forEach(function (agent) {
        backups[agent] = {};
        PromptManager._defaultBackupFiles(agent).forEach(function (f) {
          backups[agent][f] = { content: PromptManager._readPromptFile(agent, f), backedUpAt: now };
        });
      });

      PromptManager._saveBackups(backups);
      return { success: true, backups: backups };
    } catch (e: any) {
      return { success: false, error: e.message || 'Backup failed' };
    }
  }

  // 备份指定 Agent 的提示词（支持按文件粒度，openclaw 默认全选 6 个提示词文件）
  static backupSelectedPrompts(selections: { agent: string; files?: string[] }[]): BackupResult {
    if (!Array.isArray(selections) || selections.length === 0) {
      return { success: false, error: 'No agents selected' };
    }
    try {
      const backups = PromptManager._getBackups();
      const now = new Date().toISOString();

      selections.forEach(function (sel) {
        const agent = sel.agent;
        const files =
          Array.isArray(sel.files) && sel.files.length > 0
            ? sel.files
            : PromptManager._defaultBackupFiles(agent);
        if (!backups[agent]) backups[agent] = {};
        files.forEach(function (f) {
          if (agent === 'openclaw' && f === 'MEMORY.md') return;
          backups[agent][f] = { content: PromptManager._readPromptFile(agent, f), backedUpAt: now };
        });
      });

      PromptManager._saveBackups(backups);
      return { success: true, backups: backups };
    } catch (e: any) {
      return { success: false, error: e.message || 'Backup failed' };
    }
  }

  // 获取备份
  static getBackups(): BackupsMap {
    return PromptManager._getBackups();
  }

  // 恢复指定 Agent 的原始提示词（可指定 fileName；不指定则恢复全部备份文件）
  static restoreOriginalPrompt(agent: string, fileName?: string): ResultBasic {
    const backups = PromptManager._getBackups();
    const agentBackups = backups[agent];

    if (!agentBackups) {
      return { success: false, error: 'No backup found for ' + agent };
    }

    try {
      if (fileName) {
        const entry = agentBackups[fileName];
        if (!entry || !entry.backedUpAt) {
          return { success: false, error: 'No backup found for ' + agent + '/' + fileName };
        }
        PromptManager._writePromptFile(agent, entry.content || '', fileName);
      } else {
        PromptManager._defaultBackupFiles(agent).forEach(function (f) {
          const entry = agentBackups[f];
          if (entry && entry.backedUpAt) {
            PromptManager._writePromptFile(agent, entry.content || '', f);
          }
        });
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // 恢复所有 Agent 的原始提示词
  static restoreAllOriginalPrompts(): RestoreResults {
    const results: RestoreResults = {};
    ['codex', 'claude', 'openclaw', 'gemini', 'opencode'].forEach(function (agent) {
      results[agent] = PromptManager.restoreOriginalPrompt(agent);
    });
    return results;
  }

  // ─────────── 应用提示词到 Agent ───────────

  // 获取提示词当前已应用的文件列表（openclaw）
  private static _getAppliedFiles(prompt: Prompt): string[] {
    if (prompt.fileNames && prompt.fileNames.length) return prompt.fileNames;
    if (prompt.fileName) return [prompt.fileName];
    return [];
  }

  // 应用提示词到指定 Agent，并自动取消其他提示词对该 Agent 的关联
  // openclaw 支持多文件：fileName 可为 string 或 string[]（空数组=未指定）
  // 未指定文件且为人设包 → 整套写入；否则默认写 AGENTS.md
  static applyPromptToAgent(
    promptId: string,
    agent: string,
    fileName?: string | string[]
  ): ResultWithPrompt {
    const prompts = PromptManager._getAll();
    let targetPrompt: Prompt | null = null;

    // 找到目标提示词
    for (let i = 0; i < prompts.length; i++) {
      if (prompts[i].id === promptId) {
        targetPrompt = prompts[i];
        break;
      }
    }

    if (!targetPrompt) {
      return { success: false, error: 'Prompt not found' };
    }

    // 自动取消其他提示词对该 Agent 的关联
    prompts.forEach(function (p) {
      if (p.id !== promptId && Array.isArray(p.agents)) {
        const idx = p.agents.indexOf(agent);
        if (idx !== -1) {
          p.agents.splice(idx, 1);
        }
      }
    });

    // 确保目标提示词关联了该 Agent
    if (!Array.isArray(targetPrompt.agents)) {
      targetPrompt.agents = [];
    }
    if (targetPrompt.agents.indexOf(agent) === -1) {
      targetPrompt.agents.push(agent);
    }

    // 解析要应用的文件（去重、去 MEMORY.md）
    const requestedFiles: string[] = [];
    if (Array.isArray(fileName)) {
      fileName.forEach(function (f) {
        if (f && f !== 'MEMORY.md' && requestedFiles.indexOf(f) === -1) requestedFiles.push(f);
      });
    } else if (fileName && fileName !== 'MEMORY.md') {
      requestedFiles.push(fileName);
    }

    // 将提示词内容写入对应的 md 文件
    try {
      if (agent === 'openclaw' && targetPrompt.files && requestedFiles.length === 0) {
        // 人设包模式：未指定具体文件时，一次写入全部文件（files 里没列的不动，MEMORY.md 自动拒绝）
        const promptFiles = utils.getOpenClawPromptFiles();
        promptFiles.forEach(function (f) {
          const content = targetPrompt.files[f];
          if (typeof content === 'string') {
            PromptManager._writePromptFile('openclaw', content, f);
          }
        });
        targetPrompt.fileName = null;
        targetPrompt.fileNames = promptFiles;
      } else if (agent === 'openclaw') {
        // 单文件/多文件模式：无明确文件时默认 AGENTS.md（或沿用已应用列表）
        const applyFiles = requestedFiles.length
          ? requestedFiles
          : PromptManager._getAppliedFiles(targetPrompt).length
            ? PromptManager._getAppliedFiles(targetPrompt)
            : ['AGENTS.md'];
        applyFiles.forEach(function (f) {
          const packContent =
            targetPrompt.files && typeof targetPrompt.files[f] === 'string'
              ? targetPrompt.files[f]
              : null;
          PromptManager._writePromptFile(
            'openclaw',
            packContent != null ? packContent : targetPrompt.content,
            f
          );
        });
        targetPrompt.fileNames = applyFiles.slice();
        targetPrompt.fileName = applyFiles[0] || null;
      } else {
        PromptManager._writePromptFile(agent, targetPrompt.content);
      }
    } catch (e: any) {
      return { success: false, error: 'Failed to write prompt file: ' + e.message };
    }

    // 保存更新后的提示词
    PromptManager._saveAll(prompts);

    return { success: true, prompt: targetPrompt };
  }

  // 切换提示词对 Agent 的关联，取消关联时按文件精确比对还原备份（支持多文件）
  static togglePromptAgent(
    promptId: string,
    agent: string,
    fileName?: string | string[]
  ): ToggleResult {
    const prompts = PromptManager._getAll();
    let targetPrompt: Prompt | null = null;

    for (let i = 0; i < prompts.length; i++) {
      if (prompts[i].id === promptId) {
        targetPrompt = prompts[i];
        break;
      }
    }

    if (!targetPrompt) {
      return { success: false, error: 'Prompt not found' };
    }

    if (!Array.isArray(targetPrompt.agents)) {
      targetPrompt.agents = [];
    }

    const idx = targetPrompt.agents.indexOf(agent);
    if (idx === -1) {
      // 关联：由前端调用 applyPromptToAgent 处理文件写入
      targetPrompt.agents.push(agent);
    } else {
      // 取消关联：清理 Agent 配置文件中的提示词内容
      targetPrompt.agents.splice(idx, 1);
      try {
        const backups = PromptManager._getBackups();
        const agentBackups = backups[agent] || {};

        if (agent === 'openclaw') {
          // 确定要检查的文件：显式传入 > 提示词已应用列表 > 默认 AGENTS.md
          let filesToCheck: string[] = [];
          if (Array.isArray(fileName)) {
            fileName.forEach(function (f) {
              if (f && filesToCheck.indexOf(f) === -1) filesToCheck.push(f);
            });
          } else if (fileName) {
            filesToCheck.push(fileName);
          }
          if (!filesToCheck.length) {
            const applied = PromptManager._getAppliedFiles(targetPrompt);
            filesToCheck = applied.length ? applied : ['AGENTS.md'];
          }
          filesToCheck.forEach(function (f) {
            if (f === 'MEMORY.md') return;
            const current = PromptManager._readPromptFile('openclaw', f);
            const expected =
              targetPrompt.files && typeof targetPrompt.files[f] === 'string'
                ? targetPrompt.files[f]
                : targetPrompt.content;
            if (current === expected) {
              const entry = agentBackups[f];
              if (entry && entry.content)
                PromptManager._writePromptFile('openclaw', entry.content, f);
              else PromptManager._writePromptFile('openclaw', '', f);
            }
          });
        } else {
          const currentContent = PromptManager._readPromptFile(agent);
          if (currentContent === targetPrompt.content) {
            const entry = agentBackups[DEFAULT_AGENT_FILES[agent]];
            if (entry && entry.content) {
              PromptManager._writePromptFile(agent, entry.content);
            } else {
              PromptManager._writePromptFile(agent, '');
            }
          }
        }
      } catch (e) {
        // 文件清理失败不阻断数据库更新
      }
    }

    PromptManager._saveAll(prompts);
    return { success: true, prompt: targetPrompt, associated: idx === -1 };
  }
}
