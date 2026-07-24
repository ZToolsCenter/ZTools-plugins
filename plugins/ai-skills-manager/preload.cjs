const fs = require('fs');
const path = require('path');

/**
 * ZTools 预加载脚本 — AI-Skills管理器
 * 两步安装流程：预览 → 选择 → 安装
 */

const userHome = process.env.USERPROFILE || process.env.HOME || '/';
const SKILLS_DIR = path.join(userHome, '.ai-skills-manager');

const REGISTRY_FILE = path.join(SKILLS_DIR, 'registry.json');

// 老版本兼容路径
const OLD_SKILLS_DIR = path.join(userHome, '.gemini', 'antigravity', 'skills');
const OLD_REGISTRY_FILE = path.join(OLD_SKILLS_DIR, 'registry.json');
let MEM_REGISTRY = null; // 内存缓存
let CACHED_SKILLS = null; // 缓存的完整技能列表

// 单例模式获取注册表内容 (带写缓冲/内存同步)
async function getRawRegistry() {
  if (MEM_REGISTRY) return MEM_REGISTRY;
  ensureRegistry();
  try {
    const data = await fs.promises.readFile(REGISTRY_FILE, 'utf-8');
    MEM_REGISTRY = JSON.parse(data);
    return MEM_REGISTRY;
  } catch (error) {
    console.error("读取 registry.json 失败:", error);
    return [];
  }
}

async function saveRegistry(registry) {
  MEM_REGISTRY = registry;
  await fs.promises.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// 同步写入注册表（用于同步函数内的注册表更新，保持内存缓存一致）
function saveRegistrySync(registry) {
  MEM_REGISTRY = registry;
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// 同步读取注册表（优先使用内存缓存）
function readRegistrySync() {
  if (MEM_REGISTRY) return [...MEM_REGISTRY];
  try {
    const data = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    MEM_REGISTRY = JSON.parse(data);
    return [...MEM_REGISTRY];
  } catch (e) {
    return [];
  }
}
const AGENT_CONFIGS = [
  { id: 'antigravity', name: 'Antigravity', path: '.gemini/antigravity/skills' },
  { id: 'claudecode', name: 'Claude Code', path: '.claude/skills' },
  { id: 'trae', name: 'Trae', path: '.trae/skills' },
  { id: 'traecn', name: 'Trae CN', path: '.trae-cn/skills' },
  { id: 'openclaw', name: 'OpenClaw', path: 'skills' },
  { id: 'mcpjam', name: 'MCPJam', path: '.mcpjam/skills' },
  { id: 'mistralvibe', name: 'Mistral Vibe', path: '.vibe/skills' },
  { id: 'mux', name: 'Mux', path: '.mux/skills' },
  { id: 'openhands', name: 'OpenHands', path: '.openhands/skills' },
  { id: 'pi', name: 'Pi', path: '.pi/skills' },
  { id: 'qoder', name: 'Qoder', path: '.qoder/skills' },
  { id: 'qwencode', name: 'Qwen Code', path: '.qwen/skills' },
  { id: 'roocode', name: 'Roo Code', path: '.roo/skills' },
  { id: 'windsurf', name: 'Windsurf', path: '.windsurf/skills' },
  { id: 'zencoder', name: 'Zencoder', path: '.zencoder/skills' },
  { id: 'neovate', name: 'Neovate', path: '.neovate/skills' },
  { id: 'pochi', name: 'Pochi', path: '.pochi/skills' },
  { id: 'adal', name: 'AdaL', path: '.adal/skills' },
  { id: 'crush', name: 'Crush', path: '.crush/skills' },
  { id: 'droid', name: 'Droid', path: '.factory/skills' },
  { id: 'goose', name: 'Goose', path: '.goose/skills' },
  { id: 'junie', name: 'Junie', path: '.junie/skills' },
  { id: 'iflow', name: 'iFlow CLI', path: '.iflow/skills' },
  { id: 'kilocode', name: 'Kilo Code', path: '.kilocode/skills' },
  { id: 'kiro', name: 'Kiro CLI', path: '.kiro/skills' },
  { id: 'kode', name: 'Kode', path: '.kode/skills' },
  { id: 'augment', name: 'Augment', path: '.augment/skills' },
  { id: 'ibm_bob', name: 'IBM Bob', path: '.bob/skills' },
  { id: 'codebuddy', name: 'CodeBuddy', path: '.codebuddy/skills' },
  { id: 'commandcode', name: 'Command Code', path: '.commandcode/skills' },
  { id: 'continue', name: 'Continue', path: '.continue/skills' },
  { id: 'cortexcode', name: 'Cortex Code', path: '.cortex/skills' },
  { id: 'amp', name: 'Amp', path: '.config/agents/skills' },
  { id: 'cline', name: 'Cline', path: '.config/agents/skills' },
  { id: 'codex', name: 'Codex', path: '.codex/skills' },
  { id: 'cursor', name: 'Cursor', path: '.cursor/skills' },
  { id: 'deepagents', name: 'Deep Agents', path: '.deep-agents/skills' },
  { id: 'firebender', name: 'Firebender', path: '.firebender/skills' },
  { id: 'geminicli', name: 'Gemini CLI', path: '.gemini/skills' },
  { id: 'copilot', name: 'GitHub Copilot', path: '.copilot/skills' },
  { id: 'kimicode', name: 'Kimi Code CLI', path: '.kimi/skills' },
  { id: 'opencode', name: 'OpenCode', path: '.config/opencode/skills' },
  { id: 'warp', name: 'Warp', path: '.warp/skills' }
];

// 解析多 Agent 框架路径
function getPathForAgent(agentId) {
  const home = process.env.USERPROFILE || process.env.HOME || '/';
  const conf = AGENT_CONFIGS.find(a => a.id === agentId);
  if (conf) {
    return path.join(home, ...conf.path.split('/'));
  }
  // 自定义路径安全校验：必须在用户主目录下，且不能包含路径穿越
  const resolved = path.resolve(agentId);
  if (!resolved.startsWith(home) || agentId.includes('..')) {
    throw new Error(`不安全的路径: ${agentId}`);
  }
  return resolved;
}

// 确保目录和文件存在
function ensureRegistry() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify([]));
  }
}

