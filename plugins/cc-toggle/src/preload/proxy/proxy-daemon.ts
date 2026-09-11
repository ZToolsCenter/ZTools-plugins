// @ts-nocheck TODO: 逐步添加类型注解后移除
// public/preload/proxy-daemon.js
// 后台隐藏窗口的 preload：起 http 代理，支持 failover + 健康检查 + 熔断
// 通过 IPC 接收主窗口指令，通过 ztools.sendToParent 上报状态/日志

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { ipcRenderer } = require('electron');
const { getLogger } = require('../utils.js');

let group = null; // 当前路由组配置
let members = []; // { providerId, name, baseUrl, apiKey, priority, weight, state, fails, openUntil, latency, up }
let server = null;
let healthTimer = null;
let rrIdx = 0; // round-robin 游标
let startedAt = 0; // server listen 时刻
let activeConn = 0; // 活跃连接数
let reqTotal = 0; // 总请求
let reqSuccess = 0; // 成功请求 (<500)
let reqFail = 0; // 失败请求 (>=500 或 upstream error)
let lastMemberId = null; // 最近一次转发命中的成员
let authToken = ''; // 本地代理访问令牌：仅持有者可用本代理转发

// 日志记录器
const proxyLog = getLogger('proxy');

// 请求体上限：仅防御异常/恶意撑爆内存，正常大对话/多模态请求远达不到
const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
// 非流式响应扫描 usage 时保留的尾部字节上限（usage 一般在响应末尾）
const USAGE_TAIL_BYTES = 256 * 1024;

// 校验请求携带的本地令牌；未配置 token 时放行（兼容旧行为）
function isAuthed(req) {
  if (!authToken) return true;
  var auth = req.headers['authorization'] || '';
  var bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7).trim() : '';
  var xkey = req.headers['x-api-key'] || '';
  var xkeyStr = Array.isArray(xkey) ? xkey[0] : xkey;
  return bearer === authToken || (xkeyStr && xkeyStr.trim() === authToken);
}

function log(level, msg, meta) {
  // 写入日志文件
  try {
    proxyLog[level](msg, meta);
  } catch (e) {}
}

function stat() {
  var data = {
    running: !!server,
    port: group ? group.listenPort : 0,
    startedAt: startedAt,
    activeConn: activeConn,
    reqTotal: reqTotal,
    reqSuccess: reqSuccess,
    reqFail: reqFail,
    lastMemberId: lastMemberId,
    members: members.map(function (m) {
      return {
        id: m.providerId,
        name: m.name,
        state: m.state,
        fails: m.fails,
        openUntil: m.openUntil,
        latency: m.latency,
        up: m.up
      };
    })
  };
  try {
    ztools.sendToParent('proxy-stat', data);
  } catch (e) {
    log('error', 'sendToParent failed', { error: String(e) });
  }
  try {
    ipcRenderer.send('proxy-stat', data);
  } catch (e) {}
}

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '***';
  return k.slice(0, 6) + '***' + k.slice(-4);
}

// —— 用量统计采集 ——
// 归一化不同上游的 usage 结构为统一计数
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null;
  var promptDetails = u.prompt_tokens_details || u.input_tokens_details || {};
  var input = Number(u.input_tokens != null ? u.input_tokens : u.prompt_tokens) || 0;
  var output = Number(u.output_tokens != null ? u.output_tokens : u.completion_tokens) || 0;
  // 缓存读取命中：OpenAI(cached_tokens) / Anthropic(cache_read_input_tokens)
  var cacheRead =
    Number(
      promptDetails.cached_tokens != null
        ? promptDetails.cached_tokens
        : u.cache_read_input_tokens != null
          ? u.cache_read_input_tokens
          : 0
    ) || 0;
  // 缓存创建：Anthropic(cache_creation_input_tokens)
  var cacheCreate =
    Number(u.cache_creation_input_tokens != null ? u.cache_creation_input_tokens : 0) || 0;
  var total = Number(u.total_tokens) || input + output;
  if (!input && !output && !total && !cacheRead && !cacheCreate) return null;
  return {
    input: input,
    output: output,
    cacheRead: cacheRead,
    cacheCreate: cacheCreate,
    total: total
  };
}

