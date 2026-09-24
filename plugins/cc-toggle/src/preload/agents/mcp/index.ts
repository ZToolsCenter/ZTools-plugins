// ZTools ccToggle - mcp/index.ts
// MCP Server 配置管理：配置文件为源 + db 仅存 apps 映射
// 纯编排：读写差异在各 agent 适配器（./adapters）中

import { DataMigration } from '../../core/cleanup';
import { ALL_APPS, findEntryIn, getAdapter, hasServer, slugify } from './adapters';
import {
  AppMapping,
  ConfigEntry,
  ConfigsMap,
  McpServer,
  McpServerData,
  TransportFields
} from './types';

const APPS_KEY = 'cctoggle_mcp_apps';
const TEMPLATES_KEY = 'cctoggle_mcp_templates';

export class McpManager {
  // ─────────── db apps 映射读写 ───────────

  private static _emptyMapping(): AppMapping {
    const m: AppMapping = { disabled: [] };
    ALL_APPS.forEach(function (a) {
      m[a] = [];
    });
    return m;
  }

  private static _getMapping(): AppMapping {
    try {
      const doc = ztools.db.get(APPS_KEY);
      if (!doc) return McpManager._emptyMapping();
      const m: AppMapping = { disabled: Array.isArray(doc.disabled) ? doc.disabled : [] };
      ALL_APPS.forEach(function (a) {
        m[a] = Array.isArray(doc[a]) ? doc[a] : [];
      });
      return m;
    } catch (e) {
      return McpManager._emptyMapping();
    }
  }

  private static _putMapping(mapping: AppMapping): void {
    let existing: any = null;
    try {
      existing = ztools.db.get(APPS_KEY);
    } catch (e) {}
    const doc: any = { _id: APPS_KEY, disabled: mapping.disabled || [] };
    ALL_APPS.forEach(function (a) {
      doc[a] = mapping[a] || [];
    });
    if (existing && existing._rev) doc._rev = existing._rev;
    ztools.db.put(doc);
  }

  // ─────────── 模板（无 agent 关联的 server 定义）读写 ───────────

  private static _readTemplates(): Record<string, ConfigEntry> {
    try {
      const doc = ztools.db.get(TEMPLATES_KEY);
      if (doc && doc.servers && typeof doc.servers === 'object') return doc.servers;
    } catch (e) {}
    return {};
  }

  private static _putTemplates(servers: Record<string, ConfigEntry>): void {
    let existing: any = null;
    try {
      existing = ztools.db.get(TEMPLATES_KEY);
    } catch (e) {}
    const doc: any = { _id: TEMPLATES_KEY, servers: servers };
    if (existing && existing._rev) doc._rev = existing._rev;
    ztools.db.put(doc);
  }

  // ─────────── 配置文件读取（经适配器）───────────

  private static _readAllConfigs(): ConfigsMap {
    const configs: ConfigsMap = {};
    ALL_APPS.forEach(function (app) {
      const a = getAdapter(app);
      if (a) configs[app] = a.readServers();
    });
    return configs;
  }

  // ─────────── 配置文件写入（经适配器）───────────

  private static _writeToApp(appType: string, name: string, entry: ConfigEntry): void {
    const a = getAdapter(appType);
    if (a) a.writeServer(name, entry);
  }

  private static _removeFromApp(appType: string, name: string): void {
    const a = getAdapter(appType);
    if (a) a.writeServer(name, null);
  }

  // ─────────── 构建配置文件条目 ───────────

  private static _buildConfigEntry(server: McpServerData): ConfigEntry | null {
    if (server.stdio) {
      const entry: ConfigEntry = {
        command: server.stdio.command || '',
        args: server.stdio.args || []
      };
      if (server.stdio.env && Object.keys(server.stdio.env).length > 0)
        entry.env = server.stdio.env;
      return entry;
    }
    if (server.sse) {
      const entry: ConfigEntry = { url: server.sse.url || '' };
      if (server.sse.headers && Object.keys(server.sse.headers).length > 0)
        entry.headers = server.sse.headers;
      return entry;
    }
    if (server.http) {
      const entry: ConfigEntry = { url: server.http.url || '' };
      if (server.http.headers && Object.keys(server.http.headers).length > 0)
        entry.headers = server.http.headers;
      return entry;
    }
    return null;
  }

  // 从配置条目推断类型
  private static _inferType(def: ConfigEntry | null): string {
    return def && def.url ? 'streamable-http' : 'stdio';
  }

