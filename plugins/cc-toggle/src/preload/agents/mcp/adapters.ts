// ZTools ccToggle - mcp/adapters.ts
// 各 agent 的 MCP 配置适配器：封装路径与读写格式差异

// eslint-disable-next-line @typescript-eslint/no-var-requires
const utils = require('../../utils');

const fs = utils.fs;
const path = utils.path;
const getHomeDir = utils.getHomeDir;
const ensureDir = utils.ensureDir;

import { AgentMcpAdapter, ConfigEntry } from './types';

// ─────────── 通用工具 ───────────

function readJsonConfig(filePath: string): Record<string, ConfigEntry> {
  try {
    if (fs.existsSync(filePath)) {
      const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return config.mcpServers || {};
    }
  } catch (e) {}
  return {};
}

function writeJsonMcpServer(filePath: string, name: string, entryOrNull: ConfigEntry | null): void {
  let config: any = {};
  try {
    if (fs.existsSync(filePath)) config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    config = {};
  }
  if (!config.mcpServers) config.mcpServers = {};

  if (entryOrNull === null) {
    delete config.mcpServers[name];
  } else {
    config.mcpServers[name] = entryOrNull;
  }

  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export function slugify(name: string): string {
  return (
    (name || 'mcp')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'mcp'
  );
}

// slug 感知的配置条目查找：先精确匹配，再尝试按 codex 式 slug 匹配
export function findEntryIn(
  configServers: Record<string, ConfigEntry> | undefined,
  name: string
): ConfigEntry | null {
  if (!configServers) return null
  if (configServers[name]) return configServers[name]
  const slug = slugify(name)
  if (slug !== name && configServers[slug]) return configServers[slug]
  return null
}

export function hasServer(
  configServers: Record<string, ConfigEntry> | undefined,
  name: string
): boolean {
  return findEntryIn(configServers, name) !== null
}

function removeTomlSection(text: string, tableNameRegex: string): string {
  if (!text || !text.trim()) return '';
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  let inTarget = false;
  const regex = new RegExp('^\\s*\\[\\[?\\s*(' + tableNameRegex + '(?:\\..*)?)\\s*\\]\\]?\\s*$');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tableMatch = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (tableMatch) {
      if (regex.test(line)) {
        inTarget = true;
        continue;
      } else {
        inTarget = false;
      }
    }
    if (!inTarget) result.push(line);
  }
  return result.join('\n');
}

// ─────────── Claude（写时同步 Claude Desktop）───────────

export class ClaudeMcpAdapter implements AgentMcpAdapter {
  id = 'claude';
  label = 'Claude';

  getConfigPath(): string {
    const configured = utils.getAgentConfigPath('claude');
    if (configured) return path.join(configured, '.claude.json');
    return path.join(getHomeDir(), '.claude.json');
  }

  readServers(): Record<string, ConfigEntry> {
    return readJsonConfig(this.getConfigPath());
  }

  writeServer(name: string, entryOrNull: ConfigEntry | null): void {
    writeJsonMcpServer(this.getConfigPath(), name, entryOrNull);
    writeJsonMcpServer(utils.getClaudeDesktopConfigPath(), name, entryOrNull);
  }
}

// ─────────── Claude Desktop ───────────

export class ClaudeDesktopMcpAdapter implements AgentMcpAdapter {
  id = 'claude-desktop';
  label = 'Claude Desktop';

  getConfigPath(): string {
    return utils.getClaudeDesktopConfigPath();
  }

  readServers(): Record<string, ConfigEntry> {
    return readJsonConfig(this.getConfigPath());
  }

  writeServer(name: string, entryOrNull: ConfigEntry | null): void {
    writeJsonMcpServer(this.getConfigPath(), name, entryOrNull);
  }
}

// ─────────── Codex（config.toml）───────────

export class CodexMcpAdapter implements AgentMcpAdapter {
  id = 'codex';
  label = 'Codex';

  getConfigPath(): string {
    const configured = utils.getAgentConfigPath('codex');
    if (configured) return path.join(configured, 'config.toml');
    return path.join(getHomeDir(), '.codex', 'config.toml');
  }

