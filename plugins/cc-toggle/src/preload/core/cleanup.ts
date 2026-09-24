// ZTools ccToggle - cleanup.ts
// 数据清理 / 迁移逻辑（幂等，无需版本号）

import * as cryptoApi from './crypto';
import { hasServer } from '../agents/mcp/adapters';

export class DataMigration {
  static cleanMcpMapping(mapping: any, configs: any, allApps: string[]): boolean {
    let changed = false;
    allApps.forEach(function (app) {
      const configServers = configs[app] || {};
      mapping[app] = (mapping[app] || []).filter(function (name: string) {
        if (hasServer(configServers, name)) return true;
        if ((mapping.disabled || []).indexOf(name) !== -1) return true;
        for (let i = 0; i < allApps.length; i++) {
          if (allApps[i] !== app && hasServer(configs[allApps[i]], name)) return true;
        }
        changed = true;
        return false;
      });
    });
    return changed;
  }

  /** 主入口：逐项检查，按需执行 */
  static migrateAgentPaths(): void {
    DataMigration.migrateSkillnestDir();
    DataMigration.migrateCctoggleDir();
    DataMigration.migrateToProfileStructure();
    DataMigration.migrateLastActiveApp();
    DataMigration.migrateApiKeysToProfile();
    DataMigration.cleanStaleProxyDocs();
    DataMigration.migratePromptBackups();
  }

  /** 提示词备份迁移：旧格式 { agent: { content, backedUpAt } } → 新格式 { agent: { fileName: { content, backedUpAt } } } */
  static migratePromptBackups(): void {
    const BACKUP_KEY = 'cctoggle_prompts_backup';
    const DEFAULT_FILES: Record<string, string> = {
      codex: 'AGENTS.md',
      claude: 'CLAUDE.md',
      gemini: 'GEMINI.md',
      openclaw: 'AGENTS.md',
      opencode: 'AGENTS.md'
    };
    try {
      const doc = ztools.db.get(BACKUP_KEY);
      if (!doc || !doc.backups || typeof doc.backups !== 'object') return;

      const backups = doc.backups;
      let changed = false;
      Object.keys(backups).forEach(function (agent) {
        const backup = backups[agent];
        if (!backup || typeof backup !== 'object' || typeof backup.content !== 'string') return;
        const file = DEFAULT_FILES[agent];
        if (!file) return;
        backups[agent] = {
          [file]: { content: backup.content, backedUpAt: backup.backedUpAt || '' }
        };
        changed = true;
      });

      if (changed) {
        ztools.db.put(doc);
        console.log('[Cleanup] Migrated prompt backups to file-granularity');
      }
    } catch (e: any) {
      console.error('[Cleanup] Prompt backups migration failed:', e.message);
    }
  }

  /** skillnest → cctoggle 目录迁移 */
  static migrateSkillnestDir(): void {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    let home: string;
    try {
      home = ztools.getPath('home');
    } catch (e) {
      home = os.homedir();
    }

    const oldNest = path.join(home, '.skillnest', 'skills');
    if (!fs.existsSync(oldNest)) return;

    const newNest = path.join(home, '.ztools-cctoggle', 'skills');
    try {
      const newDir = path.dirname(newNest);
      if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

      const entries = fs.readdirSync(oldNest, { withFileTypes: true });
      let copied = 0;
      entries.forEach(function (entry: any) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) return;
        try {
          DataMigration.copyDirSync(path.join(oldNest, entry.name), path.join(newNest, entry.name));
          copied++;
        } catch (e: any) {
          console.error('[Cleanup] Failed to copy skill:', entry.name, e.message);
        }
      });
      console.log('[Cleanup] Copied ' + copied + ' skills');

      DataMigration.redeploySymlinks(newNest);

