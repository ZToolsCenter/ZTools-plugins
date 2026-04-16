const fs = require('fs');
const path = require('path');

/**
 * ZTools 预加载脚本 — AI-Skills管理器
 * 两步安装流程：预览 → 选择 → 安装
 */

const SKILLS_DIR = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'skills')
  : path.join(process.env.HOME || '/', '.gemini', 'antigravity', 'skills');

const REGISTRY_FILE = path.join(SKILLS_DIR, 'registry.json');

const AGENT_CONFIGS = [
  { id: 'antigravity', name: 'Antigravity', path: '.gemini/antigravity/skills' },
  { id: 'claudecode', name: 'Claude Code', path: '.claude/skills' },
  { id: 'trae', name: 'Trae', path: '.trae/skills' },
  { id: 'traecn', name: 'Trae CN', path: '.trae/skills' },
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
  return agentId;
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

// 解析 GitHub 地址 → { gitUrl, subPath }
function parseGitHubUrl(input) {
  let url = input.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  const fullMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)(?:\/tree\/([^/]+)\/(.+))?$/);
  if (fullMatch) {
    return {
      gitUrl: `https://github.com/${fullMatch[1]}.git`,
      subPath: fullMatch[3] || null
    };
  }

  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(url)) {
    return { gitUrl: `https://github.com/${url}.git`, subPath: null };
  }

  return {
    gitUrl: url.startsWith('http') ? url + '.git' : `https://github.com/${url}.git`,
    subPath: null
  };
}

// ========== 获取已安装列表 ==========
function getSkillsList() {
  ensureRegistry();
  let registry = [];
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
  } catch (error) {
    console.error("读取 registry.json 失败:", error);
  }

  const actualSkills = [];

  // 处理已在注册表中的技能
  for (const skill of registry) {
    try {
      if (fs.existsSync(skill.localPath)) {
        const metaPath = path.join(skill.localPath, 'metadata.json');

        // 如果元数据文件存在，读取并同步到内存对象
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (meta.source_url) skill.sourceUrl = meta.source_url;
            if (meta.installed_at) skill.installedAt = meta.installed_at;
            if (meta.name) skill.name = meta.name;
          } catch (e) { }
        }

        // 确保 updatedAt 始终反映文件的最新修改
        const mdPath = path.join(skill.localPath, 'SKILL.md');
        if (fs.existsSync(mdPath)) {
          skill.updatedAt = fs.statSync(mdPath).mtime.toISOString();
        } else {
          skill.updatedAt = fs.statSync(skill.localPath).mtime.toISOString();
        }

        actualSkills.push(skill);
      }
    } catch (e) { }
  }

  // 扫描所有 Agent 路径 (宽松补全模式)
  const agentsToScan = AGENT_CONFIGS.map(a => a.id);
  const normalize = p => p.toLowerCase().replace(/\\/g, '/');

  for (const agent of agentsToScan) {
    try {
      const p = getPathForAgent(agent);
      if (!fs.existsSync(p)) continue;
      const dirents = fs.readdirSync(p, { withFileTypes: true });
      for (const dirent of dirents) {
        if (dirent.isDirectory()) {
          // 排除隐藏文件夹和以等下划线开头的临时文件夹
          if (dirent.name.startsWith('.') || dirent.name.startsWith('_')) continue;

          const skillPath = path.join(p, dirent.name);
          const normSkillPath = normalize(skillPath);

          // 只要是目录，就尝试作为技能被识别
          if (!actualSkills.some(s => normalize(s.localPath) === normSkillPath)) {
            let sourceUrl = '未注册';
            let installedAt = fs.statSync(skillPath).birthtime.toISOString();
            let name = dirent.name;

            const metaPath = path.join(skillPath, 'metadata.json');
            const mdPath = path.join(skillPath, 'SKILL.md');

            if (fs.existsSync(metaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                if (meta.source_url) sourceUrl = meta.source_url;
                if (meta.installed_at) installedAt = meta.installed_at;
                if (meta.name) name = meta.name;
              } catch (e) { }
            }

            let updatedAt = fs.existsSync(mdPath)
              ? fs.statSync(mdPath).mtime.toISOString()
              : fs.statSync(skillPath).mtime.toISOString();

            actualSkills.push({
              id: `local_${agent}_${dirent.name.toLowerCase()}`,
              name: name,
              agent: agent,
              localPath: skillPath,
              sourceUrl: sourceUrl,
              installedAt: installedAt,
              updatedAt: updatedAt
            });
          }
        }
      }
    } catch (e) { }
  }
  return actualSkills;
}