// 上报一次用量（每完成一个请求调用一次）
function reportUsage(member, usage) {
  var n = normalizeUsage(usage);
  if (!n) return;
  try {
    ztools.sendToParent('proxy-usage', {
      ts: Date.now(),
      appType: member ? member.appType || '' : '',
      providerId: member ? member.providerId : '',
      name: member ? member.name : '',
      model: (member && member.model) || '',
      input: n.input,
      output: n.output,
      cacheRead: n.cacheRead,
      cacheCreate: n.cacheCreate,
      total: n.total
    });
  } catch (e) {}
}

// 从 SSE 文本片段中提取最后一个带 usage 的 data 事件（用于透传场景）
// 返回 usage 对象或 null；scanner 维护跨 chunk 的残行
function makeUsageScanner() {
  return { leftover: '', usage: null };
}
function scanSseForUsage(scanner, text) {
  scanner.leftover += text;
  var idx = scanner.leftover.lastIndexOf('\n');
  if (idx < 0) return;
  var complete = scanner.leftover.slice(0, idx + 1);
  scanner.leftover = scanner.leftover.slice(idx + 1);
  if (complete.indexOf('usage') < 0) return;
  complete.split(/\r?\n/).forEach(function (line) {
    var s = line.indexOf('data:');
    if (s !== 0) return;
    var payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      var d = JSON.parse(payload);
      var u =
        d.usage ||
        (d.response && d.response.usage) ||
        (d.type === 'message_delta' && d.usage) ||
        null;
      if (u) scanner.usage = u;
    } catch (e) {}
  });
}

// —— 熔断状态机 ——
function noteSuccess(m) {
  m.fails = 0;
  if (m.state === 'half-open' || m.state === 'open') {
    m.state = 'closed';
    m.openUntil = 0;
    log('info', 'breaker closed', { id: m.providerId });
  }
}
function noteFailure(m) {
  m.fails = (m.fails || 0) + 1;
  const th = (group.breaker && group.breaker.failThreshold) || 3;
  if (m.state !== 'open' && m.fails >= th) {
    const cd = (group.breaker && group.breaker.cooldownMs) || 60000;
    m.state = 'open';
    m.openUntil = Date.now() + cd;
    log('warn', 'breaker open', { id: m.providerId });
  }
}
function tickBreaker() {
  const now = Date.now();
  members.forEach(function (m) {
    if (m.state === 'open' && now >= m.openUntil && m.up !== false) {
      m.state = 'half-open';
      m.fails = 0;
    }
  });
}

// —— 选择上游 ——
function eligible() {
  tickBreaker();
  return members.filter(function (m) {
    return m.state !== 'open';
  });
}
function pickMember() {
  const list = eligible();
  if (list.length === 0) return null;
  const strategy = (group && group.strategy) || 'failover';
  if (strategy === 'round_robin') {
    const m = list[rrIdx % list.length];
    rrIdx++;
    return m;
  }
  if (strategy === 'weighted') {
    const total = list.reduce(function (s, m) {
      return s + (m.weight || 1);
    }, 0);
    let r = Math.random() * total;
    for (let i = 0; i < list.length; i++) {
      r -= list[i].weight || 1;
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }
  // failover: priority 小的优先，其次健康
  list.sort(function (a, b) {
    return (a.priority || 99) - (b.priority || 99);
  });
  return list[0];
}

// —— 协议转换器 ——
let converter = null;
try {
  converter = require('../config/proxy-converter.js');
} catch (e) {}

function joinUrl(baseUrl, reqPath) {
  // 保留 baseUrl 的路径前缀（如 /v1），再拼上 reqPath
  var b = baseUrl.replace(/\/+$/, '');
  var m = b.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!m) return new URL(reqPath, baseUrl);
  var origin = m[1];
  var basePath = (m[2] || '').replace(/\/+$/, '');
  var q = reqPath.indexOf('?');
  var pathOnly = q >= 0 ? reqPath.slice(0, q) : reqPath;
  var search = q >= 0 ? reqPath.slice(q) : '';
  // 若 reqPath 已包含 basePath 则不重复
  var full = basePath && pathOnly.indexOf(basePath) === 0 ? pathOnly : basePath + pathOnly;
  return new URL(origin + full + search);
}

