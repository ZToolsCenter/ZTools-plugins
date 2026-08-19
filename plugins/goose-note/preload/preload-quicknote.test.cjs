"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  fitQuickNoteBoundsToWorkArea,
  resolveQuickNoteBounds,
  resolveTempTargetPath,
  getBase64ByteLength,
  writeTempFile,
  createQuicknoteGooseFs,
} = require("./preload-quicknote.cjs");

const primaryWorkArea = { x: 0, y: 24, width: 1440, height: 876 };

test("合法的速记窗口位置和尺寸保持不变", () => {
  const screenApi = {
    getDisplayNearestPoint: () => ({ workArea: primaryWorkArea }),
  };

  assert.deepEqual(
    resolveQuickNoteBounds(
      {
        windowX: 800,
        windowY: 120,
        windowWidth: 480,
        windowHeight: 350,
      },
      screenApi,
    ),
    { x: 800, y: 120, width: 480, height: 350 },
  );
});

test("断开外接屏后按当前最近显示器 workArea 收回窗口", () => {
  let queriedPoint = null;
  const screenApi = {
    getDisplayNearestPoint: (point) => {
      queriedPoint = point;
      return { workArea: primaryWorkArea };
    },
  };

  assert.deepEqual(
    resolveQuickNoteBounds(
      {
        windowX: 2560,
        windowY: 180,
        windowWidth: 480,
        windowHeight: 350,
      },
      screenApi,
    ),
    { x: 960, y: 180, width: 480, height: 350 },
  );
  assert.deepEqual(queriedPoint, { x: 2800, y: 355 });
});

test("分辨率缩小时同时钳制窗口尺寸和坐标", () => {
  assert.deepEqual(
    fitQuickNoteBoundsToWorkArea(
      { x: -200, y: -100, width: 1600, height: 1000 },
      { x: 0, y: 24, width: 1280, height: 696 },
    ),
    { x: 0, y: 24, width: 1280, height: 696 },
  );
});

test("首次打开仍定位到光标所在屏幕右上角", () => {
  let queriedPoint = null;
  const screenApi = {
    getCursorScreenPoint: () => ({ x: -900, y: 300 }),
    getDisplayNearestPoint: (point) => {
      queriedPoint = point;
      return {
        workArea: { x: -1280, y: 0, width: 1280, height: 720 },
      };
    },
  };

  assert.deepEqual(
    resolveQuickNoteBounds(
      {
        windowX: null,
        windowY: null,
        windowWidth: 480,
        windowHeight: 350,
      },
      screenApi,
    ),
    { x: -496, y: 16, width: 480, height: 350 },
  );
  assert.deepEqual(queriedPoint, { x: -900, y: 300 });
});

test("screen API 不可用时不覆盖已记住的位置", () => {
  assert.deepEqual(
    resolveQuickNoteBounds(
      {
        windowX: -700,
        windowY: 88,
        windowWidth: 500,
        windowHeight: 360,
      },
      {},
    ),
    { x: -700, y: 88, width: 500, height: 360 },
  );
});

