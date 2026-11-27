"use strict";

// 作者：木子
// SSH 执行核心：从 ZTools preload.js 迁移，去掉平台 API 依赖，增加阶段/输出事件。

const { Client } = require("ssh2");

const CONNECT_TIMEOUT_MS = 15000;
const CLOSE_GRACE_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_SEC = 300;

/** runId -> Set<Client>，用于整批取消 */
const runClients = new Map();
/** runId -> boolean，取消标记 */
const runCancelled = new Map();

function normalizeServer(server) {
  if (!server || typeof server !== "object") throw new Error("服务器配置无效");
  const host = String(server.host || "").trim();
  if (!host) throw new Error("主机地址不能为空");
  const port = Number(server.port) || 22;
  if (port < 1 || port > 65535) throw new Error("端口不合法: " + port);
  const username = String(server.username || "").trim();
  if (!username) throw new Error("用户名不能为空");
  return {
    host,
    port,
    username,
    authType: server.authType === "privateKey" ? "privateKey" : "password",
    password: String(server.password || ""),
    privateKey: String(server.privateKey || ""),
    passphrase: String(server.passphrase || ""),
  };
}

function buildConnectConfig(server) {
  const s = normalizeServer(server);
  const config = {
    host: s.host,
    port: s.port,
    username: s.username,
    readyTimeout: 20000,
    keepaliveInterval: 10000,
    tryKeyboard: false,
  };
  if (s.authType === "privateKey") {
    const key = s.privateKey.trim();
    if (!key) throw new Error("未配置私钥内容");
    config.privateKey = key;
    if (s.passphrase) config.passphrase = s.passphrase;
  } else {
    if (!s.password) throw new Error("未配置密码");
    config.password = s.password;
  }
  return config;
}

function describeSshError(err) {
  const msg = (err && err.message) || String(err);
  const map = [
    ["ECONNREFUSED", "连接被拒绝，请确认主机与端口"],
    ["ETIMEDOUT", "连接超时，请检查网络或防火墙"],
    ["Timed out while waiting for handshake", "SSH 握手超时：服务器已响应但登录协商未完成，可能是连接限流或网络抖动，请稍后重试"],
    ["Handshake failed", "SSH 握手失败：协议或加密算法协商不通过，请确认服务器 SSH 版本与配置"],
    ["ENOTFOUND", "主机名无法解析"],
    ["EHOSTUNREACH", "主机不可达"],
    ["All configured authentication methods failed", "认证失败：请检查用户名、密码或私钥"],
    ["Encrypted private key detected", "私钥已加密：需要提供私钥密码"],
    ["Cannot parse privateKey", "私钥格式无法解析，请使用 OpenSSH/PEM 格式"],
  ];
  for (const [needle, text] of map) {
    if (msg.includes(needle)) return text;
  }
  return msg;
}

function trackClient(runId, client) {
  if (!runId) return;
  if (!runClients.has(runId)) runClients.set(runId, new Set());
  runClients.get(runId).add(client);
}

function untrackClient(runId, client) {
  const set = runClients.get(runId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) {
    runClients.delete(runId);
    runCancelled.delete(runId);
  }
}

function forceCloseClient(client) {
  try {
    client.end();
  } catch (_) {
    /* 忽略关闭异常 */
  }
}

