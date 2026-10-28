const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const path = require("node:path");
const { createHost, resolveHelperPath } = require("../../ztools/bridge.cjs");

function fixture(options = {}) {
  const callbacks = {};
  const spawned = [];
  const requests = [];
  const external = [];
  const dialogs = [];
  let dark = false;
  let selected;
  const ztools = {
    onPluginEnter: (callback) => {
      callbacks.enter = callback;
    },
    onPluginOut: (callback) => {
      callbacks.out = callback;
    },
    onThemeChange: (callback) => {
      callbacks.theme = callback;
    },
    isDarkColors: () => dark,
    shellOpenExternal: (url) => {
      external.push(url);
      return { success: true };
    },
    showOpenDialog: (value) => {
      dialogs.push(value);
      return selected;
    },
  };
  const host = createHost({
    ztools,
    helperPath: path.resolve("plugin/helper/askills-ztools.exe"),
    testDataDirectory: options.testDataDirectory,
    responseLimitBytes: options.responseLimitBytes,
    spawnProcess: (executable, args, spawnOptions) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.reply = (request, result) =>
        child.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
      child.errorReply = (request, code, message) =>
        child.stdout.write(
          JSON.stringify({ id: request.id, error: { code, message } }) + "\n",
        );
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        throw new Error("Must not kill transactions");
      };
      child.stdin = new Writable({
        write(chunk, _encoding, done) {
          const request = JSON.parse(chunk.toString());
          requests.push(request);
          if (request.command === "get_app_info") {
            child.reply(request, {
              version: "1.0.0-fix",
              protocolVersion: options.protocolVersion ?? 1,
            });
          } else if (options.onRequest) options.onRequest(child, request);
          else child.reply(request, request.args);
          done();
        },
      });
      child.stdin.on("finish", () => {
        child.eof = true;
        if (options.autoClose !== false)
          queueMicrotask(() => child.emit("close", 0));
      });
      spawned.push({ child, executable, args, spawnOptions });
      return child;
    },
  });
  return {
    host,
    callbacks,
    spawned,
    requests,
    external,
    dialogs,
    enter: (code = "library") => callbacks.enter({ code }),
    select: (value) => {
      selected = value;
    },
    theme: (value) => {
      dark = value;
      callbacks.theme();
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("preload is idle until enter + invocation; spawn is a fixed executable without a shell", async () => {
  const f = fixture();
  assert.equal(f.spawned.length, 0);
  await assert.rejects(f.host.invoke("get_snapshot"), { code: "HostInactive" });
  f.enter();
  assert.equal(f.spawned.length, 0);
  await f.host.invoke("get_snapshot");
  assert.equal(f.spawned.length, 1);
  assert.equal(f.spawned[0].spawnOptions.shell, false);
  assert.equal(f.spawned[0].spawnOptions.windowsHide, true);
  assert.deepEqual(f.spawned[0].args, []);
  assert.deepEqual(
    f.requests.map((value) => value.command),
    ["get_app_info", "get_snapshot"],
  );
  f.host.close();
});

test("renderer cannot invoke internal directory registration or arbitrary commands", async () => {
  const f = fixture();
  f.enter();
  for (const command of [
    "register_directory_selection",
    "spawn",
    "read_file",
    "constructor",
  ]) {
    await assert.rejects(f.host.invoke(command, { path: "/untrusted" }), {
      code: "UnsupportedCommand",
    });
  }
  await assert.rejects(f.host.invoke("get_snapshot", []), {
    code: "InvalidRequest",
  });
  assert.equal(f.spawned.length, 0);
  await f.host.invoke("open_repository", { url: "https://untrusted.invalid" });
  assert.deepEqual(f.external, ["https://github.com/Candquarzy/Askills"]);
});

test("only native directory selection can mint a directory grant; cancel stays idle", async () => {
  const f = fixture();
  f.enter();
  assert.equal(
    await f.host.invoke("pick_directory", { purpose: "import" }),
    null,
  );
  assert.equal(f.spawned.length, 0);
  await assert.rejects(
    f.host.invoke("pick_directory", { purpose: "__proto__" }),
    { code: "InvalidSelection" },
  );
  const chosen = path.resolve("fixture/selected skill");
  f.select([chosen]);
  const result = await f.host.invoke("pick_directory", {
    purpose: "import",
    path: "/untrusted",
  });
  assert.deepEqual(result, { path: chosen, purpose: "import" });
  assert.deepEqual(f.dialogs[1].properties, ["openDirectory"]);
  assert.equal(f.requests[1].command, "register_directory_selection");
  f.host.close();
});

test("entry codes are bounded and late subscribers replay only an active entry", () => {
  const f = fixture();
  const received = [];
  const unsubscribe = f.host.onEnter((code) => received.push(code));
  f.enter("projects");
  f.enter("../arbitrary");
  unsubscribe();
  f.enter("sources");
  const latest = [];
  f.host.onEnter((code) => latest.push(code));
  assert.deepEqual(received, ["projects", "library"]);
  assert.deepEqual(latest, ["sources"]);
  f.callbacks.out(false);
  f.host.onEnter((code) => latest.push(code));
  assert.deepEqual(latest, ["sources"]);
});

test("theme subscriptions follow host theme and unsubscribe", () => {
  const f = fixture();
  const themes = [];
  const unsubscribe = f.host.onThemeChange((dark) => themes.push(dark));
  f.theme(true);
  assert.equal(f.host.isDark(), true);
  unsubscribe();
  f.theme(false);
  assert.deepEqual(themes, [true]);
});

test("protocol version mismatch rejects before any workspace operation", async () => {
  const f = fixture({ protocolVersion: 9 });
  f.enter();
  await assert.rejects(f.host.invoke("get_snapshot"), {
    code: "ProtocolMismatch",
  });
  assert.deepEqual(
    f.requests.map((value) => value.command),
    ["get_app_info"],
  );
  await tick();
  assert.equal(f.spawned[0].child.eof, true);
  assert.equal(f.spawned[0].child.killed, false);
});

test("responses can arrive out of order while progress and cancellation remain available", async () => {
  let download;
  const f = fixture({
    onRequest(child, request) {
      if (request.command === "prepare_github") download = request;
      else if (request.command === "get_download_progress")
        child.reply(request, { completed: 4, total: 10 });
      else if (request.command === "cancel_operation") {
        child.reply(request, null);
        child.errorReply(download, "Cancelled", "Operation cancelled.");
      }
    },
  });
  f.enter();
  const pending = f.host.invoke("prepare_github", { requestId: "download" });
  const cancellation = assert.rejects(pending, { code: "Cancelled" });
  await tick();
  assert.deepEqual(
    await f.host.invoke("get_download_progress", { requestId: "download" }),
    { completed: 4, total: 10 },
  );
  await f.host.invoke("cancel_operation");
  await cancellation;
  f.host.close();
});

test("exit drains pending work and reentry waits for old process to release its lock", async () => {
  let write;
  const f = fixture({
    autoClose: false,
    onRequest(child, request) {
      if (request.command === "set_library_root") write = request;
      else child.reply(request, {});
    },
  });
  f.enter();
  const pending = f.host.invoke("set_library_root", {
    selectionId: "owned-selection",
  });
  const detached = assert.rejects(pending, { code: "HostInactive" });
  await tick();
  const old = f.spawned[0].child;
  f.callbacks.out(false);
  await detached;
  await tick();
  assert.equal(old.eof, true);
  await assert.rejects(f.host.invoke("get_snapshot"), { code: "HostInactive" });
  f.enter("settings");
  const next = f.host.invoke("get_snapshot");
  await tick();
  assert.equal(f.spawned.length, 1);
  old.reply(write, { completed: true });
  old.emit("close", 0);
  assert.deepEqual(await next, {});
  assert.equal(f.spawned.length, 2);
  assert.equal(old.killed, false);
  f.host.close();
  f.spawned[1].child.emit("close", 0);
});

test("helper crash rejects all pending calls and next invocation can recover", async () => {
  const f = fixture({ onRequest() {} });
  f.enter();
  const first = f.host.invoke("get_snapshot");
  const second = f.host.invoke("get_revisions", { skillId: "example" });
  const errors = Promise.all([
    assert.rejects(first, { code: "HostDisconnected" }),
    assert.rejects(second, { code: "HostDisconnected" }),
  ]);
  await tick();
  f.spawned[0].child.emit("close", 1);
  await errors;
  assert.equal((await f.host.invoke("get_app_info")).protocolVersion, 1);
  assert.equal(f.spawned.length, 2);
  f.host.close();
});

test("requests and helper responses have finite framing limits", async () => {
  const f = fixture({ responseLimitBytes: 128, onRequest() {} });
  f.enter();
  await assert.rejects(
    f.host.invoke("remember_repository", { repository: "x".repeat(65536) }),
    { code: "InvalidRequest" },
  );
  const pending = f.host.invoke("get_snapshot");
  const error = assert.rejects(pending, { code: "ProtocolError" });
  await tick();
  f.spawned[0].child.stdout.write(Buffer.alloc(129, 120));
  await error;
  await tick();
  assert.equal(f.spawned[0].child.killed, false);
});

test("malformed helper JSON rejects pending requests without exposing raw output", async () => {
  const f = fixture({ onRequest() {} });
  f.enter();
  const pending = f.host.invoke("get_snapshot");
  const error = assert.rejects(pending, {
    code: "ProtocolError",
    message: "Askills 本地服务返回了无效响应。",
  });
  await tick();
  f.spawned[0].child.stdout.write("PRIVATE FILE CONTENT\n");
  await error;
});

test("UTF-8 responses split in the middle of a multibyte character remain intact", async () => {
  const f = fixture({
    onRequest(child, request) {
      const bytes = Buffer.from(
        JSON.stringify({ id: request.id, result: "中文 skill" }) + "\n",
      );
      const offset = bytes.indexOf(Buffer.from("中")) + 1;
      child.stdout.write(bytes.subarray(0, offset));
      child.stdout.write(bytes.subarray(offset));
    },
  });
  f.enter();
  assert.equal(await f.host.invoke("get_snapshot"), "中文 skill");
  f.host.close();
});

test("packaged helper runs from the unpacked ASAR directory; development path stays unchanged", () => {
  assert.equal(
    resolveHelperPath(path.resolve("plugins/askills.asar")),
    path.resolve("plugins/askills.asar.unpacked/helper/askills-ztools.exe"),
  );
  assert.equal(
    resolveHelperPath(path.resolve("plugins/askills-dev")),
    path.resolve("plugins/askills-dev/helper/askills-ztools.exe"),
  );
});

test("startup library lock failure can be retried after the owner exits", async () => {
  let locked = true;
  const f = fixture({
    onRequest(child, request) {
      if (locked)
        child.errorReply(request, "LibraryBusy", "Library is in use.");
      else child.reply(request, { skills: [] });
    },
  });
  f.enter();
  await assert.rejects(f.host.invoke("get_snapshot"), { code: "LibraryBusy" });
  locked = false;
  assert.deepEqual(await f.host.invoke("get_snapshot"), { skills: [] });
  assert.equal(f.spawned.length, 2);
  f.host.close();
});

test("a directory dialog from a previous entry cannot grant access after reentry", async () => {
  const f = fixture();
  f.enter();
  let finishSelection;
  f.select(
    new Promise((resolve) => {
      finishSelection = resolve;
    }),
  );
  const pending = f.host.invoke("pick_directory", { purpose: "import" });
  const error = assert.rejects(pending, { code: "HostInactive" });
  f.callbacks.out(false);
  f.enter("library");
  finishSelection([path.resolve("previous-entry/skill")]);
  await error;
  assert.equal(f.spawned.length, 0);
});

test("valid large documents and two-document diffs can exceed 8 MiB", async () => {
  const body = "x".repeat(16 * 1024 * 1024);
  const f = fixture({
    onRequest(child, request) {
      const result =
        request.command === "get_document"
          ? { content: body }
          : { before: body, after: body };
      const bytes = Buffer.from(
        JSON.stringify({ id: request.id, result }) + "\n",
      );
      // Simulate real pipe-sized chunks. Whole-document concatenation on every
      // chunk would cause quadratic copying for these supported document sizes.
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        child.stdout.write(bytes.subarray(offset, offset + 64 * 1024));
      }
    },
  });
  f.enter();
  const document = await f.host.invoke("get_document", { revisionId: "large" });
  assert.equal(document.content.length, body.length);
  const diff = await f.host.invoke("get_revision_diff", {
    beforeId: "a",
    afterId: "b",
  });
  assert.equal(diff.before.length, body.length);
  assert.equal(diff.after.length, body.length);
  f.host.close();
});

test("old bound catch handlers cannot send commands after plugin reentry", async () => {
  const f = fixture({
    onRequest(child, request) {
      if (request.command !== "prepare_github") child.reply(request, {});
    },
  });
  f.enter();
  const oldCall = f.host.bindInvoke();
  const pending = oldCall("prepare_github", { requestId: "old-download" });
  const oldCatch = pending.catch(() => oldCall("get_snapshot"));
  const rejected = assert.rejects(oldCatch, { code: "HostInactive" });
  await tick();
  f.callbacks.out(false);
  f.enter();
  await rejected;
  assert.equal(
    f.requests.filter((request) => request.command === "get_snapshot").length,
    0,
  );
  assert.equal(f.spawned.length, 1);
  const newCall = f.host.bindInvoke();
  assert.deepEqual(await newCall("get_snapshot"), {});
  assert.equal(f.spawned.length, 2);
  f.host.close();
});