// 迁移老版本记录 (安全且非阻塞版本)
async function migrateLegacyData() {
  const fileExists = async (p) => fs.promises.access(p).then(() => true).catch(() => false);

  if (!(await fileExists(OLD_REGISTRY_FILE))) return;

  try {
    if (!(await fileExists(SKILLS_DIR))) {
      await fs.promises.mkdir(SKILLS_DIR, { recursive: true });
    }

    // 只有当目标文件不存在时才执行复制，防止覆盖可能已存在的新版数据
    if (!(await fileExists(REGISTRY_FILE))) {
      await fs.promises.copyFile(OLD_REGISTRY_FILE, REGISTRY_FILE);
    }

    // 只有在目的地文件确认存在的情况下，才删除旧源文件，确保不丢失原始数据
    if (await fileExists(REGISTRY_FILE)) {
      await fs.promises.unlink(OLD_REGISTRY_FILE);
    }
  } catch (e) {
    console.error("数据迁移过程中发生错误:", e);
  }
}

// 解析 GitHub 地址 → { gitUrl, subPath }
function parseGitHubUrl(input) {
  let url = input.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  const fullMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)(?:\/tree\/([^/]+)\/(.+))?$/);
  if (fullMatch) {
    let subPath = fullMatch[3] || null;
    if (subPath) {
      // 安全过滤：防止路径穿越 (Path Traversal)
      if (subPath.includes('..') || path.isAbsolute(subPath) || /[\\:*?"<>|]/.test(subPath)) {
        subPath = null;
      }
    }
    return {
      gitUrl: `https://github.com/${fullMatch[1]}.git`,
      subPath: subPath
    };
  }

  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(url)) {
    return { gitUrl: `https://github.com/${url}.git`, subPath: null };
  }

  const finalUrl = url.startsWith('http') ? url + '.git' : `https://github.com/${url}.git`;
  return {
    gitUrl: finalUrl,
    subPath: null
  };
}

