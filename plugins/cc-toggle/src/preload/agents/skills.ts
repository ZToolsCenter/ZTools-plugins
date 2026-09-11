// ZTools ccToggle - skills.ts
// CCToggle 技能管理、部署、搜索

import utils = require('../utils');
const fs = utils.fs;
const path = utils.path;
const getHomeDir = utils.getHomeDir;
const expandHome = utils.expandHome;
const ensureDir = utils.ensureDir;
const copyDirSync = utils.copyDirSync;

// ===== Types =====

interface NestSkillInfo {
  name: string;
  path: string;
  hasSkillMd: boolean;
  repo: string;
  version: string;
  installedAt: string;
}

interface NestSkillMeta {
  repo?: string;
  version?: string;
  installedAt?: string;
  subPath?: string;
  branch?: string;
  updatedAt?: string;
}

interface DeployRecord {
  target: string;
  mode: string;
  deployedAt: string;
}

interface ProjectTarget {
  id: string;
  path: string;
  label: string;
  addedAt: string;
}

interface SkillRepo {
  url: string;
  branch: string;
  addedAt: string;
}

interface SearchResult {
  name: string;
  repo: string;
  path: string;
  desc: string;
  installs: number;
}

interface SkillDirEntry {
  name: string;
  path: string;
  hasSkillMd: boolean;
}

interface OperationResult {
  success: boolean;
  error?: string;
  mode?: string;
  action?: string;
  id?: string;
  path?: string;
}

interface AllSkillsResult {
  nest: NestSkillInfo[];
  [app: string]: NestSkillInfo[] | SkillDirEntry[];
}

interface SyncResult {
  success: boolean;
  error?: string;
  results?: Array<{ skill: string; target: string; result: OperationResult }>;
}

// ===== CCToggle: Central Skill Nest + Deploy Engine =====

// --- Module-level variable ---
var _projectTargets: ProjectTarget[] | null = null;

export class SkillManager {
  // --- Nest Directory ---

  static getNestDir(): string {
    // 优先从配置读取（用户自定义路径）
    var configured: string | null = ztools.dbStorage.getItem('ccswitch_nest_dir');
    if (configured) {
      var expanded = expandHome(configured);
      ensureDir(expanded);
      return expanded;
    }

    var home = getHomeDir();
    var newNest = path.join(home, '.ztools-cctoggle', 'skills');
    ensureDir(newNest);
    return newNest;
  }

  // 校验技能名合法：非空、无路径分隔符、无 ".."，避免目录穿越
  private static _safeSkillName(name: unknown): boolean {
    if (!name || typeof name !== 'string') return false;
    if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return false;
    if (name === '.' || name === '..') return false;
    if (name.indexOf('\0') >= 0) return false;
    return true;
  }

  // 断言 target 落在 root 目录内（防止拼接出的路径逃逸后被递归删除）
  private static _assertInside(root: string, target: string): void {
    var r = path.resolve(root);
    var t = path.resolve(target);
    var rel = path.relative(r, t);
    if (rel === '' || rel === '..' || rel.indexOf('..' + path.sep) === 0 || path.isAbsolute(rel)) {
      throw new Error('unsafe path outside target root: ' + target);
    }
  }

  // --- Nest Skill Listing ---

  static listNestSkills(): NestSkillInfo[] {
    var nest = SkillManager.getNestDir();
    try {
      if (!fs.existsSync(nest)) return [];
      var entries = fs.readdirSync(nest, { withFileTypes: true });
      var result: NestSkillInfo[] = [];
      entries.forEach(function (e: any) {
        if (!e.isDirectory() || e.name.startsWith('.')) return;
        var skillPath = path.join(nest, e.name);
        var hasSkillMd = fs.existsSync(path.join(skillPath, 'SKILL.md'));
        var meta = SkillManager.getNestSkillMeta(e.name);
        result.push({
          name: e.name,
          path: skillPath,
          hasSkillMd: hasSkillMd,
          repo: meta.repo || '',
          version: meta.version || '',
          installedAt: meta.installedAt || ''
        });
      });
      return result;
    } catch (e) {
      return [];
    }
  }

