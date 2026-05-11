#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const RELEASE_DIR = 'release';
const PLUGINS_JSON = join(RELEASE_DIR, 'plugins.json');

// 阿里云 OSS 配置
const OSS_BUCKET = process.env.OSS_BUCKET || 'ztools-center';
const OSS_REGION = process.env.OSS_REGION || 'oss-cn-beijing';
const OSS_CUSTOM_DOMAIN = process.env.OSS_CUSTOM_DOMAIN; // 可选的自定义域名

/**
 * 生成 OSS 下载地址
 */
function generateOssUrl(fileName) {
  if (OSS_CUSTOM_DOMAIN) {
    // 如果配置了自定义域名（CDN），使用自定义域名
    return `${OSS_CUSTOM_DOMAIN}/${fileName}`;
  }
  // 使用 OSS 默认域名
  return `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/${fileName}`;
}

/**
 * 主函数
 */
function main() {
  console.log('开始更新 plugins.json 中的下载地址为 OSS 地址...\n');

  if (!existsSync(PLUGINS_JSON)) {
    console.error(`错误: 找不到文件 ${PLUGINS_JSON}`);
    process.exit(1);
  }

  try {
    // 读取 plugins.json
    const plugins = JSON.parse(readFileSync(PLUGINS_JSON, 'utf-8'));
    console.log(`读取到 ${plugins.length} 个插件\n`);

    // 更新每个插件的下载地址
    let updatedCount = 0;
    for (const plugin of plugins) {
      if (plugin.downloadUrl) {
        const oldUrl = plugin.downloadUrl;
        // 从原下载地址提取文件名
        const fileName = oldUrl.split('/').pop();
        // 生成新的 OSS 地址
        plugin.downloadUrl = generateOssUrl(fileName);

        console.log(`${plugin.name}:`);
        console.log(`  旧地址: ${oldUrl}`);
        console.log(`  新地址: ${plugin.downloadUrl}`);
        updatedCount++;
      }
    }

    // 写回文件
    writeFileSync(PLUGINS_JSON, JSON.stringify(plugins, null, 2));

    console.log(`\n✓ 成功更新 ${updatedCount} 个插件的下载地址`);
    console.log(`配置: Bucket=${OSS_BUCKET}, Region=${OSS_REGION}`);
    if (OSS_CUSTOM_DOMAIN) {
      console.log(`使用自定义域名: ${OSS_CUSTOM_DOMAIN}`);
    }
  } catch (error) {
    console.error('更新失败:', error.message);
    process.exit(1);
  }
}

main();
