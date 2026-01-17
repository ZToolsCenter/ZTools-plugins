#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';
import { Extract } from 'unzipper';
import { pipeline } from 'stream/promises';

const RELEASE_DIR = 'release';
const TEMP_DIR = join(RELEASE_DIR, 'temp');
const BUILD_INFO_FILE = join(RELEASE_DIR, 'build-info.json');

/**
 * 获取仓库信息
 */
function getRepoInfo() {
  const remoteUrl = process.env.GITHUB_REPOSITORY || '';

  if (remoteUrl) {
    const [owner, repo] = remoteUrl.split('/');
    return { owner, repo };
  }

  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const match = remote.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch (error) {
    console.error('无法获取仓库信息');
  }

  throw new Error('无法确定GitHub仓库信息');
}

/**
 * 获取release版本号
 */
function getReleaseVersion() {
  if (existsSync(BUILD_INFO_FILE)) {
    const buildInfo = JSON.parse(readFileSync(BUILD_INFO_FILE, 'utf-8'));
    return buildInfo.releaseVersion;
  }
  return 'latest';
}

/**
 * 解压zip文件
 */
async function extractZip(zipPath, destDir) {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  // 优先使用系统unzip命令（更可靠）
  try {
    execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, {
      stdio: 'pipe'
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    return;
  } catch (sysError) {
    console.log(`  系统unzip失败，尝试使用unzipper库...`);
  }

  // 备用方案：使用unzipper库
  try {
    await pipeline(
      createReadStream(zipPath),
      Extract({ path: destDir })
    );
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    throw new Error(`解压失败: ${error.message}`);
  }
}

/**
 * 在解压的目录中查找plugin.json
 */
function findPluginJson(dir) {
  const possiblePaths = [
    join(dir, 'plugin.json'),
    join(dir, 'public', 'plugin.json'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // 递归查找
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const found = findPluginJson(fullPath);
        if (found) return found;
      }
    } catch (e) {
      // 忽略错误
    }
  }

  return null;
}

/**
 * 在解压的目录中查找logo文件
 */
function findLogoFile(dir, logoFileName) {
  const possiblePaths = [
    join(dir, logoFileName),
    join(dir, 'public', logoFileName),
    join(dir, 'assets', logoFileName),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // 递归查找
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory() && !file.includes('node_modules')) {
        const found = findLogoFile(fullPath, logoFileName);
        if (found) return found;
      }
    } catch (e) {
      // 忽略错误
    }
  }

  return null;
}

/**
 * 将图片压缩为64x64并转为base64
 */
async function imageToBase64(imagePath) {
  try {
    const buffer = await sharp(imagePath)
      .resize(64, 64, {
        fit: 'cover',
        position: 'center'
      })
      .png()
      .toBuffer();

    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error(`处理图片失败: ${imagePath}`, error.message);
    return null;
  }
}

/**
 * 处理单个zip文件
 */