function wantsConvert(member, reqPath) {
  if (!converter) return false;
  var af = member.apiFormat || '';
  if (af !== 'openai_chat' && af !== 'anthropic') return false;
  // 仅转换 Codex 的 Responses 请求
  var p = reqPath.split('?')[0];
  return /\/responses\/?$/.test(p) || member.appType === 'codex';
}

// —— 转发 ——
// reasoningStripped: 自适应重试标记——上游拒绝 reasoning 参数后，剥离并重试一次时置真，防止无限重试
function forward(member, req, res, attemptsLeft, reqBody, reasoningStripped) {
  return new Promise(function (resolve) {
    lastMemberId = member.providerId;
    var reqPath = req.url;
    var doConvert =
      req.method === 'POST' && wantsConvert(member, reqPath) && reqBody && reqBody.length;
    var outBody = reqBody;
    var upstream;

    try {
      // Claude Desktop 模型名映射：claude-sonnet-5 → 实际模型名
      if (member.desktopModelMap && req.method === 'POST' && reqBody && reqBody.length) {
        try {
          var bodyObj = JSON.parse(reqBody.toString('utf8'));
          var mapped = member.desktopModelMap[bodyObj.model];
          if (mapped && mapped !== bodyObj.model) {
            bodyObj.model = mapped;
            reqBody = Buffer.from(JSON.stringify(bodyObj), 'utf8');
            outBody = reqBody;
          }
        } catch (e) {
          /* 非 JSON body，跳过 */
        }
      }
      // 过滤不支持的 tool 类型，仅保留 "function" 类型（MiMo 等 API 不支持 custom/web_search 等）
      if (req.method === 'POST' && reqBody && reqBody.length) {
        try {
          var bodyForTools = JSON.parse(reqBody.toString('utf8'));
          if (Array.isArray(bodyForTools.tools)) {
            var filtered = bodyForTools.tools.filter(function (t) {
              return t.type === 'function' || !t.type;
            });
            if (filtered.length !== bodyForTools.tools.length) {
              bodyForTools.tools = filtered.length > 0 ? filtered : undefined;
              reqBody = Buffer.from(JSON.stringify(bodyForTools), 'utf8');
              outBody = reqBody;
            }
          }
        } catch (e) {
          /* 非 JSON body，跳过 */
        }
      }
      if (doConvert) {
        var parsed = JSON.parse(reqBody.toString('utf8'));
        var conv = converter.convertRequest(member, parsed, reqPath);
        // bodyOverride 合并
        if (member.bodyOverride) {
          try {
            var ov = JSON.parse(member.bodyOverride);
            var cb = JSON.parse(conv.body);
            Object.assign(cb, ov);
            conv.body = JSON.stringify(cb);
          } catch (e) {}
        }
        outBody = Buffer.from(conv.body, 'utf8');
        upstream = joinUrl(member.baseUrl, conv.path);
      } else {
        // 代理写入 Codex 配置时给 base_url 加了伪前缀 /v1（见 services.js），Codex 遂请求 /v1/responses。
        // 该 /v1 仅用于让 Codex 接受端点；当上游 baseUrl 自带路径段（如火山 /api/plan/v3）时，
        // 直接拼接会得到 /api/plan/v3/v1/responses 而 404，需先剥掉 /v1。纯域名上游（标准 OpenAI
        // 端点需要 /v1）不剥；baseUrl 尾部本就是 /v1 的由 joinUrl 去重处理，剥不剥都正确。
        var passPath = reqPath;
        var hasBasePath = /^https?:\/\/[^/]+\/.+/.test(member.baseUrl || '');
        if (member.appType === 'codex' && hasBasePath)
          passPath = reqPath.replace(/^\/v1(\/|$)/, '/');
        upstream = joinUrl(member.baseUrl, passPath);
        // 自适应重试已剥离 reasoning 时，用剥离后的 body 转发（reqBody 已是剥离版，无需再处理）
      }
    } catch (e) {
      log('error', 'convert failed', { id: member.providerId });
      upstream = joinUrl(member.baseUrl, reqPath);
      outBody = reqBody;
      doConvert = false;
    }

    var client = upstream.protocol === 'https:' ? https : http;
    var headers = Object.assign({}, req.headers);
    delete headers.host;
    delete headers['content-length'];
    delete headers['accept-encoding']; // 避免上游 gzip 干扰转换
    if (member.apiKey) {
      var af = member.apiFormat || '';
      if (af === 'anthropic') {
        headers['x-api-key'] = member.apiKey;
        headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01';
      } else {
        headers['authorization'] = 'Bearer ' + member.apiKey;
        headers['x-api-key'] = member.apiKey;
      }
    }
    if (member.impersonateClaudeCode) {
      // 伪装 Claude Code 客户端：网关限制只能通过 Claude Code 使用时开启
      headers['user-agent'] = member.customUserAgent || 'claude-cli/1.0.0 (external, cli)';
      headers['x-app'] = 'cli';
      headers['anthropic-beta'] =
        headers['anthropic-beta'] || 'claude-code-20250219,oauth-2025-04-20';
    }
    if (member.customUserAgent) headers['user-agent'] = member.customUserAgent;
    if (member.headersOverride) {
      try {
        var ho = JSON.parse(member.headersOverride);
        Object.keys(ho).forEach(function (k) {
          headers[k.toLowerCase()] = ho[k];
        });
      } catch (e) {}
    }
    if (outBody) {
      headers['content-length'] = Buffer.byteLength(outBody);
      if (doConvert) headers['content-type'] = 'application/json';
    }

    var t0 = Date.now();
    var reqOpt = {
      method: req.method,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      path: upstream.pathname + upstream.search,
      headers: headers,
      timeout: (group && group.timeoutMs) || 120000
    };

    var upReq = client.request(reqOpt, function (upRes) {
      var latency = Date.now() - t0;
      var sc = upRes.statusCode || 0;
      // 自适应重试：部分 Responses 兼容上游（如火山 ark-code-latest）不支持 reasoning 参数，返回 400。
      // 捕获该错误，剥离 reasoning 后重试一次；官方支持 reasoning 的端点不会触发，功能不退化。
      if (
        sc === 400 &&
        !doConvert &&
        !reasoningStripped &&
        req.method === 'POST' &&
        reqBody &&
        reqBody.length
      ) {
        var _eb = [];
        upRes.on('data', function (c) {
          _eb.push(c);
        });
        upRes.on('end', function () {
          var errText = Buffer.concat(_eb).toString('utf8');
          var canRetry = false;
          var stripped = null;
          if (/reasoning/i.test(errText)) {
            try {
              var pb = JSON.parse(reqBody.toString('utf8'));
              if (pb && pb.reasoning !== undefined) {
                delete pb.reasoning;
                stripped = Buffer.from(JSON.stringify(pb), 'utf8');
                canRetry = true;
              }
            } catch (e) {
              /* 非 JSON 无法剥离 */
            }
          }
          if (canRetry) {
            return forward(member, req, res, attemptsLeft, stripped, true).then(resolve);
          }
          // 非 reasoning 类 400，原样回给客户端
          noteSuccess(member);
          reqSuccess++;
          member.latency = latency;
          if (!res.headersSent)
            res.writeHead(sc, {
              'content-type': upRes.headers['content-type'] || 'application/json'
            });
          res.end(Buffer.concat(_eb));
          resolve();
        });
        return;
      }
      if (sc >= 500) {
        noteFailure(member);
        reqFail++;
        log('warn', 'upstream 5xx', { id: member.providerId, sc: sc });
        upRes.resume();
        if (attemptsLeft > 0) {
          var next = pickMember();
          if (next && next.providerId !== member.providerId) {
            return forward(next, req, res, attemptsLeft - 1, reqBody).then(resolve);
          }
        }
        if (!res.headersSent) res.writeHead(sc, { 'content-type': 'application/json' });
        return void res.end('{"error":"upstream 5xx"}');
      }
      noteSuccess(member);
      reqSuccess++;
      member.latency = latency;

      var ct = (upRes.headers['content-type'] || '').toLowerCase();
      var isSse = ct.indexOf('text/event-stream') >= 0;

      if (doConvert && isSse) {
        // 流式：Chat/Anthropic SSE → Responses SSE
        var outHeaders = {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        };
        res.writeHead(sc, outHeaders);
        // 先发 response.created
        try {
          res.write('event: response.created\n');
          res.write(
            'data: ' +
              JSON.stringify({
                type: 'response.created',
                response: {
                  id: 'resp_' + Date.now(),
                  object: 'response',
                  created_at: Math.floor(Date.now() / 1000),
                  status: 'in_progress',
                  model: member.model || '',
                  output: []
                }
              }) +
              '\n\n'
          );
        } catch (e) {}
        var state = {
          text: '',
          toolCalls: {},
          responseJson: {},
          reasoningAdded: false,
          reasoningText: '',
          reasoningItemId: '',
          reasoningOutputIndex: 0,
          nextOutputIndex: 0,
          textAdded: false,
          msgOutputIndex: 0
        };
        var leftover = '';
        upRes.setEncoding('utf8');
        upRes.on('data', function (chunk) {
          leftover += chunk;
          var idx = leftover.lastIndexOf('\n');
          if (idx < 0) return;
          var complete = leftover.slice(0, idx + 1);
          leftover = leftover.slice(idx + 1);
          try {
            var converted = converter.convertSse(member, complete, state);
            if (converted)
              res.write(converted.replace(/\n(event:)/g, '\n\n$1').replace(/\n$/, '\n\n'));
          } catch (e) {
            log('error', 'sse convert failed', { id: member.providerId });
          }
        });
        upRes.on('end', function () {
          if (leftover.trim()) {
            try {
              var c2 = converter.convertSse(member, leftover + '\n', state);
              if (c2) res.write(c2);
            } catch (e) {}
          }
          // 如果没有收到 [DONE] 标记，强制发送 response.completed
          if (state.msgId && !state.doneSent) {
            try {
              var content = [];
              if (state.text)
                content.push({ type: 'output_text', text: state.text, annotations: [] });
              Object.keys(state.toolCalls || {})
                .sort(function (a, b) {
                  return Number(a) - Number(b);
                })
                .forEach(function (k) {
                  var tc = state.toolCalls[k];
                  if (!tc) return;
                  content.push({
                    type: 'function_call',
                    id: tc.id,
                    call_id: tc.id,
                    name: tc.name || '',
                    arguments: tc.arguments || '',
                    status: 'completed'
                  });
                });
              res.write('event: response.output_item.done\n');
              res.write(
                'data: ' +
                  JSON.stringify({
                    type: 'response.output_item.done',
                    output_index: state.msgOutputIndex || 0,
                    item: {
                      type: 'message',
                      id: state.msgId,
                      status: 'completed',
                      role: 'assistant',
                      content: content
                    }
                  }) +
                  '\n\n'
              );
              state.responseJson.output = state.responseJson.output || [];
              state.responseJson.output.push({
                type: 'message',
                id: state.msgId,
                status: 'completed',
                role: 'assistant',
                content: content
              });
              // 兜底：强制补全 Responses 格式 usage，否则 Codex 解析 ResponseCompleted 报
              // "missing field input_tokens"。state.responseJson.usage 可能缺失或为 chat 旧格式。
              var _u = state.responseJson.usage;
              state.responseJson.usage =
                _u && typeof _u === 'object'
                  ? {
                      input_tokens:
                        Number(_u.input_tokens != null ? _u.input_tokens : _u.prompt_tokens) || 0,
                      input_tokens_details: {
                        cached_tokens:
                          Number(
                            _u.input_tokens_details && _u.input_tokens_details.cached_tokens != null
                              ? _u.input_tokens_details.cached_tokens
                              : _u.prompt_tokens_details && _u.prompt_tokens_details.cached_tokens != null
                                ? _u.prompt_tokens_details.cached_tokens
                                : _u.cache_read_input_tokens != null
                                  ? _u.cache_read_input_tokens
                                  : 0
                          ) || 0
                      },
                      output_tokens:
                        Number(_u.output_tokens != null ? _u.output_tokens : _u.completion_tokens) || 0,
                      total_tokens: Number(_u.total_tokens) || 0
                    }
                  : { input_tokens: 0, output_tokens: 0 };
              res.write('event: response.completed\n');
              res.write(
                'data: ' +
                  JSON.stringify({ type: 'response.completed', response: state.responseJson }) +
                  '\n\n'
              );
              state.doneSent = true;
            } catch (e) {}
          }
          try {
            reportUsage(member, state.responseJson && state.responseJson.usage);
          } catch (e) {}
          res.end();
          resolve();
        });
        return;
      }

      if (doConvert) {
        // 非流式 JSON → Responses JSON
        var buf = [];
        upRes.on('data', function (c) {
          buf.push(c);
        });
        upRes.on('end', function () {
          var raw = Buffer.concat(buf).toString('utf8');
          var out = raw;
          try {
            out = converter.convertResponse(member, raw, false);
          } catch (e) {}
          try {
            var pj = JSON.parse(out);
            reportUsage(member, pj && pj.usage);
          } catch (e) {}
          res.writeHead(sc, { 'content-type': 'application/json' });
          res.end(out);
          resolve();
        });
        return;
      }

      // 透传（同时扫描 usage 用于统计，不改动转发内容）
      res.writeHead(sc, upRes.headers);
      var ctPass = (upRes.headers['content-type'] || '').toLowerCase();
      var isSsePass = ctPass.indexOf('text/event-stream') >= 0;
      var isJsonPass = ctPass.indexOf('application/json') >= 0;
      if (isSsePass) {
        var scanner = makeUsageScanner();
        upRes.on('data', function (chunk) {
          res.write(chunk);
          try {
            scanSseForUsage(scanner, chunk.toString('utf8'));
          } catch (e) {}
        });
        upRes.on('end', function () {
          try {
            scanSseForUsage(scanner, '\n');
            reportUsage(member, scanner.usage);
          } catch (e) {}
          res.end();
          resolve();
        });
      } else if (isJsonPass) {
        // 边转发边只保留尾部片段用于扫 usage，避免大响应整体缓冲堆内存
        var jbuf = [];
        var jbufBytes = 0;
        upRes.on('data', function (chunk) {
          res.write(chunk);
          jbuf.push(chunk);
          jbufBytes += chunk.length;
          // 超出尾部窗口时丢弃最早的片段（usage 通常位于响应末尾）
          while (jbufBytes > USAGE_TAIL_BYTES && jbuf.length > 1) {
            jbufBytes -= jbuf[0].length;
            jbuf.shift();
          }
        });
        upRes.on('end', function () {
          try {
            var pj = JSON.parse(Buffer.concat(jbuf).toString('utf8'));
            reportUsage(member, pj && pj.usage);
          } catch (e) {
            /* 尾部截断的大响应无法解析 usage，属预期 */
          }
          res.end();
          resolve();
        });
      } else {
        upRes.pipe(res).on('finish', resolve);
      }
    });

    upReq.on('error', function (err) {
      noteFailure(member);
      reqFail++;
      log('error', 'upstream error', { id: member.providerId });
      if (attemptsLeft > 0) {
        var next = pickMember();
        if (next && next.providerId !== member.providerId) {
          return forward(next, req, res, attemptsLeft - 1, reqBody).then(resolve);
        }
      }
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('upstream error');
      }
      resolve();
    });
    upReq.on('timeout', function () {
      upReq.destroy(new Error('timeout'));
    });

    if (outBody && outBody.length) upReq.end(outBody);
    else upReq.end();
  });
}

