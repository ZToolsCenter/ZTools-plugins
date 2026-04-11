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
  
  for (const skill of registry) {
    try {
      if (fs.existsSync(path.join(skill.localPath, 'SKILL.md'))) {
        // 如果 registry 中标记为未托管，尝试从 metadata.json 读取真实源
        if (!skill.sourceUrl || skill.sourceUrl === '本地/未托管') {
          try {
            const metaPath = path.join(skill.localPath, 'metadata.json');
            if (fs.existsSync(metaPath)) {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              if (meta && meta.source_url) {
                skill.sourceUrl = meta.source_url;
              }
            }
          } catch(e) {}
        }
        actualSkills.push(skill);
      }
    } catch(e) {}
  }

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
          if (fs.existsSync(mdPath)) {
            if (!actualSkills.some(s => s.localPath === skillPath)) {
              let sourceUrl = '本地/未托管';
              try {
                const meta = JSON.parse(fs.readFileSync(path.join(skillPath, 'metadata.json'), 'utf-8'));
                if (meta && meta.source_url) sourceUrl = meta.source_url;
              } catch(e) {}
              
              actualSkills.push({
                id: `local_${agent}_${dirent.name}`,
                name: dirent.name,
                localPath: skillPath,
                sourceUrl: sourceUrl,
                installedAt: fs.statSync(skillPath).birthtime.toISOString(),
                updatedAt: fs.statSync(mdPath).mtime.toISOString()
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
  'https://ghfast.top/',       // 镜像1
  'https://ghps.cc/',          // 镜像2
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

// ========== 第一步：预览仓库中的 Skills 列表 ==========
function previewSkills(repoUrl, onProgress) {
  ensureRegistry();
  const { gitUrl, subPath } = parseGitHubUrl(repoUrl);
  const tempDir = path.join(SKILLS_DIR, `_preview_${Date.now()}`);
  
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  if (onProgress) onProgress({ type: 'info', text: `[仓库] ${gitUrl}\n` });
  if (subPath && onProgress) onProgress({ type: 'info', text: `[子路径] ${subPath}\n` });

  const cloneDir = path.join(tempDir, 'repo');
  
  return gitCloneWithFallback(gitUrl, cloneDir, onProgress).then(() => {
    const skills = [];

    if (subPath) {
      const targetDir = path.join(cloneDir, ...subPath.split('/'));
      if (fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
        skills.push({ name: path.basename(targetDir), path: subPath });
      } else if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
        const subDirs = fs.readdirSync(targetDir, { withFileTypes: true });
        for (const d of subDirs) {
          if (d.isDirectory() && fs.existsSync(path.join(targetDir, d.name, 'SKILL.md'))) {
            skills.push({ name: d.name, path: `${subPath}/${d.name}` });
          }
        }
      }
    } else {
      const skillsSubDir = path.join(cloneDir, 'skills');
      if (fs.existsSync(skillsSubDir) && fs.statSync(skillsSubDir).isDirectory()) {
        const subDirs = fs.readdirSync(skillsSubDir, { withFileTypes: true });
        for (const d of subDirs) {
          if (d.isDirectory() && fs.existsSync(path.join(skillsSubDir, d.name, 'SKILL.md'))) {
            skills.push({ name: d.name, path: `skills/${d.name}` });
          }
        }
      }
      if (skills.length === 0 && fs.existsSync(path.join(cloneDir, 'SKILL.md'))) {
        skills.push({ name: path.basename(gitUrl, '.git'), path: '.' });
      }
    }

    if (skills.length === 0) {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      throw new Error("仓库中未找到任何 SKILL.md");
    }

    return { tempDir, cloneDir, skills, gitUrl };
  }).catch((err) => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  });
}

// ========== 第二步：从已克隆的临时目录安装选中的 Skills ==========
function installFromPreview(previewData, selectedSkillNames, targetPaths, repoUrl, onProgress) {
  const { tempDir, cloneDir, skills } = previewData;

  try {
    const selectedSkills = skills.filter(s => selectedSkillNames.includes(s.name));
    
    if (selectedSkills.length === 0) {
      throw new Error("未选择任何技能");
    }

    for (const skill of selectedSkills) {
      const sourcePath = skill.path === '.' ? cloneDir : path.join(cloneDir, ...skill.path.split('/'));
      
      for (const tp of targetPaths) {
        const baseDir = getPathForAgent(tp);
        if (!fs.existsSync(baseDir)) {
          fs.mkdirSync(baseDir, { recursive: true });
        }
        const finalDir = path.join(baseDir, skill.name);

        if (fs.existsSync(finalDir)) {
          fs.rmSync(finalDir, { recursive: true, force: true });
        }

        fs.cpSync(sourcePath, finalDir, { recursive: true });

        // 写入 metadata.json
        try {
          fs.writeFileSync(path.join(finalDir, 'metadata.json'), JSON.stringify({
            name: skill.name,
            source_url: repoUrl,
            installed_at: new Date().toISOString(),
            type: "git"
          }, null, 2));
        } catch (e) {}

        // 清理 .git
        const dotGit = path.join(finalDir, '.git');
        if (fs.existsSync(dotGit)) {
          fs.rmSync(dotGit, { recursive: true, force: true });
        }

        if (onProgress) onProgress({ type: 'info', text: `✓ [${skill.name}] → ${baseDir}\n` });

        // 更新 registry.json
        try {
          let currentReg = [];
          try { currentReg = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')); } catch (e) {}

          const targetIndex = currentReg.findIndex(r => r.localPath === finalDir);
          const uniqueId = targetIndex >= 0 ? currentReg[targetIndex].id : `${skill.name}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

          const newEntry = {
            id: uniqueId,
            name: skill.name,
            localPath: finalDir,
            sourceUrl: repoUrl,
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

    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
  
  if (!skill) return Promise.reject(new Error("找不到该技能"));
  if (skill.sourceUrl === '本地/未托管') {
    return Promise.reject(new Error("无源地址，无法更新。请先卸载后重新安装"));
  }

  // 更新 = 重新克隆 + 只安装这一个技能到原来的位置
  const parentDir = path.dirname(skill.localPath);
  
  return previewSkills(skill.sourceUrl, onProgress).then(previewData => {
    // 找到匹配的技能
    const matched = previewData.skills.find(s => s.name === skill.name);
    if (!matched) {
      cancelPreview(previewData.tempDir);
      throw new Error(`仓库中未找到名为 "${skill.name}" 的技能`);
    }
    installFromPreview(previewData, [skill.name], [parentDir], skill.sourceUrl, onProgress);
    return true;
  });
}

// ========== Shell 操作（必须在 preload 中执行） ==========
function openLocalPath(localPath) {
  if (!localPath) return;
  try {
    const { exec } = require('child_process');
    // Windows: explorer 打开目录
    exec(`explorer "${localPath.replace(/\//g, '\\')}"`);
  } catch (e) {
    console.error('openLocalPath failed:', e);
  }
}

function openUrl(url) {
  if (!url) return;
  try {
    const { exec } = require('child_process');
    // Windows: start 打开 URL
    exec(`start "" "${url}"`);
  } catch (e) {
    console.error('openUrl failed:', e);
  }
}

// 将方法挂载到 window
window.preloadAPI = {
  getSkillsList,
  previewSkills,
  installFromPreview,
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
  updateSkill
};

