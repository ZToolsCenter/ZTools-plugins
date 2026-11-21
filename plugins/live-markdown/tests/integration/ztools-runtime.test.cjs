"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { describe, it } = require("node:test");

const rootDir = path.resolve(__dirname, "..", "..");
const distDir = path.join(rootDir, "dist");

/**
 * Exact replica of ZTools PluginManager.resolvePluginUrl from app.asar
 */
function ztoolsResolvePluginUrl(pluginPath, pluginConfig, isDevelopment) {
  const isConfigHeadless = !pluginConfig.main;
  if (isConfigHeadless) {
    return { pluginUrl: "file:///hideWindow.html", isConfigHeadless: true };
  }
  if (isDevelopment) {
    const developmentMain = pluginConfig.development?.main;
    if (developmentMain) {
      return { pluginUrl: developmentMain, isConfigHeadless };
    }
  }
  if (pluginConfig.main.startsWith("http")) {
    return { pluginUrl: pluginConfig.main, isConfigHeadless };
  }
  return {
    pluginUrl: pathToFileURL(path.join(pluginPath, pluginConfig.main)).href,
    isConfigHeadless
  };
}

describe("ZTools Developer Tool & Release Runtime Resolution", () => {
  it("resolves root plugin.json (dev mode) directly to existing dist/index.html file:// URL without requiring a dev server", () => {
    const rootPluginConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, "plugin.json"), "utf8")
    );

    assert.equal(rootPluginConfig.name, "live-markdown");
    assert.equal(rootPluginConfig.main, "dist/index.html");
    assert.equal(rootPluginConfig.development, undefined);

    const { pluginUrl, isConfigHeadless } = ztoolsResolvePluginUrl(
      rootDir,
      rootPluginConfig,
      true
    );

    assert.equal(isConfigHeadless, false);
    assert.ok(
      pluginUrl.startsWith("file://"),
      `Expected file:// URL in dev mode, got ${pluginUrl}`
    );
    const resolvedHtmlPath = fileURLToPath(pluginUrl);
    assert.equal(resolvedHtmlPath, path.join(rootDir, "dist", "index.html"));
    assert.ok(
      fs.existsSync(resolvedHtmlPath),
      `Resolved HTML entry does not exist: ${resolvedHtmlPath}`
    );

    const preloadPath = path.join(rootDir, rootPluginConfig.preload);
    assert.ok(fs.existsSync(preloadPath), `Preload file missing: ${preloadPath}`);
  });

  it("resolves dist/plugin.json (release & dev mode) directly to dist/index.html", () => {
    const distPluginConfig = JSON.parse(
      fs.readFileSync(path.join(distDir, "plugin.json"), "utf8")
    );

    assert.equal(distPluginConfig.name, "live-markdown");
    assert.equal(distPluginConfig.main, "index.html");
    assert.equal(distPluginConfig.development, undefined);

    for (const isDev of [true, false]) {
      const { pluginUrl, isConfigHeadless } = ztoolsResolvePluginUrl(
        distDir,
        distPluginConfig,
        isDev
      );
      assert.equal(isConfigHeadless, false);
      assert.equal(
        fileURLToPath(pluginUrl),
        path.join(distDir, "index.html")
      );
    }
  });

  it("verifies dist/index.html uses relative ./assets/ paths and all referenced JS/CSS bundles exist", () => {
    const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
    const assetMatches = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
      (m) => m[1]
    );

    assert.ok(assetMatches.length >= 2, "Expected JS and CSS assets in dist/index.html");
    for (const ref of assetMatches) {
      assert.ok(
        ref.startsWith("./"),
        `Asset reference in dist/index.html must be relative for file:// protocol, got: ${ref}`
      );
      const assetPath = path.resolve(distDir, ref);
      assert.ok(
        fs.existsSync(assetPath),
        `Referenced asset does not exist on disk: ${assetPath}`
      );
      const stat = fs.statSync(assetPath);
      assert.ok(stat.size > 0, `Referenced asset is empty: ${assetPath}`);
    }
  });

  it("mounts window.typoraBridge in preload/services.cjs, expands ZTools window height, and recovers from chrome-error:// URLs", () => {
    let enteredCallback = null;
    let expandedHeight = null;
    let replacedUrl = null;

    global.window = {
      location: {
        href: "chrome-error://chromewebdata/",
        replace(url) {
          replacedUrl = url;
        }
      },
      ztools: {
        setExpendHeight(h) {
          expandedHeight = h;
        },
        onPluginEnter(cb) {
          enteredCallback = cb;
        },
        dbStorage: {
          getItem() {
            return null;
          },
          setItem() {}
        }
      },
      addEventListener() {}
    };

    const preloadModulePath = path.join(rootDir, "preload", "services.cjs");
    delete require.cache[require.resolve(preloadModulePath)];
    const bridge = require(preloadModulePath);

    assert.ok(global.window.typoraBridge, "window.typoraBridge should be defined");
    assert.equal(global.window.services, bridge);
    assert.equal(expandedHeight, 820, "Should automatically expand ZTools window height to 820");
    assert.equal(typeof enteredCallback, "function", "Should bind ztools.onPluginEnter");

    let receivedEnterAction = null;
    const unsubscribe = bridge.subscribePluginEnter((action) => {
      receivedEnterAction = action;
    });

    enteredCallback({
      code: "typora-workbench",
      type: "text",
      payload: "typora"
    });

    assert.deepEqual(receivedEnterAction, {
      code: "typora-workbench",
      type: "text",
      payload: "typora"
    });
    assert.equal(
      replacedUrl,
      pathToFileURL(path.join(rootDir, "dist", "index.html")).href,
      "Should self-heal chrome-error:// page to local dist/index.html file:// URL"
    );

    let openedExternalUrl = null;
    const rawStorage = new Map();
    global.window.ztools.shellOpenExternal = (url) => {
      openedExternalUrl = url;
    };
    global.window.ztools.dbStorage = {
      getItem(k) {
        return rawStorage.get(k) || null;
      },
      setItem(k, v) {
        rawStorage.set(k, v);
      }
    };

    // Protocol allowlist verification (Finding #2)
    assert.equal(bridge.openExternalUrl("javascript:alert(1)"), false);
    assert.equal(bridge.openExternalUrl("file:///etc/passwd"), false);
    assert.equal(openedExternalUrl, null);
    assert.equal(bridge.openExternalUrl("https://ztools.app/docs"), true);
    assert.equal(openedExternalUrl, "https://ztools.app/docs");

    // Credential encoding at rest verification (Finding #5)
    bridge.savePersistedState({
      webdavConfig: {
        enabled: true,
        serverUrl: "https://dav.jianguoyun.com/dav/",
        username: "user@example.com",
        password: "super-secret-app-password",
        remotePath: "/TyporaNotes/"
      }
    });
    const storedRaw = rawStorage.get("typora_markdown_persisted_state_v1");
    assert.ok(storedRaw, "Expected state in dbStorage");
    const storedParsed = JSON.parse(storedRaw);
    assert.equal(
      storedParsed.webdavConfig.password.startsWith("enc:v1:"),
      true,
      "Password at rest must be encoded with enc:v1: prefix"
    );
    assert.notEqual(
      storedParsed.webdavConfig.password,
      "super-secret-app-password"
    );
    const loadedState = bridge.loadPersistedState();
    assert.equal(
      loadedState.webdavConfig.password,
      "super-secret-app-password",
      "Loaded state must decode password transparently"
    );

    assert.equal(bridge.isDirectory(rootDir), true);
    assert.equal(bridge.isDirectory(path.join(rootDir, "plugin.json")), false);

    unsubscribe();
    delete global.window;
  });
});