// 辅助函数：从 SKILL.md 提取描述 (异步版本)
async function extractDescription(skillPath) {
  const mdPath_standard = path.join(skillPath, 'SKILL.md');
  const mdPath_lower = path.join(skillPath, 'skill.md');

  const fileExistsAsync = async (p) => fs.promises.access(p).then(() => true).catch(() => false);
  let mdPath = null;
  try {
    if (await fileExistsAsync(mdPath_standard)) mdPath = mdPath_standard;
    else if (await fileExistsAsync(mdPath_lower)) mdPath = mdPath_lower;
  } catch (e) { }

  if (mdPath) {
    try {
      const readline = require('readline');
      const fileStream = fs.createReadStream(mdPath, { encoding: 'utf-8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let inFrontmatter = false;
      let lineCount = 0;
      let foundDescriptionMode = null;
      const block = [];
      let desc = '';

      try {
        for await (const line of rl) {
          lineCount++;
          if (lineCount > 500) break; // 防止处理超大 MD 文件导致挂起

          if (lineCount === 1 && line.match(/^---\s*$/)) {
            inFrontmatter = true;
            continue;
          }

          if (foundDescriptionMode === 'folded' || foundDescriptionMode === 'literal') {
            if (line.trim() === '') {
              block.push('');
            } else if (line.match(/^[ \t]+/)) {
              block.push(line.trim());
            } else {
              rl.close();
              desc = block.join(foundDescriptionMode === 'folded' ? ' ' : '\n').replace(/ +/g, ' ').trim();
              if (desc === '{}' || desc === '[]') return '';
              return desc;
            }
          } else if (foundDescriptionMode === 'doublequote') {
            if (line.endsWith('"')) {
              block.push(line.substring(0, line.length - 1));
              rl.close();
              desc = block.join('\n').trim();
              if (desc === '{}' || desc === '[]') return '';
              return desc;
            }
            block.push(line);
          } else if (foundDescriptionMode === 'singlequote') {
            if (line.endsWith("'")) {
              block.push(line.substring(0, line.length - 1));
              rl.close();
              desc = block.join('\n').trim();
              if (desc === '{}' || desc === '[]') return '';
              return desc;
            }
            block.push(line);
          } else {
            // foundDescriptionMode === null
            if (inFrontmatter && line.match(/^---\s*$/)) {
              inFrontmatter = false;
              break; // Stop parsing after frontmatter closure
            }

            const match = line.match(/^description:\s*(.*)/i);
            if (match) {
              desc = match[1].trim();
              if (desc === '|' || desc === '>') {
                foundDescriptionMode = desc === '>' ? 'folded' : 'literal';
              } else if (desc.startsWith('"') && !desc.endsWith('"')) {
                foundDescriptionMode = 'doublequote';
                block.push(desc.substring(1));
              } else if (desc.startsWith("'") && !desc.endsWith("'")) {
                foundDescriptionMode = 'singlequote';
                block.push(desc.substring(1));
              } else {
                if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
                  desc = desc.substring(1, desc.length - 1);
                }
                rl.close();
                if (desc === '{}' || desc === '[]') return '';
                return desc;
              }
            }
          }
        }
      } finally {
        rl.close();
        fileStream.destroy();
      }

      if (foundDescriptionMode === 'folded' || foundDescriptionMode === 'literal') {
        desc = block.join(foundDescriptionMode === 'folded' ? ' ' : '\n').replace(/ +/g, ' ').trim();
        if (desc === '{}' || desc === '[]') return '';
        return desc;
      } else if (foundDescriptionMode === 'doublequote' || foundDescriptionMode === 'singlequote') {
        desc = block.join('\n').trim();
        if (desc === '{}' || desc === '[]') return '';
        return desc;
      }
    } catch (e) { }
  }
  return '';
}

// ========== 获取已安装列表 (异步优化与内存加速版) ==========
async function getSkillsList() {
  if (CACHED_SKILLS) {
    return CACHED_SKILLS;
  }

  const registry = await getRawRegistry();
  const actualSkills = [];
  const fileExistsAsync = async (p) => fs.promises.access(p).then(() => true).catch(() => false);

  // 1. 并发处理已在注册表中的技能
  const registryPromises = registry.map(async (skill) => {
    try {
      if (await fileExistsAsync(skill.localPath)) {
        const metaPath = path.join(skill.localPath, 'metadata.json');

        if (await fileExistsAsync(metaPath)) {
          try {
            const metaJson = await fs.promises.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaJson);
            if (meta.source_url) skill.sourceUrl = meta.source_url;
            if (meta.installed_at) skill.installedAt = meta.installed_at;
            if (meta.name) skill.name = meta.name;
            // 确保描述是字符串类型
            if (meta.description && typeof meta.description === 'string') {
              skill.description = meta.description;
            } else if (meta.description && typeof meta.description === 'object') {
              skill.description = ''; // 忽略错误的对象类型
            }
          } catch (e) { }
        }

        if (!skill.description) {
          skill.description = await extractDescription(skill.localPath);
        }

        const mdPath = path.join(skill.localPath, 'SKILL.md');
        const mdExists = await fileExistsAsync(mdPath);
        const statPath = mdExists ? mdPath : skill.localPath;
        const stats = await fs.promises.stat(statPath);
        skill.updatedAt = stats.mtime.toISOString();

        return skill;
      }
    } catch (e) { }
    return null;
  });

  const processedRegistry = await Promise.all(registryPromises);
  actualSkills.push(...processedRegistry.filter(s => s !== null));

  // 2. 扫描所有 Agent 路径 (并发扫描)
  const normalize = p => p.toLowerCase().replace(/\\/g, '/');

  const scanPromises = AGENT_CONFIGS.map(async (agentConf) => {
    const p = getPathForAgent(agentConf.id);
    try {
      if (!(await fileExistsAsync(p))) return [];
      const dirents = await fs.promises.readdir(p, { withFileTypes: true });

      const skillPromises = dirents.map(async (dirent) => {
        if (dirent.isDirectory()) {
          if (dirent.name.startsWith('.') || dirent.name.startsWith('_')) return null;

          const skillPath = path.join(p, dirent.name);
          const normSkillPath = normalize(skillPath);

          // 检查是否已经在 registry 中处理过
          if (!actualSkills.some(s => normalize(s.localPath) === normSkillPath)) {
            let sourceUrl = '未注册';
            const stats = await fs.promises.stat(skillPath);
            let installedAt = stats.birthtime.toISOString();
            let name = dirent.name;
            let description = '';

            const metaPath = path.join(skillPath, 'metadata.json');
            const mdPath = path.join(skillPath, 'SKILL.md');

            if (await fileExistsAsync(metaPath)) {
              try {
                const metaJson = await fs.promises.readFile(metaPath, 'utf-8');
                const meta = JSON.parse(metaJson);
                if (meta.source_url) sourceUrl = meta.source_url;
                if (meta.installed_at) installedAt = meta.installed_at;
                if (meta.name) name = meta.name;
                if (meta.description && typeof meta.description === 'string') {
                  description = meta.description;
                }
              } catch (e) { }
            }

            if (!description) {
              description = await extractDescription(skillPath);
            }

            const mdExists = await fileExistsAsync(mdPath);
            const updateStatPath = mdExists ? mdPath : skillPath;
            const updateStats = await fs.promises.stat(updateStatPath);
            const updatedAt = updateStats.mtime.toISOString();

            return {
              id: `local_${agentConf.id}_${dirent.name.toLowerCase()}`,
              name: name,
              description: description,
              agent: agentConf.id,
              localPath: skillPath,
              sourceUrl: sourceUrl,
              installedAt: installedAt,
              updatedAt: updatedAt
            };
          }
        }
        return null;
      });

      const results = await Promise.all(skillPromises);
      return results.filter(r => r !== null);
    } catch (e) { return []; }
  });

  const scannedResults = await Promise.all(scanPromises);
  scannedResults.forEach(res => actualSkills.push(...res));

  CACHED_SKILLS = actualSkills;

  return actualSkills;
}



