const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workspaceApi = require("../../preload/fs-workspace.cjs");
const exporterApi = require("../../preload/exporter.cjs");

const pluginRoot = path.resolve(__dirname, "../..");
const testTmpRoot = path.join(pluginRoot, ".cache", "test-tmp-workspace");

test("preload workspace CRUD, tree scan, full-text search, image asset copy, and HTML export", () => {
  fs.rmSync(testTmpRoot, { recursive: true, force: true });
  fs.mkdirSync(testTmpRoot, { recursive: true });

  try {
    // 1. Create document
    const doc1 = workspaceApi.createDocument(
      testTmpRoot,
      "Architecture.md",
      "# System Architecture\n\nSeamless Live Preview with TypeMark.\n"
    );
    assert.equal(doc1.name, "Architecture.md");
    assert.ok(fs.existsSync(doc1.path));

    // 2. Create subfolder & second document
    const subDir = workspaceApi.createFolder(testTmpRoot, "guides");
    const doc2 = workspaceApi.createDocument(
      subDir.path,
      "Shortcuts.md",
      "# Keyboard Shortcuts\n\nPress Cmd+/ to toggle Source Code mode.\n"
    );
    assert.ok(fs.existsSync(doc2.path));

    // 3a. Shallow scan workspace (top-level only for fast tree loading)
    const shallowScanned = workspaceApi.scanWorkspace(testTmpRoot, {
      shallow: true
    });
    assert.equal(shallowScanned.isShallow, true);
    assert.equal(shallowScanned.files.length, 1);
    const guidesNode = shallowScanned.tree.children.find(
      (n) => n.type === "directory" && n.name === "guides"
    );
    assert.ok(guidesNode);
    assert.equal(guidesNode.childrenLoaded, false);
    assert.equal(guidesNode.children.length, 0);

    // 3b. On-demand directory expansion via listDirectoryChildren
    const expandedChildren = workspaceApi.listDirectoryChildren(
      subDir.path,
      testTmpRoot
    );
    assert.equal(expandedChildren.files.length, 1);
    assert.equal(expandedChildren.files[0].name, "Shortcuts.md");

    // 3c. Full scan workspace
    const scanned = workspaceApi.scanWorkspace(testTmpRoot);
    assert.equal(scanned.isShallow, false);
    assert.equal(scanned.files.length, 2);

    // 4. Full-text search in workspace
    const searchRes = workspaceApi.searchInWorkspace(testTmpRoot, "Cmd+/", {
      caseSensitive: false,
      wholeWord: false,
      isRegex: false
    });
    assert.equal(searchRes.totalMatches, 1);
    assert.equal(searchRes.results[0].name, "Shortcuts.md");

    // 4b. Invalid regex search does not throw SyntaxError
    const badRegexRes = workspaceApi.searchInWorkspace(
      testTmpRoot,
      "[unterminated(",
      {
        caseSensitive: false,
        wholeWord: false,
        isRegex: true
      }
    );
    assert.equal(badRegexRes.totalMatches, 0);
    assert.equal(badRegexRes.results.length, 0);

    // 5. Copy base64 image to ./assets
    const tinyPngDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const copiedImg = workspaceApi.copyImageToAssets(
      doc1.path,
      tinyPngDataUrl,
      { usePerDocAssets: false, fileName: "pixel.png" }
    );
    assert.equal(copiedImg.relativeMarkdownPath, "./assets/pixel.png");
    assert.ok(fs.existsSync(copiedImg.savedAbsolutePath));

    // 6. Export standalone HTML & verify editor chrome sanitization + diagram CSS variables
    const htmlOutPath = path.join(testTmpRoot, "Architecture.html");
    const dirtyEditorHtml = [
      '<div class="ty-editor-scroll"><div id="write" class="is-node">',
      '<div class="ty-block-wrapper ty-heading-block" data-block-id="b1">',
      '<button class="ty-heading-fold-btn">▾</button>',
      '<span class="ty-heading-gutter-tag">H1</span>',
      '<h1>System Architecture</h1>',
      '<span class="ty-heading-collapsed-pill">已折叠 2 项</span>',
      '</div>',
      '<div class="ty-table-toolbar"><button>+ 行</button></div>',
      '<div class="md-fences"><div class="md-fences-header"><input class="ty-code-lang-input" value="ts" /><datalist id="dl"><option value="ts"></option></datalist><button>复制代码</button></div></div>',
      '<div class="ty-diagram-container"><svg class="ty-mermaid-svg"><rect fill="var(--diagram-node-fill)" /></svg></div>',
      '</div></div>'
    ].join("");
    const exported = exporterApi.exportHtmlFile(htmlOutPath, {
      title: "System Architecture",
      htmlBody: dirtyEditorHtml,
      themeName: "github",
      themeCss: "body { color: #24292f; }",
      includeStyles: true
    });
    assert.ok(fs.existsSync(exported.path));
    assert.ok(exported.size > 100);
    const exportedHtmlContent = fs.readFileSync(exported.path, "utf8");
    const exportedBodySection = exportedHtmlContent.slice(
      exportedHtmlContent.indexOf("<body")
    );
    assert.ok(
      !exportedBodySection.includes("ty-heading-fold-btn"),
      "Exported HTML body should strip heading fold buttons"
    );
    assert.ok(
      !exportedBodySection.includes("ty-heading-gutter-tag"),
      "Exported HTML body should strip heading gutter tags"
    );
    assert.ok(
      !exportedBodySection.includes("ty-table-toolbar"),
      "Exported HTML body should strip table editing toolbars"
    );
    assert.ok(
      !exportedBodySection.includes("<datalist"),
      "Exported HTML body should strip language autocomplete datalists"
    );
    assert.ok(
      exportedHtmlContent.includes("--diagram-node-fill"),
      "Exported HTML should include diagram CSS custom properties so SVGs do not render black"
    );
    assert.ok(
      exportedBodySection.includes("<h1>System Architecture</h1>"),
      "Exported HTML body should preserve document headings"
    );
  } finally {
    fs.rmSync(testTmpRoot, { recursive: true, force: true });
  }
});

