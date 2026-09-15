/**
 * ZTools 插件 preload 脚本：SSH 批量命令执行本地能力
 *
 * 规范约束：
 * - 使用 CommonJS（require），保持源码可读，禁止压缩/混淆/打包
 * - 只暴露最小 API，不把 ssh2、fs 等模块整体挂到 window
 * - 不写 UI 逻辑
 * - 说明：ssh2 默认不校验主机指纹，以提升首次连接的易用性
 */
const fs = require("node:fs");
const { Client } = require("ssh2");

/** runId -> Set<Client>，用于整批取消 */
const runClients = new Map();
/** runId -> boolean，取消标记 */
const runCancelled = new Map();

/** 校验并规范化服务器配置 */
function normalizeServer(server) {
  if (!server || typeof server !== "object") {
    throw new Error("服务器配置无效");
  }
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

/** 组装 ssh2 连接配置 */
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

/** 把常见连接错误翻译成更易读的提示 */
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
  if (set) {
    set.delete(client);
    if (set.size === 0) {
      runClients.delete(runId);
      runCancelled.delete(runId);
    }
  }
}

function forceCloseClient(client) {
  try {
    client.end();
  } catch (_) {
    /* 忽略关闭异常 */
  }
}

/** 连接/握手阶段硬超时（毫秒）：超时仍未 ready 就主动失败，避免无限“连接中” */
const CONNECT_TIMEOUT_MS = 15000;
/** 进程已 exit 但 channel close 事件迟迟不来时的兜底时间（毫秒） */
const CLOSE_GRACE_MS = 5000;

/**
 * 在单台服务器上执行一条命令
 * @param {object} server 服务器配置
 * @param {string} command 要执行的命令
 * @param {{timeout?: number, runId?: string, onStage?: (stage: string, info?: object) => void}} [options]
 *        timeout 为命令执行超时秒数（默认 300，从登录成功后起算）；onStage 回报连接阶段
 * @param {(text: string) => void} [onOutput] 实时输出回调（stdout + stderr）
 * @returns {Promise<{ok: boolean, exitCode: number|null, stdout: string, stderr: string, error: string, duration: number, timedOut?: boolean, cancelled?: boolean, trace?: string[]}>}
 */
function execOnServer(server, command, options, onOutput) {
  const opts = options || {};
  const timeoutSec = Number(opts.timeout) > 0 ? Number(opts.timeout) : 300;
  const runId = opts.runId || "";
  const onStage = typeof opts.onStage === "function" ? opts.onStage : null;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const result = { ok: false, exitCode: null, stdout: "", stderr: "", error: "", duration: 0, trace: [] };
    let finished = false;
    let client = null;
    /** 连接阶段计时器 */
    let connectTimer = null;
    /** 命令执行阶段计时器 */
    let execTimer = null;
    /** exit 后等待 close 的兜底计时器 */
    let closeGraceTimer = null;

    /** 记录阶段轨迹，写入返回结果，便于事后排错 */
    const trace = (stage) => {
      result.trace.push("+" + (Date.now() - startedAt) + "ms " + stage);
      if (onStage) {
        try {
          onStage(stage);
        } catch (_) {
          /* 阶段回调异常不影响执行 */
        }
      }
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
      Object.assign(result, patch || {});
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

    /* 连接阶段独立硬超时：不依赖 ssh2 内部 readyTimeout，防止握手静默挂起 */
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

    // 收到服务器 banner，说明 TCP 已通、sshd 已响应
    client.on("handshake", () => trace("handshake"));

    client.on("ready", () => {
      if (connectTimer) clearTimeout(connectTimer);
      trace("ready");
      client.exec(command, (err, stream) => {
        if (err) {
          return finish({ error: "命令执行失败: " + describeSshError(err) });
        }
        trace("exec");

        // 登录成功、命令已提交后，才开始计算命令执行超时
        execTimer = setTimeout(() => {
          finish({ timedOut: true, error: "命令执行超时（超过 " + timeoutSec + " 秒），已断开连接" });
        }, timeoutSec * 1000);

        const push = (text) => {
          if (typeof onOutput === "function") {
            try {
              onOutput(text);
            } catch (_) {
              /* 输出回调异常不影响执行 */
            }
          }
        };

        /** exit 事件携带退出码/信号；close 表示通道完全关闭，二者都做兜底 */
        let exitCode = null;
        let exitSignal = null;

        const complete = () => {
          const code = exitCode;
          const failedBySignal = !!exitSignal;
          finish({
            exitCode: code,
            ok: code === 0 && !failedBySignal,
            error: failedBySignal
              ? "命令被信号终止: " + exitSignal
              : code === 0
                ? ""
                : "命令退出码 " + code,
          });
        };

        stream.on("data", (data) => {
          result.stdout += data.toString();
          push(data.toString());
        });
        stream.stderr.on("data", (data) => {
          result.stderr += data.toString();
          push(data.toString());
        });

        stream.on("exit", (code, signal) => {
          if (code !== undefined && code !== null) exitCode = code;
          if (signal) exitSignal = signal;
          trace("exit:" + (signal ? "signal=" + signal : "code=" + exitCode));
          // 正常情况 close 会紧随其后；若个别实现迟迟不发 close，兜底完成，避免永久挂起
          if (closeGraceTimer) clearTimeout(closeGraceTimer);
          closeGraceTimer = setTimeout(() => {
            if (!finished) complete();
          }, CLOSE_GRACE_MS);
        });

        stream.on("close", (code) => {
          trace("close");
          // close 的 code 缺省时回退使用 exit 事件拿到的退出码
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

/** 测试服务器连接：执行 echo 探针命令 */
async function testConnection(server) {
  const probe = "__ztools_ssh_probe__";
  const res = await execOnServer(server, "echo " + probe, { timeout: 20 });
  if (res.ok && res.stdout.includes(probe)) {
    return { ok: true, message: "连接成功" };
  }
  return { ok: false, message: res.error || "连接失败" };
}

/** 取消一轮批量执行：断开该 runId 下所有连接 */
function cancelRun(runId) {
  if (!runId) return 0;
  runCancelled.set(runId, true);
  const set = runClients.get(runId);
  let count = 0;
  if (set) {
    set.forEach((client) => {
      forceCloseClient(client);
      count++;
    });
  }
  return count;
}

/** 读取本地私钥文件内容（限 64KB，避免误读大文件） */
function readPrivateKey(filePath) {
  const p = String(filePath || "").trim();
  if (!p) return { ok: false, message: "路径为空" };
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return { ok: false, message: "不是普通文件: " + p };
    if (stat.size > 64 * 1024) return { ok: false, message: "文件过大（超过 64KB），不像私钥文件" };
    const content = fs.readFileSync(p, "utf-8");
    if (!content.includes("PRIVATE KEY")) {
      return { ok: false, message: "文件内容不包含私钥标记（PRIVATE KEY）" };
    }
    return { ok: true, content };
  } catch (e) {
    return { ok: false, message: "读取失败: " + e.message };
  }
}

window.services = {
  execOnServer,
  testConnection,
  cancelRun,
  readPrivateKey,
};
