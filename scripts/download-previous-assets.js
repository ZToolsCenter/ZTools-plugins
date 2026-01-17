#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { get } from 'https';

const RELEASE_DIR = 'release';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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
  const { execSync } = require('child_process');
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
  }
}

main().catch(error => {
  console.error('执行失败:', error);
  process.exit(1);
});
