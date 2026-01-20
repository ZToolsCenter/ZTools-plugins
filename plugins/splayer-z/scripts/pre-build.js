import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const splayerDir = join(rootDir, 'SPlayer');

// SPlayer 配置
const SPLAYER_REPO = 'https://github.com/Yueby/SPlayer.git';
const SPLAYER_BRANCH = 'ztools-plugin';

console.log('🚀 预构建脚本开始...');
console.log('📦 检查 SPlayer submodule...');

// 检查 SPlayer 目录是否存在
if (!existsSync(splayerDir)) {
  console.log('⚠️  SPlayer 目录不存在，开始克隆...');
  
  try {
    // 克隆 SPlayer 仓库（指定分支）
    console.log(`📥 克隆 SPlayer 仓库 (分支: ${SPLAYER_BRANCH})...`);
    execSync(`git clone -b ${SPLAYER_BRANCH} --single-branch ${SPLAYER_REPO} SPlayer`, {
      cwd: rootDir,
      stdio: 'inherit'
    });
    console.log('✅ SPlayer 克隆完成');
  } catch (error) {
    console.error('❌ 克隆 SPlayer 失败:', error.message);
    process.exit(1);
  }
} else {
  console.log('✅ SPlayer 目录已存在');
  
  // 检查是否是 git 仓库
  const gitDir = join(splayerDir, '.git');
  if (existsSync(gitDir)) {
    console.log(`🔄 更新 SPlayer 仓库 (分支: ${SPLAYER_BRANCH})...`);
    try {
      // 确保在正确的分支上
      execSync(`git checkout ${SPLAYER_BRANCH}`, {
        cwd: splayerDir,
        stdio: 'pipe'
      });
      // 拉取最新代码
      execSync(`git pull origin ${SPLAYER_BRANCH}`, {
        cwd: splayerDir,
        stdio: 'inherit'
      });
      console.log('✅ SPlayer 更新完成');
    } catch (error) {
      console.warn('⚠️  更新 SPlayer 失败，继续使用现有版本');
    }
  } else {
    console.log('⚠️  SPlayer 目录存在但不是 git 仓库，跳过更新');
  }
}

// 检查必要的文件是否存在
const requiredPaths = [
  join(splayerDir, 'public'),
  join(splayerDir, 'public', 'images')
];

console.log('🔍 验证必要文件...');
let allExists = true;
for (const path of requiredPaths) {
  if (!existsSync(path)) {
    console.error(`❌ 缺少必要路径: ${path}`);
    allExists = false;
  }
}

if (!allExists) {
  console.error('❌ SPlayer 目录结构不完整');
  process.exit(1);
}

console.log('✅ 所有必要文件检查通过');
console.log('🎉 预构建脚本完成!');
