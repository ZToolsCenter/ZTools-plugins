// Keep this file and bridge.cjs readable: ZTools does not allow bundled or
// obfuscated preload code. All native capabilities live behind askillsHost.
const { createHost, resolveHelperPath } = require("./bridge.cjs");

const ztoolsApi = window.ztools;
const testDataDirectory =
  ztoolsApi.isDev() === true
    ? process.env.ASKILLS_ZTOOLS_TEST_DATA_DIR
    : undefined;

const host = createHost({
  ztools: ztoolsApi,
  helperPath: resolveHelperPath(__dirname),
  testDataDirectory,
});

Object.defineProperty(window, "askillsHost", {
  value: host,
  configurable: false,
  writable: false,
});

// Closing/destroying the plugin also closes its pipe. The Rust helper cancels
// cancellable work and finishes filesystem transactions before releasing locks.
window.addEventListener("unload", () => host.close());