// GitHub 镜像列表（直连失败时自动回退）
const GITHUB_MIRRORS = [
  '',                          // 直连
  'https://gitclone.com/',         // 2. 专用加速 (强烈推荐：专为 git clone 优化，支持缓存)
  'https://hub.fastgit.xyz/',      // 5. FastGit (速度较快，但偶尔有证书波动)
];

// 核心克隆函数，支持镜像回退
function gitCloneWithFallback(gitUrl, cloneDir, onProgress) {
  const { spawn } = require('child_process');
  const isGitHub = gitUrl.includes('github.com');
  const mirrors = isGitHub ? GITHUB_MIRRORS : [''];

  let mirrorIndex = 0;

  return new Promise((resolve, reject) => {
    function tryClone() {
      // 安全检查：防止命令注入 (Git 选项注入)
      if (gitUrl.trim().startsWith('-')) {
        reject(new Error("无效的 URL 地址：不能以 '-' 开头"));
        return;
      }

      const prefix = mirrors[mirrorIndex];
      const url = prefix ? `${prefix}${gitUrl}` : gitUrl;

      if (onProgress) onProgress({ type: 'info', text: `[${prefix ? `镜像 ${mirrorIndex + 1}` : '直连'}] ${url}\n` });

      // 清理上次失败的残留
      if (fs.existsSync(cloneDir)) fs.rmSync(cloneDir, { recursive: true, force: true });

      // 使用 -- 确保 url 不会被解析为选项
      const args = ['clone', '--depth', '1', '--', url, cloneDir];
      const child = spawn('git', args, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }
      });

      let errData = '';
      let handled = false; // 防止 close 和 error 双触发导致重复重试
      const TIMEOUT_MS = 30000;
      let timeoutTimer = setTimeout(() => {
        if (onProgress) onProgress({ type: 'info', text: `[超时] 30秒无响应，正在切换线路...\n` });
        child.kill('SIGKILL');
      }, TIMEOUT_MS);

      const resetTimer = () => {
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          if (onProgress) onProgress({ type: 'info', text: `[超时] 30秒无响应，正在切换线路...\n` });
          child.kill('SIGKILL');
        }, TIMEOUT_MS);
      };

      const handleFailure = (errorForReject) => {
        if (handled) return;
        handled = true;
        clearTimeout(timeoutTimer);
        mirrorIndex++;
        if (mirrorIndex < mirrors.length) {
          if (onProgress) onProgress({ type: 'info', text: `[回退] 尝试下一个镜像...\n` });
          tryClone();
        } else {
          reject(errorForReject);
        }
      };

      child.stderr.on('data', (data) => {
        resetTimer();
        errData += data.toString();
      });

      child.stdout.on('data', (data) => {
        resetTimer();
        if (onProgress) onProgress({ type: 'info', text: data.toString() });
      });

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        if (code === 0) {
          if (!handled) { handled = true; resolve(); }
        } else {
          const detail = errData.trim().replace(/[\r\n]+/g, ' ').substring(0, 300);
          const proxyHint = `
--------------------------------------------------
💡 提示：所有同步线路均已失败。
如果尝试多次依然不通，请检查网络或配置 Git 代理：
1. 请确保您的代理软件（如 Clash/V2Ray）已开启
2. 在命令行中运行以下指令设置代理（假设端口为 7890）：
   git config --global http.proxy http://127.0.0.1:7890
3. 检查 GitHub 官网是否能正常访问
--------------------------------------------------`;
          handleFailure(new Error(`克隆失败。${proxyHint}\n\n技术详情：${detail || '连接超时'}`));
        }
      });

      child.on('error', (err) => {
        handleFailure(err);
      });
    }
    tryClone();
  });
}

/**
 * 构造更具体的技能网页 URL
 */
function constructSpecificUrl(repoUrl, skillPath) {
  if (!skillPath || skillPath === '.') return repoUrl;
  let url = repoUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  // 如果已经是具体路径了，不再叠加
  if (url.includes('/tree/')) return url;
  if (url.includes('github.com')) {
    return `${url}/tree/master/${skillPath.replace(/^\/+/, '')}`;
  }
  return url;
}