test("preload 创建和复用窗口时都应用校正后的 bounds", () => {
  const modulePath = require.resolve("./preload-quicknote.cjs");
  const originalWindow = global.window;
  const originalUTools = global.utools;
  const originalSetTimeout = global.setTimeout;
  let ready = null;
  let createOptions = null;
  const setBoundsCalls = [];
  let outPluginCalls = [];
  let hideCalls = 0;
  let currentBounds = { x: 960, y: 180, width: 480, height: 350 };
  let persisted = JSON.stringify({
    state: {
      windowX: 2560,
      windowY: 180,
      windowWidth: 480,
      windowHeight: 350,
    },
    version: 2,
  });
  const win = {
    isDestroyed: () => false,
    getBounds: () => currentBounds,
    setBounds: (bounds) => {
      currentBounds = { ...bounds };
      setBoundsCalls.push({ ...bounds });
    },
    show: () => {},
    hide: () => {
      hideCalls += 1;
    },
    focus: () => {},
    setAlwaysOnTop: () => {},
    webContents: { send: () => {} },
  };

  try {
    global.setTimeout = (callback) => {
      callback();
      return 0;
    };
    global.window = {};
    global.utools = {
      getWindowType: () => "main",
      getDisplayNearestPoint: () => ({ workArea: primaryWorkArea }),
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      removeSubInput: () => {},
      hideMainWindow: () => {},
      outPlugin: (isKill) => {
        outPluginCalls.push(isKill);
        return true;
      },
      createBrowserWindow: (_url, options, callback) => {
        createOptions = options;
        ready = callback;
        return win;
      },
      db: {
        get: () => ({ _rev: "1", data: { value: persisted } }),
        put: (doc) => {
          persisted = doc.data.value;
          return { ok: true };
        },
      },
      dbStorage: { removeItem: () => {} },
    };

    delete require.cache[modulePath];
    require(modulePath);
    // 小窗双击图片依赖 gooseFs.writeTempFile；preload 必须注入最小面。
    assert.equal(typeof global.window.gooseFs?.writeTempFile, "function");
    assert.equal(typeof global.window.gooseFs?.cleanupTempFiles, "function");
    assert.equal(typeof global.window.gooseFs?.existsAsync, "function");
    global.window.exports.quicknote_new.args.enter();

    assert.equal(createOptions.x, 960);
    assert.equal(createOptions.y, 180);
    assert.equal(createOptions.width, 480);
    assert.equal(createOptions.height, 350);
    ready();
    assert.deepEqual(setBoundsCalls[0], currentBounds);
    // enter 后必须 outPlugin(false) 释放宿主，浮窗本身不被 hide。
    assert.deepEqual(outPluginCalls, [false]);
    assert.equal(hideCalls, 0);

    // 第二次触发隐藏，第三次触发复用并再次按当前 workArea 校正。
    global.window.exports.quicknote_new.args.enter();
    assert.equal(hideCalls, 1);
    assert.deepEqual(outPluginCalls, [false, false]);
    assert.deepEqual(JSON.parse(persisted), {
      state: {
        windowX: 960,
        windowY: 180,
        windowWidth: 480,
        windowHeight: 350,
      },
      version: 2,
    });
    persisted = JSON.stringify({
      state: {
        windowX: 2560,
        windowY: 180,
        windowWidth: 480,
        windowHeight: 350,
      },
      version: 2,
    });
    global.window.exports.quicknote_new.args.enter();
    assert.deepEqual(setBoundsCalls.at(-1), {
      x: 960,
      y: 180,
      width: 480,
      height: 350,
    });
    assert.deepEqual(outPluginCalls, [false, false, false]);
  } finally {
    delete require.cache[modulePath];
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    if (originalUTools === undefined) delete global.utools;
    else global.utools = originalUTools;
    global.setTimeout = originalSetTimeout;
  }
});

test("临时路径限制在 os.tmpdir 下，拒绝目录逃逸", () => {
  const tmpRoot = os.tmpdir();
  const resolved = resolveTempTargetPath("goose-note/opened-resources/a.png");
  assert.equal(resolved, path.join(tmpRoot, "goose-note/opened-resources/a.png"));
  assert.ok(resolved.startsWith(tmpRoot));

  const escaped = resolveTempTargetPath("../outside/a.png");
  assert.equal(escaped, path.join(tmpRoot, "outside/a.png"));
  assert.ok(escaped.startsWith(tmpRoot));
});

test("getBase64ByteLength 计算正确", () => {
  // "hi" base64 = aGk=
  assert.equal(getBase64ByteLength("aGk="), 2);
  assert.equal(getBase64ByteLength(""), 0);
});

test("writeTempFile 写入后可被 existsAsync 识别", async () => {
  const gooseFs = createQuicknoteGooseFs();
  const relativePath = `goose-note/opened-resources/test-${Date.now()}/image.png`;
  // 1x1 PNG
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const targetPath = await writeTempFile(relativePath, pngBase64);
  assert.ok(targetPath);
  assert.equal(await gooseFs.existsAsync(targetPath), true);
  assert.equal(gooseFs.exists(targetPath), true);

  try {
    fs.unlinkSync(targetPath);
    fs.rmdirSync(path.dirname(targetPath));
  } catch {
    /* noop */
  }
});
