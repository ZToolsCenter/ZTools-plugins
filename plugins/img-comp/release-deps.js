'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const NODE_MODULES = path.join(ROOT, 'node_modules');

/**
 * 在当前包及其父级 node_modules 中解析依赖的 package.json。
 * @param {string} name 依赖名称
 * @param {string} fromDir 依赖发起方目录
 * @returns {string|null} package.json 路径
 */
function findPackageJson(name, fromDir) {
  let dir = path.resolve(fromDir);
  const parts = name.split('/');
  while (true) {
    const candidate = path.join(dir, 'node_modules', ...parts, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 收集发布包实际需要的运行时依赖闭包。
 * @returns {Array<{name:string, root:string, packageJsonPath:string, packageJson:Object}>} 依赖列表
 */
function collectRuntimePackages() {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pending = Object.keys(rootPackage.dependencies || {}).map(name => ({ name, fromDir: ROOT }));
  const visited = new Set();
  const result = [];

  while (pending.length > 0) {
    const current = pending.pop();
    const packageJsonPath = findPackageJson(current.name, current.fromDir);
    if (!packageJsonPath) {
      throw new Error(`无法解析运行时依赖: ${current.name}`);
    }
    const packageRoot = path.dirname(packageJsonPath);
    const key = path.relative(NODE_MODULES, packageRoot).replace(/\\/g, '/');
    if (visited.has(key)) continue;
    visited.add(key);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    result.push({
      name: packageJson.name || current.name,
      root: packageRoot,
      packageJsonPath,
      packageJson
    });
    for (const dependency of Object.keys({
      ...(packageJson.dependencies || {}),
      ...(packageJson.optionalDependencies || {})
    })) {
      pending.push({ name: dependency, fromDir: packageRoot });
    }
  }

  return result.sort((a, b) => a.root.localeCompare(b.root));
}

module.exports = { collectRuntimePackages, findPackageJson, ROOT, NODE_MODULES };