      fs.rmSync(oldNest, { recursive: true, force: true });
      const oldParent = path.join(home, '.skillnest');
      if (fs.existsSync(oldParent) && fs.readdirSync(oldParent).length === 0) {
        fs.rmdirSync(oldParent);
      }
    } catch (e: any) {
      console.error('[Cleanup] Skillnest migration failed:', e.message);
    }
  }

  /** cctoggle → ztools-cctoggle 目录迁移（旧命名 → 新命名，避免与其他插件撞名） */
  static migrateCctoggleDir(): void {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    let home: string;
    try {
      home = ztools.getPath('home');
    } catch (e) {
      home = os.homedir();
    }

    const oldDir = path.join(home, '.cctoggle');
    if (!fs.existsSync(oldDir)) return;

    const newDir = path.join(home, '.ztools-cctoggle');
    try {
      const entries = fs.readdirSync(oldDir, { withFileTypes: true });
      let copied = 0;
      entries.forEach(function (entry: any) {
        const srcPath = path.join(oldDir, entry.name);
        const destPath = path.join(newDir, entry.name);
        if (fs.existsSync(destPath)) return;
        try {
          if (entry.isDirectory()) {
            DataMigration.copyDirSync(srcPath, destPath);
          } else {
            const destParent = path.dirname(destPath);
            if (!fs.existsSync(destParent)) fs.mkdirSync(destParent, { recursive: true });
            fs.copyFileSync(srcPath, destPath);
          }
          copied++;
        } catch (e: any) {
          console.error('[Cleanup] Failed to copy:', entry.name, e.message);
        }
      });
      console.log('[Cleanup] Copied ' + copied + ' items from .cctoggle');

      const skillsOld = path.join(oldDir, 'skills');
      const skillsNew = path.join(newDir, 'skills');
      if (fs.existsSync(skillsOld)) {
        DataMigration.redeploySymlinks(skillsNew);
      }

      fs.rmSync(oldDir, { recursive: true, force: true });
      console.log('[Cleanup] Removed old .cctoggle directory');
    } catch (e: any) {
      console.error('[Cleanup] .cctoggle migration failed:', e.message);
    }
  }

  /** 供应商 → default profile（检查 default profile 是否存在） */
  static migrateToProfileStructure(): void {
    const PROFILE_KEY = 'cctoggle_profile_default';
    const DB_PREFIX = 'cctoggle_provider_';

    // 已有 default profile → 跳过
    if (ztools.db.get(PROFILE_KEY)) return;

    try {
      const allDocs = ztools.db.allDocs(DB_PREFIX) || [];
      const providers: Record<string, Record<string, any>> = {};
      const keysToDelete: any[] = [];

      allDocs.forEach(function (doc: any) {
        const suffix = doc._id.replace(DB_PREFIX, '');
        const sepIdx = suffix.indexOf('_');
        if (sepIdx < 0) return;

        const appType = suffix.substring(0, sepIdx);
        const providerId = suffix.substring(sepIdx + 1);
        if (!providers[appType]) providers[appType] = {};

        const provider: Record<string, any> = { id: providerId };
        Object.keys(doc).forEach(function (k) {
          if (k !== '_id' && k !== '_rev' && k !== 'id') provider[k] = doc[k];
        });
        providers[appType][providerId] = provider;
        keysToDelete.push(doc);
      });

      const now = new Date().toISOString();
      ztools.db.put({
        _id: PROFILE_KEY,
        id: 'default',
        name: '全局默认',
        createdAt: now,
        updatedAt: now,
        providers: providers,
        lastActiveApp: ''
      });

      keysToDelete.forEach(function (doc: any) {
        try {
          ztools.db.remove(doc);
        } catch (e) {}
      });

      console.log('[Cleanup] Migrated ' + keysToDelete.length + ' providers into default profile');
    } catch (e: any) {
      console.error('[Cleanup] Profile migration failed:', e.message);
    }
  }

  /** lastActiveApp 迁入 profile（检查 dbStorage 旧 key 是否存在） */
  static migrateLastActiveApp(): void {
    const KEY = 'cctoggle_last_active_app';
    try {
      const raw = ztools.dbStorage.getItem(KEY);
      if (!raw) return; // 无旧 key → 跳过

      const lastActiveApp = typeof raw === 'object' ? raw.value || '' : raw;
      if (lastActiveApp) {
        const docs = ztools.db.allDocs('cctoggle_profile_') || [];
        docs.forEach(function (doc: any) {
          if (doc.lastActiveApp) return;
          doc.lastActiveApp = lastActiveApp;
          ztools.db.put(doc);
        });
      }

      ztools.dbStorage.removeItem(KEY);
      console.log('[Cleanup] Migrated lastActiveApp into profiles');
    } catch (e: any) {
      console.error('[Cleanup] lastActiveApp migration failed:', e.message);
    }
  }

  /** API Key 从 dbCryptoStorage 迁入 profile（幂等）：
   *  profile 中已有 encryptedApiKey → 跳过；无则从旧 Key 加密写入，最后统一删除旧 Key（先写后删） */
  static migrateApiKeysToProfile(): void {
    try {
      const docs = ztools.db.allDocs('cctoggle_profile_') || [];
      const keysToRemove: string[] = [];
      let migratedKeys = 0;

      docs.forEach(function (doc: any) {
        const providers = doc.providers || {};
        let changed = false;

        Object.keys(providers).forEach(function (appType) {
          const appProviders = providers[appType] || {};
          Object.keys(appProviders).forEach(function (providerId) {
            const provider = appProviders[providerId];
            if (!provider || provider.encryptedApiKey) return; // 已迁移/无 provider

            let oldKey = '';
            try {
              oldKey = ztools.dbStorage.getItem('apikey_' + appType + '_' + providerId) || '';
            } catch (e) {}
            if (!oldKey) return; // 无旧 Key → 跳过

            provider.encryptedApiKey = cryptoApi.encryptSecret(oldKey);
            if (keysToRemove.indexOf('apikey_' + appType + '_' + providerId) === -1) {
              keysToRemove.push('apikey_' + appType + '_' + providerId);
            }
            migratedKeys++;
            changed = true;
          });
        });

        if (changed) ztools.db.put(doc); // 先写 profile
      });

      // 后删旧 Key
      if (migratedKeys > 0) {
        keysToRemove.forEach(function (key) {
          try {
            ztools.dbStorage.removeItem(key);
          } catch (e) {}
        });
        console.log(
          '[Cleanup] Migrated ' +
            migratedKeys +
            ' api keys into profiles, removed ' +
            keysToRemove.length +
            ' old keys'
        );
      }
    } catch (e: any) {
      console.error('[Cleanup] api key migration failed:', e.message);
    }
  }

  /** 清理废弃的 proxy 孤儿数据 */
  static cleanStaleProxyDocs(): void {
    const apps = ['codex', 'claude', 'claude-desktop', 'gemini', 'openclaw'];
    let removed = 0;
    apps.forEach(function (app) {
      ['cctoggle_proxy_live_', 'cctoggle_proxy_ctl_'].forEach(function (prefix) {
        try {
          const doc = ztools.db.get(prefix + app);
          if (doc) {
            ztools.db.remove(doc);
            removed++;
          }
        } catch (e) {}
      });
    });
    if (removed) console.log('[Cleanup] Removed ' + removed + ' stale proxy docs');
  }

  // ── 工具方法 ──

  static copyDirSync(src: string, dest: string): void {
    const fs = require('fs');
    const path = require('path');
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(function (entry: any) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        DataMigration.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    });
  }

  static redeploySymlinks(newNestDir: string): void {
    const fs = require('fs');
    const path = require('path');

    try {
      const reg = ztools.dbStorage.getItem('ccswitch_nest_registry') || {};
      let fixed = 0;

      Object.keys(reg).forEach(function (skillName) {
        (reg[skillName] || []).forEach(function (dep: any) {
          if (dep.mode !== 'symlink') return;
          const targetDir = DataMigration.resolveTargetDir(dep.target);
          if (!targetDir) return;

          const linkPath = path.join(targetDir, skillName);
          const newSrc = path.join(newNestDir, skillName);
          try {
            if (!fs.existsSync(newSrc)) return;
            if (fs.existsSync(linkPath)) {
              const stat = fs.lstatSync(linkPath);
              if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
            }
            fs.symlinkSync(newSrc, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
            fixed++;
          } catch (e: any) {
            console.error('[Cleanup] Failed to redeploy symlink:', skillName, e.message);
          }
        });
      });

      if (fixed > 0) console.log('[Cleanup] Redeployed ' + fixed + ' symlinks');
    } catch (e: any) {
      console.error('[Cleanup] Redeploy failed:', e.message);
    }
  }

  static resolveTargetDir(target: string): string | null {
    const path = require('path');
    const os = require('os');
    let home: string;
    try {
      home = ztools.getPath('home');
    } catch (e) {
      home = os.homedir();
    }

    const defaultDirs: Record<string, string> = {
      codex: path.join(home, '.codex', 'skills'),
      claude: path.join(home, '.claude', 'skills'),
      gemini: path.join(home, '.gemini', 'skills'),
      openclaw: path.join(home, '.openclaw', 'skills'),
      opencode: path.join(home, '.config', 'opencode', 'skills')
    };
    return defaultDirs[target] || null;
  }
}
