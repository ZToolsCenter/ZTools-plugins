#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import { existsSync, mkdirSync, createWriteStream, readdirSync, unlinkSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { get } from 'https';
import { execSync } from 'child_process';

const RELEASE_DIR = 'release';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/**
 * 比较两个版本号
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * 获取仓库信息
 */
function getRepoInfo() {
  // 从环境变量或git remote获取
  const remoteUrl = process.env.GITHUB_REPOSITORY || '';

  if (remoteUrl) {
    const [owner, repo] = remoteUrl.split('/');
    return { owner, repo };
  }

  // 从git remote解析
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
 * 下载文件
 */
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // 处理重定向
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: ${response.statusCode}`));
        return;
      }

      const fileStream = createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 清理旧版本的插件，只保留每个插件的最新版本
 */
function cleanupOldVersions() {
  console.log('\n清理旧版本插件...');

  // 获取所有zip文件
  const zipFiles = readdirSync(RELEASE_DIR)
    .filter(file => extname(file) === '.zip');

  if (zipFiles.length === 0) {
    console.log('没有找到zip文件');
    return;
  }

  // 按插件名分组
  const pluginGroups = {};

  for (const zipFile of zipFiles) {
    // 从文件名中提取插件名和版本号
    // 格式: pluginName-version.zip
    const match = zipFile.match(/^(.+?)-([\d.]+)\.zip$/);
    if (!match) {
      console.log(`跳过无法解析的文件: ${zipFile}`);
      continue;
    }

    const [, pluginName, version] = match;

    if (!pluginGroups[pluginName]) {
      pluginGroups[pluginName] = [];
    }

    pluginGroups[pluginName].push({
      fileName: zipFile,
      version: version
    });
  }

  // 对每个插件，只保留最新版本
  let deletedCount = 0;

  for (const [pluginName, versions] of Object.entries(pluginGroups)) {
    if (versions.length <= 1) {
      continue; // 只有一个版本，不需要清理
    }

    // 按版本号排序，找出最新版本
    versions.sort((a, b) => compareVersions(b.version, a.version));
    const latestVersion = versions[0];
    const oldVersions = versions.slice(1);

    console.log(`\n插件: ${pluginName}`);
    console.log(`  保留: ${latestVersion.fileName} (v${latestVersion.version})`);

    // 删除旧版本
    for (const oldVersion of oldVersions) {
      const filePath = join(RELEASE_DIR, oldVersion.fileName);
      try {
        unlinkSync(filePath);
        console.log(`  删除: ${oldVersion.fileName} (v${oldVersion.version})`);
        deletedCount++;
      } catch (error) {
        console.error(`  删除失败: ${oldVersion.fileName} - ${error.message}`);
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`\n✓ 清理完成，删除了 ${deletedCount} 个旧版本文件`);
  } else {
    console.log('\n✓ 没有需要清理的旧版本');
  }
}

/**
 * 主函数
 */
async function main() {
  if (!GITHUB_TOKEN) {
    console.error('错误: 未设置GITHUB_TOKEN环境变量');
    process.exit(1);
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const { owner, repo } = getRepoInfo();

  console.log(`仓库: ${owner}/${repo}`);

  // 确保release目录存在
  if (!existsSync(RELEASE_DIR)) {
    mkdirSync(RELEASE_DIR, { recursive: true });
  }

  try {
    // 获取最新的release
    console.log('获取最新release...');
    const { data: latestRelease } = await octokit.repos.getLatestRelease({
      owner,
      repo
    });

    console.log(`找到最新release: ${latestRelease.tag_name}`);
    console.log(`资产数量: ${latestRelease.assets.length}`);

    if (latestRelease.assets.length === 0) {
      console.log('最新release没有资产，跳过下载');
      return;
    }

    // 下载所有资产
    for (const asset of latestRelease.assets) {
      const destPath = join(RELEASE_DIR, asset.name);

      // 如果文件已存在（本次构建的新文件），跳过
      if (existsSync(destPath)) {
        console.log(`跳过已存在的文件: ${asset.name}`);
        continue;
      }

      console.log(`下载: ${asset.name} (${(asset.size / 1024).toFixed(2)} KB)`);

      try {
        await downloadFile(asset.browser_download_url, destPath);
        console.log(`✓ 下载完成: ${asset.name}`);
      } catch (error) {
        console.error(`✗ 下载失败: ${asset.name} - ${error.message}`);
      }
    }

    console.log('\n✓ 所有历史资产下载完成');
  } catch (error) {
    if (error.status === 404) {
      console.log('没有找到历史release，这可能是首次发布');
    } else {
      console.error('下载历史资产时出错:', error.message);
      throw error;
    }
  } finally {
    // 无论是否下载成功，都清理旧版本
    cleanupOldVersions();
  }
}

main().catch(error => {
  console.error('执行失败:', error);
  process.exit(1);
});
