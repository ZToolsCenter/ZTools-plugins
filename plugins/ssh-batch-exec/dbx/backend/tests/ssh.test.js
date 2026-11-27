"use strict";

// 作者：木子
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const { Server } = require("ssh2");
const { createSshRuntime } = require("../lib/ssh");

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

async function startServer() {
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on("authentication", (ctx) => {
      ctx.accept();
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec, rejectExec, info) => {
          const command = info.command;
          const stream = acceptExec();
          if (command === "echo hello") {
            stream.write("hello\n");
            stream.exit(0);
            stream.end();
          } else if (command === "fail") {
            stream.stderr.write("oops\n");
            stream.exit(1);
            stream.end();
          }
          // sleep / long：不结束，用于取消与超时测试
        });
      });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

function serverConfig(port) {
  return {
    name: "local",
    host: "127.0.0.1",
    port,
    username: "tester",
    authType: "password",
    password: "secret",
  };
}

test("execOnServer returns stdout/stderr and emits stages", async () => {
  const { server, port } = await startServer();
  const events = [];
  const ssh = createSshRuntime((event) => events.push(event));
  try {
    const ok = await ssh.execOnServer(serverConfig(port), "echo hello", {
      runId: "run-ok",
      execId: "exec-ok",
      timeout: 10,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.exitCode, 0);
    assert.equal(ok.stdout, "hello\n");
    assert.ok(events.some((e) => e.type === "stage" && e.stage === "ready"));
    assert.ok(events.some((e) => e.type === "output" && e.text.includes("hello")));

    const failed = await ssh.execOnServer(serverConfig(port), "fail", {
      timeout: 10,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.exitCode, 1);
    assert.match(failed.stderr, /oops/);
  } finally {
    server.close();
  }
});

test("cancelRun stops a running command", async () => {
  const { server, port } = await startServer();
  let notifyExec;
  const execStarted = new Promise((resolve) => {
    notifyExec = resolve;
  });
  const ssh = createSshRuntime((event) => {
    if (event.type === "stage" && event.stage === "exec") notifyExec();
  });
  try {
    const running = ssh.execOnServer(serverConfig(port), "sleep", {
      runId: "run-cancel",
      timeout: 30,
    });
    await execStarted;
    ssh.cancelRun("run-cancel");
    const result = await running;
    assert.equal(result.cancelled, true);
  } finally {
    server.close();
  }
});

test("command timeout is reported", async () => {
  const { server, port } = await startServer();
  const ssh = createSshRuntime(() => {});
  try {
    const result = await ssh.execOnServer(serverConfig(port), "long", { timeout: 1 });
    assert.equal(result.timedOut, true);
    assert.match(result.error, /超时/);
  } finally {
    server.close();
  }
});