// —— HTTP 服务 ——
function startServer() {
  return new Promise(function (resolve, reject) {
    if (server) {
      try {
        server.close();
      } catch (e) {}
      server = null;
    }
    const port = (group && group.listenPort) || 8788;
    server = http.createServer(function (req, res) {
      reqTotal++;
      activeConn++;
      log('debug', 'request received', { method: req.method, url: req.url, total: reqTotal });
      res.on('close', function () {
        activeConn = Math.max(0, activeConn - 1);
      });
      if (!isAuthed(req)) {
        reqFail++;
        log('warn', 'unauthorized request');
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end('{"error":"unauthorized: invalid proxy token"}');
      }
      const m = pickMember();
      if (!m) {
        reqFail++;
        res.writeHead(503);
        return res.end('no available upstream');
      }
      const maxAttempts = Math.max(1, members.length);
      // 缓冲请求体（转换需要完整 body）
      var chunks = [];
      var received = 0;
      var aborted = false;
      req.on('data', function (c) {
        if (aborted) return;
        received += c.length;
        if (received > MAX_REQUEST_BYTES) {
          aborted = true;
          reqFail++;
          chunks = [];
          if (!res.headersSent) res.writeHead(413, { 'content-type': 'application/json' });
          res.end('{"error":"request entity too large"}');
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', function () {
        if (aborted) return;
        var body = chunks.length ? Buffer.concat(chunks) : null;
        forward(m, req, res, maxAttempts - 1, body);
      });
    });
    server.on('error', function (err) {
      log('error', 'server error');
      reject(err);
    });
    server.listen(port, '127.0.0.1', function () {
      startedAt = Date.now();
      activeConn = 0;
      reqTotal = 0;
      reqSuccess = 0;
      reqFail = 0;
      lastMemberId = null;
      log('info', 'proxy listening', { port: port, members: members.length });
      stat();
      resolve();
    });
  });
}

// —— 健康检查 ——
function pingOnce(m) {
  return new Promise(function (resolve) {
    // 没有apiKey的供应商跳过健康检查
    if (!m.apiKey) {
      m.up = true;
      m.latency = 0;
      return resolve();
    }
    let u;
    try {
      u = new URL((group.health && group.health.path) || '/', m.baseUrl);
    } catch (e) {
      m.up = false;
      m.latency = 0;
      return resolve();
    }
    const client = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const req = client.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        timeout: (group.health && group.health.timeoutMs) || 5000,
        headers: { authorization: 'Bearer ' + m.apiKey, 'x-api-key': m.apiKey }
      },
      function (r) {
        m.latency = Date.now() - t0;
        m.up = (r.statusCode || 0) < 500;
        r.resume();
        resolve();
      }
    );
    req.on('error', function () {
      m.up = false;
      m.latency = 0;
      resolve();
    });
    req.on('timeout', function () {
      m.up = false;
      m.latency = 0;
      req.destroy();
      resolve();
    });
    req.end();
  });
}
function startHealth() {
  if (healthTimer) clearInterval(healthTimer);
  const interval = (group.health && group.health.intervalMs) || 30000;
  const run = function () {
    Promise.all(members.map(pingOnce)).then(function () {
      stat();
    });
  };
  run();
  healthTimer = setInterval(run, interval);
}