async function processZipFile(zipFileName) {
  const zipPath = join(RELEASE_DIR, zipFileName);
  // 修复：匹配最后一个版本号部分，版本号格式为 数字.数字...
  // 例如：json-editor-1.7.1.zip -> json-editor
  //      port-use-1.0.0.zip -> port-use
  const pluginName = zipFileName.replace(/-[\d.]+\.zip$/, '');
  const extractDir = join(TEMP_DIR, pluginName);

  console.log(`\n处理: ${zipFileName}`);

  try {
    // 解压
    console.log('  解压中...');
    await extractZip(zipPath, extractDir);

    // 查找plugin.json
    const pluginJsonPath = findPluginJson(extractDir);
    if (!pluginJsonPath) {
      console.error(`  ✗ 找不到plugin.json`);
      return null;
    }

    console.log(`  找到plugin.json: ${pluginJsonPath}`);
    const pluginInfo = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));

    // 查找并处理logo
    let logoBase64 = null;
    if (pluginInfo.logo) {
      const logoPath = findLogoFile(extractDir, pluginInfo.logo);
      if (logoPath) {
        console.log(`  找到logo: ${logoPath}`);
        logoBase64 = await imageToBase64(logoPath);
        if (logoBase64) {
          console.log(`  ✓ logo已转换为base64`);
        }
      } else {
        console.warn(`  ⚠ 找不到logo文件: ${pluginInfo.logo}`);
      }
    }

    // 生成下载URL
    const { owner, repo } = getRepoInfo();
    const version = getReleaseVersion();
    const downloadUrl = `https://github.com/${owner}/${repo}/releases/download/v${version}/${zipFileName}`;

    // 合并信息
    const result = {
      ...pluginInfo,
      downloadUrl,
      logo: logoBase64 || pluginInfo.logo
    };

    console.log(`  ✓ 处理完成`);
    return result;
  } catch (error) {
    console.error(`  ✗ 处理失败: ${error.message}`);
    return null;
  }
}

/**
 * 清理临时目录
 */
function cleanupTemp() {
  if (existsSync(TEMP_DIR)) {
    execSync(`rm -rf "${TEMP_DIR}"`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('开始生成plugins.json...\n');

  // 确保临时目录存在
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  try {
    // 获取所有zip文件
    const zipFiles = readdirSync(RELEASE_DIR)
      .filter(file => extname(file) === '.zip')
      .sort();

    console.log(`找到 ${zipFiles.length} 个插件包\n`);

    if (zipFiles.length === 0) {
      console.error('错误: 没有找到任何zip文件');
      process.exit(1);
    }

    // 处理所有zip文件
    const plugins = [];
    for (const zipFile of zipFiles) {
      const pluginInfo = await processZipFile(zipFile);
      if (pluginInfo) {
        plugins.push(pluginInfo);
      }
    }

    if (plugins.length === 0) {
      console.error('\n错误: 没有成功处理任何插件');
      process.exit(1);
    }

    // 生成plugins.json
    const outputPath = join(RELEASE_DIR, 'plugins.json');
    writeFileSync(outputPath, JSON.stringify(plugins, null, 2));

    console.log(`\n========== 生成结果 ==========`);
    console.log(`成功处理: ${plugins.length} 个插件`);
    console.log(`输出文件: ${outputPath}`);
    console.log(`文件大小: ${(readFileSync(outputPath).length / 1024).toFixed(2)} KB`);

    // 输出插件列表
    console.log('\n插件列表:');
    plugins.forEach(p => {
      console.log(`  - ${p.name} v${p.version}: ${p.description}`);
    });

    // 生成变更日志（用于 GitHub Release）
    const buildInfo = existsSync(BUILD_INFO_FILE)
      ? JSON.parse(readFileSync(BUILD_INFO_FILE, 'utf-8'))
      : { changedPlugins: [] };

    const changedPluginNames = buildInfo.changedPlugins || [];
    const changedPluginsInfo = plugins.filter(p =>
      changedPluginNames.some(name =>
        p.name === name || p.name.toLowerCase() === name.toLowerCase()
      )
    );

    const changeLog = changedPluginsInfo.length > 0
      ? changedPluginsInfo.map(p => `${p.name} v${p.version}: ${p.description}`).join('\n')
      : '无变更插件信息';

    // 保存变更日志到文件
    const changeLogPath = join(RELEASE_DIR, 'changelog.txt');
    writeFileSync(changeLogPath, changeLog);
    console.log(`\n变更日志已保存到: ${changeLogPath}`);
    console.log('变更内容:');
    console.log(changeLog);

    console.log('\n✓ plugins.json生成完成');
  } finally {
    // 清理临时目录
    console.log('\n清理临时文件...');
    cleanupTemp();
  }
}

main().catch(error => {
  console.error('执行失败:', error);
  cleanupTemp();
  process.exit(1);
});
