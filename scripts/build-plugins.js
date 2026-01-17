#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

const PLUGINS_DIR = 'plugins';
const RELEASE_DIR = 'release';
const BUILD_INFO_FILE = join(RELEASE_DIR, 'build-info.json');

/**
 * 读取构建信息
 */
function getBuildInfo() {
  if (!existsSync(BUILD_INFO_FILE)) {
    console.error('找不到build-info.json，请先运行detect-changes.js');
    process.exit(1);
  }
  return JSON.parse(readFileSync(BUILD_INFO_FILE, 'utf-8'));
}

/**
 * 读取插件的plugin.json
 */
function getPluginInfo(pluginName) {
  const pluginJsonPaths = [
    join(PLUGINS_DIR, pluginName, 'plugin.json'),
    join(PLUGINS_DIR, pluginName, 'public', 'plugin.json'),
    join(PLUGINS_DIR, pluginName, 'dist', 'plugin.json'),
  ];

  for (const path of pluginJsonPaths) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  }

  // 如果dist下有子目录，递归查找
  const distPath = join(PLUGINS_DIR, pluginName, 'dist');
  if (existsSync(distPath)) {
    const distContents = readdirSync(distPath);
    for (const item of distContents) {
      const itemPath = join(distPath, item);
      if (statSync(itemPath).isDirectory()) {
        const pluginJsonInSubDir = join(itemPath, 'plugin.json');
        if (existsSync(pluginJsonInSubDir)) {
          return JSON.parse(readFileSync(pluginJsonInSubDir, 'utf-8'));
        }
      }
    }
  }

  throw new Error(`找不到插件 ${pluginName} 的plugin.json`);
}

/**
 * 检查插件是否需要构建
 */
function needsBuild(pluginPath) {
  // 优先检查自定义构建脚本
  const buildScriptPath = join(pluginPath, 'build-plugin.sh');
  if (existsSync(buildScriptPath)) {
    return {
      customScript: true,
      scriptPath: buildScriptPath,
      install: false,
      build: false
    };
  }

  // 检查package.json
  const packageJsonPath = join(pluginPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return { customScript: false, install: false, build: false };
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const hasBuildScript = packageJson.scripts && packageJson.scripts.build;

  return {
    customScript: false,
    install: true,  // 有package.json就需要安装依赖
    build: hasBuildScript  // 有build脚本才需要构建
  };
}

/**
 * 构建插件
 */
function buildPlugin(pluginName) {
  const pluginPath = join(PLUGINS_DIR, pluginName);

  console.log(`\n========== 构建插件: ${pluginName} ==========`);

  const buildConfig = needsBuild(pluginPath);

  // 如果有自定义构建脚本，直接执行
  if (buildConfig.customScript) {
    console.log('检测到自定义构建脚本: build-plugin.sh');

    try {
      // 给脚本添加执行权限（使用相对路径）
      execSync('chmod +x build-plugin.sh', {
        cwd: pluginPath,
        stdio: 'inherit'
      });

      // 执行构建脚本
      console.log('执行自定义构建脚本...');
      execSync('./build-plugin.sh', {
        cwd: pluginPath,
        stdio: 'inherit',
        shell: '/bin/bash'
      });

      console.log('✓ 自定义构建完成');
    } catch (error) {
      console.error(`✗ 自定义构建失败: ${error.message}`);
      throw error;
    }
    return;
  }

  // 标准构建流程
  const { install, build } = buildConfig;

  if (install) {
    console.log('检测到package.json，安装依赖...');

    try {
      // 安装依赖
      execSync('npm install', {
        cwd: pluginPath,
        stdio: 'inherit'
      });
      console.log('✓ 依赖安装完成');
    } catch (error) {
      console.error(`✗ 依赖安装失败: ${error.message}`);
      throw error;
    }

    if (build) {
      console.log('检测到build脚本，执行构建...');
      try {
        execSync('npm run build', {
          cwd: pluginPath,
          stdio: 'inherit'
        });
        console.log('✓ 构建完成');
      } catch (error) {
        console.error(`✗ 构建失败: ${error.message}`);
        throw error;
      }
    } else {
      console.log('未检测到build脚本，跳过构建步骤');
    }
  } else {
    console.log('无需构建，直接打包源码');
  }
}

/**
 * 获取需要打包的目录
 */
function getPackageDir(pluginName) {
  const pluginPath = join(PLUGINS_DIR, pluginName);

  // 检查是否有构建配置
  const buildConfig = needsBuild(pluginPath);

  // 如果有自定义构建脚本或执行了构建，检查dist目录
  if (buildConfig.customScript || buildConfig.build) {
    const distPath = join(pluginPath, 'dist');
    if (existsSync(distPath)) {
      // 对于Ctool这种特殊情况，检查dist下是否有子目录
      const distContents = readdirSync(distPath);
      if (distContents.length === 1 && statSync(join(distPath, distContents[0])).isDirectory()) {
        const subDir = join(distPath, distContents[0]);
        console.log(`使用dist子目录作为打包源: ${distContents[0]}`);
        return subDir;
      }

      console.log('使用dist目录作为打包源');
      return distPath;
    }
  }

  // 否则打包整个插件目录
  console.log('使用插件根目录作为打包源');
  return pluginPath;
}

/**
 * 打包插件为zip
 */
async function packagePlugin(pluginName, version) {
  const sourceDir = getPackageDir(pluginName);
  const zipFileName = `${pluginName}-${version}.zip`;
  const zipFilePath = join(RELEASE_DIR, zipFileName);

  console.log(`打包到: ${zipFilePath}`);

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipFilePath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    output.on('close', () => {
      console.log(`✓ 打包完成: ${archive.pointer()} bytes`);
      resolve(zipFilePath);
    });

    archive.on('error', (err) => {
      console.error(`✗ 打包失败: ${err.message}`);
      reject(err);
    });

    archive.pipe(output);

    // 添加文件到压缩包
    const files = readdirSync(sourceDir);
    files.forEach(file => {
      const filePath = join(sourceDir, file);
      const stat = statSync(filePath);

      // 排除不需要的文件
      const excludes = ['node_modules', '.git', '.DS_Store', 'package-lock.json', 'npm-debug.log'];
      if (excludes.includes(file)) {
        return;
      }

      if (stat.isDirectory()) {
        archive.directory(filePath, file);
      } else {
        archive.file(filePath, { name: file });
      }
    });

    archive.finalize();
  });
}

