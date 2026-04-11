const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * ZTools 预加载脚本
 * 有权限访问 Node.js API (fs, path, child_process 等)
 */

const SKILLS_DIR = process.env.USERPROFILE 
  ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'skills')
  : path.join(process.env.HOME || '/', '.gemini', 'antigravity', 'skills');

const REGISTRY_FILE = path.join(SKILLS_DIR, 'registry.json');

// 确保目录和文件存在
function ensureRegistry() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify([]));
  }
}

// 获取技能列表
function getSkillsList() {
  ensureRegistry();
  try {
    const data = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    const registry = JSON.parse(data);
    
    // 也能同时扫描目录中是否存在未知插件（可以进行双向对齐，这里简化为以 registry 为准）
    return registry;
  } catch (error) {
    console.error("读取 registry.json 失败:", error);
    return [];
  }
}

// 保存 registry
function saveRegistry(registry) {
  ensureRegistry();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// 安装技能
function installSkill(repoUrl) {
  ensureRegistry();
  
  // 从 repoUrl 解析出文件夹名
  const match = repoUrl.match(/github\.com\/[^\/]+\/([^\/]+)/i);
  if (!match) {
    throw new Error("无效的 GitHub 仓库地址");
  }
  
  const skillId = match[1].replace('.git', '');
  const targetDir = path.join(SKILLS_DIR, skillId);
  const tempDir = path.join(SKILLS_DIR, `_temp_${skillId}_${Date.now()}`);

  try {
    // 假设系统里有 git
    console.log(`Cloning ${repoUrl} to ${tempDir}`);
    execSync(`git clone ${repoUrl} ${tempDir}`);
    
    // 如果之前已有，先删除
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    
    // 移动 temp 到 target
    fs.renameSync(tempDir, targetDir);

    // 记录到 registry
    const registry = getSkillsList();
    const existingIndex = registry.findIndex(s => s.id === skillId);
    
    const skillData = {
      id: skillId,
      name: skillId,
      localPath: targetDir,
      sourceUrl: repoUrl,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      registry[existingIndex] = skillData;
    } else {
      registry.push(skillData);
    }
    
    saveRegistry(registry);
    
    return true;
  } catch (err) {
    console.error("安装失败", err);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true }); // 清理碎片
    }
    throw err;
  }
}

// 删除技能
function uninstallSkill(skillId) {
  const targetDir = path.join(SKILLS_DIR, skillId);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  const registry = getSkillsList();
  const updatedReg = registry.filter(s => s.id !== skillId);
  saveRegistry(updatedReg);
  
  return true;
}

// 更新技能
function updateSkill(skillId) {
  const registry = getSkillsList();
  const skill = registry.find(s => s.id === skillId);
  if (!skill) throw new Error("技能不存在 registry 中");

  const targetDir = skill.localPath;
  if (!fs.existsSync(targetDir)) {
    // 若本地包丢失，则直接重新安装
    return installSkill(skill.sourceUrl);
  }

  // 执行 git pull
  try {
    execSync(`cd "${targetDir}" && git pull`);
    skill.updatedAt = new Date().toISOString();
    saveRegistry(registry);
    return true;
  } catch (err) {
    console.error("更新失败", err);
    throw err;
  }
}

// 将方法挂载到 window（Preload 暴露）
window.preloadAPI = {
  getSkillsList,
  installSkill,
  uninstallSkill,
  updateSkill
};