function saveRegistry(registry) {
  ensureRegistry();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// GitHub 镜像列表（直连失败时自动回退）
const GITHUB_MIRRORS = [
  '',                          // 直连
  'https://ghproxy.net/',      // 稳定镜像1（优先）
  'https://ghps.cc/',          // 稳定镜像2
  'https://gh-proxy.com/',     // 镜像3
];

// 核心克隆函数，支持镜像回退
function gitCloneWithFallback(gitUrl, cloneDir, onProgress) {
  const { spawn } = require('child_process');
  const isGitHub = gitUrl.includes('github.com');
  const mirrors = isGitHub ? GITHUB_MIRRORS : [''];

  let mirrorIndex = 0;

  return new Promise((resolve, reject) => {
    function tryClone() {
      const prefix = mirrors[mirrorIndex];
      const url = prefix ? `${prefix}${gitUrl}` : gitUrl;

      if (onProgress) onProgress({ type: 'info', text: `[${prefix ? `镜像 ${mirrorIndex + 1}` : '直连'}] ${url}\n` });

      // 清理上次失败的残留
      if (fs.existsSync(cloneDir)) fs.rmSync(cloneDir, { recursive: true, force: true });

      const args = ['clone', '--depth', '1', url, cloneDir];
      const child = spawn('git', args, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
        shell: true // 使用 shell: true 兼容 Windows 上的 git 命令路径
      });

      let errData = '';
      const TIMEOUT_MS = 5000;
      let timeoutTimer = setTimeout(() => {
        if (onProgress) onProgress({ type: 'info', text: `[超时] 5秒无响应，正在切换线路...\n` });
        child.kill('SIGKILL');
      }, TIMEOUT_MS);

      const resetTimer = () => {
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          if (onProgress) onProgress({ type: 'info', text: `[超时] 5秒无响应，正在切换线路...\n` });
          child.kill('SIGKILL');
        }, TIMEOUT_MS);
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
          resolve();
        } else {
          mirrorIndex++;
          if (mirrorIndex < mirrors.length) {
            if (onProgress) onProgress({ type: 'info', text: `[回退] 尝试下一个镜像...\n` });
            tryClone();
          } else {
            const detail = errData.trim().replace(/[\r\n]+/g, ' ').substring(0, 300);
            reject(new Error(`所有线路均失败: ${detail || '网络不可达'}`));
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        mirrorIndex++;
        if (mirrorIndex < mirrors.length) {
          tryClone();
        } else {
          reject(err);
        }
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
  const { gitUrl, subPath } = parseGitHubUrl(repoUrl);
  const tempDir = path.join(SKILLS_DIR, `_preview_${Date.now()}`);

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
      function recursiveSearch(dir, relPath) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // 跳过无效和巨大的隐藏文件夹，但必须允许 .claude 等 Agent 特定文件夹
            if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'assets') continue;
            const full = path.join(dir, entry.name);
            const currentRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            if (fs.existsSync(path.join(full, 'SKILL.md')) || fs.existsSync(path.join(full, 'skill.md'))) {
              skills.push({ name: entry.name, path: currentRel });
            } else {
              recursiveSearch(full, currentRel);
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

    if (onProgress) onProgress({ type: 'info', text: `[成功] 发现 ${skills.length} 个技能: ${skills.map(s => s.name).join(', ')}\n` });
    return { tempDir, cloneDir, skills, gitUrl };
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

        const finalDir = path.join(baseDir, skill.name);
        if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });

        fs.cpSync(sourcePath, finalDir, { recursive: true });

        // 写入元数据
        try {
          fs.writeFileSync(path.join(finalDir, 'metadata.json'), JSON.stringify({
            name: skill.name,
            source_url: skillSpecificUrl,
            installed_at: new Date().toISOString(),
            type: "git"
          }, null, 2));
        } catch (e) { }

        // 清理 git
        const dotGit = path.join(finalDir, '.git');
        if (fs.existsSync(dotGit)) fs.rmSync(dotGit, { recursive: true, force: true });

        if (onProgress) onProgress({ type: 'info', text: `✓ 已安装 [${skill.name}] 到 ${baseDir}\n` });

        // 更新注册表
        try {
          let currentReg = [];
          try { currentReg = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')); } catch (e) { }

          const targetIndex = currentReg.findIndex(r => r.localPath === finalDir);
          const uniqueId = targetIndex >= 0 ? currentReg[targetIndex].id : `${skill.name}_${Date.now()}`;

          const newEntry = {
            id: uniqueId,
            name: skill.name,
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
          fs.writeFileSync(REGISTRY_FILE, JSON.stringify(currentReg, null, 2));
        } catch (e) { }
      }
    }

    if (!keepTemp && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    return true;
  } catch (err) {
    if (!keepTemp && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

// ========== 取消预览，清理临时目录 ==========
function cancelPreview(tempDir) {
  try {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (e) { }
}

// ========== 删除技能 ==========
function uninstallSkill(skillId) {
  const allSkills = getSkillsList();
  const skill = allSkills.find(s => s.id === skillId);

  if (skill && fs.existsSync(skill.localPath)) {
    fs.rmSync(skill.localPath, { recursive: true, force: true });
  }

  try {
    let registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
    saveRegistry(registry.filter(s => s.id !== skillId));
  } catch (e) { }

  return true;
}

// ========== 更新技能 ==========
function updateSkill(skillId, onProgress) {
  const all = getSkillsList();
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
// ========== 批量更新技能 (逐个独立拉取) ==========
async function batchUpdateSkills(skillIds, onProgress) {
  const all = getSkillsList();
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
function batchDeleteSkills(skillIds) {
  const results = { success: [], failed: [] };
  for (const id of skillIds) {
    try {
      uninstallSkill(id);
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
  const { exec } = require('child_process');
  const platform = process.platform;
  let command = '';

  if (platform === 'win32') {
    command = `explorer "${localPath.replace(/\//g, '\\')}"`;
  } else if (platform === 'darwin') {
    command = `open "${localPath}"`;
  } else {
    command = `xdg-open "${localPath}"`;
  }

  try {
    exec(command);
  } catch (e) {
    console.error('openLocalPath failed:', e);
  }
}

function openUrl(url) {
  if (!url) return;
  const { exec } = require('child_process');
  const platform = process.platform;
  let command = '';

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  try {
    exec(command);
  } catch (e) {
    console.error('openUrl failed:', e);
  }
}

// ========== 导出技能配置（不含源文件） ==========
function exportSkillsConfig() {
  const allSkills = getSkillsList();

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
    filePath = path.join(home, 'Desktop', targetPath);
    if (!fs.existsSync(path.dirname(filePath))) {
      filePath = path.join(home, targetPath);
    }
    if (!fs.existsSync(path.dirname(filePath))) {
      filePath = path.join(SKILLS_DIR, targetPath);
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
    const { exec } = require('child_process');
    const winPath = path.resolve(filePath).replace(/\//g, '\\');
    exec(`cmd /c explorer /select,"${winPath}"`);
  } catch (e) {
    console.error('Failed to open explorer:', e);
  }

  return filePath;
}

// 选择保存路径（通过 PowerShell 调用原生对话框）
function selectSavePath(defaultName = 'skills-hub-backup.json') {
  if (process.platform !== 'win32') {
    // 非 Windows 平台暂不支持原生对话框，返回 null 让前端处理
    return null;
  }
  const { execSync } = require('child_process');
  try {
    // 转义文件名中的单引号，防止注入
    const escapedName = defaultName.replace(/'/g, "''");
    const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.SaveFileDialog; $f.FileName = '${escapedName}'; $f.Filter = 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'; $f.Title = '选择导出位置'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileName }`;
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`, { encoding: 'utf-8' }).trim();
    return result || null;
  } catch (e) {
    console.error('Native dialog failed:', e);
    return null;
  }
}

// ========== 分发技能到其他 Agent ==========
function distributeSkill(skillId, targetAgents) {
  const all = getSkillsList();
  const skill = all.find(s => s.id === skillId);
  if (!skill) throw new Error("找不到该技能记录");

  for (const agent of targetAgents) {
    const baseDir = getPathForAgent(agent);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    const finalDir = path.join(baseDir, skill.name);
    if (finalDir.toLowerCase() === skill.localPath.toLowerCase()) continue;
    if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
    fs.cpSync(skill.localPath, finalDir, { recursive: true });

    try {
      let currentReg = [];
      try { currentReg = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')); } catch (e) { }
      if (!currentReg.some(r => r.localPath === finalDir)) {
        currentReg.push({ id: `${skill.name}_${agent}_${Date.now()}`, name: skill.name, localPath: finalDir, agent, sourceUrl: skill.sourceUrl, installedAt: skill.installedAt, updatedAt: new Date().toISOString() });
        saveRegistry(currentReg);
      }
    } catch (e) { }
  }
  return true;
}

function getSupportedAgents() { return AGENT_CONFIGS; }

// 挂载
window.preloadAPI = {
  getSkillsList, getSupportedAgents, previewSkills, installFromPreview, distributeSkill, cancelPreview,
  openLocalPath, openUrl, selectSavePath, uninstallSkill, updateSkill, batchUpdateSkills, batchDeleteSkills,
  exportSkillsConfig, importSkillsConfig, saveFileDialog,
  refreshRegistry: () => { ensureRegistry(); return getSkillsList(); }
};