// ========== 第一步：预览仓库中的 Skills 列表 ==========
function previewSkills(repoUrl, onProgress) {
  ensureRegistry();
  const os = require('os');
  const { gitUrl, subPath } = parseGitHubUrl(repoUrl);
  const tempDir = path.join(os.tmpdir(), `ai_skills_preview_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  if (onProgress) onProgress({ type: 'info', text: `[准备] 正在连接仓库: ${gitUrl}\n` });

  const cloneDir = path.join(tempDir, 'repo');

  return gitCloneWithFallback(gitUrl, cloneDir, onProgress).then(() => {
    let skills = [];

    // 1. 如果指定了子路径
    if (subPath) {
      const targetDir = path.join(cloneDir, ...subPath.split('/'));
      if (fs.existsSync(targetDir) && (fs.existsSync(path.join(targetDir, 'SKILL.md')) || fs.existsSync(path.join(targetDir, 'skill.md')))) {
        skills.push({ name: path.basename(targetDir), path: subPath });
      } else if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
        const subDirs = fs.readdirSync(targetDir, { withFileTypes: true });
        for (const d of subDirs) {
          if (d.isDirectory() && (fs.existsSync(path.join(targetDir, d.name, 'SKILL.md')) || fs.existsSync(path.join(targetDir, d.name, 'skill.md')))) {
            skills.push({ name: d.name, path: `${subPath}/${d.name}` });
          }
        }
      }
    }

    // 2. 默认路径
    if (skills.length === 0) {
      const skillsSubDir = path.join(cloneDir, 'skills');
      if (fs.existsSync(skillsSubDir) && fs.statSync(skillsSubDir).isDirectory()) {
        const subDirs = fs.readdirSync(skillsSubDir, { withFileTypes: true });
        for (const d of subDirs) {
          if (d.isDirectory() && (fs.existsSync(path.join(skillsSubDir, d.name, 'SKILL.md')) || fs.existsSync(path.join(skillsSubDir, d.name, 'skill.md')))) {
            skills.push({ name: d.name, path: `skills/${d.name}` });
          }
        }
      }
      if (skills.length === 0 && (fs.existsSync(path.join(cloneDir, 'SKILL.md')) || fs.existsSync(path.join(cloneDir, 'skill.md')))) {
        skills.push({ name: path.basename(gitUrl, '.git'), path: '.' });
      }
    }

    // 3. 递归深度搜索
    if (skills.length === 0) {
      if (onProgress) onProgress({ type: 'info', text: `[搜索] 标准结构未匹配，启动深度检索...\n` });
      function recursiveSearch(dir, relPath, depth = 0) {
        if (depth > 10) return; // 限制搜索深度，防止超大仓库导致挂起
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // 跳过无效和巨大的隐藏文件夹，但必须允许 .claude 等 Agent 特定文件夹
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            const full = path.join(dir, entry.name);
            const currentRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            if (fs.existsSync(path.join(full, 'SKILL.md')) || fs.existsSync(path.join(full, 'skill.md'))) {
              skills.push({ name: entry.name, path: currentRel });
            } else {
              recursiveSearch(full, currentRel, depth + 1);
            }
          }
        }
      }
      recursiveSearch(cloneDir, '');
    }

    if (skills.length === 0) {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      throw new Error("同步失败：在该仓库中未发现任何 SKILL.md 文件。请确认地址是否正确。");
    }

    // 4. 为发现的每个技能补充描述
    return Promise.all(skills.map(async (s) => {
      const sp = s.path === '.' ? cloneDir : path.join(cloneDir, ...s.path.split('/'));
      const description = await extractDescription(sp);
      return { ...s, description };
    })).then(resolvedSkills => {
      skills = resolvedSkills;
      if (onProgress) onProgress({ type: 'info', text: `[成功] 发现 ${skills.length} 个技能: ${skills.map(s => s.name).join(', ')}\n` });
      return { tempDir, cloneDir, skills, gitUrl };
    });
  }).catch((err) => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  });
}

// ========== 第二步：安装技能 ==========
function installFromPreview(previewData, selectedSkillNames, targetPaths, repoUrl, onProgress, keepTemp = false) {
  const { tempDir, cloneDir, skills } = previewData;

  try {
    const selectedSkills = skills.filter(s => selectedSkillNames.includes(s.name));

    if (selectedSkills.length === 0) {
      throw new Error("未选择任何待安装技能");
    }

    for (const skill of selectedSkills) {
      const sourcePath = skill.path === '.' ? cloneDir : path.join(cloneDir, ...skill.path.split('/'));
      const skillSpecificUrl = constructSpecificUrl(repoUrl, skill.path);

      for (const tp of targetPaths) {
        const baseDir = getPathForAgent(tp);
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

        // 安全过滤：防止路径穿越
        const safeName = path.basename(skill.name);
        if (!safeName || safeName === "." || safeName === "..") continue;
        const finalDir = path.join(baseDir, safeName);
        if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });

        fs.cpSync(sourcePath, finalDir, { recursive: true });

        // 写入元数据
        try {
          fs.writeFileSync(path.join(finalDir, 'metadata.json'), JSON.stringify({
            name: skill.name,
            description: (typeof skill.description === 'string' ? skill.description : '') || '',
            source_url: skillSpecificUrl,
            installed_at: new Date().toISOString(),
            type: "git"
          }, null, 2));
        } catch (e) { }

        // 清理 git
        const dotGit = path.join(finalDir, '.git');
        if (fs.existsSync(dotGit)) fs.rmSync(dotGit, { recursive: true, force: true });

        if (onProgress) onProgress({ type: 'info', text: `✓ 已安装 [${skill.name}] 到 ${baseDir}\n` });

        CACHED_SKILLS = null; // 废弃缓存

        // 更新注册表
        try {
          let currentReg = readRegistrySync();

          const targetIndex = currentReg.findIndex(r => r.localPath === finalDir);
          const uniqueId = targetIndex >= 0 ? currentReg[targetIndex].id : `${skill.name}_${Date.now()}`;

          const newEntry = {
            id: uniqueId,
            name: skill.name,
            description: (typeof skill.description === 'string' ? skill.description : '') || '',
            localPath: finalDir,
            sourceUrl: skillSpecificUrl,
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          if (targetIndex >= 0) {
            currentReg[targetIndex] = newEntry;
          } else {
            currentReg.push(newEntry);
          }
          saveRegistrySync(currentReg);
        } catch (e) { }
      }
    }

    if (!keepTemp && tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) { }
    }
    return true;
  } catch (err) {
    if (!keepTemp && tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) { }
    }
    throw err;
  }
}

// ========== 取消预览，清理临时目录 ==========
function cancelPreview(tempDir) {
  if (tempDir) {
    fs.rm(tempDir, { recursive: true, force: true }, () => { });
  }
}

// ========== 删除技能 ==========
async function uninstallSkill(skillId) {
  const allSkills = await getSkillsList();
  const skill = allSkills.find(s => s.id === skillId);

  if (skill && fs.existsSync(skill.localPath)) {
    fs.rmSync(skill.localPath, { recursive: true, force: true });
  }

  try {
    let registry = readRegistrySync();
    await saveRegistry(registry.filter(s => s.id !== skillId));
  } catch (e) { }

  CACHED_SKILLS = null; // 废弃缓存
  return true;
}

// ========== 更新技能 ==========
async function updateSkill(skillId, onProgress) {
  const all = await getSkillsList();
  const skill = all.find(s => s.id === skillId);

  if (!skill) return Promise.reject(new Error("找不到该技能记录"));
  if (skill.sourceUrl === '本地/未托管') {
    return Promise.reject(new Error("本地技能无源地址，请先卸载后重新通过 GitHub 安装"));
  }

  const parentDir = path.dirname(skill.localPath);

  const tryUpdate = (targetUrl) => {
    return previewSkills(targetUrl, onProgress).then(previewData => {
      // 允许模糊匹配：如果名字不完全一致（如大小写），尝试寻找最接近的
      const matched = previewData.skills.find(s => s.name.toLowerCase() === skill.name.toLowerCase());
      if (!matched) {
        cancelPreview(previewData.tempDir);
        const available = previewData.skills.map(s => s.name).join(', ');
        throw new Error(`更新失败：仓库中未找到名为 "${skill.name}" 的技能 (该仓库包含: ${available || '无'})`);
      }
      installFromPreview(previewData, [matched.name], [parentDir], targetUrl, onProgress);
      return true;
    });
  };

  // 1. 尝试原地址
  return tryUpdate(skill.sourceUrl).catch(err => {
    // 2. 自动回退主仓库地址 (剥离子路径)
    const { gitUrl } = parseGitHubUrl(skill.sourceUrl);
    if (gitUrl && (gitUrl !== skill.sourceUrl && gitUrl + '.git' !== skill.sourceUrl)) {
      if (onProgress) onProgress({ type: 'info', text: `[回馈] 精确同步失败，正在启动主仓库自动发现策略...\n` });
      return tryUpdate(gitUrl);
    }
    throw err;
  });
}

// ========== 批量更新技能 ==========
async function batchUpdateSkills(skillIds, onProgress) {
  const all = await getSkillsList();
  const results = { success: [], failed: [] };

  // 1. 提取所有待更新的有效技能，按仓库分组
  const groups = new Map();
  for (const id of skillIds) {
    const skill = all.find(s => s.id === id);
    if (!skill) {
      results.failed.push({ id, error: "找不到该技能记录" });
      continue;
    }
    if (skill.sourceUrl === '本地/未托管' || !skill.sourceUrl) {
      results.failed.push({ id, error: "本地技能无源地址" });
      continue;
    }

    const { gitUrl } = parseGitHubUrl(skill.sourceUrl);
    if (!groups.has(gitUrl)) groups.set(gitUrl, []);
    groups.get(gitUrl).push(skill);
  }

  const totalGroups = groups.size;
  if (onProgress) onProgress({ type: 'batch', text: `[批量] 准备更新 ${skillIds.length} 个技能 (涉及 ${totalGroups} 个仓库)...\n` });

  // 2. 按仓库进行批量更新（仓库内部串行，确保进度日志清晰）
  for (const [gitUrl, skills] of groups.entries()) {
    if (onProgress) onProgress({ type: 'batch', text: `[仓库] 正在同步: ${gitUrl}\n` });

    let previewData = null;
    try {
      // 克隆一次仓库
      previewData = await previewSkills(gitUrl, onProgress);

      for (const skill of skills) {
        try {
          // 在克隆结果中寻找对应的技能（模糊匹配名字）
          const matched = previewData.skills.find(s => s.name.toLowerCase() === skill.name.toLowerCase());
          if (!matched) {
            throw new Error(`仓库中未找到名为 "${skill.name}" 的技能`);
          }

          const parentDir = path.dirname(skill.localPath);
          // 执行安装（保留临时目录供该组后续技能使用）
          installFromPreview(previewData, [matched.name], [parentDir], gitUrl, onProgress, true);

          results.success.push(skill.id);
          if (onProgress) onProgress({ type: 'batch', text: `[批量] ✓ ${skill.name} 更新成功\n` });
        } catch (innerErr) {
          results.failed.push({ id: skill.id, error: innerErr.message });
          if (onProgress) onProgress({ type: 'batch', text: `[批量] ✗ ${skill.name} 失败: ${innerErr.message}\n` });
        }
      }
    } catch (repoErr) {
      // 整个仓库克隆/预览失败
      for (const skill of skills) {
        results.failed.push({ id: skill.id, error: `仓库同步失败: ${repoErr.message}` });
      }
      if (onProgress) onProgress({ type: 'batch', text: `[批量] ✗ 仓库 ${gitUrl} 同步失败: ${repoErr.message}\n` });
    } finally {
      // 最后统一清理临时目录
      if (previewData && previewData.tempDir) {
        cancelPreview(previewData.tempDir);
      }
    }
  }

  return results;
}

// ========== 批量删除技能 ==========
async function batchDeleteSkills(skillIds) {
  const results = { success: [], failed: [] };
  for (const id of skillIds) {
    try {
      await uninstallSkill(id);
      results.success.push(id);
    } catch (err) {
      results.failed.push({ id, error: err.message });
    }
  }
  return results;
}

// ========== Shell 辅助 ==========
function openLocalPath(localPath) {
  if (!localPath) return;

  try {
    const { shell } = require('electron');
    if (shell && shell.showItemInFolder) {
      shell.showItemInFolder(localPath);
      return;
    }
  } catch (e) { }

  const { spawn } = require('child_process');
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      spawn('explorer', [localPath.replace(/\//g, '\\')], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [localPath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [localPath], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.error('openLocalPath failed:', e);
  }
}

function openUrl(url) {
  if (!url) return;

  // 优先尝试使用 electron 的 shell API (最直接、最安全的系统原生调用)
  try {
    const { shell } = require('electron');
    if (shell && shell.openExternal) {
      shell.openExternal(url);
      return;
    }
  } catch (e) { }

  const { spawn } = require('child_process');
  const platform = process.platform;

  try {
    // 统一的安全过滤：仅允许合规的 http/https URL
    if (!/^https?:\/\/[^\s"&|^<>]+$/.test(url)) return;

    if (platform === 'win32') {
      // 使用 explorer 彻底避免 cmd /c 执行带来的命令注入和转义问题
      spawn('explorer', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.error('openUrl failed:', e);
  }
}

// ========== 导出技能配置（不含源文件） ==========
async function exportSkillsConfig() {
  const allSkills = await getSkillsList();

  function detectAgent(localPath) {
    if (!localPath) return 'antigravity';
    const lp = localPath.toLowerCase().replace(/\\/g, '/');

    // 优先匹配具体配置的路径
    for (const agent of AGENT_CONFIGS) {
      if (lp.includes(agent.path.toLowerCase())) return agent.id;
    }

    // 兜底逻辑：如果包含 /skills 且没有具体 ID 匹配，视作 OpenClaw
    if (lp.endsWith('/skills') || lp.includes('/skills/')) return 'openclaw';

    return 'antigravity';
  }

  // 按仓库分组
  const repoGroups = new Map();
  const unmanaged = [];

  for (const skill of allSkills) {
    const agent = detectAgent(skill.localPath);
    if (!skill.sourceUrl || skill.sourceUrl === '本地/未托管') {
      unmanaged.push({ name: skill.name, agent });
      continue;
    }
    // 提取仓库主地址
    const m = skill.sourceUrl.match(/(https:\/\/github\.com\/[^/]+\/[^/]+)/);
    const repoUrl = m ? m[1] : skill.sourceUrl;
    const key = repoUrl;

    if (!repoGroups.has(key)) {
      repoGroups.set(key, { url: repoUrl, skills: [], targets: new Set() });
    }
    const g = repoGroups.get(key);
    if (!g.skills.includes(skill.name)) g.skills.push(skill.name);
    g.targets.add(agent);
  }

  const config = {
    version: 1,
    exportedAt: new Date().toISOString(),
    description: "AI-Skills管理器 配置清单 — 仅包含安装信息，不含源文件",
    repositories: Array.from(repoGroups.values()).map(g => ({
      url: g.url,
      skills: g.skills,
      targets: Array.from(g.targets)
    })),
    unmanaged: unmanaged
  };

  return JSON.stringify(config, null, 2);
}

// ========== 导入技能配置 ==========
async function importSkillsConfig(configJson, onProgress) {
  let config;
  try {
    config = JSON.parse(configJson);
  } catch (e) {
    throw new Error("配置文件格式无效：不是合法的 JSON");
  }
  if (!config.version || !config.repositories) {
    throw new Error("配置文件格式无效：缺少 version 或 repositories 字段");
  }

  const results = { success: [], failed: [], skipped: [] };
  const total = config.repositories.length;

  const CONCURRENCY = 2;
  for (let i = 0; i < total; i += CONCURRENCY) {
    const chunk = config.repositories.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (repo) => {
      if (onProgress) onProgress({ type: 'batch', text: `[导入] 正在处理仓库: ${repo.url}\n` });

      try {
        const previewData = await previewSkills(repo.url, onProgress);
        const availableNames = previewData.skills.map(s => s.name);
        // 只安装配置中指定的 AND 仓库中实际存在的
        const toInstall = repo.skills.filter(name => availableNames.includes(name));
        const skippedNames = repo.skills.filter(name => !availableNames.includes(name));

        if (toInstall.length > 0) {
          const targets = repo.targets || ['antigravity'];
          installFromPreview(previewData, toInstall, targets, repo.url, onProgress);
          results.success.push(...toInstall.map(n => ({ name: n, repo: repo.url })));
        }
        if (skippedNames.length > 0) {
          results.skipped.push(...skippedNames.map(n => ({ name: n, repo: repo.url, reason: '仓库中不存在' })));
        }

        cancelPreview(previewData.tempDir);
      } catch (err) {
        results.failed.push({ repo: repo.url, error: err.message });
        if (onProgress) onProgress({ type: 'batch', text: `[导入] ✗ ${repo.url} 失败: ${err.message}\n` });
      }
    }));
  }

  if (config.unmanaged && config.unmanaged.length > 0) {
    results.skipped.push(...config.unmanaged.map(s => ({ name: s.name, reason: '本地/未托管，需手动处理' })));
  }

  return results;
}

// 保存文件对话框辅助
function saveFileDialog(content, targetPath) {
  const os = require('os');
  const home = os.homedir();
  let filePath = targetPath;

  // 如果不是绝对路径，则当作文件名并拼接到 Desktop
  if (!path.isAbsolute(targetPath)) {
    const safeName = path.basename(targetPath);
    filePath = path.join(home, 'Desktop', safeName);
    if (!fs.existsSync(path.dirname(filePath))) {
      filePath = path.join(home, safeName);
    }
    if (!fs.existsSync(path.dirname(filePath))) {
      filePath = path.join(SKILLS_DIR, safeName);
    }
  }

  // 确保父目录存在
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, content, 'utf-8');

  // 保存后自动打开所在文件夹并选中
  try {
    const { spawn } = require('child_process');
    const platform = process.platform;
    const absPath = path.resolve(filePath);

    if (platform === 'win32') {
      const winPath = absPath.replace(/\//g, '\\');
      spawn('explorer', ['/select,', winPath], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', ['-R', absPath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // Linux 下通常只能打开目录
      spawn('xdg-open', [path.dirname(absPath)], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.error('Failed to open file manager:', e);
  }

  return filePath;
}

// 选择保存路径
function selectSavePath(defaultName = 'ai-skills-manager-backup.json') {
  return new Promise((resolve) => {
    const platform = process.platform;
    const os = require('os');
    const home = os.homedir();

    if (platform === 'win32') {
      const { spawn } = require('child_process');
      // 严格转义文件名：PowerShell 单引号内双写单引号，并过滤换行符
      const escapedName = defaultName.replace(/'/g, "''").replace(/[\n\r]/g, "");
      const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.SaveFileDialog; $f.FileName = '${escapedName}'; $f.Filter = 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'; $f.Title = '选择导出位置'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileName }`;

      const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], { encoding: 'utf-8' });
      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.on('close', () => {
        resolve(output ? output.trim() : null);
      });
      return;
    } else if (platform === 'darwin') {
      const { spawn } = require('child_process');
      // 严格转义文件名：AppleScript 双引号中使用反斜杠转义双引号，并过滤换行符
      const escapedName = defaultName.replace(/"/g, '\\"').replace(/[\n\r]/g, "");
      const script = `POSIX path of (choose file name with prompt "选择导出位置" default name "${escapedName}")`;
      const child = spawn('osascript', ['-e', script], { encoding: 'utf-8' });
      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.on('close', () => {
        resolve(output ? output.trim() : null);
      });
      return;
    }

    // Linux 或其他平台回退：默认保存到桌面
    const desktop = path.join(home, 'Desktop');
    if (fs.existsSync(desktop)) {
      resolve(path.join(desktop, defaultName));
    } else {
      resolve(path.join(home, defaultName));
    }
  });
}