  // 从配置条目构建 server 传输字段
  private static _buildTransport(type: string, def: ConfigEntry | null): TransportFields {
    if (!def) return {};
    if (type === 'stdio') {
      return { stdio: { command: def.command || '', args: def.args || [], env: def.env || {} } };
    }
    const transport = {
      url: def.url || '',
      headers: def.headers || {},
      authType: def.authType || 'none',
      apiKey: def.apiKey || ''
    };
    return type === 'sse' ? { sse: transport } : { http: transport };
  }

  // 收集所有配置文件 + 映射中出现的 server name
  private static _collectAllNames(configs: ConfigsMap, mapping: AppMapping): string[] {
    const nameSet: Record<string, boolean> = {};
    ALL_APPS.forEach(function (app) {
      Object.keys(configs[app] || {}).forEach(function (n) {
        nameSet[n] = true;
      });
      (mapping[app] || []).forEach(function (n) {
        nameSet[n] = true;
      });
    });
    Object.keys(McpManager._readTemplates()).forEach(function (n) {
      nameSet[n] = true;
    });
    // 去重：配置键若是某原始名的 codex 式 slug（如 mcp_server_github ↔ mcp-server-github），保留原始名
    const slugOwners: Record<string, string> = {};
    Object.keys(nameSet).forEach(function (n) {
      const s = slugify(n);
      if (s !== n) slugOwners[s] = n;
    });
    Object.keys(slugOwners).forEach(function (s) {
      if (nameSet[s]) delete nameSet[s];
    });
    return Object.keys(nameSet);
  }

  // 计算 server 关联的 apps
  private static _resolveApps(name: string, mapping: AppMapping, configs: ConfigsMap): string[] {
    const apps: string[] = [];
    ALL_APPS.forEach(function (app) {
      if (mapping[app].indexOf(name) !== -1) apps.push(app);
    });
    if (apps.length === 0) {
      ALL_APPS.forEach(function (app) {
        if (hasServer(configs[app], name)) apps.push(app);
      });
    }
    return apps;
  }

  // 从配置文件中查找 server 定义（slug 感知）
  private static _findDef(name: string, configs: ConfigsMap): ConfigEntry | null {
    for (let i = 0; i < ALL_APPS.length; i++) {
      const found = findEntryIn(configs[ALL_APPS[i]], name);
      if (found) return found;
    }
    const templates = McpManager._readTemplates();
    return templates[name] || templates[slugify(name)] || null;
  }

  // ─────────── CRUD ───────────

  private static _buildServer(
    name: string,
    def: ConfigEntry | null,
    apps: string[],
    disabledSet: Record<string, boolean>
  ): McpServer {
    const type = McpManager._inferType(def);
    const server: McpServer = {
      id: name,
      name: name,
      type: type,
      enabled: !disabledSet[name],
      stdio: null,
      sse: null,
      http: null,
      apps: apps
    };
    const transport = McpManager._buildTransport(type, def);
    if (transport.stdio) server.stdio = transport.stdio;
    if (transport.sse) server.sse = transport.sse;
    if (transport.http) server.http = transport.http;
    return server;
  }

  static listMcpServers(): McpServer[] {
    const configs = McpManager._readAllConfigs();
    const mapping = McpManager._getMapping();
    if (DataMigration.cleanMcpMapping(mapping, configs, ALL_APPS)) McpManager._putMapping(mapping);
    const disabledSet: Record<string, boolean> = {};
    (mapping.disabled || []).forEach(function (n) {
      disabledSet[n] = true;
    });

    const names = McpManager._collectAllNames(configs, mapping);
    const result: McpServer[] = [];

    names.forEach(function (name) {
      const apps = McpManager._resolveApps(name, mapping, configs);
      const def = McpManager._findDef(name, configs);
      result.push(McpManager._buildServer(name, def, apps, disabledSet));
    });

    return result;
  }

  static getMcpServer(name: string): McpServer {
    const configs = McpManager._readAllConfigs();
    const mapping = McpManager._getMapping();
    const apps = McpManager._resolveApps(name, mapping, configs);
    const def = McpManager._findDef(name, configs);
    const disabledSet: Record<string, boolean> = {};
    (mapping.disabled || []).forEach(function (n) {
      disabledSet[n] = true;
    });
    return McpManager._buildServer(name, def, apps, disabledSet);
  }

