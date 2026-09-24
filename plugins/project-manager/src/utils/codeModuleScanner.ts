/**
 * 代码模块扫描器（纯函数，不依赖平台 API）
 *
 * 扫描项目目录结构，识别常见的全栈子模块：
 * Node/Vue/React (package.json)、Java (pom.xml/build.gradle)、
 * Go (go.mod)、Python (requirements.txt/setup.py/pyproject.toml)、
 * .NET (.csproj/.sln)
 *
 * 深度最多 3 层，定位为"快捷入口"：名称、相对路径、语言/框架。
 */

import type { CodeModule, CodeModuleFramework } from '../types';

// ─── 框架标记文件映射 ────────────────────────────────────────────────────────

/** 每个标记文件对应一个框架类型，按优先级排列（先匹配的优先） */
const FRAMEWORK_MARKERS: Array<{ file: string; framework: CodeModuleFramework; priority: number }> = [
  // Vue 优先于 React（Vue 项目也可能有 react 依赖）
  { file: 'vue.config.js', framework: 'vue', priority: 1 },
  { file: 'vite.config.ts', framework: 'vue', priority: 2 }, // 进一步检查 package.json 确认
  // React
  { file: '.eslintrc.js', framework: 'react', priority: 3 },
  // Java
  { file: 'pom.xml', framework: 'java', priority: 10 },
  { file: 'build.gradle', framework: 'java', priority: 10 },
  { file: 'build.gradle.kts', framework: 'java', priority: 10 },
  // Go
  { file: 'go.mod', framework: 'go', priority: 10 },
  // Python
  { file: 'pyproject.toml', framework: 'python', priority: 10 },
  { file: 'setup.py', framework: 'python', priority: 10 },
  { file: 'requirements.txt', framework: 'python', priority: 11 },
  // .NET
  { file: '*.sln', framework: 'dotnet', priority: 10 },
  { file: '*.csproj', framework: 'dotnet', priority: 10 },
];

/** 通用 Node/JS 项目标记 */
const NODE_MARKER = 'package.json';

/**
 * 从目录条目中判断模块的框架类型
 * @param files 目录中的文件名列表
 * @returns 框架类型
 */
export function detectFramework(files: string[]): CodeModuleFramework {
  const fileSet = new Set(files);

  // 有 package.json → 进一步判断是 Vue / React / 普通 Node
  if (fileSet.has(NODE_MARKER)) {
    // Vue 标记
    if (fileSet.has('vue.config.js') || fileSet.has('vite.config.ts') || fileSet.has('vite.config.js')) {
      return 'vue';
    }
    // React 标记：JSX/TSX 文件或者 react 依赖（文件级判断只看标记文件）
    if (fileSet.has('.eslintrc.js') || fileSet.has('.eslintrc.json')) {
      return 'react'; // 粗略判断，后续可通过 package.json 内容进一步确认
    }
    return 'node';
  }

  // 按优先级匹配其他标记文件
  for (const marker of FRAMEWORK_MARKERS) {
    if (marker.file.startsWith('*.')) {
      // 通配符匹配扩展名
      const ext = marker.file.slice(1); // e.g. '.sln'
      if (files.some(f => f.endsWith(ext))) {
        return marker.framework;
      }
    } else if (fileSet.has(marker.file)) {
      return marker.framework;
    }
  }

  return 'unknown';
}

/**
 * 扫描目录结构，识别代码模块
 *
 * @param dirEntries 目录树，key 为相对路径（如 "packages/app"），value 为该目录下的文件名列表
 * @param maxDepth 最大扫描深度，默认 3
 * @returns 识别到的代码模块列表
 */
export function scanCodeModules(
  dirEntries: Record<string, string[]>,
  maxDepth = 3,
): CodeModule[] {
  const modules: CodeModule[] = [];
  const seenPaths = new Set<string>();

  for (const [relativePath, files] of Object.entries(dirEntries)) {
    // 计算深度
    const depth = relativePath === '.' ? 0 : relativePath.split('/').length;
    if (depth > maxDepth) continue;

    // 根目录本身不作为模块
    if (relativePath === '.' || relativePath === '') continue;

    const framework = detectFramework(files);

    // 仅当检测到具体框架时才创建模块（unknown 跳过）
    if (framework === 'unknown') continue;

    if (seenPaths.has(relativePath)) continue;
    seenPaths.add(relativePath);

    // 从路径提取显示名称
    const pathParts = relativePath.split('/');
    const dirName = pathParts[pathParts.length - 1] || relativePath;

    modules.push({
      id: `module-${relativePath.replace(/[/\\]/g, '-')}`,
      name: dirName,
      relativePath,
      framework,
      pinned: false,
    });
  }

  return modules;
}

/**
 * 构建目录树条目（用于从扁平路径列表构建 scanCodeModules 的输入）
 *
 * @param flatEntries 扁平的目录/文件路径列表，如 ["packages/app/package.json", "packages/app/src"]
 * @param rootPrefix 根路径前缀（会被剥离）
 * @returns 以相对目录路径为 key、该目录下文件名数组为 value 的记录
 */
export function buildDirTree(
  flatEntries: Array<{ name: string; isDirectory: boolean }>,
): Record<string, string[]> {
  const tree: Record<string, string[]> = {};

  // 根目录的直接子条目
  tree['.'] = [];

  for (const entry of flatEntries) {
    const name = entry.name;
    if (!name) continue;

    if (entry.isDirectory) {
      // 目录本身作为可能的模块路径
      if (!tree[name]) tree[name] = [];
    } else {
      // 文件放入根目录
      tree['.'].push(name);
    }
  }

  return tree;
}

/**
 * 从 package.json 内容提取 name 字段，用于模块显示名
 * @param jsonContent package.json 文件内容字符串
 * @returns 包名或 null
 */
export function extractPackageName(jsonContent: string): string | null {
  try {
    const pkg = JSON.parse(jsonContent);
    if (typeof pkg?.name === 'string' && pkg.name) {
      // 去掉 scope 前缀
      const parts = pkg.name.split('/');
      return parts[parts.length - 1];
    }
  } catch {
    // JSON 解析失败，忽略
  }
  return null;
}

/**
 * 从 package.json 内容检测框架（通过依赖列表）
 * @param jsonContent package.json 文件内容字符串
 * @returns 框架类型
 */
export function detectFrameworkFromPackageJson(jsonContent: string): CodeModuleFramework {
  try {
    const pkg = JSON.parse(jsonContent);
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    if (allDeps.vue || allDeps['@vue/cli-service'] || allDeps['@vitejs/plugin-vue']) {
      return 'vue';
    }
    if (allDeps.react || allDeps['react-dom'] || allDeps['@types/react']) {
      return 'react';
    }
    if (Object.keys(allDeps).length > 0) {
      return 'node';
    }
  } catch {
    // 解析失败
  }
  return 'unknown';
}