function createSshRuntime(emitEvent) {
  const emit = typeof emitEvent === "function" ? emitEvent : () => {};

  function emitStage(runId, execId, stage, enabled) {
    if (!enabled || !runId) return;
    emit({ type: "stage", runId, execId, stage, at: Date.now() });
  }

  function emitOutput(runId, execId, stream, text, enabled) {
    if (!enabled || !runId || !text) return;
    emit({ type: "output", runId, execId, stream, text, at: Date.now() });
  }

  function execOnServer(server, command, options) {
    const opts = options || {};
    const timeoutSec = Number(opts.timeout) > 0 ? Number(opts.timeout) : DEFAULT_COMMAND_TIMEOUT_SEC;
    const runId = opts.runId ? String(opts.runId) : "";
    const execId = opts.execId ? String(opts.execId) : "";
    const events = opts.events !== false;

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const result = {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        error: "",
        duration: 0,
        trace: [],
      };
      let finished = false;
      let client = null;
      let connectTimer = null;
      let execTimer = null;
      let closeGraceTimer = null;

      const trace = (stage) => {
        result.trace.push("+" + (Date.now() - startedAt) + "ms " + stage);
        emitStage(runId, execId, stage, events);
      };

      const clearTimers = () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (execTimer) clearTimeout(execTimer);
        if (closeGraceTimer) clearTimeout(closeGraceTimer);
      };

      const finish = (patch) => {
        if (finished) return;
        finished = true;
        clearTimers();
        const wasCancelled = !!runCancelled.get(runId);
        Object.assign(result, patch || {});
        if (wasCancelled && !result.cancelled) {
          result.cancelled = true;
          result.error = "已取消";
        }
        result.duration = Date.now() - startedAt;
        if (client) {
          if (runId) untrackClient(runId, client);
          forceCloseClient(client);
        }
        resolve(result);
      };

      if (typeof command !== "string" || !command.trim()) {
        return finish({ error: "命令不能为空" });
      }
      if (runCancelled.get(runId)) {
        return finish({ cancelled: true, error: "已取消" });
      }

      let config;
      try {
        config = buildConnectConfig(server);
      } catch (e) {
        return finish({ error: e.message });
      }

      client = new Client();
      trackClient(runId, client);

      connectTimer = setTimeout(() => {
        finish({
          timedOut: true,
          error:
            "SSH 连接超时：" +
            CONNECT_TIMEOUT_MS / 1000 +
            " 秒内未完成握手/登录。测试连接正常却偶发失败时，常见原因为服务器短时连接限流（MaxStartups/fail2ban）或网络丢包，请稍后重试",
        });
      }, CONNECT_TIMEOUT_MS);

      trace("connecting");

      client.on("handshake", () => trace("handshake"));

      client.on("ready", () => {
        if (connectTimer) clearTimeout(connectTimer);
        trace("ready");
        client.exec(command, (err, stream) => {
          if (err) {
            return finish({ error: "命令执行失败: " + describeSshError(err) });
          }
          trace("exec");

          execTimer = setTimeout(() => {
            finish({
              timedOut: true,
              error: "命令执行超时（超过 " + timeoutSec + " 秒），已断开连接",
            });
          }, timeoutSec * 1000);

          let exitCode = null;
          let exitSignal = null;

          const complete = () => {
            const failedBySignal = !!exitSignal;
            finish({
              exitCode,
              ok: exitCode === 0 && !failedBySignal,
              error: failedBySignal
                ? "命令被信号终止: " + exitSignal
                : exitCode === 0
                  ? ""
                  : "命令退出码 " + exitCode,
            });
          };

          stream.on("data", (data) => {
            const text = data.toString();
            result.stdout += text;
            emitOutput(runId, execId, "stdout", text, events);
          });
          stream.stderr.on("data", (data) => {
            const text = data.toString();
            result.stderr += text;
            emitOutput(runId, execId, "stderr", text, events);
          });

          stream.on("exit", (code, signal) => {
            if (code !== undefined && code !== null) exitCode = code;
            if (signal) exitSignal = signal;
            trace("exit:" + (signal ? "signal=" + signal : "code=" + exitCode));
            if (closeGraceTimer) clearTimeout(closeGraceTimer);
            closeGraceTimer = setTimeout(() => {
              if (!finished) complete();
            }, CLOSE_GRACE_MS);
          });

          stream.on("close", (code) => {
            trace("close");
            if (code !== undefined && code !== null) exitCode = code;
            complete();
          });
        });
      });

      client.on("error", (err) => {
        finish({ error: describeSshError(err) });
      });

      try {
        client.connect(config);
      } catch (e) {
        finish({ error: "连接失败: " + describeSshError(e) });
      }
    });
  }

  async function testConnection(server) {
    const probe = "__dbx_ssh_probe__";
    const res = await execOnServer(server, "echo " + probe, {
      timeout: 20,
      events: false,
    });
    if (res.ok && res.stdout.includes(probe)) {
      return { ok: true, message: "连接成功" };
    }
    return { ok: false, message: res.error || "连接失败" };
  }

  function cancelRun(runId) {
    if (!runId) return 0;
    runCancelled.set(String(runId), true);
    const set = runClients.get(String(runId));
    let count = 0;
    if (set) {
      set.forEach((client) => {
        forceCloseClient(client);
        count++;
      });
    }
    return count;
  }

  return { execOnServer, testConnection, cancelRun, normalizeServer, describeSshError };
}

module.exports = {
  createSshRuntime,
  normalizeServer,
  describeSshError,
  CONNECT_TIMEOUT_MS,
  CLOSE_GRACE_MS,
  DEFAULT_COMMAND_TIMEOUT_SEC,
};
