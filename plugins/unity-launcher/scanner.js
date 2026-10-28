// File I/O stays asynchronous; large directory listings also yield to UI events.
const fs = require('fs').promises;
const path = require('path');

// 系统/回收站/包缓存目录：项目与编辑器扫描都跳过
const systemDirectories = new Set([
  '$recycle.bin', '$winreagent', 'system volume information', 'recovery',
  'windows', 'winsxs', 'winsxsbackup', 'driverstore', 'installer',
  'servicing', 'softwaredistribution', 'perflogs', 'config.msi', 'msocache',
  'programdata', 'appdata', 'node_modules', '.git', '.svn', '.hg', '.vs', '.idea'
]);
// Windows 用户目录下的兼容性目录联接，跳过以避免循环
const junctionDirectories = new Set([
  'documents and settings', 'all users', 'default user', 'application data',
  'local settings', 'my documents', 'cookies', 'nethood', 'printhood',
  'recent', 'sendto', 'start menu', 'templates'
]);
// Unity 工程的缓存/构建产物，两类扫描都无需深入
const cacheDirectories = new Set([
  'library', 'assets', 'projectsettings', 'temp', 'logs', 'obj', 'build', 'builds'
]);
// 扫描项目时额外跳过系统程序目录；扫描编辑器时不能跳过 Program Files
const projectOnlyDirectories = new Set(['program files', 'program files (x86)']);

function shouldSkipDirectory(name, kind) {
  if (systemDirectories.has(name) || junctionDirectories.has(name) || cacheDirectories.has(name)) {
    return true;
  }
  return kind === 'projects' && projectOnlyDirectories.has(name);
}

function exeToEditor(exe) {
  // Match directory components, including Unity 5.x and Unity 6 (6000.x).
  const parts = exe.split(/[\\/]/);
  const version = parts.slice(0, -1).reverse()
    .map(part => (part.match(/(?:^|[^\d])(\d+\.\d+\.\d+[abfp]\d+(?:c\d+)?)(?=$|[^\w])/i) || [])[1])
    .find(Boolean);
  return { path: exe, version: version || '未知版本' };
}

async function scanUnityFolders(selectedPath, kind, onProgress, options = {}) {
  const root = path.resolve(selectedPath);
  const pending = [root];
  const found = [];
  let scannedCount = 0;
  let skippedCount = 0;
  let currentDir = root;
  let lastProgress = 0;
  let lastYield = Date.now();

  const report = (force = false) => {
    const now = Date.now();
    if (force || now - lastProgress >= 100) {
      lastProgress = now;
      if (onProgress) onProgress({ scannedCount, foundCount: found.length, skippedCount, currentDir });
    }
  };
  const checkpoint = async () => {
    report();
    if (Date.now() - lastYield >= 16) {
      await new Promise(resolve => setTimeout(resolve, 0));
      lastYield = Date.now();
    }
  };

  report(true);
  while (pending.length && !options.cancelled) {
    currentDir = pending.pop();
    await checkpoint();
    if (options.cancelled) break;
    let handle;
    try {
      // Stream entries instead of allocating a whole disk directory listing.
      handle = await fs.opendir(currentDir);
    } catch (err) {
      if (currentDir === root) throw new Error(`无法读取所选目录: ${err.message}`);
      skippedCount++;
      continue;
    }
    scannedCount++;
    const children = [];
    let hasAssets = false;
    let hasSettings = false;
    try {
      while (!options.cancelled) {
        await checkpoint();
        if (options.cancelled) break;
        let entry;
        try {
          entry = await handle.read();
        } catch (err) {
          if (currentDir === root) throw new Error(`无法读取所选目录: ${err.message}`);
          skippedCount++;
          break;
        }
        if (!entry) break;
        // Includes Windows junctions: do not follow links into cycles/other drives.
        if (entry.isSymbolicLink()) continue;
        const name = entry.name.toLowerCase();
        if (entry.isDirectory()) {
          if (name === 'assets') hasAssets = true;
          if (name === 'projectsettings') hasSettings = true;
          if (shouldSkipDirectory(name, kind)) continue;
          children.push(path.join(currentDir, entry.name));
        } else if (kind === 'editors' && entry.isFile() && name === 'unity.exe') {
          found.push(exeToEditor(path.join(currentDir, entry.name)));
        }
      }
    } finally {
      await handle.close();
    }
    if (options.cancelled) break;

    if (kind === 'projects' && hasAssets && hasSettings) {
      let detectedVersion = null;
      try {
        const text = await fs.readFile(path.join(currentDir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
        detectedVersion = (text.match(/m_EditorVersion:\s*(\S+)/) || [])[1] || null;
      } catch (err) {
        // A project can still be imported when its version file is absent.
        if (err.code !== 'ENOENT') skippedCount++;
      }
      found.push({ path: currentDir, isUnityProject: true, detectedVersion });
    } else {
      for (const child of children) pending.push(child);
    }
  }
  report(true);
  return found;
}

module.exports = { scanUnityFolders, exeToEditor };
