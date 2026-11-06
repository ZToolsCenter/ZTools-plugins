'use strict';

// lmdb's published CommonJS bundle includes a Rollup import.meta.url shim.
// In Electron's shared preload/page world it detects `document` and derives its
// native-addon directory from the page URL. Give this Node-only module a local
// document binding, so it consistently resolves relative to its own filename.
if (typeof document === 'undefined') {
  module.exports = require('lmdb');
} else {
  const fs = require('fs');
  const path = require('path');
  const Module = require('module');
  const filename = require.resolve('lmdb');
  let loaded = require.cache[filename];
  if (!loaded) {
    loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    require.cache[filename] = loaded;
    try {
      loaded._compile("'use strict'; const document = undefined;\n" + fs.readFileSync(filename, 'utf8'), filename);
      loaded.loaded = true;
    } catch (error) {
      delete require.cache[filename];
      throw error;
    }
  }
  module.exports = loaded.exports;
}
