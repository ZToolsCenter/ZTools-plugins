"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("preload version gate only bypasses an explicit browser preview", () => {
  const previousWindow = global.window;
  global.window = {};
  try {
    const { parseVersion, hostCompatibility } = require("../preload.js");
    assert.deepEqual(parseVersion("3.2"), [3, 2, 0]);
    assert.deepEqual(parseVersion("v3.2.0-beta.1"), [3, 2, 0]);
    assert.equal(parseVersion("ZTools 3.2.0"), null);
    assert.equal(hostCompatibility().supported, true);

    global.window.ztools = {};
    assert.equal(hostCompatibility().supported, false);
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, "getAppVersion", { get() { throw new Error("unavailable"); } });
    global.window.ztools = throwingGetter;
    assert.equal(hostCompatibility().supported, false);
    global.window.ztools = { getAppVersion: () => { throw new Error("unavailable"); } };
    assert.equal(hostCompatibility().supported, false);
    for (const version of ["", "unknown", 320]) {
      global.window.ztools = { getAppVersion: () => version };
      assert.equal(hostCompatibility().supported, false);
    }
    global.window.ztools = { getAppVersion: () => "2.3.9" };
    assert.equal(hostCompatibility().supported, false);
    global.window.ztools = { getAppVersion: () => "2.4.0-beta.1" };
    assert.equal(hostCompatibility().supported, false);
    for (const version of ["2.4", "3.1.9", "3.2.0"]) {
      global.window.ztools = { getAppVersion: () => version };
      assert.equal(hostCompatibility().supported, true);
    }
  } finally {
    global.window = previousWindow;
  }
});
