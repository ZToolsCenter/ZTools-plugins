const fs = require('fs');
const path = require('path');

/**
 * ZTools 预加载脚本 — AI Skills Hub
 * 两步安装流程：预览 → 选择 → 安装
 */

const SKILLS_DIR = process.env.USERPROFILE 
  ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'skills')
  : path.join(process.env.HOME || '/', '.gemini', 'antigravity', 'skills');

const REGISTRY_FILE = path.join(SKILLS_DIR, 'registry.json');

// 解析多 Agent 框架路径
function getPathForAgent(agent) {
  const home = process.env.USERPROFILE || process.env.HOME || '/';
  switch (agent) {
    case 'antigravity': return path.join(home, '.gemini', 'antigravity', 'skills');
    case 'claudecode': return path.join(home, '.claude', 'skills');
    case 'openclaw': return path.join(home, 'skills');
    case 'qoder': return path.join(home, '.qoder', 'skills');
    case 'qwencode': return path.join(home, '.qwen', 'skills');
    case 'trae': return path.join(home, '.trae', 'skills');
    default: return agent;
  }
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

/**
 * 动态审计并修复技能元数据
 * 策略：基于“已知主仓库”进行反向自动关联
 * 1. 从注册表中提取所有出现过的源地址，建立“主仓库映射库”
 * 2. 扫描所有 Agent 路径，补全那些名字匹配但地址缺失的技能
 */
function auditAndRepair(registry) {
  let changed = false;
  
  // 1. 建立仓库指纹库 { skillName: fullSourceUrl }
  const repoFingerprints = {};
  
  // 从当前的注册表中提取已知有效的映射
  for (const skill of registry) {
    if (skill.sourceUrl && skill.sourceUrl !== '未注册') {
      repoFingerprints[skill.name] = skill.sourceUrl;
    }
  }

  // 从全机 metadata.json 中进一步收集知识
  const agents = ['antigravity', 'claudecode', 'openclaw', 'qoder', 'qwencode', 'trae'];
  for (const agent of agents) {
    try {
      const p = getPathForAgent(agent);
      if (!fs.existsSync(p)) continue;
      const dirs = fs.readdirSync(p, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const metaPath = path.join(p, d.name, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (m.source_url && m.source_url !== '未注册') {
              if (!repoFingerprints[d.name]) repoFingerprints[d.name] = m.source_url;
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  // 2. 根据收集到的指纹自动修复那些“失联”的技能
  for (const skill of registry) {
    const metaPath = path.join(skill.localPath, 'metadata.json');
    let hasMeta = fs.existsSync(metaPath);
    
    // 如果没有源地址，看库里有没有存过它的“老家”
    if (!skill.sourceUrl || skill.sourceUrl === '未注册') {
       if (repoFingerprints[skill.name]) {
         skill.sourceUrl = repoFingerprints[skill.name];
         changed = true;
       }
    }

    // 同步到物理 metadata.json
    if (skill.sourceUrl && skill.sourceUrl !== '未注册') {
      let needsWrite = !hasMeta;
      if (hasMeta) {
        try {
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (m.source_url !== skill.sourceUrl) needsWrite = true;
        } catch(e) { needsWrite = true; }
      }
      
      if (needsWrite) {
        try {
          fs.writeFileSync(metaPath, JSON.stringify({
            name: skill.name,
            source_url: skill.sourceUrl,
            installed_at: skill.installedAt || new Date().toISOString(),
            type: "git"
          }, null, 2));
        } catch(e) {}
      }
    }
  }

  if (changed) {
    saveRegistry(registry);
  }
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

  // 动态审计
  auditAndRepair(registry);

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
          } catch (e) {}
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
    } catch(e) {}
  }

  // 扫描常见 Agent 路径 (Antigravity, Claude Code, etc.)
  const agentsToScan = ['antigravity', 'claudecode', 'openclaw', 'qoder', 'qwencode', 'trae'];
  for (const agent of agentsToScan) {
    try {
      const p = getPathForAgent(agent);
      if (!fs.existsSync(p)) continue;
      const dirents = fs.readdirSync(p, { withFileTypes: true });
      for (const dirent of dirents) {
        if (dirent.isDirectory()) {
          const skillPath = path.join(p, dirent.name);
          const mdPath = path.join(skillPath, 'SKILL.md');
          const metaPath = path.join(skillPath, 'metadata.json');
          
          if (fs.existsSync(mdPath) || fs.existsSync(metaPath)) {
            if (!actualSkills.some(s => s.localPath === skillPath)) {
              let sourceUrl = '未注册';
              let installedAt = fs.statSync(skillPath).birthtime.toISOString();
              let name = dirent.name;
              
              if (fs.existsSync(metaPath)) {
                try {
                  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                  if (meta.source_url) sourceUrl = meta.source_url;
                  if (meta.installed_at) installedAt = meta.installed_at;
                  if (meta.name) name = meta.name;
                } catch(e) {}
              }
              
              let updatedAt = fs.existsSync(mdPath) 
                ? fs.statSync(mdPath).mtime.toISOString() 
                : fs.statSync(skillPath).mtime.toISOString();

              actualSkills.push({
                id: `local_${agent}_${dirent.name}`,
                name: name,
                localPath: skillPath,
                sourceUrl: sourceUrl,
                installedAt: installedAt,
                updatedAt: updatedAt
              });
            }
          }
        }
      }
    } catch (e) {}
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
  'https://ghps.cc/',          // 镜像1
];

// 核心克隆函数，支持镜像回退
function gitCloneWithFallback(gitUrl, cloneDir, onProgress) {
  const { exec } = require('child_process');
  const isGitHub = gitUrl.includes('github.com');
  const mirrors = isGitHub ? GITHUB_MIRRORS : [''];
  
  let mirrorIndex = 0;
  
  return new Promise((resolve, reject) => {
    function tryClone() {
      const prefix = mirrors[mirrorIndex];
      const url = prefix ? `${prefix}${gitUrl}` : gitUrl;
      
      if (onProgress) onProgress({ type: 'info', text: `[${prefix ? '镜像' + mirrorIndex : '直连'}] ${url}\n` });
      
      // 清理上次失败的残留
      if (fs.existsSync(cloneDir)) fs.rmSync(cloneDir, { recursive: true, force: true });
      
      let errData = '';
      const child = exec(`git clone --depth 1 "${url}" "${cloneDir}"`, {
        encoding: 'utf-8', shell: true, maxBuffer: 1024 * 1024 * 50,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }
      });
      
      child.stderr.on('data', (chunk) => { errData += chunk; });
      child.stdout.on('data', (chunk) => { if (onProgress) onProgress({ type: 'info', text: chunk.toString() }); });
      
      child.on('close', (code) => {
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
        mirrorIndex++;
        if (mirrorIndex < mirrors.length) { tryClone(); }
        else { reject(err); }
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
function installFromPreview(previewData, selectedSkillNames, targetPaths, repoUrl, onProgress) {
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
        } catch (e) {}

        // 清理 git
        const dotGit = path.join(finalDir, '.git');
        if (fs.existsSync(dotGit)) fs.rmSync(dotGit, { recursive: true, force: true });

        if (onProgress) onProgress({ type: 'info', text: `✓ 已安装 [${skill.name}] 到 ${baseDir}\n` });

        // 更新注册表
        try {
          let currentReg = [];
          try { currentReg = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')); } catch (e) {}

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
        } catch (e) {}
      }
    }

    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    return true;
  } catch (err) {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

// ========== 取消预览，清理临时目录 ==========
function cancelPreview(tempDir) {
  try {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch(e) {}
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
  } catch(e) {}
  
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
async function batchUpdateSkills(skillIds, onProgress) {
  const results = { success: [], failed: [] };
  const total = skillIds.length;
  for (let i = 0; i < total; i++) {
    const id = skillIds[i];
    if (onProgress) onProgress({ type: 'batch', text: `[批量] 正在更新 (${i + 1}/${total}): ${id}\n` });
    try {
      await updateSkill(id, onProgress);
      results.success.push(id);
      if (onProgress) onProgress({ type: 'batch', text: `[批量] ✓ ${id} 更新成功\n` });
    } catch (err) {
      results.failed.push({ id, error: err.message });
      if (onProgress) onProgress({ type: 'batch', text: `[批量] ✗ ${id} 更新失败: ${err.message}\n` });
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
  try {
    const { exec } = require('child_process');
    exec(`explorer "${localPath.replace(/\//g, '\\')}"`);
  } catch (e) {
    console.error('openLocalPath failed:', e);
  }
}

function openUrl(url) {
  if (!url) return;
  try {
    const { exec } = require('child_process');
    exec(`start "" "${url}"`);
  } catch (e) {
    console.error('openUrl failed:', e);
  }
}

// ========== 导出技能配置（不含源文件） ==========
function exportSkillsConfig() {
  const allSkills = getSkillsList();
  const agentMap = {
    '.gemini/antigravity/skills': 'antigravity',
    '.gemini\\\\antigravity\\\\skills': 'antigravity',
    '.claude/skills': 'claudecode',
    '.claude\\\\skills': 'claudecode',
    '.qoder/skills': 'qoder',
    '.qoder\\\\skills': 'qoder',
    '.qwen/skills': 'qwencode',
    '.qwen\\\\skills': 'qwencode',
    '.trae/skills': 'trae',
    '.trae\\\\skills': 'trae',
    '/skills': 'openclaw',
    '\\\\skills': 'openclaw'
  };

  function detectAgent(localPath) {
    if (!localPath) return 'antigravity';
    const lp = localPath.toLowerCase().replace(/\\\\/g, '/');
    if (lp.includes('.gemini/antigravity/skills')) return 'antigravity';
    if (lp.includes('.claude/skills')) return 'claudecode';
    if (lp.includes('.qoder/skills')) return 'qoder';
    if (lp.includes('.qwen/skills')) return 'qwencode';
    if (lp.includes('.trae/skills')) return 'trae';
    if (lp.endsWith('/skills/' + path.basename(localPath))) return 'openclaw';
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
    description: "AI Skills Hub 配置清单 — 仅包含安装信息，不含源文件",
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

  for (let i = 0; i < total; i++) {
    const repo = config.repositories[i];
    if (onProgress) onProgress({ type: 'batch', text: `[导入] (${i + 1}/${total}) 处理仓库: ${repo.url}\n` });

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
  }

  if (config.unmanaged && config.unmanaged.length > 0) {
    results.skipped.push(...config.unmanaged.map(s => ({ name: s.name, reason: '本地/未托管，需手动处理' })));
  }

  return results;
}

// 保存文件对话框辅助
function saveFileDialog(content, defaultName) {
  const os = require('os');
  const home = os.homedir();
  let filePath = path.join(home, 'Desktop', defaultName);
  
  // 检查 Desktop 是否存在
  if (!fs.existsSync(path.dirname(filePath))) {
    // 尝试直接在家目录保存
    filePath = path.join(home, defaultName);
  }
  
  // 如果还是不行（极少见），保存在插件配置目录
  if (!fs.existsSync(path.dirname(filePath))) {
    filePath = path.join(SKILLS_DIR, defaultName);
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  
  // 保存后自动打开所在文件夹并选中
  try {
    const { exec } = require('child_process');
    const winPath = path.resolve(filePath).replace(/\//g, '\\');
    // 使用 cmd /c 确保命令在 Windows 环境下更准确执行
    exec(`cmd /c explorer /select,"${winPath}"`);
  } catch (e) {
    console.error('Failed to open explorer:', e);
  }

  return filePath;
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
    // 如果目标路径和当前路径一致，跳过
    if (finalDir.toLowerCase() === skill.localPath.toLowerCase()) continue;

    if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
    fs.cpSync(skill.localPath, finalDir, { recursive: true });

    // 更新注册表
    try {
      let currentReg = [];
      try { currentReg = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')); } catch (e) {}
      
      if (!currentReg.some(r => r.localPath === finalDir)) {
        currentReg.push({
          id: `${skill.name}_${agent}_${Date.now()}`,
          name: skill.name,
          localPath: finalDir,
          sourceUrl: skill.sourceUrl,
          installedAt: skill.installedAt,
          updatedAt: new Date().toISOString()
        });
        fs.writeFileSync(REGISTRY_FILE, JSON.stringify(currentReg, null, 2));
      }
    } catch (e) {}
  }
  return true;
}

// 挂载
window.preloadAPI = {
  getSkillsList,
  previewSkills,
  installFromPreview,
  distributeSkill,
  cancelPreview,
  openLocalPath,
  openUrl,
  installSkill: (url, paths, onProgress) => {
    return previewSkills(url, onProgress).then(data => {
      const allNames = data.skills.map(s => s.name);
      installFromPreview(data, allNames, paths, url, onProgress);
      return true;
    });
  },
  uninstallSkill,
  updateSkill,
  batchUpdateSkills,
  batchDeleteSkills,
  exportSkillsConfig,
  importSkillsConfig,
  saveFileDialog
};