test("preload selectOpenFolders and multi-root MCP workspace search", async (t) => {
  const multiRoot = path.join(pluginRoot, ".cache", "test-tmp-multi-workspace");
  const folderA = path.join(multiRoot, "folder-a");
  const folderB = path.join(multiRoot, "folder-b");
  fs.rmSync(multiRoot, { recursive: true, force: true });
  fs.mkdirSync(folderA, { recursive: true });
  fs.mkdirSync(folderB, { recursive: true });

  const servicePath = require.resolve("../../preload/services.cjs");
  const dialogOptions = [];
  const originalWindow = global.window;

  t.after(() => {
    delete require.cache[servicePath];
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    fs.rmSync(multiRoot, { recursive: true, force: true });
  });

  workspaceApi.createDocument(folderA, "alpha.md", "# Alpha\n\nshared-multi-folder-token in alpha\n");
  workspaceApi.createDocument(folderB, "beta.md", "# Beta\n\nshared-multi-folder-token in beta\n");

  global.window = {
    addEventListener() {},
    ztools: {
      setExpendHeight() {},
      onPluginEnter() {},
      showOpenDialog(opts) {
        dialogOptions.push(opts);
        return [folderA, folderB];
      },
      dbStorage: {
        getItem() { return null; },
        setItem() {}
      }
    }
  };

  delete require.cache[servicePath];
  const bridge = require(servicePath);

  const selected = bridge.selectOpenFolders();
  assert.deepEqual(selected, [folderA, folderB]);
  assert.ok(dialogOptions[0].properties.includes("multiSelections"));

  bridge.setWorkspaceRoots([folderA, folderB]);
  const mcpResult = await bridge.mcp.callTool(
    "builtin",
    "search_workspace_references",
    { query: "shared-multi-folder-token" },
    "multi-root-search"
  );
  assert.equal(mcpResult.isError, false);
  const parsed = JSON.parse(mcpResult.content[0].text);
  assert.equal(parsed.fileCount, 2);
  assert.equal(parsed.totalMatches, 2);
  assert.deepEqual(
    parsed.results.map((r) => r.name).sort(),
    ["alpha.md", "beta.md"]
  );

  // One missing root must not break search across remaining valid roots
  bridge.setWorkspaceRoots([folderA, path.join(multiRoot, "does-not-exist")]);
  const partialResult = await bridge.mcp.callTool(
    "builtin",
    "search_workspace_references",
    { query: "shared-multi-folder-token" },
    "multi-root-search-partial"
  );
  assert.equal(partialResult.isError, false);
  const partialParsed = JSON.parse(partialResult.content[0].text);
  assert.equal(partialParsed.fileCount, 1);
  assert.equal(partialParsed.results[0].name, "alpha.md");

  bridge.setWorkspaceRoots([]);
  const clearedResult = await bridge.mcp.callTool(
    "builtin",
    "search_workspace_references",
    { query: "shared-multi-folder-token" },
    "multi-root-search-empty"
  );
  assert.equal(clearedResult.isError, true);
});