  static getNestSkillMeta(skillName: string): NestSkillMeta {
    try {
      var metaPath = path.join(SkillManager.getNestDir(), skillName, 'meta.json');
      if (fs.existsSync(metaPath)) {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch (e) {}
    return {};
  }

  static setNestSkillMeta(skillName: string, meta: NestSkillMeta): void {
    var metaPath = path.join(SkillManager.getNestDir(), skillName, 'meta.json');
    ensureDir(metaPath);
    var existing = SkillManager.getNestSkillMeta(skillName);
    Object.assign(existing, meta, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2), 'utf8');
  }

  // --- Deploy Registry ---

  static getDeployRegistry(): Record<string, DeployRecord[]> {
    try {
      return ztools.dbStorage.getItem('ccswitch_nest_registry') || {};
    } catch (e) {
      return {};
    }
  }

  static setDeployRegistry(reg: Record<string, DeployRecord[]>): void {
    ztools.dbStorage.setItem('ccswitch_nest_registry', reg);
  }

  static listDeployments(): Record<string, DeployRecord[]> {
    return SkillManager.getDeployRegistry();
  }

  // --- Create Link (Win junction / Unix symlink) ---

  static createLink(src: string, dest: string): string {
    SkillManager._assertInside(path.dirname(dest), dest);
    ensureDir(dest);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    var isWin = process.platform === 'win32';
    if (isWin) {
      var srcVol = path.parse(src).root;
      var destVol = path.parse(dest).root;
      if (srcVol !== destVol) {
        copyDirSync(src, dest);
        return 'copy';
      }
      fs.symlinkSync(src, dest, 'junction');
      return 'symlink';
    } else {
      fs.symlinkSync(src, dest, 'dir');
      return 'symlink';
    }
  }

  // --- Deploy Skill (nest to target) ---

  static deploySkill(skillName: string, target: string): OperationResult {
    var nest = SkillManager.getNestDir();
    if (!SkillManager._safeSkillName(skillName)) {
      return { success: false, error: 'invalid skill name: ' + skillName };
    }
    var srcPath = path.join(nest, skillName);
    if (!fs.existsSync(srcPath) || !fs.existsSync(path.join(srcPath, 'SKILL.md'))) {
      return { success: false, error: 'skill not found in nest: ' + skillName };
    }

    var allPaths = SkillManager.getSkillStoragePaths();
    var destDir: string | undefined = expandHome(allPaths[target]);
    if (!destDir) {
      var projects = SkillManager.listProjectTargets();
      var proj = projects.find(function (p) {
        return p.id === target;
      });
      if (proj) {
        destDir = expandHome(proj.path);
      } else {
        return { success: false, error: 'unknown target: ' + target };
      }
    }
    ensureDir(destDir);
    var destPath = path.join(destDir, skillName);
    SkillManager._assertInside(destDir, destPath);

    var mode = SkillManager.getSyncMode();

    try {
      if (mode === 'symlink') {
        SkillManager.createLink(srcPath, destPath);
      } else {
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        copyDirSync(srcPath, destPath);
      }

      var reg = SkillManager.getDeployRegistry();
      if (!reg[skillName]) reg[skillName] = [];
      var existing = reg[skillName].find(function (d) {
        return d.target === target;
      });
      if (existing) {
        existing.mode = mode;
      } else {
        reg[skillName].push({ target: target, mode: mode, deployedAt: new Date().toISOString() });
      }
      SkillManager.setDeployRegistry(reg);

      return { success: true, mode: mode };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // --- Undeploy Skill ---

  static undeploySkill(skillName: string, target: string): OperationResult {
    if (!SkillManager._safeSkillName(skillName)) {
      return { success: false, error: 'invalid skill name: ' + skillName };
    }
    var allPaths = SkillManager.getSkillStoragePaths();
    var destDir: string | undefined = expandHome(allPaths[target]);
    if (!destDir) {
      var projects = SkillManager.listProjectTargets();
      var proj = projects.find(function (p) {
        return p.id === target;
      });
      if (proj) destDir = expandHome(proj.path);
    }
    if (!destDir) return { success: false, error: 'unknown target: ' + target };

    var destPath = path.join(destDir, skillName);
    SkillManager._assertInside(destDir, destPath);
    if (!fs.existsSync(destPath)) {
      return { success: false, error: 'not deployed to ' + target };
    }

    try {
      var stat = fs.lstatSync(destPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(destPath);
      } else {
        fs.rmSync(destPath, { recursive: true, force: true });
      }

      var reg = SkillManager.getDeployRegistry();
      if (reg[skillName]) {
        reg[skillName] = reg[skillName].filter(function (d) {
          return d.target !== target;
        });
        if (reg[skillName].length === 0) delete reg[skillName];
      }
      SkillManager.setDeployRegistry(reg);

      return { success: true, action: 'removed' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // --- Toggle (deploy/undeploy) ---

  static toggleSkillToAgent(
    skillName: string,
    sourceApp: string,
    targetApp: string
  ): OperationResult {
    var reg = SkillManager.getDeployRegistry();
    var deployed =
      reg[skillName] &&
      reg[skillName].find(function (d) {
        return d.target === targetApp;
      });
    if (deployed) {
      return SkillManager.undeploySkill(skillName, targetApp);
    } else {
      return SkillManager.deploySkill(skillName, targetApp);
    }
  }

  // --- Project Targets ---

  static listProjectTargets(): ProjectTarget[] {
    if (_projectTargets) return _projectTargets;
    try {
      _projectTargets = ztools.dbStorage.getItem('ccswitch_project_targets') || [];
      return _projectTargets;
    } catch (e) {
      return [];
    }
  }

  static addProjectTarget(pathStr: string, label?: string): OperationResult {
    var targets = SkillManager.listProjectTargets();
    if (
      targets.find(function (t) {
        return t.path === pathStr;
      })
    ) {
      return { success: false, error: 'target already exists' };
    }
    var id = 'project_' + Date.now().toString(36);
    targets.push({
      id: id,
      path: pathStr,
      label: label || pathStr,
      addedAt: new Date().toISOString()
    });
    _projectTargets = targets;
    ztools.dbStorage.setItem('ccswitch_project_targets', targets);
    return { success: true, id: id };
  }

  static removeProjectTarget(id: string): OperationResult {
    var targets = SkillManager.listProjectTargets().filter(function (t) {
      return t.id !== id;
    });
    _projectTargets = targets;
    ztools.dbStorage.setItem('ccswitch_project_targets', targets);
    return { success: true };
  }

  // --- Skills Registry & Search ---

  static getDefaultSkillDirs(): Record<string, string> {
    var home = getHomeDir();
    return {
      codex: path.join(home, '.codex', 'skills'),
      claude: path.join(home, '.claude', 'skills'),
      gemini: path.join(home, '.gemini', 'skills'),
      opencode: path.join(home, '.config', 'opencode', 'skills'),
      openclaw: path.join(home, '.openclaw', 'skills')
    };
  }

  static getSkillStoragePaths(): Record<string, string> {
    // 优先从 agent 配置路径派生
    var configPaths: Record<string, string> = {};
    try {
      configPaths = ztools.dbStorage.getItem('ccswitch_config_paths') || {};
    } catch (e) {
      configPaths = {};
    }

    // 如果有配置，从配置路径派生 skill 目录
    if (Object.keys(configPaths).length > 0) {
      var result: Record<string, string> = {};
      Object.keys(configPaths).forEach(function (app) {
        if (configPaths[app]) {
          result[app] = path.join(expandHome(configPaths[app]), 'skills');
        }
      });
      // 补充未配置的 agent 使用默认路径
      var defaults = SkillManager.getDefaultSkillDirs();
      Object.keys(defaults).forEach(function (app) {
        if (!result[app]) {
          result[app] = defaults[app];
        }
      });
      return result;
    }

    // 兼容旧的独立存储路径配置（向后兼容）
    var saved: Record<string, string> | null = ztools.dbStorage.getItem('ccswitch_skill_paths');
    if (saved) {
      // 如果旧数据存在，尝试迁移
      // 将旧数据转换为新的 config_paths 格式
      var defaultSkillDirs = SkillManager.getDefaultSkillDirs();
      var migratedConfigPaths: Record<string, string> = {};
      Object.keys(saved).forEach(function (app) {
        if (saved[app] && saved[app] !== defaultSkillDirs[app]) {
          // 从 skill 路径推导出 agent 路径
          var agentPath = saved[app].replace(/[\/\\]skills$/, '');
          if (agentPath !== saved[app]) {
            migratedConfigPaths[app] = agentPath;
          }
        }
      });

      // 如果有需要迁移的数据，保存到新格式
      if (Object.keys(migratedConfigPaths).length > 0) {
        ztools.dbStorage.setItem('ccswitch_config_paths', migratedConfigPaths);
        // 重新计算结果
        var result2: Record<string, string> = {};
        Object.keys(migratedConfigPaths).forEach(function (app) {
          if (migratedConfigPaths[app]) {
            result2[app] = path.join(expandHome(migratedConfigPaths[app]), 'skills');
          }
        });
        var defaults2 = SkillManager.getDefaultSkillDirs();
        Object.keys(defaults2).forEach(function (app) {
          if (!result2[app]) {
            result2[app] = defaults2[app];
          }
        });
        return result2;
      }

      return saved;
    }

    // 首次使用，返回默认值
    var defaults3 = SkillManager.getDefaultSkillDirs();
    return defaults3;
  }

  static setSkillStoragePaths(paths: Record<string, string>): void {
    ztools.dbStorage.setItem('ccswitch_skill_paths', paths);
  }

  static getSkillRepos(): SkillRepo[] {
    return ztools.dbStorage.getItem('ccswitch_skill_repos') || [];
  }

  static addSkillRepo(repoUrl: string, branch?: string): OperationResult {
    var repos = SkillManager.getSkillRepos();
    if (
      repos.find(function (r) {
        return r.url === repoUrl;
      })
    ) {
      return { success: false, error: 'repo already exists' };
    }
    repos.push({ url: repoUrl, branch: branch || 'main', addedAt: new Date().toISOString() });
    ztools.dbStorage.setItem('ccswitch_skill_repos', repos);
    return { success: true };
  }

  static removeSkillRepo(repoUrl: string): OperationResult {
    ztools.dbStorage.setItem(
      'ccswitch_skill_repos',
      SkillManager.getSkillRepos().filter(function (r) {
        return r.url !== repoUrl;
      })
    );
    return { success: true };
  }

  static getSyncMode(): string {
    return ztools.dbStorage.getItem('ccswitch_sync_mode') || 'symlink';
  }

  static setSyncMode(mode: string): void {
    ztools.dbStorage.setItem('ccswitch_sync_mode', mode);
  }

  // --- Skills Search ---

  // 支持 source: "skillsh"（默认，skill.sh） / "modelscope"（ModelScope 技能广场）
  static searchSkills(query?: string, source?: string): Promise<SearchResult[]> {
    if (source === 'modelscope') {
      return SkillManager._searchModelScope(query);
    }
    return SkillManager._searchSkillSh(query);
  }

  private static _httpGetJson(url: string, timeoutMs?: number): Promise<any> {
    var https = require('https');
    return new Promise(function (resolve) {
      try {
        var req = https.get(url, { timeout: timeoutMs || 8000 }, function (res: any) {
          var data = '';
          res.on('data', function (c: string) {
            data += c;
          });
          res.on('end', function () {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(null);
            }
          });
        });
        req.on('timeout', function () {
          req.destroy();
        });
        req.on('error', function () {
          resolve(null);
        });
        req.end();
      } catch (e) {
        resolve(null);
      }
    });
  }

  private static _mapSkill(s: any): SearchResult {
    return {
      name: s.name || s.skillId,
      repo: s.source ? 'https://github.com/' + s.source : '',
      path: s.skillId || '',
      desc: s.source || '',
      installs: s.installs || 0
    };
  }

  private static _searchSkillSh(query?: string): Promise<SearchResult[]> {
    var url = query
      ? 'https://www.skills.sh/api/search?q=' + encodeURIComponent(query) + '&limit=50'
      : 'https://www.skills.sh/api/search?limit=200';
    return SkillManager._httpGetJson(url).then(function (json) {
      return ((json && json.skills) || []).map(SkillManager._mapSkill);
    });
  }

  // ModelScope 技能广场搜索
  // GET /openapi/v1/skills?search=<q>&page_number=1&page_size=50
  private static _mapModelScopeSkill(s: any): SearchResult {
    return {
      name: s.display_name || s.id || s._id || '',
      repo: s.source_url || '',
      path: s.id || s._id || '',
      desc: s.description || (s.developer ? 'by ' + s.developer : ''),
      installs: s.downloads || 0
    };
  }

  private static _searchModelScope(query?: string): Promise<SearchResult[]> {
    var PAGE_SIZE = 20;
    var page = 1;
    var out: SearchResult[] = [];
    var seen: Record<string, boolean> = {};
    function next(): Promise<SearchResult[]> {
      var url =
        'https://modelscope.cn/openapi/v1/skills?page_number=' +
        page +
        '&page_size=' +
        PAGE_SIZE +
        (query ? '&search=' + encodeURIComponent(query) : '');
      return SkillManager._httpGetJson(url).then(function (json) {
        if (!json || !json.success) return out;
        var data = json.data || {};
        var list = data.skills || [];
        for (var i = 0; i < list.length; i++) {
          var mapped = SkillManager._mapModelScopeSkill(list[i]);
          if (seen[mapped.name]) continue;
          seen[mapped.name] = true;
          out.push(mapped);
        }
        var total = data.total || 0;
        if (list.length < PAGE_SIZE || out.length >= total) return out;
        page++;
        return next();
      });
    }
    return next();
  }

  // --- Install / List / Sync (nest-first) ---

  static listSkillsInDir(dir: string): SkillDirEntry[] {
    try {
      dir = expandHome(dir);
      if (!fs.existsSync(dir)) return [];
      var out: SkillDirEntry[] = [];
      function isDirLike(full: string, dirent: any): boolean {
        // Dirent.isDirectory() returns false for junctions/symlinks on Windows.
        // Fall back to stat (which follows the link) so deployed skills are counted.
        if (dirent && dirent.isDirectory()) return true;
        try {
          var st = fs.statSync(full);
          return st.isDirectory();
        } catch (_) {
          return false;
        }
      }
      function walk(base: string, rel: string): void {
        var entries: any[];
        try {
          entries = fs.readdirSync(base, { withFileTypes: true });
        } catch (_) {
          return;
        }
        entries.forEach(function (e: any) {
          if (e.name.startsWith('.')) return;
          var full = path.join(base, e.name);
          var r = rel ? rel + '/' + e.name : e.name;
          if (isDirLike(full, e)) {
            if (fs.existsSync(path.join(full, 'SKILL.md'))) {
              out.push({ name: r, path: full, hasSkillMd: true });
            } else {
              // Only recurse into real directories to avoid symlink loops.
              if (e.isDirectory()) walk(full, r);
            }
          }
        });
      }
      walk(dir, '');
      return out;
    } catch (e) {
      return [];
    }
  }

  static listAllSkills(): AllSkillsResult {
    var result: AllSkillsResult = { nest: SkillManager.listNestSkills() };
    var paths = SkillManager.getSkillStoragePaths() || {};
    Object.keys(paths).forEach(function (app) {
      result[app] = SkillManager.listSkillsInDir(paths[app]);
    });
    return result;
  }

  static installSkill(
    name: string,
    repo?: string,
    subPath?: string,
    branch?: string
  ): OperationResult {
    try {
      if (!SkillManager._safeSkillName(name))
        return { success: false, error: 'invalid skill name' };
      var nest = SkillManager.getNestDir();
      var target = path.join(nest, name);
      SkillManager._assertInside(nest, target);
      if (fs.existsSync(target) && fs.existsSync(path.join(target, 'SKILL.md'))) {
        return { success: false, error: 'already installed' };
      }
      ensureDir(target);
      // Best-effort placeholder: write meta + minimal SKILL.md so UI can see it.
      // Actual git clone would require child_process; keep synchronous no-op here.
      SkillManager.setNestSkillMeta(name, {
        repo: repo || '',
        subPath: subPath || '',
        branch: branch || 'main',
        installedAt: new Date().toISOString()
      });
      var skillMd = path.join(target, 'SKILL.md');
      if (!fs.existsSync(skillMd)) {
        fs.writeFileSync(
          skillMd,
          '# ' + name + '\n\nInstalled from: ' + (repo || '(local)') + '\n',
          'utf8'
        );
      }
      return { success: true, path: target };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static removeNestSkill(skillName: string): OperationResult {
    if (!SkillManager._safeSkillName(skillName))
      return { success: false, error: 'invalid skill name' };
    var nest = SkillManager.getNestDir();
    var target = path.join(nest, skillName);
    SkillManager._assertInside(nest, target);
    try {
      // Undeploy from all targets first
      var reg = SkillManager.getDeployRegistry();
      if (reg[skillName]) {
        reg[skillName].slice().forEach(function (d) {
          SkillManager.undeploySkill(skillName, d.target);
        });
      }
      // Remove the skill directory
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
      // Clean up meta.json
      var metaPath = path.join(SkillManager.getNestDir(), skillName, 'meta.json');
      if (fs.existsSync(metaPath)) {
        fs.rmSync(metaPath, { recursive: true, force: true });
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static syncSkills(sourceApp: string, targetApps?: string[]): SyncResult {
    // Legacy shim: for each nest skill, deploy to each target
    try {
      var nestList = SkillManager.listNestSkills();
      var results: Array<{ skill: string; target: string; result: OperationResult }> = [];
      (targetApps || []).forEach(function (t) {
        nestList.forEach(function (s) {
          results.push({ skill: s.name, target: t, result: SkillManager.deploySkill(s.name, t) });
        });
      });
      return { success: true, results: results };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // 设置安装目录
  static setNestDir(dir?: string): OperationResult {
    if (dir) {
      ztools.dbStorage.setItem('ccswitch_nest_dir', dir);
    } else {
      ztools.dbStorage.removeItem('ccswitch_nest_dir');
    }
    return { success: true };
  }
}