  readServers(): Record<string, ConfigEntry> {
    const configPath = this.getConfigPath();
    let content = '';
    try {
      if (fs.existsSync(configPath)) content = fs.readFileSync(configPath, 'utf8');
    } catch (e) {
      return {};
    }

    const servers: Record<string, ConfigEntry> = {};
    let currentSlug: string | null = null;
    let currentEntry: ConfigEntry = {};

    content.split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*\[\s*mcp_servers\.([^\]]+?)\s*\]\s*$/);
      if (m) {
        const slug = m[1].trim();
        // 跳过子节（如 mcp_servers.xxx.env）和非 MCP 的沙箱配置
        if (slug.indexOf('.') !== -1 || slug === 'node_repl') {
          currentSlug = null;
          currentEntry = {};
          return;
        }
        if (currentSlug) servers[currentSlug] = currentEntry;
        currentSlug = slug;
        currentEntry = {};
        return;
      }
      if (currentSlug) {
        const kv = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
        if (kv) {
          const key = kv[1];
          const val = kv[2].trim();
          if (key === 'command') {
            currentEntry.command = val.replace(/^["']|["']$/g, '');
          } else if (key === 'args') {
            const arrMatch = val.match(/^\[(.*)\]$/);
            if (arrMatch) {
              currentEntry.args = arrMatch[1]
                .split(',')
                .map(function (s) {
                  return s.trim().replace(/^["']|["']$/g, '');
                })
                .filter(Boolean);
            }
          } else if (key === 'url') {
            currentEntry.url = val.replace(/^["']|["']$/g, '');
          }
        }
      }
    });
    if (currentSlug) servers[currentSlug] = currentEntry;
    return servers;
  }

  writeServer(name: string, entryOrNull: ConfigEntry | null): void {
    const configPath = this.getConfigPath();
    const slug = slugify(name);
    let existing = '';
    try {
      if (fs.existsSync(configPath)) existing = fs.readFileSync(configPath, 'utf8');
    } catch (e) {
      existing = '';
    }

    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleaned = removeTomlSection(existing, 'mcp_servers\\.' + escaped);

    if (entryOrNull) {
      const lines: string[] = ['[mcp_servers.' + slug + ']'];
      if (entryOrNull.command) lines.push('command = "' + entryOrNull.command + '"');
      if (entryOrNull.args && entryOrNull.args.length) {
        lines.push(
          'args = [' +
            entryOrNull.args
              .map(function (a) {
                return '"' + a + '"';
              })
              .join(', ') +
            ']'
        );
      }
      if (entryOrNull.url) lines.push('url = "' + entryOrNull.url + '"');
      if (entryOrNull.headers && Object.keys(entryOrNull.headers).length) {
        lines.push('[mcp_servers.' + slug + '.headers]');
        Object.keys(entryOrNull.headers).forEach(function (k) {
          lines.push('  "' + k + '" = "' + entryOrNull.headers![k] + '"');
        });
      }
      if (entryOrNull.env && Object.keys(entryOrNull.env).length) {
        lines.push('[mcp_servers.' + slug + '.env]');
        Object.keys(entryOrNull.env).forEach(function (k) {
          lines.push('  "' + k + '" = "' + entryOrNull.env![k] + '"');
        });
      }
      let content = cleaned.trim();
      if (content) content += '\n\n';
      content += lines.join('\n') + '\n';
      ensureDir(configPath);
      fs.writeFileSync(configPath, content, 'utf8');
    } else {
      ensureDir(configPath);
      fs.writeFileSync(configPath, cleaned, 'utf8');
    }
  }
}

// ─────────── OpenClaw ───────────

export class OpenClawMcpAdapter implements AgentMcpAdapter {
  id = 'openclaw';
  label = 'OpenClaw';

  getConfigPath(): string {
    const configured = utils.getAgentConfigPath('openclaw');
    if (configured) return path.join(configured, 'openclaw.json');
    return path.join(getHomeDir(), '.openclaw', 'openclaw.json');
  }

  readServers(): Record<string, ConfigEntry> {
    return readJsonConfig(this.getConfigPath());
  }

  writeServer(name: string, entryOrNull: ConfigEntry | null): void {
    writeJsonMcpServer(this.getConfigPath(), name, entryOrNull);
  }
}

// ─────────── OpenCode（mcp 字段，本地 command/远程 url）───────────

export class OpenCodeMcpAdapter implements AgentMcpAdapter {
  id = 'opencode';
  label = 'OpenCode';

  getConfigPath(): string {
    return utils.getOpenCodeConfigPath();
  }

  readServers(): Record<string, ConfigEntry> {
    const configPath = this.getConfigPath();
    let raw: any = {};
    try {
      if (fs.existsSync(configPath)) raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      raw = {};
    }
    const mcp = raw && raw.mcp && typeof raw.mcp === 'object' ? raw.mcp : {};
    const servers: Record<string, ConfigEntry> = {};
    Object.keys(mcp).forEach(function (name) {
      const s = mcp[name];
      if (!s || typeof s !== 'object') return;
      if (s.url) {
        servers[name] = { url: s.url, headers: s.headers || {} };
      } else if (s.command) {
        const cmd = Array.isArray(s.command) ? s.command : [s.command];
        servers[name] = {
          command: cmd[0] || '',
          args: cmd.slice(1),
          env: s.environment || {}
        };
      }
    });
    return servers;
  }

  writeServer(name: string, entryOrNull: ConfigEntry | null): void {
    const configPath = this.getConfigPath();
    let raw: any = {};
    try {
      if (fs.existsSync(configPath)) raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      raw = {};
    }
    if (typeof raw !== 'object' || raw === null) raw = {};
    if (!raw.mcp || typeof raw.mcp !== 'object') raw.mcp = {};

    if (entryOrNull === null) {
      delete raw.mcp[name];
    } else if (entryOrNull.command) {
      raw.mcp[name] = {
        type: 'local',
        command: [entryOrNull.command].concat(entryOrNull.args || []),
        environment: entryOrNull.env || {},
        enabled: true
      };
    } else {
      raw.mcp[name] = {
        type: 'remote',
        url: entryOrNull.url || '',
        headers: entryOrNull.headers || {},
        enabled: true
      };
    }

    ensureDir(configPath);
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
  }
}

// ─────────── 注册表 ───────────

export const MCP_ADAPTERS: Record<string, AgentMcpAdapter> = {
  claude: new ClaudeMcpAdapter(),
  'claude-desktop': new ClaudeDesktopMcpAdapter(),
  codex: new CodexMcpAdapter(),
  openclaw: new OpenClawMcpAdapter(),
  opencode: new OpenCodeMcpAdapter()
};

export const ALL_APPS: string[] = Object.keys(MCP_ADAPTERS);

export function getAdapter(app: string): AgentMcpAdapter | null {
  return MCP_ADAPTERS[app] || null;
}