/**
 * 生成latest文件，记录当前发布的版本号
 */
function generateLatestFile(releaseVersion) {
  const latestFilePath = join(RELEASE_DIR, 'latest');
  writeFileSync(latestFilePath, releaseVersion, 'utf-8');
  console.log(`✓ 生成latest文件: ${latestFilePath} (${releaseVersion})`);
}

/**
 * 主函数
 */
async function main() {
  const buildInfo = getBuildInfo();
  const { changedPlugins, releaseVersion } = buildInfo;

  console.log(`准备构建 ${changedPlugins.length} 个插件...`);

  // 确保release目录存在
  if (!existsSync(RELEASE_DIR)) {
    mkdirSync(RELEASE_DIR, { recursive: true });
  }

  const results = [];

  for (const pluginName of changedPlugins) {
    try {
      // 构建插件
      buildPlugin(pluginName);

      // 获取插件信息
      const pluginInfo = getPluginInfo(pluginName);
      const version = pluginInfo.version;

      // 打包插件
      const zipPath = await packagePlugin(pluginName, version);

      results.push({
        name: pluginName,
        version,
        zipPath,
        success: true
      });

      console.log(`✓ ${pluginName} 处理完成\n`);
    } catch (error) {
      console.error(`✗ ${pluginName} 处理失败: ${error.message}\n`);
      results.push({
        name: pluginName,
        success: false,
        error: error.message
      });
    }
  }

  // 输出结果摘要
  console.log('\n========== 构建结果摘要 ==========');
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failCount}`);

  if (failCount > 0) {
    console.log('\n失败的插件:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  // 生成latest文件，记录当前发布版本号
  generateLatestFile(releaseVersion);

  console.log('\n✓ 所有插件构建完成');
}

main().catch(error => {
  console.error('构建过程出错:', error);
  process.exit(1);
});