  static saveMcpServer(data: McpServerData & { name?: string; apps?: string[] }): string {
    const name = data.name;
    if (!name) return '';

    const mapping = McpManager._getMapping();
    const newApps = data.apps || [];

    // 获取旧的 apps
    const oldApps: string[] = [];
    ALL_APPS.forEach(function (app) {
      if (mapping[app].indexOf(name) !== -1) oldApps.push(app);
    });

    // 更新映射
    ALL_APPS.forEach(function (app) {
      const idx = mapping[app].indexOf(name);
      if (newApps.indexOf(app) !== -1) {
        if (idx === -1) mapping[app].push(name);
      } else {
        if (idx !== -1) mapping[app].splice(idx, 1);
      }
    });
    McpManager._putMapping(mapping);

    // 从旧 apps 中移除
    oldApps.forEach(function (app) {
      if (newApps.indexOf(app) === -1) McpManager._removeFromApp(app, name);
    });

    // 写入新 apps
    const entry = McpManager._buildConfigEntry(data);
    if (entry) {
      newApps.forEach(function (app) {
        McpManager._writeToApp(app, name, entry);
      });
    }

    // 无 agent 关联时保存为模板，避免配置丢失；关联 agent 后移除模板
    const templates = McpManager._readTemplates();
    if (newApps.length === 0) {
      if (entry) templates[name] = entry;
    } else {
      delete templates[name];
    }
    McpManager._putTemplates(templates);

    return name;
  }

  static deleteMcpServer(name: string): void {
    const mapping = McpManager._getMapping();

    // 从所有关联 app 配置文件中移除
    ALL_APPS.forEach(function (app) {
      if (mapping[app].indexOf(name) !== -1) {
        McpManager._removeFromApp(app, name);
        mapping[app] = mapping[app].filter(function (n) {
          return n !== name;
        });
      }
    });

    // 也从配置文件中移除（处理不在映射中但存在于配置文件的情况）
    const configs = McpManager._readAllConfigs();
    ALL_APPS.forEach(function (app) {
      if (hasServer(configs[app], name)) McpManager._removeFromApp(app, name);
    });

    // 从 disabled 列表中移除
    mapping.disabled = (mapping.disabled || []).filter(function (n) {
      return n !== name;
    });
    McpManager._putMapping(mapping);

    // 从模板中移除
    const templates = McpManager._readTemplates();
    if (templates[name]) {
      delete templates[name];
      McpManager._putTemplates(templates);
    }
  }

  static toggleMcpServer(name: string): boolean {
    const mapping = McpManager._getMapping();
    if (!mapping.disabled) mapping.disabled = [];

    // 确保 apps 映射存在
    const apps = McpManager._resolveApps(name, mapping, McpManager._readAllConfigs());
    if (apps.length > 0) {
      apps.forEach(function (app) {
        if (mapping[app].indexOf(name) === -1) mapping[app].push(name);
      });
    }

    const isDisabled = mapping.disabled.indexOf(name) !== -1;

    if (isDisabled) {
      // 启用：从 disabled 移除 + 写入配置文件，并清除禁用时保存的模板
      mapping.disabled = mapping.disabled.filter(function (n) {
        return n !== name;
      });
      McpManager._putMapping(mapping);
      const configs = McpManager._readAllConfigs();
      const def = McpManager._findDef(name, configs);
      if (def) {
        apps.forEach(function (app) {
          McpManager._writeToApp(app, name, def);
        });
        if (apps.length > 0) {
          const templates = McpManager._readTemplates();
          if (templates[name]) {
            delete templates[name];
            McpManager._putTemplates(templates);
          }
        }
      }
      return true;
    } else {
      // 禁用：定义先保存到模板（防止丢失），再加入 disabled + 从配置文件移除
      const configs = McpManager._readAllConfigs();
      const def = McpManager._findDef(name, configs);
      if (def) {
        const templates = McpManager._readTemplates();
        templates[name] = def;
        McpManager._putTemplates(templates);
      }
      mapping.disabled.push(name);
      McpManager._putMapping(mapping);
      apps.forEach(function (app) {
        McpManager._removeFromApp(app, name);
      });
      return false;
    }
  }

  // ─────────── 同步：从配置文件导入到 mapping ───────────

  static syncFromConfigFiles(): void {
    const configs = McpManager._readAllConfigs();
    const mapping = McpManager._getMapping();

    // 配置文件里有但 mapping 里没有 → 添加
    ALL_APPS.forEach(function (app) {
      const configServers = configs[app] || {};
      Object.keys(configServers).forEach(function (name) {
        if (mapping[app].indexOf(name) === -1) {
          mapping[app].push(name);
        }
      });
    });

    // 清理残留条目（如旧版 node_repl）
    DataMigration.cleanMcpMapping(mapping, configs, ALL_APPS);

    McpManager._putMapping(mapping);
  }
}
