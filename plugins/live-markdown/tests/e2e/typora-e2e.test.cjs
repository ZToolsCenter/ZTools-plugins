const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { launchBrowser, cacheRoot, screenshotRoot } = require('./browser.cjs');

const pluginRoot = path.resolve(__dirname, '../..');
const distIndexHtml = path.join(pluginRoot, 'dist/index.html');
const distPreloadPath = path.join(pluginRoot, 'dist/preload/services.cjs');
const { createE2EMockWebdavServer } = require('./mock-webdav.cjs');



test('Real Chromium E2E: loads dist/index.html via file:// protocol and verifies 1:1 Typora interactions', async () => {
  assert.equal(fs.existsSync(distIndexHtml), true, 'dist/index.html must exist');
  assert.equal(fs.existsSync(distPreloadPath), true, 'dist/preload/services.cjs must exist');

  const tmpWorkspace = fs.mkdtempSync(path.join(cacheRoot, 'typora-ztools-e2e-'));
  const tmpWorkspaceExtra = fs.mkdtempSync(path.join(cacheRoot, 'typora-ztools-e2e-extra-'));
  const sampleFile = path.join(tmpWorkspace, 'e2e-guide.md');
  const subDir = path.join(tmpWorkspace, 'docs');
  fs.mkdirSync(subDir, { recursive: true });
  const subFile = path.join(subDir, 'nested.md');

  const extraFile = path.join(tmpWorkspaceExtra, 'extra-note.md');
  const extraSubDir = path.join(tmpWorkspaceExtra, 'extra-docs');
  fs.mkdirSync(extraSubDir, { recursive: true });
  const extraSubFile = path.join(extraSubDir, 'extra-nested.md');

  fs.writeFileSync(
    sampleFile,
    [
      '---',
      'title: E2E Verification Doc',
      '---',
      '',
      '# E2E Live Heading',
      '',
      '> [!TIP]',
      '> Verified inside real headless Chromium.',
      '',
      '- [ ] First E2E Task',
      '- [x] Completed E2E Task',
      '',
      '| Feature | Status |',
      '| :--- | :--- |',
      '| Live Preview | Ready |',
      '',
      '```mermaid',
      'graph LR',
      '  A[ZTools] --> B[Typora]',
      '```',
      '',
      'MultiFolderSearchToken in primary workspace.'
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(subFile, '# Nested Document\n\nNested content here.\n', 'utf8');
  fs.writeFileSync(extraFile, '# Extra Workspace Note\n\nMultiFolderSearchToken in extra workspace.\n', 'utf8');
  fs.writeFileSync(extraSubFile, '# Extra Nested\n\nNested file in extra folder.\n', 'utf8');

  const storageMap = new Map();
  const expendHeights = [];

  global.window = {
    location: {
      href: pathToFileURL(distIndexHtml).href,
      replace() {}
    },
    ztools: {
      setExpendHeight(height) {
        expendHeights.push(height);
      },
      onPluginEnter() {},
      dbStorage: {
        getItem(key) {
          return storageMap.get(key) ?? null;
        },
        setItem(key, value) {
          storageMap.set(key, value);
        }
      },
      showOpenDialog() {
        return [sampleFile];
      },
      showSaveDialog() {
        return path.join(tmpWorkspace, 'exported.html');
      }
    }
  };

  delete require.cache[require.resolve(distPreloadPath)];
  const nodeServices = require(distPreloadPath);

  const sampleDocRecord = nodeServices.readDocument(sampleFile);
  const nestedDocRecord = nodeServices.readDocument(subFile);
  const extraDocRecord = nodeServices.readDocument(extraFile);
  const extraNestedDocRecord = nodeServices.readDocument(extraSubFile);
  const workspaceSnapshot = nodeServices.scanWorkspace(tmpWorkspace, { shallow: false });
  const shallowWorkspaceSnapshot = nodeServices.scanWorkspace(tmpWorkspace, { shallow: true });
  const subDirChildrenSnapshot = nodeServices.listDirectoryChildren(subDir, tmpWorkspace);
  const extraWorkspaceSnapshot = nodeServices.scanWorkspace(tmpWorkspaceExtra, { shallow: false });
  const extraShallowWorkspaceSnapshot = nodeServices.scanWorkspace(tmpWorkspaceExtra, { shallow: true });
  const extraSubDirChildrenSnapshot = nodeServices.listDirectoryChildren(extraSubDir, tmpWorkspaceExtra);

  const { server: webdavServer, files: webdavFiles } = createE2EMockWebdavServer({
    expectedUser: 'typora_e2e',
    expectedPass: 'pass_123'
  });
  await new Promise((resolve) => webdavServer.listen(0, '127.0.0.1', resolve));
  const webdavPort = webdavServer.address().port;
  const webdavServerUrl = `http://127.0.0.1:${webdavPort}/dav/`;

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 }
    });
    const page = await context.newPage();

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.exposeFunction('__nodeCallService', async (methodName, args) => {
      const fn = nodeServices[methodName];
      if (typeof fn !== 'function') {
        throw new Error(`Unknown service method: ${methodName}`);
      }
      return fn(...args);
    });

    await page.exposeFunction('__nodeRecordExpendHeight', (height) => {
      expendHeights.push(height);
    });

    const fixturePayload = {
      defaultNotesDir: tmpWorkspace,
      extraWorkspaceDir: tmpWorkspaceExtra,
      docs: {
        [sampleFile]: sampleDocRecord,
        [subFile]: nestedDocRecord,
        [extraFile]: extraDocRecord,
        [extraSubFile]: extraNestedDocRecord
      },
      workspaces: {
        [tmpWorkspace]: workspaceSnapshot,
        [tmpWorkspaceExtra]: extraWorkspaceSnapshot
      },
      shallowWorkspaces: {
        [tmpWorkspace]: shallowWorkspaceSnapshot,
        [tmpWorkspaceExtra]: extraShallowWorkspaceSnapshot
      },
      dirChildren: {
        [subDir]: subDirChildrenSnapshot,
        [extraSubDir]: extraSubDirChildrenSnapshot
      },
      isDirs: [tmpWorkspace, subDir, tmpWorkspaceExtra, extraSubDir]
    };

    await page.addInitScript((fixture) => {
      const listeners = new Set();
      const docsCache = new Map(Object.entries(fixture.docs || {}));
      const workspaceCache = new Map(Object.entries(fixture.workspaces || {}));
      const shallowWorkspaceCache = new Map(Object.entries(fixture.shallowWorkspaces || {}));
      const dirChildrenCache = new Map(Object.entries(fixture.dirChildren || {}));
      const isDirSet = new Set(fixture.isDirs || []);
      let persistedState = { preferences: { editorEngine: 'block' } };

      window.__dispatchPluginEnter = (action) => {
        for (const listener of listeners) {
          listener(action);
        }
      };

      window.ztools = {
        setExpendHeight(h) {
          window.__nodeRecordExpendHeight(h);
        },
        onPluginEnter(cb) {
          listeners.add(cb);
        }
      };

      const bridge = {
        getDefaultNotesDir() {
          return fixture.defaultNotesDir;
        },
        loadPersistedState() {
          return persistedState;
        },
        savePersistedState(patch) {
          persistedState = { ...(persistedState || {}), ...patch };
          window.__nodeCallService('savePersistedState', [patch]);
          return persistedState;
        },
        selectOpenFile() {
          return Array.from(docsCache.keys())[0] || null;
        },
        selectOpenFolder() {
          return window.__nextFolderDialogResult || fixture.defaultNotesDir;
        },
        selectOpenFolders() {
          if (Array.isArray(window.__nextFoldersDialogResult)) {
            return window.__nextFoldersDialogResult;
          }
          return [fixture.extraWorkspaceDir || fixture.defaultNotesDir];
        },
        selectSaveFile() {
          return `${fixture.defaultNotesDir}/exported.html`;
        },
        selectImageFile() {
          return null;
        },
        copyTextToClipboard(text) {
          window.__copiedText = text;
          return true;
        },
        openExternalUrl(url) {
          window.__openedUrl = url;
          return true;
        },
        revealInFinder() {
          return true;
        },
        isDirectory(targetPath) {
          return isDirSet.has(targetPath);
        },
        subscribePluginEnter(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        readDocument(filePath) {
          if (docsCache.has(filePath)) {
            return docsCache.get(filePath);
          }
          throw new Error(`Document not found in fixture: ${filePath}`);
        },
        writeDocumentAsync(filePath, content, options) { return window.__nodeCallService('writeDocumentAsync', [filePath, content, options]); },
        writeDocument(filePath, content) {
          const updated = {
            path: filePath,
            name: filePath.split('/').pop(),
            dir: filePath.split('/').slice(0, -1).join('/'),
            content,
            mtimeMs: Date.now(),
            size: content.length
          };
          docsCache.set(filePath, updated);
          window.__nodeCallService('writeDocument', [filePath, content]);
          return updated;
        },
        createDocument(dirPath, fileName, initialContent = '') {
          const normalized = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
          const fullPath = `${dirPath}/${normalized}`;
          const created = {
            path: fullPath,
            name: normalized,
            dir: dirPath,
            content: initialContent,
            mtimeMs: Date.now(),
            size: initialContent.length
          };
          docsCache.set(fullPath, created);
          window.__nodeCallService('createDocument', [dirPath, fileName, initialContent]);
          return created;
        },
        createFolder(parentDir, folderName) {
          const fullPath = `${parentDir}/${folderName}`;
          isDirSet.add(fullPath);
          return { path: fullPath, name: folderName };
        },
        renameEntry(oldPath, newName) {
          const dir = oldPath.split('/').slice(0, -1).join('/');
          const newPath = `${dir}/${newName}`;
          return { oldPath, newPath, name: newName };
        },
        duplicateDocument(filePath) {
          const doc = docsCache.get(filePath);
          const copyPath = filePath.replace(/\.md$/, ' (Copy).md');
          const copyDoc = { ...doc, path: copyPath, name: copyPath.split('/').pop() };
          docsCache.set(copyPath, copyDoc);
          return copyDoc;
        },
        deleteEntry(targetPath) {
          docsCache.delete(targetPath);
          return { deleted: true, path: targetPath };
        },
        scanWorkspace(rootDir, options = {}) {
          if (options && options.shallow && shallowWorkspaceCache.has(rootDir)) {
            return shallowWorkspaceCache.get(rootDir);
          }
          return (
            workspaceCache.get(rootDir) || {
              rootDir,
              rootName: rootDir.split('/').pop() || 'workspace',
              isShallow: Boolean(options && options.shallow),
              tree: { type: 'directory', name: 'workspace', path: rootDir, relativePath: '.', childrenLoaded: true, children: [] },
              files: []
            }
          );
        },
        listDirectoryChildren(dirPath) {
          return (
            dirChildrenCache.get(dirPath) || {
              dirPath,
              children: [],
              files: []
            }
          );
        },
        searchInWorkspace(rootDir, query) {
          const ws = workspaceCache.get(rootDir);
          if (!ws || !query) return { totalMatches: 0, fileCount: 0, results: [] };
          const q = String(query).toLowerCase();
          const results = [];
          let totalMatches = 0;
          for (const file of ws.files || []) {
            const doc = docsCache.get(file.path);
            const lines = String(doc?.content || '').split('\n');
            const matches = [];
            lines.forEach((lineText, idx) => {
              const pos = lineText.toLowerCase().indexOf(q);
              if (pos !== -1) {
                matches.push({
                  lineNumber: idx + 1,
                  lineText,
                  matchStart: pos,
                  matchEnd: pos + q.length,
                  matchText: lineText.slice(pos, pos + q.length)
                });
                totalMatches += 1;
              }
            });
            if (matches.length > 0) {
              results.push({ path: file.path, name: file.name, relativePath: file.relativePath, matches });
            }
          }
          return { totalMatches, fileCount: results.length, results };
        },
        copyImageToAssets() {
          return {
            assetPath: '/tmp/assets/img.png',
            relativeMarkdownPath: './assets/img.png'
          };
        },
        resolveImageUrl(_docPath, rawSrc) {
          return rawSrc;
        },
        buildStandaloneHtml(opts) {
          return `<!DOCTYPE html><html><body>${opts.htmlBody}</body></html>`;
        },
        exportHtmlFile(targetPath, opts) {
          window.__exportedHtml = { targetPath, opts };
          window.__nodeCallService('exportHtmlFile', [targetPath, opts]);
          return { path: targetPath, size: (opts.htmlBody || '').length };
        },
        testWebdavConnection(config) {
          return window.__nodeCallService('testWebdavConnection', [config]);
        },
        listWebdavFiles(config) {
          return window.__nodeCallService('listWebdavFiles', [config]);
        },
        pushWebdavDocument(config, docName, content) {
          return window.__nodeCallService('pushWebdavDocument', [config, docName, content]);
        },
        pullWebdavDocument(config, remoteFileName, localTargetDir) {
          return window.__nodeCallService('pullWebdavDocument', [config, remoteFileName, localTargetDir]);
        },
        deleteWebdavDocument(config, remoteFileName) {
          return window.__nodeCallService('deleteWebdavDocument', [config, remoteFileName]);
        },
        syncWorkspaceWithWebdav(config, options) {
          return window.__nodeCallService('syncWorkspaceWithWebdav', [config, options]);
        }
      };

      window.typoraBridge = bridge;
      window.services = bridge;
      window.ztools.setExpendHeight(820);
    }, fixturePayload);
    const scenarioContext = { tmpWorkspace, tmpWorkspaceExtra, sampleFile, expendHeights, webdavFiles, webdavServerUrl, context, page, pageErrors, consoleErrors, distIndexHtml, screenshotRoot };
    await require('./scenarios/layout-webdav.cjs')(scenarioContext);
    await require('./scenarios/view-history.cjs')(scenarioContext);
    await require('./scenarios/list-editing.cjs')(scenarioContext);
    await require('./scenarios/keyboard-history.cjs')(scenarioContext);
  } finally {
    await browser.close();
    await new Promise((resolve) => webdavServer.close(resolve));
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    fs.rmSync(tmpWorkspaceExtra, { recursive: true, force: true });
    delete global.window;
  }
});