// —— IPC 指令 ——
ipcRenderer.on('cfg', function (_e, payload) {
  group = payload.group;
  // 直接使用payload中的authToken，不回退到group.authToken（codex代理模式需要禁用auth）
  authToken =
    payload.authToken !== undefined ? payload.authToken : (group && group.authToken) || '';
  members = (payload.members || []).map(function (m) {
    return {
      providerId: m.providerId,
      name: m.name,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      priority: m.priority || 1,
      weight: m.weight || 1,
      // 协议转换参数
      appType: m.appType || '',
      apiFormat: m.apiFormat || '',
      model: m.model || '',
      maxOutputTokens: m.maxOutputTokens || '',
      customUserAgent: m.customUserAgent || '',
      headersOverride: m.headersOverride || '',
      bodyOverride: m.bodyOverride || '',
      authField: m.authField || '',
      // Claude Desktop 模型名映射
      desktopModelMap: m.desktopModelMap || null,
      state: 'closed',
      fails: 0,
      openUntil: 0,
      latency: 0,
      up: true
    };
  });
  startServer()
    .then(startHealth)
    .catch(function () {});
});

ipcRenderer.on('stop', function () {
  try {
    if (server) server.close();
    server = null;
  } catch (e) {}
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  startedAt = 0;
  log('info', 'proxy stopped');
  try {
    proxyLog.flush();
  } catch (e) {}
  stat();
});

// 定时上报 stat（1s 一次），保证统计实时刷新
setInterval(function () {
  if (server) stat();
}, 1000);

ipcRenderer.on('stat', function () {
  stat();
});
