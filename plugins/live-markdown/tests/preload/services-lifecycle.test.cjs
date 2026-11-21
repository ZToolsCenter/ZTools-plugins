"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("preload exposes and invokes local AI release on pagehide and beforeunload", async (t) => {
  const listeners = new Map();
  const calls = [];
  const servicePath = require.resolve("../../preload/local-ai/service.cjs");
  const originalServiceModule = require.cache[servicePath];
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      createLocalAiService: () => ({
        dispose: () => { calls.push("sync-dispose"); return true; },
        release: async () => { calls.push("async-release"); }
      })
    }
  };
  global.window = {
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    ztools: null
  };
  const modulePath = require.resolve("../../preload/services.cjs");
  delete require.cache[modulePath];
  t.after(() => {
    delete global.window;
    delete require.cache[modulePath];
    if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
    else delete require.cache[servicePath];
  });

  const bridge = require(modulePath);
  assert.equal(typeof bridge.dispose, "function");
  assert.equal(listeners.get("pagehide")?.length, 1);
  assert.equal(listeners.get("beforeunload")?.length, 1);
  assert.equal(bridge.dispose(), true);
  assert.deepEqual(calls, ["sync-dispose"], "synchronous child cleanup must happen before dispose returns");
  listeners.get("pagehide")[0]();
  assert.deepEqual(calls.slice(1), ["sync-dispose", "async-release"], "pagehide must signal before starting async release");
  listeners.get("beforeunload")[0]();
  assert.deepEqual(calls.slice(3), ["sync-dispose", "async-release"], "beforeunload must signal before starting async release");
});