// ========== 分发技能到其他 Agent ==========
async function distributeSkill(skillId, targetAgents) {
  const all = await getSkillsList();
  const skill = all.find(s => s.id === skillId);
  if (!skill) throw new Error("找不到该技能记录");

  for (const agent of targetAgents) {
    const baseDir = getPathForAgent(agent);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    // 安全过滤：防止路径穿越
    const safeName = path.basename(skill.name);
    if (!safeName || safeName === "." || safeName === "..") continue;
    const finalDir = path.join(baseDir, safeName);
    if (finalDir.toLowerCase() === skill.localPath.toLowerCase()) continue;
    if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
    fs.cpSync(skill.localPath, finalDir, { recursive: true });

    try {
      let currentReg = readRegistrySync();
      if (!currentReg.some(r => r.localPath === finalDir)) {
        currentReg.push({
          id: `${skill.name}_${agent}_${Date.now()}`,
          name: skill.name,
          description: (typeof skill.description === 'string' ? skill.description : '') || '',
          localPath: finalDir,
          agent,
          sourceUrl: skill.sourceUrl,
          installedAt: skill.installedAt,
          updatedAt: new Date().toISOString()
        });
        await saveRegistry(currentReg);
      }
    } catch (e) { }
  }
  CACHED_SKILLS = null; // 废弃缓存
  return true;
}

function getSupportedAgents() { return AGENT_CONFIGS; }

// 挂载
window.preloadAPI = {
  getSkillsList, getSupportedAgents, previewSkills, installFromPreview, distributeSkill, cancelPreview,
  openLocalPath, openUrl, selectSavePath, uninstallSkill, updateSkill, batchUpdateSkills, batchDeleteSkills,
  exportSkillsConfig, importSkillsConfig, saveFileDialog, migrateLegacyData,
  refreshRegistry: async () => {
    CACHED_SKILLS = null;
    ensureRegistry();
    return await getSkillsList();
  }
};

