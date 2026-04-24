const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { exec, spawn } = require('node:child_process');
const http = require('http');
const https = require('https');
const OpenAIImport = require('openai');
const { tavily } = require('@tavily/core');
const { Anthropic } = require('@ai-sdk/anthropic');
let AdmZip = null;
try { AdmZip = require('adm-zip'); } catch (_) { /* not available */ }

const OpenAIClient = OpenAIImport?.OpenAI || OpenAIImport;
const MAX_DEBUG_LOGS = 800;
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const MEMORY_STORAGE_KEY = 'kuke_memory_blocks';
const DEFAULT_MEMORY_LIMIT = 5000;

// Default workspace: plugin-owned folder under user home to avoid polluting project directories
// Falls back to os.tmpdir() if home is unavailable
function getDefaultWorkspaceRoot() {
  try {
    var homeDir = os.homedir();
    var pluginDataDir = path.join(homeDir, '.kukeagent', 'workspaces');
    if (!fs.existsSync(pluginDataDir)) {
      fs.mkdirSync(pluginDataDir, { recursive: true });
    }
    return pluginDataDir;
  } catch (e) {
    try {
      var tmpDir = os.tmpdir();
      var fallbackDir = path.join(tmpDir, 'kukeagent-workspaces');
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      return fallbackDir;
    } catch (fallbackErr) {
      return process.cwd();
    }
  }
}

const DEFAULT_WORKSPACE_ROOT = getDefaultWorkspaceRoot();
const debugLogs = [];
const activeChatControllers = new Map();
const activeBashProcesses = new Map();
let bashIdSeq = 0;

// MCP Server Management
const activeMcpServers = new Map();
let mcpServerIdSeq = 0;
let mcpRequestIdSeq = 0;

function createMcpJsonRpcMessage(method, params = {}) {
  return {
    jsonrpc: '2.0',
    id: ++mcpRequestIdSeq,
    method,
    params,
  };
}

function parseMcpResponse(line) {
  try {
    const obj = JSON.parse(line);
    return obj;
  } catch {
    return null;
  }
}

function sendMcpRequest(serverRecord, method, params = {}) {
  return new Promise((resolve, reject) => {
    const message = createMcpJsonRpcMessage(method, params);
    const requestId = message.id;
    const timeout = setTimeout(() => {
      serverRecord.pendingRequests.delete(requestId);
      reject(new Error(`MCP request ${method} timed out`));
    }, 60000);
    serverRecord.pendingRequests.set(requestId, { timeout, resolve, reject });
    serverRecord.proc.stdin.write(JSON.stringify(message) + '\n');
  });
}

function connectMcpServer(options) {
  options = options || {};
  const command = String(options.command != null ? options.command : '').trim();
  const args = Array.isArray(options.args) ? options.args : [];
  const env = typeof options.env === 'object' && options.env !== null ? options.env : {};
  const cmdParts = command.split('/');
  const name = String(options.name != null ? options.name : (cmdParts.length > 0 ? cmdParts[cmdParts.length - 1] : 'MCP Server')).trim();
  const cwd = typeof options.cwd === 'string' ? options.cwd.trim() : process.cwd();

  if (!command) {
    return { success: false, error: 'command 不能为空' };
  }

  const serverId = `mcp_${++mcpServerIdSeq}`;
  const startAt = Date.now();

  let proc;
  try {
    proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { success: false, error: `启动 MCP Server 失败: ${safeErrorMessage(error)}` };
  }

  const record = {
    serverId,
    name,
    command,
    args,
    cwd,
    proc,
    status: 'connecting',
    tools: [],
    pendingRequests: new Map(),
    output: [],
    cursor: 0,
    startedAt: startAt,
    endedAt: null,
    exitCode: null,
    error: null,
  };

  activeMcpServers.set(serverId, record);

  proc.stdout?.setEncoding('utf-8');
  proc.stderr?.setEncoding('utf-8');

  let buffer = '';
  proc.stdout?.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const response = parseMcpResponse(line);
      if (response && response.id !== undefined) {
        const pending = record.pendingRequests.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          record.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else {
            pending.resolve(response.result);
          }
        }
      }
    }
  });

  proc.stderr?.on('data', (chunk) => {
    const text = String(chunk).slice(0, 4096);
    record.output.push({ channel: 'stderr', text, ts: Date.now() });
    appendDebugLog('mcp', 'stderr', { serverId, text }, 'warn');
  });

  proc.on('error', (error) => {
    record.status = 'error';
    record.error = safeErrorMessage(error);
    record.endedAt = Date.now();
    for (const [id, pending] of record.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`MCP Server 异常: ${safeErrorMessage(error)}`));
    }
    record.pendingRequests.clear();
    appendDebugLog('mcp', 'error', { serverId, error: safeErrorMessage(error) }, 'error');
  });

  proc.on('close', (code, signal) => {
    record.status = code === 0 ? 'completed' : 'exited';
    record.exitCode = code;
    record.endedAt = Date.now();
    for (const [id, pending] of record.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`MCP Server 已关闭`));
    }
    record.pendingRequests.clear();
    appendDebugLog('mcp', 'closed', { serverId, code, signal, durationMs: record.endedAt - record.startedAt });
  });

  appendDebugLog('mcp', 'started', { serverId, name, command, args, cwd });

  return { success: true, data: { serverId, name, status: 'connecting', command, args, cwd } };
}

async function initializeMcpServer(serverId) {
  const record = activeMcpServers.get(serverId);
  if (!record) {
    return { success: false, error: `MCP Server 不存在: ${serverId}` };
  }

  try {
    const result = await sendMcpRequest(record, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'kuke-agent', version: '1.0.0' },
    });
    record.status = 'initialized';
    appendDebugLog('mcp', 'initialized', { serverId, result });
    return { success: true, data: result };
  } catch (error) {
    record.status = 'error';
    record.error = safeErrorMessage(error);
    return { success: false, error: safeErrorMessage(error) };
  }
}

async function listMcpTools(serverId) {
  const record = activeMcpServers.get(serverId);
  if (!record) {
    return { success: false, error: `MCP Server 不存在: ${serverId}` };
  }

  try {
    const result = await sendMcpRequest(record, 'tools/list', {});
    const tools = result?.tools || [];
    record.tools = tools.map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    appendDebugLog('mcp', 'tools_listed', { serverId, count: tools.length });
    return { success: true, data: record.tools };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function connectMcpHttpServer(options) {
  options = options || {};
  const urlStr = String(options.url != null ? options.url : '').trim();
  const name = String(options.name != null ? options.name : 'HTTP MCP Server').trim();
  const headers = typeof options.headers === 'object' && options.headers !== null ? options.headers : {};
  const transport = options.transport === 'sse' ? 'sse' : 'http';

  if (!urlStr) {
    return { success: false, error: 'url 不能为空' };
  }

  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return { success: false, error: '无效的 URL 格式' };
  }

  const serverId = `mcp_${++mcpServerIdSeq}`;
  const startAt = Date.now();

  const record = {
    serverId,
    name,
    command: urlStr,
    args: [],
    cwd: '',
    proc: null,
    status: 'connecting',
    tools: [],
    pendingRequests: new Map(),
    output: [],
    cursor: 0,
    startedAt: startAt,
    endedAt: null,
    exitCode: null,
    error: null,
    isHttp: true,
    isSse: transport === 'sse',
    baseUrl: url,
    extraHeaders: headers,
    eventSource: null,
    httpAgent: url.protocol === 'https:' ? https.globalAgent : http.globalAgent,
    sseEndpoint: null,
    sseConnected: false,
  };

  activeMcpServers.set(serverId, record);

  appendDebugLog('mcp', 'http_started', { serverId, name, url: urlStr, transport });

  return { success: true, data: { serverId, name, status: 'connecting', url: urlStr, transport } };
}

function httpRequest(record, method, body) {
  return new Promise((resolve, reject) => {
    const url = record.baseUrl;
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = {
      ...record.extraHeaders,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    };

    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      agent: record.httpAgent,
    };

    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('HTTP 请求超时'));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

function sseRequest(record, body) {
  record.output.push({ channel: 'stdout', text: `[DEBUG] sseRequest 开始, method: ${body.method}`, ts: Date.now() });
  return new Promise((resolve, reject) => {
    if (!record.sseEndpoint || !record.sseConnected) {
      record.output.push({ channel: 'stderr', text: `[DEBUG] sseRequest: SSE 未连接`, ts: Date.now() });
      reject(new Error('SSE endpoint未建立'));
      return;
    }

    const requestId = ++mcpRequestIdSeq;
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      ...body,
    };

    record.pendingRequests.set(requestId, { resolve, reject, method: body.method });
    record.output.push({ channel: 'stdout', text: `[DEBUG] sseRequest 请求 #${requestId}, method: ${body.method}`, ts: Date.now() });

    const baseUrl = record.baseUrl?.origin || 'https://api.kuke.ink';
    const url = new URL(record.sseEndpoint, baseUrl);
    const bodyStr = JSON.stringify(request);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      ...record.extraHeaders,
    };

    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers,
    };

    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 202 || res.statusCode === 200) {
          record.output.push({ channel: 'stdout', text: `[DEBUG] sseRequest POST 响应: ${res.statusCode}, 等待SSE流响应`, ts: Date.now() });
        } else {
          record.pendingRequests.delete(requestId);
          record.output.push({ channel: 'stderr', text: `[DEBUG] sseRequest HTTP错误: ${res.statusCode} ${data}`, ts: Date.now() });
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      record.pendingRequests.delete(requestId);
      record.output.push({ channel: 'stderr', text: `[DEBUG] sseRequest POST错误: ${err.message}`, ts: Date.now() });
      reject(err);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      if (record.pendingRequests.has(requestId)) {
        record.pendingRequests.delete(requestId);
        record.output.push({ channel: 'stderr', text: `[DEBUG] sseRequest 超时`, ts: Date.now() });
        reject(new Error('SSE请求超时'));
      }
    });

    req.write(bodyStr);
    req.end();

    setTimeout(() => {
      if (record.pendingRequests.has(requestId)) {
        record.pendingRequests.delete(requestId);
        record.output.push({ channel: 'stderr', text: `[DEBUG] sseRequest 30秒超时未收到响应`, ts: Date.now() });
        reject(new Error('SSE请求超时，未收到响应'));
      }
    }, 30000);
  });
}

async function initializeMcpSseServer(serverId) {
  const record = activeMcpServers.get(serverId);
  if (!record || !record.isHttp) {
    return { success: false, error: `MCP HTTP Server 不存在: ${serverId}` };
  }

  record.pendingRequests = new Map();
  record.status = 'connecting';
  record.tools = [];

  return new Promise((resolve, reject) => {
    const url = record.baseUrl;
    const headers = {
      ...record.extraHeaders,
      'Accept': 'text/event-stream',
    };

    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers,
      agent: record.httpAgent,
    };

    record.output.push({ channel: 'stdout', text: `[MCP-SSE] 连接 ${url.protocol}//${url.host}${opts.path}`, ts: Date.now() });

    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      let buffer = '';

      record.output.push({ channel: 'stdout', text: `[MCP-SSE] 状态码: ${res.statusCode}`, ts: Date.now() });

      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          record.status = 'error';
          record.error = `HTTP ${res.statusCode}`;
          record.output.push({ channel: 'stderr', text: `[MCP-SSE] HTTP错误: ${body}`, ts: Date.now() });
          reject(new Error(record.error));
        });
        return;
      }

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              record.output.push({ channel: 'stdout', text: `[MCP-SSE] 连接结束`, ts: Date.now() });
              continue;
            }

            if (data.startsWith('/')) {
              record.sseEndpoint = data;
              record.sseConnected = true;
              record.output.push({ channel: 'stdout', text: `[MCP-SSE] endpoint: ${data}`, ts: Date.now() });
              resolve(data);
              continue;
            }

            try {
              const json = JSON.parse(data);
              record.output.push({ channel: 'stdout', text: `[MCP-SSE] 收到: ${JSON.stringify(json).substring(0, 80)}`, ts: Date.now() });

              if (json.id !== undefined && record.pendingRequests && record.pendingRequests.has(json.id)) {
                const pending = record.pendingRequests.get(json.id);
                record.pendingRequests.delete(json.id);
                record.output.push({ channel: 'stdout', text: `[MCP-SSE] 响应 #${json.id} method=${pending.method || 'unknown'}`, ts: Date.now() });

                if (json.error) {
                  record.status = 'error';
                  record.error = json.error.message || JSON.stringify(json.error);
                  if (pending.reject) pending.reject(new Error(record.error));
                } else {
                  if (pending.resolve) {
                    pending.resolve(json.result || json);
                  }
                }
              }
            } catch (e) {
              record.output.push({ channel: 'stderr', text: `[MCP-SSE] 解析错误: ${data.substring(0, 50)}`, ts: Date.now() });
            }
          }
        }
      });

      res.on('end', () => {
        record.sseConnected = false;
        record.output.push({ channel: 'stderr', text: `[MCP-SSE] 连接意外关闭`, ts: Date.now() });
      });

      res.on('error', (err) => {
        record.output.push({ channel: 'stderr', text: `[MCP-SSE] SSE错误: ${err.message}`, ts: Date.now() });
      });
    });

    req.on('error', (err) => {
      record.status = 'error';
      record.error = `连接失败: ${err.message}`;
      record.output.push({ channel: 'stderr', text: `[MCP-SSE] 连接错误: ${err.message}`, ts: Date.now() });
      reject(new Error(record.error));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      record.status = 'error';
      record.error = '连接超时';
      record.output.push({ channel: 'stderr', text: `[MCP-SSE] 连接超时`, ts: Date.now() });
      reject(new Error('连接超时'));
    });

    req.end();
  }).then(async (endpoint) => {
    record.output.push({ channel: 'stdout', text: `[MCP-SSE] 发送 initialize...`, ts: Date.now() });

    const initResult = await mcpSseRequest(record, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'kuke-agent', version: '1.0.0' },
    });

    record.status = 'initialized';
    record.output.push({ channel: 'stdout', text: `[MCP-SSE] initialize成功`, ts: Date.now() });

    const toolsResult = await mcpSseRequest(record, 'tools/list', {});
    const tools = toolsResult?.tools || [];
    record.tools = tools.map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    record.status = 'initialized';
    record.output.push({ channel: 'stdout', text: `[MCP-SSE] 工具: ${record.tools.map(t => t.name).join(', ')}`, ts: Date.now() });

    return { success: true, data: record.tools };
  }).catch((err) => {
    record.status = 'error';
    record.error = err.message;
    return { success: false, error: err.message };
  });
}

function mcpSseRequest(record, method, params) {
  return new Promise((resolve, reject) => {
    if (!record.sseEndpoint || !record.sseConnected) {
      reject(new Error('SSE未连接'));
      return;
    }

    const requestId = ++mcpRequestIdSeq;
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: params || {},
    };

    record.pendingRequests.set(requestId, { resolve, reject, method });
    record.output.push({ channel: 'stdout', text: `[MCP-SSE] 发送 #${requestId} ${method}`, ts: Date.now() });

    const url = new URL(record.sseEndpoint, 'https://api.kuke.ink');
    const bodyStr = JSON.stringify(request);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      ...record.extraHeaders,
    };

    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers,
    };

    const postReq = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      record.output.push({ channel: 'stdout', text: `[MCP-SSE] POST #${requestId} 响应: ${res.statusCode}`, ts: Date.now() });
    });

    postReq.on('error', (err) => {
      record.pendingRequests.delete(requestId);
      record.output.push({ channel: 'stderr', text: `[MCP-SSE] POST #${requestId} 错误: ${err.message}`, ts: Date.now() });
      reject(err);
    });

    postReq.setTimeout(30000, () => {
      postReq.destroy();
      if (record.pendingRequests.has(requestId)) {
        record.pendingRequests.delete(requestId);
        reject(new Error('请求超时'));
      }
    });

    postReq.write(bodyStr);
    postReq.end();

    setTimeout(() => {
      if (record.pendingRequests.has(requestId)) {
        record.pendingRequests.delete(requestId);
        record.output.push({ channel: 'stderr', text: `[MCP-SSE] #${requestId} 30秒超时`, ts: Date.now() });
        reject(new Error('请求超时（30秒）'));
      }
    }, 30000);
  });
}

async function initializeMcpHttpServer(serverId) {
  const record = activeMcpServers.get(serverId);
  if (!record || !record.isHttp) {
    return { success: false, error: `MCP HTTP Server 不存在: ${serverId}` };
  }

  if (record.isSse) {
    return initializeMcpSseServer(serverId);
  }

  try {
    const result = await httpRequest(record, 'POST', {
      jsonrpc: '2.0',
      id: ++mcpRequestIdSeq,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'kuke-agent', version: '1.0.0' },
      },
    });

    if (result.status !== 200) {
      record.status = 'error';
      record.error = `HTTP ${result.status}`;
      record.output.push({ channel: 'stderr', text: `初始化失败: HTTP ${result.status}\n响应内容: ${result.body || '(空)'}`, ts: Date.now() });
      appendDebugLog('mcp', 'http_error', { serverId, status: result.status, body: result.body });
      return { success: false, error: `初始化失败: HTTP ${result.status}\n响应: ${result.body || '(空)'}` };
    }

    record.status = 'initialized';
    appendDebugLog('mcp', 'initialized', { serverId, result });
    return { success: true, data: result };
  } catch (error) {
    record.status = 'error';
    record.error = safeErrorMessage(error);
    record.output.push({ channel: 'stderr', text: `初始化异常: ${safeErrorMessage(error)}`, ts: Date.now() });
    return { success: false, error: safeErrorMessage(error) };
  }
}

function initializeMcpSseServerAsync(serverId) {
  const record = activeMcpServers.get(serverId);
  if (record) {
    record.output.push({ channel: 'stdout', text: `[DEBUG] initializeMcpSseServerAsync 开始`, ts: Date.now() });
  }
  initializeMcpSseServer(serverId).then((result) => {
    if (record) {
      record.output.push({ channel: 'stdout', text: `[DEBUG] initializeMcpSseServer 完成, result.success=${result?.success}`, ts: Date.now() });
    }
    if (result?.success) {
      if (record) {
        record.output.push({ channel: 'stdout', text: `[DEBUG] 初始化成功，获取工具列表`, ts: Date.now() });
      }
      listMcpHttpTools(serverId);
    } else {
      if (record) {
        record.output.push({ channel: 'stderr', text: `[DEBUG] initializeMcpSseServer 失败: ${JSON.stringify(result)}`, ts: Date.now() });
      }
    }
  }).catch((err) => {
    if (record) {
      record.output.push({ channel: 'stderr', text: `[DEBUG] MCP SSE 初始化异常: ${err.message}`, ts: Date.now() });
    }
  });
}

function initializeMcpHttpServerAsync(serverId) {
  const record = activeMcpServers.get(serverId);
  if (!record || !record.isHttp) return;
  if (record.isSse) {
    initializeMcpSseServerAsync(serverId);
  } else {
    initializeMcpHttpServer(serverId).then(() => {
      listMcpHttpTools(serverId);
    });
  }
}

function initializeMcpServerAsync(serverId) {
  initializeMcpServer(serverId).then(() => {
    listMcpTools(serverId);
  });
}

async function listMcpHttpTools(serverId) {
  const record = activeMcpServers.get(serverId);
  if (record) {
    record.output.push({ channel: 'stdout', text: `[DEBUG] listMcpHttpTools 开始, serverId: ${serverId}, isSse: ${record.isSse}, sseConnected: ${record.sseConnected}`, ts: Date.now() });
  }
  if (!record || !record.isHttp) {
    if (record) {
      record.output.push({ channel: 'stderr', text: `[DEBUG] listMcpHttpTools: record 不存在或不是 HTTP`, ts: Date.now() });
    }
    return { success: false, error: `MCP HTTP Server 不存在: ${serverId}` };
  }

  try {
    // 如果 SSE 已初始化且工具有缓存，直接返回（避免重复请求）
    if (record.isSse && record.tools && record.tools.length > 0) {
      record.output.push({ channel: 'stdout', text: `[DEBUG] listMcpHttpTools: 使用缓存的 ${record.tools.length} 个工具`, ts: Date.now() });
      return { success: true, data: record.tools };
    }

    let result;
    if (record.isSse) {
      if (!record.sseConnected) {
        return { success: false, error: 'SSE未连接，请先初始化' };
      }
      result = await mcpSseRequest(record, 'tools/list', {});
    } else {
      result = await httpRequest(record, 'POST', {
        jsonrpc: '2.0',
        id: ++mcpRequestIdSeq,
        method: 'tools/list',
        params: {},
      });
    }

    let tools = [];
    if (result) {
      const data = result.result || result;
      tools = data?.tools || [];
    }

    record.tools = tools.map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    appendDebugLog('mcp', 'tools_listed', { serverId, count: tools.length });
    return { success: true, data: record.tools };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

async function callMcpHttpTool(serverId, toolName, arguments_) {
  const record = activeMcpServers.get(serverId);
  if (!record || !record.isHttp) {
    return { success: false, error: `MCP HTTP Server 不存在: ${serverId}` };
  }

  try {
    let result;
    if (record.isSse) {
      if (!record.sseConnected) {
        return { success: false, error: 'SSE未连接，请先初始化' };
      }
      result = await mcpSseRequest(record, 'tools/call', {
        name: toolName,
        arguments: arguments_ || {},
      });
    } else {
      result = await httpRequest(record, 'POST', {
        jsonrpc: '2.0',
        id: ++mcpRequestIdSeq,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: arguments_ || {},
        },
      });

      if (result.status !== 200 && result.status !== 201) {
        return { success: false, error: `HTTP ${result.status}` };
      }

      try {
        const parsed = JSON.parse(result.body);
        if (parsed.error) {
          return { success: false, error: parsed.error.message || JSON.stringify(parsed.error) };
        }
        result = parsed.result || parsed;
      } catch { /* keep raw */ }
    }

    appendDebugLog('mcp', 'tool_called', { serverId, toolName, success: true });
    return { success: true, data: result };
  } catch (error) {
    appendDebugLog('mcp', 'tool_called', { serverId, toolName, success: false, error: safeErrorMessage(error) }, 'error');
    return { success: false, error: safeErrorMessage(error) };
  }
}

async function callMcpTool(serverId, toolName, arguments_) {
  const record = activeMcpServers.get(serverId);
  if (!record) {
    return { success: false, error: `MCP Server 不存在: ${serverId}` };
  }

  if (record.isHttp) {
    return callMcpHttpTool(serverId, toolName, arguments_);
  }

  try {
    const result = await sendMcpRequest(record, 'tools/call', {
      name: toolName,
      arguments: arguments_ || {},
    });
    appendDebugLog('mcp', 'tool_called', { serverId, toolName, success: true });
    return { success: true, data: result };
  } catch (error) {
    appendDebugLog('mcp', 'tool_called', { serverId, toolName, success: false, error: safeErrorMessage(error) }, 'error');
    return { success: false, error: safeErrorMessage(error) };
  }
}

function disconnectMcpServer(serverId) {
  const record = activeMcpServers.get(serverId);
  if (!record) {
    return { success: false, error: `MCP Server 不存在: ${serverId}` };
  }

  if (record.isHttp) {
    record.status = 'exited';
    record.endedAt = Date.now();
    record.eventSource = null;
  } else if (record.status === 'running' || record.status === 'connecting' || record.status === 'initialized') {
    try {
      record.proc.kill('SIGTERM');
    } catch { /* best effort */ }
    setTimeout(() => {
      if (record.status !== 'completed' && record.status !== 'exited') {
        try {
          record.proc.kill('SIGKILL');
        } catch { /* best effort */ }
      }
    }, 1000);
  }

  for (const [id, pending] of record.pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('MCP Server 正在断开'));
  }
  record.pendingRequests.clear();
  activeMcpServers.delete(serverId);
  appendDebugLog('mcp', 'disconnected', { serverId });
  return { success: true, data: { serverId } };
}

function listMcpServers() {
  const items = [];
  for (const [serverId, record] of activeMcpServers.entries()) {
    items.push({
      serverId,
      name: record.name,
      command: record.command,
      args: record.args,
      cwd: record.cwd,
      status: record.status,
      toolCount: record.tools.length,
      tools: record.tools,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      exitCode: record.exitCode,
      error: record.error,
      extraHeaders: record.extraHeaders,
      transport: record.isSse ? 'sse' : undefined,
      env: record.env,
    });
  }
  return { success: true, data: items };
}

function readMcpServerOutput(options = {}) {
  const serverId = String(options?.serverId || '').trim();
  if (!serverId) {
    return { success: false, error: 'serverId 不能为空' };
  }
  const record = activeMcpServers.get(serverId);
  if (!record) {
    return { success: false, error: `MCP Server 不存在: ${serverId}` };
  }

  const newChunks = record.output.slice(record.cursor);
  record.cursor = record.output.length;

  return {
    success: true,
    data: {
      serverId,
      status: record.status,
      newChunks: newChunks.length,
      logs: newChunks.map(c => ({ channel: c.channel, text: c.text, ts: c.ts })),
    },
  };
}

function getMcpServerLogs(options = {}) {
  const serverId = String(options?.serverId || '').trim();
  if (!serverId) {
    return { success: false, error: 'serverId 不能为空' };
  }
  const record = activeMcpServers.get(serverId);
  if (!record) {
    return { success: false, error: `MCP Server 不存在: ${serverId}` };
  }

  return {
    success: true,
    data: {
      serverId,
      name: record.name,
      status: record.status,
      error: record.error,
      logs: record.output.map(c => ({ channel: c.channel, text: c.text, ts: c.ts })),
    },
  };
}
const BASH_OUTPUT_BUFFER_CAP = 8 * 1024 * 1024;
const BASH_DEFAULT_TIMEOUT_MS = 120 * 1000;
const BASH_MAX_TIMEOUT_MS = 10 * 60 * 1000;
const BASH_RETURN_BYTE_LIMIT = 40 * 1024;
const BASH_RETURN_HEAD_LINES = 80;
const BASH_RETURN_TAIL_LINES = 320;

function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const fmText = match[1];
  const result = {};
  const lines = fmText.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  if (!result.name || !result.description) return null;
  return result;
}

function discoverSkills() {
  try {
    const searchPaths = [
      path.join(process.cwd(), '.kukeagent', 'skills'),
      path.join(os.homedir(), '.kukeagent', 'skills'),
    ];
    const seen = new Set();
    const skills = [];
    for (const basePath of searchPaths) {
      if (!fs.existsSync(basePath)) continue;
      const stats = fs.statSync(basePath);
      if (!stats.isDirectory()) continue;
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(basePath, entry.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        const content = fs.readFileSync(skillFile, 'utf-8');
        const fm = parseFrontmatter(content);
        if (!fm) continue;
        if (seen.has(fm.name)) continue;
        seen.add(fm.name);
        skills.push({
          name: fm.name,
          description: fm.description,
          path: skillDir,
          entry: skillFile,
        });
      }
    }
    return { success: true, data: skills };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function getUserSkillsDir() {
  return path.join(os.homedir(), '.kukeagent', 'skills');
}

function ensureUserSkillsDir() {
  const dir = getUserSkillsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveSkill(name, description, content) {
  try {
    ensureUserSkillsDir();
    const skillDir = path.join(getUserSkillsDir(), name);
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }
    const skillFile = path.join(skillDir, 'SKILL.md');
    const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
    const finalContent = String(content ?? '').startsWith('---') ? String(content ?? '') : frontmatter + String(content ?? '');
    fs.writeFileSync(skillFile, finalContent, 'utf-8');
    return { success: true, data: { entry: skillFile, name } };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function deleteSkill(entry) {
  try {
    const skillDir = path.dirname(entry);
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function loadMemoryBlocks() {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveMemoryBlocks(blocks) {
  localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(blocks));
}

function listMemoryBlocks() {
  const blocks = loadMemoryBlocks();
  const now = Date.now();
  return {
    success: true,
    data: Object.entries(blocks).map(([label, block]) => ({
      label,
      description: block.description || '',
      value: block.value || '',
      chars_current: (block.value || '').length,
      chars_limit: block.chars_limit || DEFAULT_MEMORY_LIMIT,
      read_only: Boolean(block.read_only),
      updatedAt: block.updatedAt || now,
    })),
  };
}

function getMemoryBlock(label) {
  const blocks = loadMemoryBlocks();
  const block = blocks[label];
  if (!block) return { success: false, error: `记忆块 "${label}" 不存在` };
  return {
    success: true,
    data: {
      label,
      description: block.description || '',
      value: block.value || '',
      chars_current: (block.value || '').length,
      chars_limit: block.chars_limit || DEFAULT_MEMORY_LIMIT,
      read_only: Boolean(block.read_only),
      updatedAt: block.updatedAt || Date.now(),
    },
  };
}

function setMemoryBlock(label, description, value, options) {
  if (!label || typeof label !== 'string') {
    return { success: false, error: 'label 不能为空' };
  }
  const blocks = loadMemoryBlocks();
  const existing = blocks[label];
  if (existing && existing.read_only) {
    return { success: false, error: `记忆块 "${label}" 是只读的，不能修改` };
  }
  blocks[label] = {
    description: description || '',
    value: value || '',
    chars_limit: options?.chars_limit || DEFAULT_MEMORY_LIMIT,
    read_only: Boolean(options?.read_only),
    updatedAt: Date.now(),
  };
  saveMemoryBlocks(blocks);
  return {
    success: true,
    data: {
      label,
      description: blocks[label].description,
      value: blocks[label].value,
      chars_current: blocks[label].value.length,
      chars_limit: blocks[label].chars_limit,
      read_only: blocks[label].read_only,
      updatedAt: blocks[label].updatedAt,
    },
  };
}

function replaceMemoryBlockText(label, oldText, newText) {
  if (!label || typeof label !== 'string') {
    return { success: false, error: 'label 不能为空' };
  }
  if (!oldText || typeof oldText !== 'string') {
    return { success: false, error: 'oldText 不能为空' };
  }
  const blocks = loadMemoryBlocks();
  const block = blocks[label];
  if (!block) return { success: false, error: `记忆块 "${label}" 不存在` };
  if (block.read_only) {
    return { success: false, error: `记忆块 "${label}" 是只读的，不能修改` };
  }
  const idx = block.value.indexOf(oldText);
  if (idx === -1) {
    return { success: false, error: `在记忆块 "${label}" 中找不到指定的 oldText` };
  }
  block.value = block.value.slice(0, idx) + newText + block.value.slice(idx + oldText.length);
  block.updatedAt = Date.now();
  saveMemoryBlocks(blocks);
  return {
    success: true,
    data: {
      label,
      description: block.description,
      value: block.value,
      chars_current: block.value.length,
      chars_limit: block.chars_limit,
      read_only: block.read_only,
      updatedAt: block.updatedAt,
    },
  };
}

function deleteMemoryBlock(label) {
  if (!label || typeof label !== 'string') {
    return { success: false, error: 'label 不能为空' };
  }
  const blocks = loadMemoryBlocks();
  const block = blocks[label];
  if (!block) return { success: false, error: `记忆块 "${label}" 不存在` };
  if (block.read_only) {
    return { success: false, error: `记忆块 "${label}" 是只读的，不能删除` };
  }
  delete blocks[label];
  saveMemoryBlocks(blocks);
  return { success: true };
}

function readSkillFile(entry) {
  try {
    const content = fs.readFileSync(entry, 'utf-8');
    return { success: true, data: content };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

const _pdfSkillContent =
  '---\n' +
  'name: pdf-processing\n' +
  'description: 提取 PDF 文本与表格、填写表单、合并拆分 PDF。当用户需要处理 PDF 文件时使用。关键词：PDF、表单、合并、拆分。\n' +
  '---\n' +
  '\n' +
  '# PDF 处理\n' +
  '\n' +
  '## 何时使用\n' +
  '- 用户上传/提到 PDF 文件并要求提取内容\n' +
  '- 用户需要填写 PDF 表单\n' +
  '- 用户需要合并/拆分 PDF\n' +
  '\n' +
  '## 操作流程\n' +
  '\n' +
  '### 提取文本\n' +
  '使用 pdftotext（Poppler）或 Python 的 PyPDF2/pypdf：\n' +
  '```bash\n' +
  'pdftotext <pdf_path> <output_txt>\n' +
  '# 或\n' +
  'python -c "import pypdf; r=pypdf.PdfReader(\'<pdf_path>\'); print(\'\\n\'.join(p.extract_text() for p in r.pages))"\n' +
  '```\n' +
  '\n' +
  '### 提取表单字段\n' +
  '```bash\n' +
  'python -c "import pypdf; r=pypdf.PdfReader(\'<pdf_path>\'); print(r.get_fields())"\n' +
  '```\n' +
  '\n' +
  '### 合并文档\n' +
  '```bash\n' +
  'python -c "import pypdf; m=pypdf.PdfMerger(); [m.append(f) for f in [\'a.pdf\',\'b.pdf\']]; m.write(\'merged.pdf\')"\n' +
  '```\n' +
  '\n' +
  '### 拆分页面\n' +
  '```bash\n' +
  'python -c "import pypdf; r=pypdf.PdfReader(\'input.pdf\'); [pypdf.PdfWriter().add_page(p).write(f\'page_{i}.pdf\') for i,p in enumerate(r.pages)]"\n' +
  '```\n' +
  '\n' +
  '## 输出格式\n' +
  '统一返回 JSON，包含 `status`、`output_path`、`errors` 三个字段。';

const _excelSkillContent =
  '---\n' +
  'name: excel-processing\n' +
  'description: 读取、写入、转换 Excel/CSV 文件。处理表格数据、公式、筛选与透视。关键词：Excel、CSV、表格、xlsx。\n' +
  '---\n' +
  '\n' +
  '# Excel 处理\n' +
  '\n' +
  '## 何时使用\n' +
  '- 用户需要读取 .xlsx/.xls/.csv 内容\n' +
  '- 用户需要修改、创建电子表格\n' +
  '- 用户需要转换格式（Excel 与 CSV 互转）\n' +
  '\n' +
  '## 操作流程\n' +
  '\n' +
  '### 读取 Excel\n' +
  '```bash\n' +
  'python -c "import pandas as pd; df=pd.read_excel(\'<file>\'); print(df.to_string())"\n' +
  '```\n' +
  '\n' +
  '### 读取 CSV\n' +
  '```bash\n' +
  'python -c "import pandas as pd; df=pd.read_csv(\'<file>\'); print(df.to_string())"\n' +
  '```\n' +
  '\n' +
  '### 写入 Excel\n' +
  '```bash\n' +
  'python -c "import pandas as pd; df=pd.DataFrame(...); df.to_excel(\'output.xlsx\', index=False)"\n' +
  '```\n' +
  '\n' +
  '### Excel 转 CSV\n' +
  '```bash\n' +
  'python -c "import pandas as pd; pd.read_excel(\'<file>\').to_csv(\'output.csv\', index=False)"\n' +
  '```\n' +
  '\n' +
  '## 注意事项\n' +
  '- 大文件优先用 pandas 的 chunksize 参数分块读取\n' +
  '- 含合并单元格的文件需要特殊处理';

const _imageSkillContent =
  '---\n' +
  'name: image-processing\n' +
  'description: 图片格式转换、压缩、裁剪、调整大小、提取 EXIF 信息。关键词：图片、图像、转换、压缩、裁剪。\n' +
  '---\n' +
  '\n' +
  '# 图片处理\n' +
  '\n' +
  '## 何时使用\n' +
  '- 用户需要转换图片格式（PNG/JPG/WebP 互转）\n' +
  '- 用户需要压缩、裁剪、调整图片尺寸\n' +
  '- 用户需要提取图片 EXIF 元数据\n' +
  '\n' +
  '## 操作流程\n' +
  '\n' +
  '### 格式转换 / 压缩\n' +
  '```bash\n' +
  'python -c "from PIL import Image; img=Image.open(\'input.png\'); img.save(\'output.jpg\', quality=85)"\n' +
  '```\n' +
  '\n' +
  '### 调整尺寸\n' +
  '```bash\n' +
  'python -c "from PIL import Image; img=Image.open(\'input.jpg\'); img.resize((800,600)).save(\'resized.jpg\')"\n' +
  '```\n' +
  '\n' +
  '### 提取 EXIF\n' +
  '```bash\n' +
  'python -c "from PIL import Image; from PIL.ExifTags import TAGS; img=Image.open(\'input.jpg\'); exif=img._getexif(); print({TAGS.get(k):v for k,v in exif.items()}) if exif else print(\'无 EXIF\')"\n' +
  '```\n' +
  '\n' +
  '### 批量处理\n' +
  '```bash\n' +
  'python -c "from PIL import Image; import glob; [Image.open(f).convert(\'RGB\').save(f.replace(\'.png\',\'.jpg\'), quality=85) for f in glob.glob(\'*.png\')]"\n' +
  '```';

const _webScrapingSkillContent =
  '---\n' +
  'name: web-scraping\n' +
  'description: 抓取网页结构化数据、解析 HTML、提取表格与列表。关键词：爬虫、抓取、HTML、解析、数据提取。\n' +
  '---\n' +
  '\n' +
  '# 网页抓取\n' +
  '\n' +
  '## 何时使用\n' +
  '- 用户需要从网页提取结构化数据\n' +
  '- 用户需要批量抓取表格、列表、文章\n' +
  '- WebFetchTool 无法满足复杂解析需求时\n' +
  '\n' +
  '## 操作流程\n' +
  '\n' +
  '### 安装依赖\n' +
  '```bash\n' +
  'pip install beautifulsoup4 requests lxml -q\n' +
  '```\n' +
  '\n' +
  '### 抓取并解析\n' +
  '```bash\n' +
  'python -c "import requests; from bs4 import BeautifulSoup; url=\'https://example.com\'; resp=requests.get(url,timeout=30); soup=BeautifulSoup(resp.text,\'lxml\'); titles=[a.get_text(strip=True) for a in soup.find_all(\'a\')]; print(titles)"\n' +
  '```\n' +
  '\n' +
  '### 提取表格\n' +
  '```bash\n' +
  'python -c "import requests; import pandas as pd; url=\'https://example.com/page-with-table\'; html=requests.get(url).text; tables=pd.read_html(html); print(tables[0].to_string())"\n' +
  '```\n' +
  '\n' +
  '## 注意事项\n' +
  '- 遵守网站的 robots.txt 和速率限制\n' +
  '- 使用合适的 User-Agent';

const STANDARD_SKILLS_TEMPLATES = {
  'pdf-processing': {
    name: 'pdf-processing',
    description: '提取 PDF 文本与表格、填写表单、合并拆分 PDF。当用户需要处理 PDF 文件时使用。关键词：PDF、表单、合并、拆分。',
    content: _pdfSkillContent,
  },
  'excel-processing': {
    name: 'excel-processing',
    description: '读取、写入、转换 Excel/CSV 文件。处理表格数据、公式、筛选与透视。关键词：Excel、CSV、表格、xlsx。',
    content: _excelSkillContent,
  },
  'image-processing': {
    name: 'image-processing',
    description: '图片格式转换、压缩、裁剪、调整大小、提取 EXIF 信息。关键词：图片、图像、转换、压缩、裁剪。',
    content: _imageSkillContent,
  },
  'web-scraping': {
    name: 'web-scraping',
    description: '抓取网页结构化数据、解析 HTML、提取表格与列表。关键词：爬虫、抓取、HTML、解析、数据提取。',
    content: _webScrapingSkillContent,
  },
};

function importStandardSkill(name) {
  try {
    const template = STANDARD_SKILLS_TEMPLATES[name];
    if (!template) {
      return { success: false, error: `未找到标准 Skill：${name}` };
    }
    return saveSkill(template.name, template.description, template.content);
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function listStandardSkillTemplates() {
  return Object.keys(STANDARD_SKILLS_TEMPLATES).map((key) => {
    const t = STANDARD_SKILLS_TEMPLATES[key];
    return { name: t.name, description: t.description };
  });
}

function importSkillFromZip(zipPath) {
  if (!AdmZip) return { success: false, error: 'adm-zip 不可用，请检查插件依赖安装' };
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    let skillMdEntry = null;
    for (const entry of entries) {
      if (!entry.isDirectory && entry.entryName.toUpperCase() === 'SKILL.MD') {
        skillMdEntry = entry;
        break;
      }
    }
    if (!skillMdEntry) {
      return { success: false, error: 'ZIP 中未找到 SKILL.md 文件' };
    }
    const content = zip.readAsText(skillMdEntry);
    const fm = parseFrontmatter(content);
    if (!fm || !fm.name) {
      return { success: false, error: 'SKILL.md 缺少 YAML frontmatter 或 name 字段' };
    }
    return saveSkill(fm.name, fm.description || '', content);
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function importSkillFromFilePath(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.zip') {
      return importSkillFromZip(filePath);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.name) {
      return { success: false, error: '文件缺少 YAML frontmatter 或 name 字段' };
    }
    return saveSkill(fm.name, fm.description || '', content);
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function trimBashOutput(rawText, channel = 'output') {
  if (typeof rawText !== 'string' || !rawText) {
    return {
      text: rawText || '',
      truncated: false,
      originalBytes: 0,
      originalLines: rawText ? 1 : 0,
    };
  }
  const originalBytes = Buffer.byteLength(rawText, 'utf-8');
  const lines = rawText.split(/\r?\n/);
  const originalLines = lines.length;
  const lineBudget = BASH_RETURN_HEAD_LINES + BASH_RETURN_TAIL_LINES;
  const withinByteBudget = originalBytes <= BASH_RETURN_BYTE_LIMIT;
  const withinLineBudget = originalLines <= lineBudget;
  if (withinByteBudget && withinLineBudget) {
    return { text: rawText, truncated: false, originalBytes, originalLines };
  }
  const head = lines.slice(0, BASH_RETURN_HEAD_LINES);
  const tail = lines.slice(-BASH_RETURN_TAIL_LINES);
  const omittedLines = Math.max(0, originalLines - head.length - tail.length);
  const banner = `... [${channel} truncated: 略过 ${omittedLines} 行 / 原始 ${originalBytes} 字节，共 ${originalLines} 行；显示首 ${head.length} + 末 ${tail.length}] ...`;
  return {
    text: [...head, banner, ...tail].join('\n'),
    truncated: true,
    originalBytes,
    originalLines,
  };
}

let electronWebUtils = null;
try {
  const electronModule = require('electron');
  electronWebUtils = electronModule?.webUtils || null;
} catch {
  electronWebUtils = null;
}

function resolveFileLocalPath(file) {
  if (!file) return '';
  const direct = typeof file.path === 'string' ? file.path.trim() : '';
  if (direct) return direct;
  if (electronWebUtils && typeof electronWebUtils.getPathForFile === 'function') {
    try {
      const resolved = electronWebUtils.getPathForFile(file);
      return typeof resolved === 'string' ? resolved.trim() : '';
    } catch {
      return '';
    }
  }
  return '';
}

const SNAPSHOT_ROOT = path.join(os.tmpdir(), 'kuke_agent_snapshots');
const UPLOAD_ROOT = path.join(os.tmpdir(), 'kuke_agent_uploads');
const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const now = () => Date.now();
const createTraceId = (scope = 'trace') =>
  `${scope}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const safeErrorMessage = (error) =>
  error instanceof Error ? error.message : String(error || 'unknown error');

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function appendDebugLog(scope, event, payload = {}, level = 'info') {
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    payload,
  };

  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs.splice(0, debugLogs.length - MAX_DEBUG_LOGS);
  }

  const printable = `[KukeAgent][${entry.level}][${scope}] ${event} ${safeStringify(payload)}`;
  if (level === 'error') {
    console.error(printable);
  } else {
    console.log(printable);
  }
}

function sanitizePathInput(input) {
  const rawValue = String(input ?? '').trim();
  const quotedMatch = rawValue.match(/^(['"`])(.*)\1$/);
  return quotedMatch ? quotedMatch[2].trim() : rawValue;
}

function resolveLocalPath(inputPath, fieldName = 'path') {
  const normalizedInput = sanitizePathInput(inputPath);
  if (!normalizedInput) {
    throw new Error(`${fieldName} 不能为空`);
  }

  if (/^file:\/\//i.test(normalizedInput)) {
    return path.resolve(fileURLToPath(normalizedInput));
  }

  return path.resolve(normalizedInput);
}

function createOpenAIClient(config = {}) {
  return new OpenAIClient({
    apiKey: config.apiKey || 'empty',
    baseURL: config.baseURL,
    dangerouslyAllowBrowser: true,
  });
}

function createAnthropicClient(config = {}) {
  const provider = new Anthropic({
    apiKey: config.apiKey || 'empty',
    baseUrl: config.baseURL || undefined,
  });
  return provider;
}

function getClient(config = {}) {
  const type = config.providerType || 'openai';
  if (type === 'anthropic') {
    return createAnthropicClient(config);
  }
  return createOpenAIClient(config);
}

function emitChatEvent(handlers, event) {
  if (!handlers || typeof handlers.onEvent !== 'function') {
    return;
  }

  try {
    handlers.onEvent(event);
  } catch (error) {
    appendDebugLog('chat.stream', 'handler_error', { message: safeErrorMessage(error) }, 'error');
  }
}

function extractContentTextPart(part) {
  if (typeof part === 'string') {
    return part;
  }
  if (!part || typeof part !== 'object') {
    return '';
  }
  if (typeof part.text === 'string') {
    return part.text;
  }
  if (typeof part.text?.value === 'string') {
    return part.text.value;
  }
  if (typeof part.content === 'string') {
    return part.content;
  }
  return '';
}

function extractContentText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => extractContentTextPart(part)).join('');
  }
  return extractContentTextPart(content);
}

function normalizeAssistantMessage(message) {
  const normalizedMessage = { ...message };
  const hasStructuredToolCalls = Array.isArray(normalizedMessage.tool_calls) && normalizedMessage.tool_calls.length > 0;

  if (hasStructuredToolCalls) {
    // Filter out null/invalid entries from tool_calls array
    var validToolCalls = [];
    for (var nti = 0; nti < normalizedMessage.tool_calls.length; nti++) {
      var tc = normalizedMessage.tool_calls[nti];
      if (tc !== null && tc !== undefined && tc !== '' && tc.function && tc.function.name && tc.function.name.trim()) {
        validToolCalls.push(tc);
      }
    }
    normalizedMessage.tool_calls = validToolCalls;

    // Clean up content
    if (normalizedMessage.content == null) {
      normalizedMessage.content = null;
    } else if (typeof normalizedMessage.content === 'string' && !normalizedMessage.content.trim()) {
      normalizedMessage.content = null;
    } else if (Array.isArray(normalizedMessage.content) && normalizedMessage.content.length === 0) {
      normalizedMessage.content = null;
    }
  } else {
    // No structured tool_calls, attempt to parse text-based tool calls from content
    const content = typeof normalizedMessage.content === 'string' ? normalizedMessage.content : '';
    const parsed = parseTextBasedToolCalls(content);
    if (parsed && parsed.toolCalls.length > 0) {
      normalizedMessage.tool_calls = parsed.toolCalls;
      normalizedMessage.content = parsed.cleanedContent;
    } else {
      delete normalizedMessage.tool_calls;
    }
  }

  return normalizedMessage;
}

function mergeToolCallDelta(targetMessage, toolCallDelta) {
  const toolCallIndex = toolCallDelta.index ?? 0;
  const existingToolCall = targetMessage.tool_calls[toolCallIndex] || {
    id: '',
    type: 'function',
    function: {
      name: '',
      arguments: '',
    },
  };

  if (toolCallDelta.id) {
    existingToolCall.id = toolCallDelta.id;
  }
  if (toolCallDelta.type) {
    existingToolCall.type = toolCallDelta.type;
  }
  if (toolCallDelta.function?.name) {
    existingToolCall.function.name += toolCallDelta.function.name;
  }
  if (toolCallDelta.function?.arguments) {
    existingToolCall.function.arguments += toolCallDelta.function.arguments;
  }

  targetMessage.tool_calls[toolCallIndex] = existingToolCall;
}

var TEXT_TOOL_CALL_ID_COUNTER = 0;

function nextTextToolCallId() {
  TEXT_TOOL_CALL_ID_COUNTER += 1;
  return 'textcall_' + TEXT_TOOL_CALL_ID_COUNTER;
}

function parseTextBasedToolCalls(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return null;
  }

  var toolCalls = [];
  var cleanedContent = content;

  // Pattern 1: <function_calls>...</function_calls> wrapping <invoke> blocks
  // This covers Minimax and Anthropic legacy XML tool call format
  var functionCallsRegex = /<function_calls>([\s\S]*?)<\/function_calls>/g;
  var fcMatch;
  var hasFcWrapper = false;

  while ((fcMatch = functionCallsRegex.exec(content)) !== null) {
    hasFcWrapper = true;
    var inner = fcMatch[1];
    var invokeRegex = /<invoke>\s*<tool_name>([\s\S]*?)<\/tool_name>\s*<parameters>([\s\S]*?)<\/parameters>\s*<\/invoke>/g;
    var invMatch;
    while ((invMatch = invokeRegex.exec(inner)) !== null) {
      var name = invMatch[1].trim();
      var paramsXml = invMatch[2];
      var args = {};
      var paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
      var pm;
      while ((pm = paramRegex.exec(paramsXml)) !== null) {
        var rawValue = pm[2];
        var trimmed = rawValue.trim();
        var parsedValue = rawValue;
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            parsedValue = JSON.parse(trimmed);
          } catch (e) {
            // keep as string
          }
        }
        args[pm[1]] = parsedValue;
      }
      toolCalls.push({
        id: nextTextToolCallId(),
        type: 'function',
        function: {
          name: name,
          arguments: JSON.stringify(args),
        },
      });
    }
  }

  if (hasFcWrapper) {
    cleanedContent = content.replace(functionCallsRegex, '').trim();
  }

  // Pattern 2: Standalone <invoke> blocks (not wrapped in <function_calls>)
  if (!hasFcWrapper) {
    var standaloneInvokeRegex = /<invoke>\s*<tool_name>([\s\S]*?)<\/tool_name>\s*<parameters>([\s\S]*?)<\/parameters>\s*<\/invoke>/g;
    var siMatch;
    var hasStandaloneInvoke = false;

    while ((siMatch = standaloneInvokeRegex.exec(content)) !== null) {
      hasStandaloneInvoke = true;
      var sName = siMatch[1].trim();
      var sParamsXml = siMatch[2];
      var sArgs = {};
      var sParamRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
      var spm;
      while ((spm = sParamRegex.exec(sParamsXml)) !== null) {
        var rawVal = spm[2];
        var trimmedVal = rawVal.trim();
        var parsedVal = rawVal;
        if (trimmedVal.startsWith('[') || trimmedVal.startsWith('{')) {
          try {
            parsedVal = JSON.parse(trimmedVal);
          } catch (e) {
            // keep as string
          }
        }
        sArgs[spm[1]] = parsedVal;
      }
      toolCalls.push({
        id: nextTextToolCallId(),
        type: 'function',
        function: {
          name: sName,
          arguments: JSON.stringify(sArgs),
        },
      });
    }

    if (hasStandaloneInvoke) {
      cleanedContent = content.replace(standaloneInvokeRegex, '').trim();
    }
  }

  // Pattern 3: <invoke name="..."> with <parameter name="..."> sub-tags
  // e.g. <invoke name="TodoWriteTool"><parameter name="todos">[...]</parameter></invoke>
  if (toolCalls.length === 0) {
    var invokeNameRegex = /<invoke\s+name\s*=\s*"([^"]+)">([\s\S]*?)<\/invoke>/g;
    var inMatch;
    var hasInvokeName = false;

    while ((inMatch = invokeNameRegex.exec(content)) !== null) {
      hasInvokeName = true;
      var iName = inMatch[1].trim();
      var iParamBody = inMatch[2];
      var iArgs = {};
      var iParamRegex = /<parameter\s+name\s*=\s*"([^"]+)">([\s\S]*?)<\/parameter>/g;
      var ipm;
      while ((ipm = iParamRegex.exec(iParamBody)) !== null) {
        var rawParamValue = ipm[2];
        // Try to parse as JSON if it looks like an array or object
        var parsedParamValue = rawParamValue;
        var trimmed = rawParamValue.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            parsedParamValue = JSON.parse(trimmed);
          } catch (e) {
            // keep as string
          }
        }
        iArgs[ipm[1]] = parsedParamValue;
      }
      toolCalls.push({
        id: nextTextToolCallId(),
        type: 'function',
        function: {
          name: iName,
          arguments: JSON.stringify(iArgs),
        },
      });
    }

    if (hasInvokeName) {
      invokeNameRegex.lastIndex = 0;
      cleanedContent = content.replace(/<invoke\s+name\s*=\s*"([^"]+)">([\s\S]*?)<\/invoke>/g, '').trim();
    }
  }

  if (toolCalls.length === 0) {
    return null;
  }

  return {
    toolCalls: toolCalls,
    cleanedContent: cleanedContent || null,
  };
}

function isAbortError(error) {
  if (!error) {
    return false;
  }
  const message = safeErrorMessage(error).toLowerCase();
  return error.name === 'AbortError' || message.includes('abort') || message.includes('canceled');
}

async function createChatResponse(
  config,
  messages,
  tools,
  handlers = {},
  traceId = createTraceId('chat'),
  signal,
) {
  const providerType = (config.providerType || 'openai').toString().trim().toLowerCase();
  const useStream = typeof handlers.onEvent === 'function';

  appendDebugLog('chat', 'request_start', {
    traceId,
    model: config?.model,
    baseURL: config?.baseURL,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    toolCount: Array.isArray(tools) ? tools.length : 0,
    stream: useStream,
    providerType,
  });

  if (providerType === 'anthropic') {
    return createAnthropicChatResponse(config, messages, tools, handlers, traceId, signal);
  }

  const openai = createOpenAIClient(config);

  if (!useStream) {
    const response = await openai.chat.completions.create({
      model: config.model,
      messages,
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : 'none',
      stream: false,
      signal,
    });

    appendDebugLog('chat', 'request_finish', {
      traceId,
      mode: 'non_stream',
      finishReason: response.choices?.[0]?.finish_reason || null,
    });
    return normalizeAssistantMessage(response.choices[0].message);
  }

  const stream = await openai.chat.completions.create({
    model: config.model,
    messages,
    tools,
    tool_choice: tools && tools.length > 0 ? 'auto' : 'none',
    stream: true,
    signal,
  });

  const finalMessage = {
    role: 'assistant',
    content: '',
    tool_calls: [],
  };

  var contentDeltaCount = 0;
  var toolDeltaCount = 0;
  var finishReason = null;

  for await (const chunk of stream) {
    if (signal?.aborted) {
      const abortError = new Error('request aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta || {};

    if (delta.role) {
      finalMessage.role = delta.role;
    }

    const deltaText = extractContentText(delta.content);
    if (deltaText) {
      contentDeltaCount += 1;
      finalMessage.content += deltaText;
      emitChatEvent(handlers, { type: 'content_delta', delta: deltaText });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const toolCallDelta of delta.tool_calls) {
        if (!toolCallDelta || typeof toolCallDelta !== 'object') continue;
        appendDebugLog('chat.stream', 'tool_call_delta_raw', { index: toolCallDelta.index, hasId: !!toolCallDelta.id, hasFunction: !!toolCallDelta.function, functionName: toolCallDelta.function?.name, argsPreview: String(toolCallDelta.function?.arguments ?? '').substring(0, 100) });
        mergeToolCallDelta(finalMessage, toolCallDelta);
        toolDeltaCount += 1;
      }

      appendDebugLog('chat.stream', 'tool_calls_delta', { toolDeltaCount, accumulatedToolCalls: finalMessage.tool_calls.length, toolCalls: finalMessage.tool_calls.map(function(tc) { return { id: tc.id, type: tc.type, hasFunction: !!tc.function, name: tc.function?.name, argsLen: (tc.function?.arguments || '').length }; }) });
      emitChatEvent(handlers, {
        type: 'tool_calls_delta',
        toolCalls: finalMessage.tool_calls,
      });
    }

    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  var hasMalformedToolCalls = false;
  if (finalMessage.tool_calls.length > 0) {
    for (var mti = 0; mti < finalMessage.tool_calls.length; mti++) {
      var tc = finalMessage.tool_calls[mti];
      if (tc === null || tc === undefined) {
        hasMalformedToolCalls = true;
        break;
      }
      if (!tc.function || !tc.function.name || tc.function.name === '') {
        hasMalformedToolCalls = true;
        break;
      }
    }
  }

  var parsed = null;
  if (finalMessage.tool_calls.length === 0 || hasMalformedToolCalls) {
    parsed = parseTextBasedToolCalls(finalMessage.content || '');
    if (parsed && parsed.toolCalls.length > 0) {
      if (hasMalformedToolCalls) {
        finalMessage.tool_calls = parsed.toolCalls;
      } else {
        finalMessage.tool_calls = parsed.toolCalls;
      }
      var cleaned = parsed.cleanedContent || '';
      if (cleaned !== finalMessage.content) {
        finalMessage.content = cleaned || null;
        emitChatEvent(handlers, { type: 'content_replace', content: cleaned });
        emitChatEvent(handlers, {
          type: 'tool_calls_delta',
          toolCalls: finalMessage.tool_calls,
        });
      }
    }
  }

  if (finalMessage.tool_calls.length && !finalMessage.content?.trim?.()) {
    finalMessage.content = null;
  }

  if (finishReason) {
    emitChatEvent(handlers, { type: 'finish', finishReason });
  }

  appendDebugLog('chat', 'request_finish', {
    traceId,
    mode: 'stream',
    contentDeltaCount,
    toolDeltaCount,
    finalToolCalls: finalMessage.tool_calls.length,
    finishReason,
  });

  return normalizeAssistantMessage(finalMessage);
}

async function createAnthropicChatResponse(
  config,
  messages,
  tools,
  handlers = {},
  traceId = createTraceId('chat'),
  signal,
) {
  appendDebugLog('chat', 'tools_count', { toolCount: tools?.length }, 'info');
  const useStream = typeof handlers.onEvent === 'function';
  let baseURL = (config.baseURL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  if (!baseURL.includes('/v1')) {
    baseURL = baseURL + '/v1';
  }
  const apiKey = config.apiKey || 'empty';

  const anthropicTools = tools && tools.length > 0 ? convertToolsToAnthropic(tools) : null;
  const anthropicPrompt = convertMessagesToAnthropic(messages);

  const requestBody = {
    model: config.model,
    max_tokens: 4096,
    messages: anthropicPrompt.messages,
  };

  if (anthropicPrompt.system) {
    requestBody.system = anthropicPrompt.system;
  }

  if (anthropicTools) {
    requestBody.tools = anthropicTools;
  }

  const url = `${baseURL}/messages`;

  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const httpModule = isHttps ? https : http;

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04',
      },
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
      });
    }

    const req = httpModule.request(options, (res) => {
      if (!useStream) {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            appendDebugLog('chat', 'error', { traceId, status: res.statusCode, body }, 'error');
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            const response = JSON.parse(body);
            const content = response.content || [];
            let text = '';
            const toolCalls = [];

            for (const block of content) {
              if (block.type === 'text') {
                text += block.text || '';
              } else if (block.type === 'tool_use') {
                toolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: block.input ? JSON.stringify(block.input) : '{}',
                  },
                });
              }
            }

            appendDebugLog('chat', 'request_finish', {
              traceId,
              mode: 'non_stream',
              providerType: 'anthropic',
              finishReason: response.stop_reason,
            });

            resolve(normalizeAssistantMessage({
              role: 'assistant',
              content: text || null,
              tool_calls: toolCalls,
            }));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      } else {
        if (res.statusCode !== 200) {
          let errorBody = '';
          res.on('data', (chunk) => { errorBody += chunk; });
          res.on('end', () => {
            appendDebugLog('chat', 'error', { traceId, status: res.statusCode, body: errorBody }, 'error');
            reject(new Error(`HTTP ${res.statusCode}: ${errorBody.slice(0, 500)}`));
          });
          return;
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          appendDebugLog('chat.stream', 'response_body', { bodyLength: body.length, bodyPreview: body.slice(0, 200) }, 'info');

          // Check if it's SSE format or complete JSON
          if (body.includes('\n') || body.startsWith('data:')) {
            // SSE format
            const finalMessage = {
              role: 'assistant',
              content: '',
              tool_calls: [],
            };
            let contentDeltaCount = 0;
            let finishReason = null;
            const toolCallIndexByContentBlock = Object.create(null);

            const lines = body.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const event = JSON.parse(data);

                if (event.type === 'content_block_start') {
                  const block = event.content_block;
                  appendDebugLog('chat.stream', 'content_block_start', { blockType: block?.type, blockKeys: block ? Object.keys(block) : [], index: event.index }, 'info');
                  if (block && block.type === 'tool_use') {
                    const toolId = block.id || block.tool_use_id || block.name;
                    const toolCallIndex = finalMessage.tool_calls.push({
                      id: toolId || `tool_${event.index}`,
                      type: 'function',
                      function: {
                        name: block.name || `unknown_tool_${event.index}`,
                        arguments: '',
                      },
                    }) - 1;
                    toolCallIndexByContentBlock[event.index] = toolCallIndex;
                  }
                } else if (event.type === 'content_block_delta') {
                  const delta = event.delta;
                  if (delta && delta.type === 'text_delta' && delta.text) {
                    contentDeltaCount += 1;
                    finalMessage.content += delta.text;
                    emitChatEvent(handlers, { type: 'content_delta', delta: delta.text });
                  } else if (delta && delta.type === 'thinking_delta') {
                    // Skip MiniMax extended thinking
                  } else if (delta && delta.type === 'input_json_delta') {
                    // Tool arguments come through as input_json_delta
                    const tcIndex = toolCallIndexByContentBlock[event.index];
                    if (tcIndex !== undefined && finalMessage.tool_calls[tcIndex]) {
                      finalMessage.tool_calls[tcIndex].function.arguments += delta.input_json || '';
                    }
                  }
                } else if (event.type === 'message_delta') {
                  if (event.delta?.stop_reason) {
                    finishReason = event.delta.stop_reason;
                  }
                }
              } catch (e) {
                // Skip
              }
            }

            if (finishReason) {
              emitChatEvent(handlers, { type: 'finish', finishReason });
            }

            appendDebugLog('chat', 'request_finish', {
              traceId,
              mode: 'stream',
              contentDeltaCount,
              finalContentLength: finalMessage.content.length,
              toolCallCount: finalMessage.tool_calls.length,
              finishReason,
            });

            resolve(normalizeAssistantMessage(finalMessage));
          } else {
            // Complete JSON response (non-streaming)
            try {
              const response = JSON.parse(body);
              const content = response.content || [];
              let text = '';
              const toolCalls = [];

              for (const block of content) {
                if (block.type === 'text') {
                  text += block.text || '';
                } else if (block.type === 'tool_use') {
                  toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                      name: block.name,
                      arguments: block.input ? JSON.stringify(block.input) : '{}',
                    },
                  });
                }
              }

              if (text) {
                emitChatEvent(handlers, { type: 'content_delta', delta: text });
              }
              emitChatEvent(handlers, { type: 'finish', finishReason: response.stop_reason || 'stop' });

              appendDebugLog('chat', 'request_finish', {
                traceId,
                mode: 'non_stream_fallback',
                contentLength: text.length,
                finishReason: response.stop_reason,
              });

              resolve(normalizeAssistantMessage({
                role: 'assistant',
                content: text || null,
                tool_calls: toolCalls,
              }));
            } catch (e) {
              appendDebugLog('chat', 'parse_error', { error: e.message, body: body.slice(0, 200) }, 'error');
              reject(new Error(`Failed to parse response: ${e.message}`));
            }
          }
        });
      }
    });

    req.on('error', (e) => {
      appendDebugLog('chat', 'request_network_error', { traceId, error: e.message }, 'error');
      reject(new Error(`Request failed: ${e.message}`));
    });

    req.on('socket', (socket) => {
      appendDebugLog('chat', 'request_socket', { traceId, remoteAddress: socket.remoteAddress }, 'info');
    });

    appendDebugLog('chat', 'request_sending', { traceId, url }, 'info');
    req.write(JSON.stringify(requestBody));
    req.end();
    appendDebugLog('chat', 'request_sent', { traceId }, 'info');
  });
}

function convertMessagePartToAnthropicBlock(part) {
  if (part == null) {
    return null;
  }
  if (typeof part === 'string') {
    return part ? { type: 'text', text: part } : null;
  }
  if (part.type === 'text' && typeof part.text === 'string') {
    return part.text ? { type: 'text', text: part.text } : null;
  }
  if (part.type === 'image_url') {
    const rawUrl = String(part.image_url?.url || '').trim();
    const match = rawUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) {
      return null;
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: match[1],
        data: match[2],
      },
    };
  }
  return null;
}

function convertMessageContentToAnthropicBlocks(content) {
  const parts = Array.isArray(content) ? content : [content];
  const blocks = [];
  for (const part of parts) {
    const block = convertMessagePartToAnthropicBlock(part);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

function parseAnthropicToolInput(rawArguments) {
  if (rawArguments == null || rawArguments === '') {
    return {};
  }
  if (typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
    return rawArguments;
  }
  if (typeof rawArguments !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyAnthropicContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (content == null) {
    return '';
  }
  const text = extractContentText(content);
  if (text) {
    return text;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function pushAnthropicMessage(target, role, blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return;
  }
  const lastMessage = target[target.length - 1];
  if (lastMessage && lastMessage.role === role && Array.isArray(lastMessage.content)) {
    lastMessage.content = lastMessage.content.concat(blocks);
    return;
  }
  target.push({ role, content: blocks });
}

function convertMessagesToAnthropic(messages) {
  const result = [];
  const systemParts = [];

  for (const msg of messages || []) {
    if (!msg) {
      continue;
    }

    if (msg.role === 'system') {
      const text = stringifyAnthropicContent(msg.content).trim();
      if (text) {
        systemParts.push(text);
      }
      continue;
    }

    if (msg.role === 'tool') {
      const toolUseId = String(msg.tool_call_id ?? msg.toolUseId ?? '').trim();
      if (!toolUseId) {
        continue;
      }
      pushAnthropicMessage(result, 'user', [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: stringifyAnthropicContent(msg.content),
      }]);
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks = convertMessageContentToAnthropicBlocks(msg.content);
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (let index = 0; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index];
        const toolName = String(toolCall?.function?.name ?? toolCall?.name ?? '').trim();
        if (!toolName) {
          continue;
        }
        blocks.push({
          type: 'tool_use',
          id: String(toolCall?.id ?? '').trim() || `tool_${result.length}_${index}`,
          name: toolName,
          input: parseAnthropicToolInput(toolCall?.function?.arguments ?? toolCall?.arguments),
        });
      }
      pushAnthropicMessage(result, 'assistant', blocks);
      continue;
    }

    if (msg.role === 'user') {
      pushAnthropicMessage(result, 'user', convertMessageContentToAnthropicBlocks(msg.content));
    }
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: result,
  };
}

function convertMessagesToAnthropicPrompt(messages) {
  const prompt = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      prompt.push({ role: 'system', content: msg.content });
    } else if (msg.role === 'user') {
      const content = typeof msg.content === 'string'
        ? [{ type: 'text', text: msg.content }]
        : msg.content;
      prompt.push({ role: 'user', content });
    } else if (msg.role === 'assistant') {
      const content = typeof msg.content === 'string'
        ? [{ type: 'text', text: msg.content }]
        : msg.content;
      prompt.push({ role: 'assistant', content });
    }
  }
  return prompt;
}

function convertToolsToAnthropic(tools) {
  return tools.map((tool, index) => {
    if (!tool) {
      return null;
    }

    let name, description, parameters;

    // Handle various formats
    if (tool.type === 'function' && tool.function) {
      name = tool.function.Name || tool.function.name;
      description = tool.function.description;
      parameters = tool.function.parameters;
    } else if (tool.type === 'function') {
      name = tool.Name || tool.name;
      description = tool.description;
      parameters = tool.parameters;
    } else {
      name = tool.Name || tool.name;
      description = tool.description;
      parameters = tool.parameters;
    }

    // Try to get name from title in parameters if name is still missing
    if ((!name || !String(name).trim()) && parameters?.title) {
      name = String(parameters.title).replace(/Arguments$/, '');
    }

    // Fallback: if still no name, try to get from description or use index
    if (!name || !String(name).trim()) {
      name = `tool_${index}`;
    }

    const properties = {};
    const required = [];
    if (parameters?.properties) {
      for (const [propName, prop] of Object.entries(parameters.properties)) {
        if (!propName || !String(propName).trim()) {
          continue;
        }
        properties[propName] = {
          type: prop && prop.type ? prop.type : 'string',
          description: prop && prop.description ? prop.description : (prop && prop.title ? prop.title : ''),
        };
        if (parameters.required?.includes(propName)) {
          required.push(propName);
        }
      }
    }

    return {
      name: String(name).trim(),
      description: description || '',
      input_schema: {
        type: 'object',
        properties,
        required,
      },
    };
  }).filter(Boolean);
}

function convertAnthropicResponseToAssistant(content, finishReason) {
  const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }];
  let textContent = '';
  const toolCalls = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textContent += block.text || '';
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: block.input ? JSON.stringify(block.input) : '{}',
        },
      });
    }
  }

  return {
    role: 'assistant',
    content: textContent || null,
    tool_calls: toolCalls,
  };
}

function normalizeHttpUrl(rawUrl) {
  const input = String(rawUrl ?? '').trim();
  if (!input) {
    throw new Error('url 不能为空');
  }
  const candidate = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 http 或 https 协议');
  }
  return parsed.toString();
}

function decodeHtmlEntities(text) {
  const value = String(text ?? '');
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const normalized = String(code).toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos' || normalized === '#39') return "'";
    if (normalized === 'nbsp') return ' ';
    if (normalized.startsWith('#x')) {
      const parsed = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : entity;
    }
    if (normalized.startsWith('#')) {
      const parsed = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : entity;
    }
    return entity;
  });
}

function htmlToPlainText(html) {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|main|header|footer|aside|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
}

function truncateText(text, maxLength = 20000) {
  const value = String(text ?? '');
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, maxLength)}\n\n...[内容已截断，共 ${value.length} 字符]`,
    truncated: true,
  };
}

function compactSearchText(text, maxLength = 320) {
  const normalized = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[#>*_|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function decodeSearchResultUrl(rawUrl) {
  const input = String(rawUrl ?? '').trim();
  if (!input) {
    return input;
  }
  try {
    const parsed = new URL(input, 'https://duckduckgo.com');
    const redirectTarget = parsed.searchParams.get('uddg');
    return redirectTarget ? decodeURIComponent(redirectTarget) : parsed.toString();
  } catch {
    return input;
  }
}

async function fetchWithFallback(urls, options = {}) {
  const attempts = [];

  for (const targetUrl of urls) {
    try {
      if (typeof fetch !== 'function') {
        throw new Error('当前环境不支持 fetch');
      }
      const response = await fetch(targetUrl, options);
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || 'request_failed'}`);
      }
      return { response, url: targetUrl, attempts };
    } catch (error) {
      attempts.push({
        url: targetUrl,
        message: safeErrorMessage(error),
      });
    }
  }

  const summary = attempts.map((item) => `${item.url}: ${item.message}`).join(' | ');
  throw new Error(summary || '请求失败');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DIFF_MAX_CELLS = 5_000_000;
const DIFF_MAX_TEXT_LENGTH = 64 * 1024;
const DIFF_CONTEXT_LINES = 3;

function splitForDiff(text) {
  if (text === '' || text == null) return [];
  const lines = String(text).split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '' && String(text).endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

function computeLineDiff(oldText, newText) {
  const oldLines = splitForDiff(oldText);
  const newLines = splitForDiff(newText);

  // Trim common prefix / suffix so the LCS only runs on the hunk of change.
  let prefix = 0;
  while (
    prefix < oldLines.length
    && prefix < newLines.length
    && oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);
  const m = oldMid.length;
  const n = newMid.length;

  let ops = [];
  let tooLarge = false;

  if (m === 0 && n === 0) {
    // pure identity — no changes at all
  } else if ((m + 1) * (n + 1) > DIFF_MAX_CELLS) {
    // avoid O(m*n) memory blow-up on huge rewrites
    tooLarge = true;
    for (let k = 0; k < m; k += 1) ops.push({ type: '-', content: oldMid[k] });
    for (let k = 0; k < n; k += 1) ops.push({ type: '+', content: newMid[k] });
  } else {
    const dp = new Uint32Array((m + 1) * (n + 1));
    const width = n + 1;
    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        if (oldMid[i - 1] === newMid[j - 1]) {
          dp[i * width + j] = dp[(i - 1) * width + (j - 1)] + 1;
        } else {
          const up = dp[(i - 1) * width + j];
          const left = dp[i * width + (j - 1)];
          dp[i * width + j] = up >= left ? up : left;
        }
      }
    }
    let i = m;
    let j = n;
    const rev = [];
    while (i > 0 && j > 0) {
      if (oldMid[i - 1] === newMid[j - 1]) {
        rev.push({ type: ' ', content: oldMid[i - 1] });
        i -= 1;
        j -= 1;
      } else if (dp[(i - 1) * width + j] >= dp[i * width + (j - 1)]) {
        rev.push({ type: '-', content: oldMid[i - 1] });
        i -= 1;
      } else {
        rev.push({ type: '+', content: newMid[j - 1] });
        j -= 1;
      }
    }
    while (i > 0) {
      rev.push({ type: '-', content: oldMid[i - 1] });
      i -= 1;
    }
    while (j > 0) {
      rev.push({ type: '+', content: newMid[j - 1] });
      j -= 1;
    }
    ops = rev.reverse();
  }

  let addedLines = 0;
  let removedLines = 0;
  for (const op of ops) {
    if (op.type === '+') addedLines += 1;
    else if (op.type === '-') removedLines += 1;
  }

  // Build hunks around the mid region, translating indices back by `prefix`.
  // Each hunk starts at an index that is either the very first change or DIFF_CONTEXT_LINES
  // lines after the previous hunk's last change.
  const hunks = [];
  if (ops.length > 0 && addedLines + removedLines > 0) {
    let oldLine = prefix + 1;
    let newLine = prefix + 1;
    let current = null;
    let trailingContext = 0;

    const flush = () => {
      if (!current) return;
      // trim trailing pure-context runs longer than DIFF_CONTEXT_LINES
      while (
        current.lines.length > 0
        && current.lines[current.lines.length - 1].type === ' '
        && trailingContext > DIFF_CONTEXT_LINES
      ) {
        current.lines.pop();
        current.oldLines -= 1;
        current.newLines -= 1;
        trailingContext -= 1;
      }
      hunks.push(current);
      current = null;
      trailingContext = 0;
    };

    for (let index = 0; index < ops.length; index += 1) {
      const op = ops[index];
      if (op.type === ' ') {
        if (current) {
          if (trailingContext < DIFF_CONTEXT_LINES * 2 + 1) {
            current.lines.push({ type: ' ', content: op.content, oldLineNumber: oldLine, newLineNumber: newLine });
            current.oldLines += 1;
            current.newLines += 1;
            trailingContext += 1;
          } else {
            flush();
          }
        }
        oldLine += 1;
        newLine += 1;
      } else {
        if (!current) {
          // seed hunk with up to DIFF_CONTEXT_LINES of leading context
          const leading = [];
          let backIndex = index - 1;
          let backOld = oldLine - 1;
          let backNew = newLine - 1;
          while (backIndex >= 0 && leading.length < DIFF_CONTEXT_LINES) {
            const prev = ops[backIndex];
            if (prev.type !== ' ') break;
            leading.unshift({ type: ' ', content: prev.content, oldLineNumber: backOld, newLineNumber: backNew });
            backIndex -= 1;
            backOld -= 1;
            backNew -= 1;
          }
          current = {
            oldStart: leading.length ? leading[0].oldLineNumber : oldLine,
            newStart: leading.length ? leading[0].newLineNumber : newLine,
            oldLines: leading.length,
            newLines: leading.length,
            lines: leading,
          };
          trailingContext = 0;
        }
        if (op.type === '-') {
          current.lines.push({ type: '-', content: op.content, oldLineNumber: oldLine });
          current.oldLines += 1;
          oldLine += 1;
        } else {
          current.lines.push({ type: '+', content: op.content, newLineNumber: newLine });
          current.newLines += 1;
          newLine += 1;
        }
        trailingContext = 0;
      }
    }
    flush();
  }

  // Emit unified-style text
  const diffLines = [];
  for (const hunk of hunks) {
    diffLines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      diffLines.push(`${line.type}${line.content}`);
    }
  }
  let diffText = diffLines.join('\n');
  let diffTruncated = false;
  if (diffText.length > DIFF_MAX_TEXT_LENGTH) {
    diffText = `${diffText.slice(0, DIFF_MAX_TEXT_LENGTH)}\n... [diff truncated]`;
    diffTruncated = true;
  }

  return {
    addedLines,
    removedLines,
    diffText,
    hunks,
    tooLarge,
    diffTruncated,
  };
}

function buildToolDiffMeta(filePath, oldText, newText) {
  try {
    const diff = computeLineDiff(oldText ?? '', newText ?? '');
    return {
      filePath,
      addedLines: diff.addedLines,
      removedLines: diff.removedLines,
      diffText: diff.diffText,
      tooLarge: diff.tooLarge,
      diffTruncated: diff.diffTruncated,
    };
  } catch (error) {
    appendDebugLog('diff', 'compute_error', {
      filePath,
      message: safeErrorMessage(error),
    }, 'error');
    return null;
  }
}

function globToRegExp(pattern) {
  const normalized = String(pattern || '**/*').replace(/\\/g, '/');
  let expression = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];

    if (current === '*') {
      if (next === '*') {
        if (afterNext === '/') {
          expression += '(?:.*\\/)?';
          index += 2;
        } else {
          expression += '.*';
          index += 1;
        }
      } else {
        expression += '[^/]*';
      }
      continue;
    }

    if (current === '?') {
      expression += '[^/]';
      continue;
    }

    expression += escapeRegExp(current);
  }

  return new RegExp(`^${expression}$`);
}

function shouldTreatAsTextFile(targetPath) {
  const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip', '.7z', '.rar',
    '.mp3', '.mp4', '.mov', '.avi', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.class', '.jar',
    '.exe', '.dll', '.so', '.dylib', '.bin',
  ]);
  const extension = path.extname(targetPath).toLowerCase();
  if (binaryExtensions.has(extension)) {
    return false;
  }
  try {
    const stats = fs.statSync(targetPath);
    return stats.size <= 2 * 1024 * 1024;
  } catch {
    return false;
  }
}

function walkEntries(rootPath, options = {}) {
  const includeDirectories = Boolean(options.includeDirectories);
  const maxEntries = Math.min(Math.max(Number(options.maxEntries) || 2000, 1), 50000);
  const startPath = resolveLocalPath(rootPath || process.cwd(), 'path');
  const queue = [startPath];
  const results = [];

  while (queue.length && results.length < maxEntries) {
    const currentPath = queue.shift();
    const stats = fs.statSync(currentPath);

    if (!stats.isDirectory()) {
      results.push({ path: currentPath, type: 'file' });
      continue;
    }

    const items = fs.readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);
      if (item.isDirectory()) {
        if (includeDirectories) {
          results.push({ path: fullPath, type: 'directory' });
        }
        queue.push(fullPath);
      } else {
        results.push({ path: fullPath, type: 'file' });
      }

      if (results.length >= maxEntries) {
        break;
      }
    }
  }

  return { startPath, results };
}

function listDirectory(dirPath) {
  const traceId = createTraceId('read_dir');
  const startAt = now();
  let targetPath = '';
  try {
    targetPath = resolveLocalPath(dirPath, 'dirPath');
    const files = fs.readdirSync(targetPath, { withFileTypes: true });
    const data = files.map((file) => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(targetPath, file.name),
    }));
    appendDebugLog('file.read_dir', 'success', {
      traceId,
      durationMs: now() - startAt,
      inputPath: dirPath,
      resolvedPath: targetPath,
      items: data.length,
    });
    return { success: true, data };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('file.read_dir', 'error', {
      traceId,
      durationMs: now() - startAt,
      inputPath: dirPath,
      resolvedPath: targetPath,
      message,
    }, 'error');
    return { success: false, error: message };
  }
}

function readFileContent(filePath) {
  const traceId = createTraceId('read_file');
  const startAt = now();
  let targetPath = '';
  try {
    targetPath = resolveLocalPath(filePath, 'filePath');
    const data = fs.readFileSync(targetPath, 'utf-8');
    appendDebugLog('file.read_file', 'success', {
      traceId,
      durationMs: now() - startAt,
      inputPath: filePath,
      resolvedPath: targetPath,
      bytes: Buffer.byteLength(data, 'utf-8'),
    });
    return { success: true, data };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('file.read_file', 'error', {
      traceId,
      durationMs: now() - startAt,
      inputPath: filePath,
      resolvedPath: targetPath,
      message,
    }, 'error');
    return { success: false, error: message };
  }
}

const FILE_READ_DEFAULT_LIMIT = 2000;
const FILE_READ_LINE_CHAR_CAP = 2000;
const FILE_READ_IMAGE_SIZE_CAP = 10 * 1024 * 1024;

const GREP_TYPE_EXTENSIONS = {
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  ts: ['.ts', '.tsx', '.mts', '.cts'],
  jsx: ['.jsx', '.tsx'],
  py: ['.py', '.pyi'],
  go: ['.go'],
  rust: ['.rs'],
  rs: ['.rs'],
  java: ['.java'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
  cs: ['.cs'],
  rb: ['.rb'],
  php: ['.php'],
  vue: ['.vue'],
  svelte: ['.svelte'],
  md: ['.md', '.mdx', '.markdown'],
  json: ['.json', '.jsonc'],
  yaml: ['.yml', '.yaml'],
  toml: ['.toml'],
  sh: ['.sh', '.bash', '.zsh', '.fish'],
  ps: ['.ps1'],
  sql: ['.sql'],
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.less'],
  lua: ['.lua'],
  kt: ['.kt', '.kts'],
  swift: ['.swift'],
};

function buildGrepTypeFilter(rawTypes) {
  if (!rawTypes) return null;
  const list = Array.isArray(rawTypes)
    ? rawTypes.map((item) => String(item || '').toLowerCase().trim()).filter(Boolean)
    : String(rawTypes)
        .split(',')
        .map((item) => item.toLowerCase().trim())
        .filter(Boolean);
  if (!list.length) return null;
  const exts = new Set();
  for (const key of list) {
    const mapping = GREP_TYPE_EXTENSIONS[key];
    if (mapping) {
      mapping.forEach((ext) => exts.add(ext));
    } else if (key.startsWith('.')) {
      exts.add(key);
    }
  }
  return exts.size ? exts : null;
}

function compileGrepRegex(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`pattern 不是合法正则：${safeErrorMessage(error)}`);
  }
}

function runGrep(options = {}) {
  const traceId = createTraceId('grep');
  const startAt = now();
  try {
    const pattern = String(options?.pattern ?? '').trim();
    if (!pattern) {
      throw new Error('pattern 不能为空');
    }

    const outputMode = ['content', 'files_with_matches', 'count'].includes(options?.outputMode)
      ? options.outputMode
      : 'files_with_matches';
    const isRegex = options?.isRegex === undefined ? true : Boolean(options.isRegex);
    const caseSensitive = Boolean(options?.caseSensitive);
    const multiline = Boolean(options?.multiline);
    const showLineNumbers = options?.showLineNumbers !== false;
    const headLimit = Math.max(1, Math.min(Number(options?.headLimit) || 250, 10000));
    const offset = Math.max(0, Number(options?.offset) || 0);
    const contextArg = Number(options?.context);
    const beforeContext = Math.max(0, Number(options?.beforeContext) || (Number.isFinite(contextArg) ? contextArg : 0));
    const afterContext = Math.max(0, Number(options?.afterContext) || (Number.isFinite(contextArg) ? contextArg : 0));

    const globPattern = String(options?.glob ?? options?.filePattern ?? '').trim();
    const typeFilter = buildGrepTypeFilter(options?.type);

    const searchBase = options?.path ? resolveLocalPath(options.path, 'path') : process.cwd();
    let singleFileStats = null;
    try {
      singleFileStats = fs.statSync(searchBase);
    } catch (error) {
      throw new Error(`无法访问路径：${safeErrorMessage(error)}`);
    }

    let targetFiles;
    let startPath;
    if (singleFileStats.isFile()) {
      targetFiles = [{ path: searchBase, type: 'file' }];
      startPath = path.dirname(searchBase);
    } else {
      const walked = walkEntries(searchBase, {
        includeDirectories: false,
        maxEntries: 20000,
      });
      targetFiles = walked.results;
      startPath = walked.startPath;
    }

    const globMatcher = globPattern ? globToRegExp(globPattern) : null;
    const matchFileByRelativePath = globPattern.includes('/') || globPattern.includes('\\');

    const baseFlags = `${caseSensitive ? '' : 'i'}${multiline ? 's' : ''}${isRegex ? 'g' : 'g'}`;
    const regexSource = isRegex ? pattern : escapeRegExp(pattern);
    const lineRegex = compileGrepRegex(regexSource, `${caseSensitive ? '' : 'i'}${multiline ? 's' : ''}`);
    const globalMultilineRegex = multiline ? compileGrepRegex(regexSource, baseFlags) : null;

    const perFileMatches = [];
    const perFileCounts = [];
    const matchedFilePaths = [];
    let scannedFiles = 0;
    let collectedMatches = 0;

    for (const entry of targetFiles) {
      if (entry.type !== 'file') continue;
      if (!shouldTreatAsTextFile(entry.path)) continue;

      if (typeFilter) {
        const ext = path.extname(entry.path).toLowerCase();
        if (!typeFilter.has(ext)) continue;
      }

      if (globMatcher) {
        const candidate = matchFileByRelativePath
          ? path.relative(startPath, entry.path).replace(/\\/g, '/')
          : path.basename(entry.path);
        if (!globMatcher.test(candidate)) continue;
      }

      scannedFiles += 1;

      let content = '';
      try {
        content = fs.readFileSync(entry.path, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      const fileMatches = [];
      let fileMatchCount = 0;

      if (multiline && globalMultilineRegex) {
        globalMultilineRegex.lastIndex = 0;
        let match;
        while ((match = globalMultilineRegex.exec(content)) !== null) {
          fileMatchCount += 1;
          if (outputMode === 'content') {
            const upto = content.slice(0, match.index);
            const lineNumber = (upto.match(/\n/g) || []).length + 1;
            const snippet = match[0].split(/\r?\n/)[0].slice(0, 500);
            fileMatches.push({
              lineNumber,
              line: snippet,
              beforeContext: beforeContext > 0
                ? lines
                    .slice(Math.max(0, lineNumber - 1 - beforeContext), lineNumber - 1)
                    .map((line, idx) => ({
                      lineNumber: lineNumber - beforeContext + idx,
                      line: line.slice(0, 500),
                    }))
                : [],
              afterContext: afterContext > 0
                ? lines
                    .slice(lineNumber, lineNumber + afterContext)
                    .map((line, idx) => ({
                      lineNumber: lineNumber + 1 + idx,
                      line: line.slice(0, 500),
                    }))
                : [],
            });
          }
          if (match.index === globalMultilineRegex.lastIndex) {
            globalMultilineRegex.lastIndex += 1;
          }
        }
      } else {
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          lineRegex.lastIndex = 0;
          const matched = lineRegex.test(line);
          lineRegex.lastIndex = 0;
          if (!matched) continue;
          fileMatchCount += 1;
          if (outputMode === 'content') {
            fileMatches.push({
              lineNumber: index + 1,
              line: line.slice(0, 500),
              beforeContext: beforeContext > 0
                ? lines
                    .slice(Math.max(0, index - beforeContext), index)
                    .map((contextLine, contextIndex) => ({
                      lineNumber: Math.max(1, index - beforeContext + contextIndex + 1),
                      line: contextLine.slice(0, 500),
                    }))
                : [],
              afterContext: afterContext > 0
                ? lines
                    .slice(index + 1, index + 1 + afterContext)
                    .map((contextLine, contextIndex) => ({
                      lineNumber: index + 1 + contextIndex + 1,
                      line: contextLine.slice(0, 500),
                    }))
                : [],
            });
          }
        }
      }

      if (fileMatchCount === 0) continue;

      matchedFilePaths.push(entry.path);
      if (outputMode === 'count') {
        perFileCounts.push({ path: entry.path, matchCount: fileMatchCount });
      }
      if (outputMode === 'content') {
        for (const match of fileMatches) {
          perFileMatches.push({
            path: entry.path,
            ...match,
            showLineNumbers,
          });
          collectedMatches += 1;
        }
      }

      if (outputMode === 'files_with_matches' && matchedFilePaths.length >= offset + headLimit) break;
      if (outputMode === 'count' && perFileCounts.length >= offset + headLimit) break;
      if (outputMode === 'content' && collectedMatches >= offset + headLimit) break;
    }

    appendDebugLog('file.grep', 'success', {
      traceId,
      durationMs: now() - startAt,
      pattern,
      startPath,
      outputMode,
      scannedFiles,
      matchedFiles: matchedFilePaths.length,
      collectedMatches,
    });

    if (outputMode === 'files_with_matches') {
      const paginated = matchedFilePaths.slice(offset, offset + headLimit);
      return {
        success: true,
        data: {
          outputMode,
          paths: paginated,
          totalFiles: matchedFilePaths.length,
          scannedFiles,
          offset,
          headLimit,
        },
      };
    }

    if (outputMode === 'count') {
      perFileCounts.sort((a, b) => b.matchCount - a.matchCount);
      const paginated = perFileCounts.slice(offset, offset + headLimit);
      return {
        success: true,
        data: {
          outputMode,
          counts: paginated,
          totalFiles: perFileCounts.length,
          totalMatches: perFileCounts.reduce((acc, item) => acc + item.matchCount, 0),
          scannedFiles,
          offset,
          headLimit,
        },
      };
    }

    const paginatedMatches = perFileMatches.slice(offset, offset + headLimit);
    return {
      success: true,
      data: {
        outputMode,
        matches: paginatedMatches,
        totalMatches: perFileMatches.length,
        totalFiles: matchedFilePaths.length,
        scannedFiles,
        offset,
        headLimit,
      },
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('file.grep', 'error', {
      traceId,
      durationMs: now() - startAt,
      pattern: options?.pattern || '',
      path: options?.path || '',
      message,
    }, 'error');
    return { success: false, error: message };
  }
}

function formatNumberedLines(lines, startOffset) {
  const width = Math.max(6, String(startOffset + lines.length).length);
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = startOffset + index + 1;
    const prefix = String(lineNumber).padStart(width, ' ');
    let text = lines[index];
    let lineTruncated = false;
    if (text.length > FILE_READ_LINE_CHAR_CAP) {
      text = `${text.slice(0, FILE_READ_LINE_CHAR_CAP)}... [line truncated]`;
      lineTruncated = true;
    }
    out.push(`${prefix}\t${text}`);
    if (lineTruncated) {
      // no-op; the marker already lives in the line
    }
  }
  return out.join('\n');
}

function parseNotebookForRead(targetPath) {
  const raw = fs.readFileSync(targetPath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`无法解析 notebook：${safeErrorMessage(error)}`);
  }
  const cells = Array.isArray(parsed?.cells) ? parsed.cells : [];
  const lines = [];
  cells.forEach((cell, index) => {
    const source = Array.isArray(cell?.source) ? cell.source.join('') : String(cell?.source ?? '');
    const cellId = String(cell?.id ?? `idx_${index}`);
    const cellType = String(cell?.cell_type ?? 'unknown');
    lines.push(`=== cell ${index} | type=${cellType} | id=${cellId} ===`);
    lines.push(source);
    lines.push('');
  });
  return {
    content: lines.join('\n'),
    totalCells: cells.length,
    language: parsed?.metadata?.language_info?.name || 'unknown',
  };
}

function readFileRich(options = {}) {
  const traceId = createTraceId('read_file_rich');
  const startAt = now();
  let targetPath = '';
  try {
    const rawPath = options?.filePath ?? options?.path ?? options?.file;
    targetPath = resolveLocalPath(rawPath, 'filePath');
    if (!fs.existsSync(targetPath)) {
      throw new Error('文件不存在');
    }
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      throw new Error('目标是目录，使用 GlobTool 列出内容');
    }
    const ext = path.extname(targetPath).toLowerCase();

    if (IMAGE_MIME_BY_EXT[ext]) {
      if (stats.size > FILE_READ_IMAGE_SIZE_CAP) {
        return { success: false, error: `图片大小超过 ${FILE_READ_IMAGE_SIZE_CAP} 字节，无法直接读取` };
      }
      const mimeType = IMAGE_MIME_BY_EXT[ext];
      const buffer = fs.readFileSync(targetPath);
      const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      appendDebugLog('file.read_rich', 'image', {
        traceId,
        durationMs: now() - startAt,
        resolvedPath: targetPath,
        mimeType,
        bytes: stats.size,
      });
      return {
        success: true,
        data: {
          filePath: targetPath,
          kind: 'image',
          mimeType,
          size: stats.size,
          dataUrl,
        },
      };
    }

    if (ext === '.pdf') {
      return {
        success: false,
        error: 'PDF 暂未支持直接解析文本。可使用 BashTool 执行 pdftotext / poppler / python 脚本后再读取。',
      };
    }

    if (ext === '.ipynb') {
      const parsed = parseNotebookForRead(targetPath);
      const lines = parsed.content.split(/\r?\n/);
      const offset = Math.max(0, Number(options?.offset) || 0);
      const limit = Math.max(1, Math.min(Number(options?.limit) || FILE_READ_DEFAULT_LIMIT, 50000));
      const sliced = lines.slice(offset, offset + limit);
      const truncated = offset + sliced.length < lines.length;
      return {
        success: true,
        data: {
          filePath: targetPath,
          kind: 'notebook',
          language: parsed.language,
          totalCells: parsed.totalCells,
          totalLines: lines.length,
          offset,
          linesReturned: sliced.length,
          truncated,
          content: formatNumberedLines(sliced, offset),
        },
      };
    }

    if (!shouldTreatAsTextFile(targetPath) && stats.size > 2 * 1024 * 1024) {
      return { success: false, error: '文件过大或疑似二进制文件（>2MB），未读取' };
    }

    const raw = fs.readFileSync(targetPath, 'utf-8');
    const rawLines = raw.split(/\r?\n/);
    // If the file ends with a trailing newline, split yields an empty last element — drop it for counting
    const hasTrailingNewline = raw.endsWith('\n');
    const totalLines = hasTrailingNewline && rawLines[rawLines.length - 1] === ''
      ? rawLines.length - 1
      : rawLines.length;
    const offset = Math.max(0, Number(options?.offset) || 0);
    const limit = Math.max(1, Math.min(Number(options?.limit) || FILE_READ_DEFAULT_LIMIT, 50000));
    const sliced = rawLines.slice(offset, offset + limit);
    // If trailing empty line sneaks in at the tail of the full file, strip from the slice tail too
    while (sliced.length > 0 && sliced[sliced.length - 1] === '' && offset + sliced.length >= rawLines.length) {
      sliced.pop();
    }
    const truncated = offset + sliced.length < totalLines;
    const content = formatNumberedLines(sliced, offset);

    appendDebugLog('file.read_rich', 'text', {
      traceId,
      durationMs: now() - startAt,
      resolvedPath: targetPath,
      totalLines,
      offset,
      linesReturned: sliced.length,
      truncated,
    });

    return {
      success: true,
      data: {
        filePath: targetPath,
        kind: 'text',
        totalLines,
        offset,
        linesReturned: sliced.length,
        truncated,
        content,
      },
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('file.read_rich', 'error', {
      traceId,
      durationMs: now() - startAt,
      resolvedPath: targetPath,
      message,
    }, 'error');
    return { success: false, error: message };
  }
}

function writeFileContent(filePath, content) {
  const traceId = createTraceId('write_file');
  const startAt = now();
  let targetPath = '';
  try {
    targetPath = resolveLocalPath(filePath, 'filePath');
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const normalizedContent = typeof content === 'string' ? content : String(content ?? '');
    let previousContent = '';
    let previouslyExisted = false;
    try {
      if (fs.existsSync(targetPath)) {
        previouslyExisted = true;
        previousContent = fs.readFileSync(targetPath, 'utf-8');
      }
    } catch {
      previousContent = '';
    }
    fs.writeFileSync(targetPath, normalizedContent, 'utf-8');
    const diff = buildToolDiffMeta(targetPath, previousContent, normalizedContent);
    appendDebugLog('file.write_file', 'success', {
      traceId,
      durationMs: now() - startAt,
      inputPath: filePath,
      resolvedPath: targetPath,
      bytes: Buffer.byteLength(normalizedContent, 'utf-8'),
      previouslyExisted,
      addedLines: diff?.addedLines ?? 0,
      removedLines: diff?.removedLines ?? 0,
    });
    return {
      success: true,
      data: {
        filePath: targetPath,
        previouslyExisted,
        diff,
      },
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('file.write_file', 'error', {
      traceId,
      durationMs: now() - startAt,
      inputPath: filePath,
      resolvedPath: targetPath,
      message,
    }, 'error');
    return { success: false, error: message };
  }
}

function clampBashTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return BASH_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(parsed), 1000), BASH_MAX_TIMEOUT_MS);
}

function executeShellCommand(command, cwd, options = {}) {
  const traceId = createTraceId('exec');
  const startAt = now();
  let resolvedCwd = process.cwd();
  try {
    resolvedCwd = cwd ? resolveLocalPath(cwd, 'cwd') : process.cwd();
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('exec', 'cwd_error', {
      traceId,
      command,
      cwd,
      message,
    }, 'error');
    return Promise.resolve({ success: false, error: message });
  }

  const timeoutMs = clampBashTimeout(options?.timeoutMs);
  const description = typeof options?.description === 'string' ? options.description.trim() : '';

  appendDebugLog('exec', 'start', {
    traceId,
    command,
    cwd: resolvedCwd,
    timeoutMs,
    description,
  });

  return new Promise((resolve) => {
    exec(
      String(command || ''),
      {
        cwd: resolvedCwd,
        windowsHide: true,
        shell: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const durationMs = now() - startAt;
        const trimmedStdout = trimBashOutput(stdout, 'stdout');
        const trimmedStderr = trimBashOutput(stderr, 'stderr');
        if (error) {
          appendDebugLog('exec', 'error', {
            traceId,
            durationMs,
            command,
            cwd: resolvedCwd,
            message: safeErrorMessage(error),
            stderrLength: trimmedStderr.originalBytes,
            stdoutLength: trimmedStdout.originalBytes,
            stdoutTruncated: trimmedStdout.truncated,
            stderrTruncated: trimmedStderr.truncated,
          }, 'error');
          resolve({
            success: false,
            error: error.message,
            stderr: trimmedStderr.text,
            stdout: trimmedStdout.text,
            stdoutTruncated: trimmedStdout.truncated,
            stderrTruncated: trimmedStderr.truncated,
            stdoutOriginalBytes: trimmedStdout.originalBytes,
            stderrOriginalBytes: trimmedStderr.originalBytes,
            stdoutOriginalLines: trimmedStdout.originalLines,
            stderrOriginalLines: trimmedStderr.originalLines,
            timedOut: Boolean(error.killed && error.signal === 'SIGTERM'),
            durationMs,
          });
          return;
        }

        appendDebugLog('exec', 'success', {
          traceId,
          durationMs,
          command,
          cwd: resolvedCwd,
          stdoutLength: trimmedStdout.originalBytes,
          stderrLength: trimmedStderr.originalBytes,
          stdoutTruncated: trimmedStdout.truncated,
          stderrTruncated: trimmedStderr.truncated,
        });
        resolve({
          success: true,
          stdout: trimmedStdout.text,
          stderr: trimmedStderr.text,
          stdoutTruncated: trimmedStdout.truncated,
          stderrTruncated: trimmedStderr.truncated,
          stdoutOriginalBytes: trimmedStdout.originalBytes,
          stderrOriginalBytes: trimmedStderr.originalBytes,
          stdoutOriginalLines: trimmedStdout.originalLines,
          stderrOriginalLines: trimmedStderr.originalLines,
          durationMs,
        });
      },
    );
  });
}

function appendToRingBuffer(record, chunk, channel) {
  if (!chunk) return;
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  if (!text) return;
  record.output.push({ channel, text, at: Date.now() });
  record.totalBytes += Buffer.byteLength(text, 'utf-8');
  while (record.totalBytes > BASH_OUTPUT_BUFFER_CAP && record.output.length > 1) {
    const dropped = record.output.shift();
    record.totalBytes -= Buffer.byteLength(dropped.text, 'utf-8');
    record.droppedCount += 1;
  }
}

function startBackgroundBash(command, cwd, options = {}) {
  const traceId = createTraceId('bash_bg');
  const startAt = now();
  let resolvedCwd = process.cwd();
  try {
    resolvedCwd = cwd ? resolveLocalPath(cwd, 'cwd') : process.cwd();
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }

  const normalizedCommand = String(command || '').trim();
  if (!normalizedCommand) {
    return { success: false, error: 'command 不能为空' };
  }

  bashIdSeq += 1;
  const bashId = `bash_${bashIdSeq}_${Date.now().toString(36)}`;

  let child;
  try {
    child = spawn(normalizedCommand, {
      cwd: resolvedCwd,
      shell: true,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }

  const record = {
    bashId,
    command: normalizedCommand,
    cwd: resolvedCwd,
    description: typeof options?.description === 'string' ? options.description.trim() : '',
    status: 'running',
    exitCode: null,
    signal: null,
    startedAt: startAt,
    endedAt: null,
    pid: child.pid || null,
    proc: child,
    output: [],
    totalBytes: 0,
    droppedCount: 0,
    cursor: 0,
  };
  activeBashProcesses.set(bashId, record);

  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');
  child.stdout?.on('data', (chunk) => appendToRingBuffer(record, chunk, 'stdout'));
  child.stderr?.on('data', (chunk) => appendToRingBuffer(record, chunk, 'stderr'));

  child.on('error', (error) => {
    if (record.status === 'running') {
      record.status = 'error';
    }
    record.endedAt = Date.now();
    appendToRingBuffer(record, `\n[error] ${safeErrorMessage(error)}\n`, 'stderr');
    appendDebugLog('bash.bg', 'child_error', { bashId, message: safeErrorMessage(error) }, 'error');
  });

  child.on('close', (code, signal) => {
    if (record.status === 'running') {
      record.status = code === 0 ? 'completed' : 'exited';
    }
    record.exitCode = code == null ? null : code;
    record.signal = signal || null;
    record.endedAt = Date.now();
    appendDebugLog('bash.bg', 'closed', {
      bashId,
      exitCode: record.exitCode,
      signal: record.signal,
      durationMs: record.endedAt - record.startedAt,
      status: record.status,
    });
    if (bashNotificationEnabled) {
      const title = 'Bash ' + record.status;
      const desc = record.description || record.command;
      const truncatedDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
      showWindowsNotification(title, truncatedDesc);
    }
  });

  appendDebugLog('bash.bg', 'started', {
    traceId,
    bashId,
    command: normalizedCommand,
    cwd: resolvedCwd,
    pid: record.pid,
    description: record.description,
  });

  return {
    success: true,
    data: {
      bashId,
      pid: record.pid,
      cwd: resolvedCwd,
      command: normalizedCommand,
      startedAt: record.startedAt,
      description: record.description,
    },
  };
}

function readBackgroundBashOutput(options = {}) {
  const bashId = String(options?.bashId || '').trim();
  if (!bashId) {
    return { success: false, error: 'bashId 不能为空' };
  }
  const record = activeBashProcesses.get(bashId);
  if (!record) {
    return { success: false, error: `bashId 不存在或已清理：${bashId}` };
  }

  const filterRaw = typeof options?.filter === 'string' ? options.filter.trim() : '';
  let filterRegex = null;
  if (filterRaw) {
    try {
      filterRegex = new RegExp(filterRaw);
    } catch (error) {
      return { success: false, error: `filter 不是合法正则：${safeErrorMessage(error)}` };
    }
  }

  const newChunks = record.output.slice(record.cursor);
  record.cursor = record.output.length;

  let stdout = '';
  let stderr = '';
  for (const chunk of newChunks) {
    const text = filterRegex
      ? chunk.text
          .split(/\r?\n/)
          .filter((line) => filterRegex.test(line))
          .join('\n')
      : chunk.text;
    if (!text) continue;
    if (chunk.channel === 'stdout') {
      stdout += text;
      if (filterRegex && !stdout.endsWith('\n')) stdout += '\n';
    } else {
      stderr += text;
      if (filterRegex && !stderr.endsWith('\n')) stderr += '\n';
    }
  }

  const trimmedStdout = trimBashOutput(stdout, 'stdout');
  const trimmedStderr = trimBashOutput(stderr, 'stderr');

  return {
    success: true,
    data: {
      bashId,
      status: record.status,
      exitCode: record.exitCode,
      signal: record.signal,
      pid: record.pid,
      command: record.command,
      cwd: record.cwd,
      stdout: trimmedStdout.text,
      stderr: trimmedStderr.text,
      stdoutTruncated: trimmedStdout.truncated,
      stderrTruncated: trimmedStderr.truncated,
      stdoutOriginalBytes: trimmedStdout.originalBytes,
      stderrOriginalBytes: trimmedStderr.originalBytes,
      stdoutOriginalLines: trimmedStdout.originalLines,
      stderrOriginalLines: trimmedStderr.originalLines,
      newChunks: newChunks.length,
      droppedCount: record.droppedCount,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      durationMs: (record.endedAt || Date.now()) - record.startedAt,
    },
  };
}

function killBackgroundBash(options = {}) {
  const bashId = String(options?.bashId || '').trim();
  if (!bashId) {
    return { success: false, error: 'bashId 不能为空' };
  }
  const record = activeBashProcesses.get(bashId);
  if (!record) {
    return { success: false, error: `bashId 不存在：${bashId}` };
  }

  if (record.status !== 'running') {
    return {
      success: true,
      data: {
        bashId,
        status: record.status,
        exitCode: record.exitCode,
        signal: record.signal,
        alreadyStopped: true,
      },
    };
  }

  try {
    record.proc.kill('SIGTERM');
  } catch (error) {
    appendDebugLog('bash.bg', 'kill_error', { bashId, message: safeErrorMessage(error) }, 'error');
  }
  setTimeout(() => {
    if (record.status === 'running') {
      try {
        record.proc.kill('SIGKILL');
      } catch {
        // best effort
      }
    }
  }, 500);
  record.status = 'killed';
  record.endedAt = Date.now();
  appendDebugLog('bash.bg', 'kill_requested', { bashId, pid: record.pid });
  return {
    success: true,
    data: {
      bashId,
      status: record.status,
      pid: record.pid,
    },
  };
}

function listBackgroundBashes() {
  const items = [];
  for (const [, record] of activeBashProcesses.entries()) {
    items.push({
      bashId: record.bashId,
      status: record.status,
      command: record.command,
      description: record.description,
      pid: record.pid,
      cwd: record.cwd,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      exitCode: record.exitCode,
      signal: record.signal,
      bufferedBytes: record.totalBytes,
      droppedCount: record.droppedCount,
    });
  }
  return { success: true, data: { shells: items } };
}

function sanitizeContextKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
}

function snapshotDirFor(sessionId, messageId) {
  const sessionKey = sanitizeContextKey(sessionId) || 'default';
  const messageKey = sanitizeContextKey(messageId);
  if (!messageKey) {
    return '';
  }
  return path.join(SNAPSHOT_ROOT, `${sessionKey}__${messageKey}`);
}

function encodeSnapshotSlot(filePath) {
  return Buffer.from(String(filePath), 'utf-8').toString('base64url').slice(0, 180);
}

function readSnapshotMeta(dir) {
  const metaPath = path.join(dir, '__meta.json');
  if (!fs.existsSync(metaPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSnapshotMeta(dir, entries) {
  const metaPath = path.join(dir, '__meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(entries, null, 2), 'utf-8');
}

function snapshotFileBefore(context, targetFilePath) {
  const sessionId = context?.sessionId;
  const messageId = context?.messageId ?? context?.userMessageId;
  const dir = snapshotDirFor(sessionId, messageId);
  if (!dir || !targetFilePath) {
    return { success: false, error: 'snapshot context 不完整' };
  }
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entries = readSnapshotMeta(dir);
    if (entries.some((item) => item && item.filePath === targetFilePath)) {
      return { success: true, data: { skipped: true, reason: 'already_snapshotted' } };
    }

    const slotName = `${entries.length}_${encodeSnapshotSlot(targetFilePath)}`;
    const existedBefore = fs.existsSync(targetFilePath);
    let savedBytes = 0;
    let isDirectory = false;
    if (existedBefore) {
      const stats = fs.statSync(targetFilePath);
      if (stats.isDirectory()) {
        isDirectory = true;
        fs.cpSync(targetFilePath, path.join(dir, slotName), { recursive: true });
      } else {
        fs.copyFileSync(targetFilePath, path.join(dir, slotName));
        savedBytes = stats.size;
      }
    }

    entries.push({
      filePath: targetFilePath,
      slotName: existedBefore ? slotName : null,
      existedBefore,
      isDirectory,
      capturedAt: Date.now(),
      bytes: savedBytes,
    });
    writeSnapshotMeta(dir, entries);

    appendDebugLog('snapshot', 'captured', {
      sessionId,
      messageId,
      filePath: targetFilePath,
      existedBefore,
      isDirectory,
      bytes: savedBytes,
    });
    return { success: true, data: { filePath: targetFilePath, existedBefore, isDirectory } };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('snapshot', 'capture_error', {
      sessionId,
      messageId,
      filePath: targetFilePath,
      message,
    }, 'error');
    return { success: false, error: message };
  }
}

function restoreFileSnapshots(sessionId, messageId) {
  const dir = snapshotDirFor(sessionId, messageId);
  if (!dir || !fs.existsSync(dir)) {
    return { success: true, data: { entries: [], total: 0, restored: 0, deleted: 0, failed: 0 } };
  }

  const entries = readSnapshotMeta(dir);
  const results = [];
  let restored = 0;
  let deleted = 0;
  let failed = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || !entry.filePath) {
      continue;
    }
    try {
      if (entry.existedBefore && entry.slotName) {
        const slotPath = path.join(dir, entry.slotName);
        if (!fs.existsSync(slotPath)) {
          failed += 1;
          results.push({ filePath: entry.filePath, action: 'failed', error: 'snapshot_missing' });
          continue;
        }
        const parentDir = path.dirname(entry.filePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        if (entry.isDirectory) {
          if (fs.existsSync(entry.filePath)) {
            fs.rmSync(entry.filePath, { recursive: true, force: true });
          }
          fs.cpSync(slotPath, entry.filePath, { recursive: true });
        } else {
          fs.copyFileSync(slotPath, entry.filePath);
        }
        restored += 1;
        results.push({ filePath: entry.filePath, action: 'restored' });
      } else {
        if (fs.existsSync(entry.filePath)) {
          const stats = fs.statSync(entry.filePath);
          if (stats.isDirectory()) {
            fs.rmSync(entry.filePath, { recursive: true, force: true });
            deleted += 1;
            results.push({ filePath: entry.filePath, action: 'deleted' });
          } else if (stats.isFile()) {
            fs.unlinkSync(entry.filePath);
            deleted += 1;
            results.push({ filePath: entry.filePath, action: 'deleted' });
          } else {
            results.push({ filePath: entry.filePath, action: 'skipped', reason: 'not_a_file_or_directory' });
          }
        } else {
          results.push({ filePath: entry.filePath, action: 'skipped', reason: 'already_absent' });
        }
      }
    } catch (error) {
      failed += 1;
      results.push({ filePath: entry.filePath, action: 'failed', error: safeErrorMessage(error) });
    }
  }

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }

  appendDebugLog('snapshot', 'restored', {
    sessionId,
    messageId,
    total: entries.length,
    restored,
    deleted,
    failed,
  });

  return {
    success: failed === 0,
    data: {
      entries: results,
      total: entries.length,
      restored,
      deleted,
      failed,
    },
  };
}

function listSnapshotsForSession(sessionId) {
  if (!fs.existsSync(SNAPSHOT_ROOT)) {
    return { success: true, data: { messageIds: [] } };
  }
  const sessionKey = sanitizeContextKey(sessionId) || 'default';
  const prefix = `${sessionKey}__`;
  try {
    const items = fs.readdirSync(SNAPSHOT_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name.slice(prefix.length));
    return { success: true, data: { messageIds: items } };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function clearSnapshotsForSession(sessionId) {
  if (!fs.existsSync(SNAPSHOT_ROOT)) {
    return { success: true, data: { cleared: 0 } };
  }
  const sessionKey = sanitizeContextKey(sessionId) || 'default';
  const prefix = `${sessionKey}__`;
  let cleared = 0;
  try {
    const items = fs.readdirSync(SNAPSHOT_ROOT, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory() || !item.name.startsWith(prefix)) {
        continue;
      }
      fs.rmSync(path.join(SNAPSHOT_ROOT, item.name), { recursive: true, force: true });
      cleared += 1;
    }
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
  appendDebugLog('snapshot', 'cleared_session', { sessionId, cleared });
  return { success: true, data: { cleared } };
}

function clearSnapshotForMessage(sessionId, messageId) {
  const dir = snapshotDirFor(sessionId, messageId);
  if (!dir || !fs.existsSync(dir)) {
    return { success: true, data: { cleared: false } };
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { success: true, data: { cleared: true } };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function statLocalPath(inputPath) {
  try {
    const targetPath = resolveLocalPath(inputPath, 'path');
    if (!fs.existsSync(targetPath)) {
      return { success: true, data: { exists: false, path: targetPath } };
    }
    const stats = fs.statSync(targetPath);
    return {
      success: true,
      data: {
        exists: true,
        path: targetPath,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        modifiedAt: stats.mtimeMs,
      },
    };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function guessImageMimeFromExtension(extension) {
  const normalized = String(extension || '').toLowerCase();
  const withDot = normalized.startsWith('.') ? normalized : `.${normalized}`;
  return IMAGE_MIME_BY_EXT[withDot] || 'image/png';
}

function guessImageExtensionFromMime(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  for (const [ext, mime] of Object.entries(IMAGE_MIME_BY_EXT)) {
    if (mime === normalized) {
      return ext;
    }
  }
  return '.png';
}

function saveClipboardImage(dataUrl, preferredExtension) {
  try {
    const raw = String(dataUrl || '').trim();
    if (!raw) {
      throw new Error('dataUrl 不能为空');
    }
    const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) {
      throw new Error('仅支持 base64 dataUrl');
    }
    const mime = match[1];
    const base64 = match[2];
    const ext = preferredExtension
      ? (String(preferredExtension).startsWith('.') ? String(preferredExtension) : `.${preferredExtension}`)
      : guessImageExtensionFromMime(mime);
    if (!fs.existsSync(UPLOAD_ROOT)) {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    }
    const fileName = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const targetPath = path.join(UPLOAD_ROOT, fileName);
    fs.writeFileSync(targetPath, Buffer.from(base64, 'base64'));
    return {
      success: true,
      data: {
        path: targetPath,
        name: fileName,
        mime,
        size: Buffer.byteLength(base64, 'base64'),
      },
    };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function sanitizeUploadFileName(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  return raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 160);
}

function saveUploadedFile(options = {}) {
  try {
    const dataUrl = String(options?.dataUrl || '').trim();
    if (!dataUrl) {
      throw new Error('dataUrl 不能为空');
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) {
      throw new Error('仅支持 base64 dataUrl');
    }
    const mime = match[1];
    const base64 = match[2];
    const original = sanitizeUploadFileName(options?.name);
    const ext = original && path.extname(original)
      ? ''
      : (mime.startsWith('image/') ? guessImageExtensionFromMime(mime) : '.bin');
    const baseName = original || `upload${ext}`;
    const uniquePrefix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
    if (!fs.existsSync(UPLOAD_ROOT)) {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    }
    const targetPath = path.join(UPLOAD_ROOT, `${uniquePrefix}${baseName}`);
    fs.writeFileSync(targetPath, Buffer.from(base64, 'base64'));
    return {
      success: true,
      data: {
        path: targetPath,
        name: baseName,
        mime,
        size: Buffer.byteLength(base64, 'base64'),
      },
    };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function readFileAsDataURL(filePath) {
  try {
    const targetPath = resolveLocalPath(filePath, 'filePath');
    if (!fs.existsSync(targetPath)) {
      return { success: false, error: '文件不存在' };
    }
    const stats = fs.statSync(targetPath);
    if (!stats.isFile()) {
      return { success: false, error: '目标不是文件' };
    }
    if (stats.size > 12 * 1024 * 1024) {
      return { success: false, error: '文件过大（> 12MB），无法转换为 dataURL' };
    }
    const extension = path.extname(targetPath).toLowerCase();
    const mimeType = guessImageMimeFromExtension(extension);
    const buffer = fs.readFileSync(targetPath);
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    return {
      success: true,
      data: {
        path: targetPath,
        dataUrl,
        mimeType,
        size: stats.size,
      },
    };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function cleanupStaleUploads(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    if (!fs.existsSync(UPLOAD_ROOT)) {
      return { success: true, data: { removed: 0 } };
    }
    const now = Date.now();
    let removed = 0;
    const items = fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true });
    for (const item of items) {
      if (!item.isFile()) {
        continue;
      }
      const fullPath = path.join(UPLOAD_ROOT, item.name);
      try {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          removed += 1;
        }
      } catch {
        // ignore
      }
    }
    return { success: true, data: { removed } };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function setWorkspaceRoot(targetPath) {
  try {
    // If path is empty or undefined, use the default workspace root
    var resolved = targetPath ? resolveLocalPath(targetPath, 'path') : DEFAULT_WORKSPACE_ROOT;
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      throw new Error('目标不是目录');
    }
    process.chdir(resolved);
    appendDebugLog('workspace', 'changed', { cwd: process.cwd(), source: targetPath ? 'user' : 'default' });
    return { success: true, data: { cwd: process.cwd() } };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('workspace', 'change_error', { targetPath, message }, 'error');
    return { success: false, error: message };
  }
}

function getWorkspaceRoot() {
  try {
    var current = process.cwd();
    // Ensure workspace exists
    if (!fs.existsSync(current)) {
      process.chdir(DEFAULT_WORKSPACE_ROOT);
      current = DEFAULT_WORKSPACE_ROOT;
    }
    return { success: true, data: { cwd: current } };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

function generateCellId() {
  return `cell_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function editNotebookCells(options = {}) {
  const traceId = createTraceId('notebook_edit');
  const startAt = now();
  let targetPath = '';
  try {
    const notebookPath = options?.notebookPath ?? options?.filePath ?? options?.path;
    targetPath = resolveLocalPath(notebookPath, 'notebookPath');
    if (!fs.existsSync(targetPath)) {
      throw new Error('notebook 文件不存在');
    }
    if (path.extname(targetPath).toLowerCase() !== '.ipynb') {
      throw new Error('目标不是 .ipynb 文件');
    }

    const context = options?.__context || null;
    if (context) {
      snapshotFileBefore(context, targetPath);
    }

    const editMode = ['replace', 'insert', 'delete'].includes(options?.editMode)
      ? options.editMode
      : 'replace';
    const cellId = options?.cellId != null ? String(options.cellId) : '';
    const newSource = typeof options?.newSource === 'string' ? options.newSource : '';
    const cellType = options?.cellType === 'markdown' ? 'markdown' : options?.cellType === 'code' ? 'code' : null;

    const raw = fs.readFileSync(targetPath, 'utf-8');
    let notebook;
    try {
      notebook = JSON.parse(raw);
    } catch (error) {
      throw new Error(`解析 notebook 失败：${safeErrorMessage(error)}`);
    }
    if (!notebook || typeof notebook !== 'object') {
      throw new Error('notebook 内容无效');
    }
    notebook.cells = Array.isArray(notebook.cells) ? notebook.cells : [];

    const findIndex = (id) => {
      if (!id) return -1;
      const byId = notebook.cells.findIndex((cell) => String(cell?.id ?? '') === id);
      if (byId !== -1) return byId;
      const asIndex = Number.parseInt(id, 10);
      if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < notebook.cells.length) {
        return asIndex;
      }
      return -1;
    };

    let affectedCellId = '';

    if (editMode === 'replace') {
      const index = findIndex(cellId);
      if (index === -1) {
        throw new Error(`找不到 cellId=${cellId} 的 cell`);
      }
      const cell = notebook.cells[index];
      if (cellType) {
        cell.cell_type = cellType;
      }
      cell.source = newSource.split(/(?<=\n)/);
      if (cell.cell_type === 'code' && !Array.isArray(cell.outputs)) {
        cell.outputs = [];
      }
      if (cell.cell_type === 'code' && cell.execution_count === undefined) {
        cell.execution_count = null;
      }
      if (!cell.metadata) cell.metadata = {};
      affectedCellId = String(cell.id ?? '');
    } else if (editMode === 'insert') {
      if (!cellType) {
        throw new Error('insert 模式必须指定 cellType (code | markdown)');
      }
      const newCell = {
        id: generateCellId(),
        cell_type: cellType,
        source: newSource.split(/(?<=\n)/),
        metadata: {},
      };
      if (cellType === 'code') {
        newCell.outputs = [];
        newCell.execution_count = null;
      }
      if (!cellId) {
        notebook.cells.unshift(newCell);
      } else {
        const index = findIndex(cellId);
        if (index === -1) {
          throw new Error(`找不到 cellId=${cellId} 的 cell`);
        }
        notebook.cells.splice(index + 1, 0, newCell);
      }
      affectedCellId = newCell.id;
    } else if (editMode === 'delete') {
      const index = findIndex(cellId);
      if (index === -1) {
        throw new Error(`找不到 cellId=${cellId} 的 cell`);
      }
      const removed = notebook.cells.splice(index, 1)[0];
      affectedCellId = String(removed?.id ?? cellId);
    }

    fs.writeFileSync(targetPath, JSON.stringify(notebook, null, 2), 'utf-8');
    const afterRaw = fs.readFileSync(targetPath, 'utf-8');
    const diff = buildToolDiffMeta(targetPath, raw, afterRaw);

    appendDebugLog('notebook.edit', 'success', {
      traceId,
      durationMs: now() - startAt,
      notebookPath: targetPath,
      editMode,
      cellId: cellId || null,
      cellType: cellType || null,
      affectedCellId,
      totalCells: notebook.cells.length,
      addedLines: diff?.addedLines ?? 0,
      removedLines: diff?.removedLines ?? 0,
    });

    return {
      success: true,
      data: {
        notebookPath: targetPath,
        filePath: targetPath,
        editMode,
        affectedCellId,
        totalCells: notebook.cells.length,
        diff,
      },
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    appendDebugLog('notebook.edit', 'error', {
      traceId,
      durationMs: now() - startAt,
      notebookPath: targetPath,
      message,
    }, 'error');
    return { success: false, error: message };
  }
}

function runTodoWrite(options = {}) {
  const traceId = createTraceId('todo_write');
  try {
    const raw = Array.isArray(options?.todos) ? options.todos : [];
    if (!raw.length) {
      return {
        success: true,
        data: {
          todos: [],
          updatedAt: Date.now(),
          summary: { pending: 0, in_progress: 0, completed: 0 },
        },
      };
    }
    const normalized = [];
    let inProgressCount = 0;
    const summary = { pending: 0, in_progress: 0, completed: 0 };
    for (const item of raw) {
      const content = String(item?.content ?? '').trim();
      const activeForm = String(item?.activeForm ?? item?.active_form ?? '').trim();
      const status = ['pending', 'in_progress', 'completed'].includes(item?.status)
        ? item.status
        : 'pending';
      if (!content) continue;
      if (status === 'in_progress') inProgressCount += 1;
      summary[status] += 1;
      normalized.push({
        content,
        activeForm: activeForm || content,
        status,
      });
    }
    if (inProgressCount > 1) {
      return {
        success: false,
        error: '同一时间只能有一个 in_progress 任务，请先把其他在途任务标记为 pending 或 completed。',
      };
    }
    appendDebugLog('todo', 'updated', {
      traceId,
      total: normalized.length,
      summary,
    });
    return {
      success: true,
      data: {
        todos: normalized,
        updatedAt: Date.now(),
        summary,
      },
    };
  } catch (error) {
    return { success: false, error: safeErrorMessage(error) };
  }
}

const SYSTEM_DIR_HINTS = [
  /\\system32(\\|$)/i,
  /\\syswow64(\\|$)/i,
  /\\windows(\\|$)/i,
  /\\program files(?: \(x86\))?(\\|$)/i,
];

function looksLikeSystemCwd(cwd) {
  if (!cwd) return false;
  const normalized = String(cwd);
  if (normalized === '/' || normalized === '\\') return true;
  if (/^[a-z]:\\?$/i.test(normalized)) return true; // C:\ / D:\ 等裸盘符
  if (normalized === '/usr/bin' || normalized === '/sbin' || normalized === '/bin') return true;
  return SYSTEM_DIR_HINTS.some((pattern) => pattern.test(normalized));
}

function normalizeInitialWorkingDirectory() {
  try {
    const originalCwd = process.cwd();
    if (!looksLikeSystemCwd(originalCwd)) return;
    const home = os.homedir();
    if (!home || !fs.existsSync(home)) return;
    process.chdir(home);
    appendDebugLog('workspace', 'auto_chdir_from_system', {
      from: originalCwd,
      to: home,
      reason: 'preload 启动时检测到 cwd 位于系统目录，自动切到用户目录避免误操作',
    });
  } catch (error) {
    appendDebugLog('workspace', 'auto_chdir_failed', {
      message: safeErrorMessage(error),
    }, 'error');
  }
}

normalizeInitialWorkingDirectory();

// ============================================================
// Bash Notification - Windows native toast notifications
// ============================================================
let bashNotificationEnabled = false;

function showWindowsNotification(title, body) {
  if (process.platform !== 'win32') return;
  const escapedTitle = String(title || 'Kuke Agent').replace(/'/g, "''");
  const escapedBody = String(body || '').replace(/'/g, "''");
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms;
    $notify = New-Object System.Windows.Forms.NotifyIcon;
    $notify.Icon = [System.Drawing.SystemIcons]::Information;
    $notify.Visible = $true;
    $notify.ShowBalloonTip(5000, '${escapedTitle}', '${escapedBody}', 'Info');
    Start-Sleep -Seconds 6;
    $notify.Dispose()
  `;
  try {
    spawn('powershell.exe', ['-Command', psScript], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch (e) {
    appendDebugLog('notification', 'windows_error', { message: safeErrorMessage(e) }, 'error');
  }
}

// ============================================================
// BackgroundTaskManager - persists tasks that survive window close
// ============================================================
const BACKGROUND_TASKS_FILE = path.join(os.homedir(), '.kukeagent', 'background_tasks.json');
const BACKGROUND_TASKS_DIR = path.join(os.homedir(), '.kukeagent');

function ensureBackgroundTasksDir() {
  try {
    if (!fs.existsSync(BACKGROUND_TASKS_DIR)) {
      fs.mkdirSync(BACKGROUND_TASKS_DIR, { recursive: true });
    }
  } catch {}
}

function loadBackgroundTasks() {
  ensureBackgroundTasksDir();
  try {
    if (fs.existsSync(BACKGROUND_TASKS_FILE)) {
      const data = fs.readFileSync(BACKGROUND_TASKS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveBackgroundTasks(tasks) {
  ensureBackgroundTasksDir();
  try {
    fs.writeFileSync(BACKGROUND_TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch (error) {
    appendDebugLog('bg_task', 'save_error', { message: safeErrorMessage(error) }, 'error');
  }
}

const BackgroundTaskManager = {
  _tasks: null,
  _listeners: new Set(),

  _load() {
    if (this._tasks === null) {
      this._tasks = loadBackgroundTasks();
    }
    return this._tasks;
  },

  _persist() {
    saveBackgroundTasks(this._tasks);
  },

  _notifyChange() {
    for (const listener of this._listeners) {
      try { listener(this._tasks); } catch {}
    }
  },

  onChange(listener) {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  },

  addTask(options = {}) {
    const tasks = this._load();
    const taskId = `btask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task = {
      id: taskId,
      title: String(options.title || options.name || '后台任务'),
      description: String(options.description || ''),
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      progress: null,
    };
    tasks.push(task);
    this._persist();
    this._notifyChange();
    appendDebugLog('bg_task', 'added', { taskId, title: task.title });
    return { success: true, data: { taskId, task } };
  },

  updateTask(taskId, updates = {}) {
    const tasks = this._load();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return { success: false, error: '任务不存在' };
    const task = tasks[idx];
    if (updates.status) task.status = updates.status;
    if (updates.progress != null) task.progress = updates.progress;
    if (updates.result != null) task.result = updates.result;
    if (updates.error != null) task.error = updates.error;
    if (updates.status === 'running' && !task.startedAt) task.startedAt = Date.now();
    if (updates.status === 'completed' || updates.status === 'failed') task.completedAt = Date.now();
    this._persist();
    this._notifyChange();
    appendDebugLog('bg_task', 'updated', { taskId, updates: Object.keys(updates) });
    return { success: true, data: { task } };
  },

  getTask(taskId) {
    const tasks = this._load();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { success: false, error: '任务不存在' };
    return { success: true, data: task };
  },

  listTasks() {
    return { success: true, data: this._load() };
  },

  removeTask(taskId) {
    const tasks = this._load();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return { success: false, error: '任务不存在' };
    tasks.splice(idx, 1);
    this._persist();
    this._notifyChange();
    appendDebugLog('bg_task', 'removed', { taskId });
    return { success: true };
  },

  clearCompleted() {
    const tasks = this._load();
    const before = tasks.length;
    const remaining = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
    this._tasks = remaining;
    this._persist();
    this._notifyChange();
    appendDebugLog('bg_task', 'cleared_completed', { removed: before - remaining.length });
    return { success: true, data: { removed: before - remaining.length } };
  },
};

// ============================================================
// NotificationManager - system notifications via ZTools API
// ============================================================
const NOTIFICATIONS_FILE = path.join(os.homedir(), '.kukeagent', 'notifications.json');

function ensureNotificationsDir() {
  try {
    if (!fs.existsSync(BACKGROUND_TASKS_DIR)) {
      fs.mkdirSync(BACKGROUND_TASKS_DIR, { recursive: true });
    }
  } catch {}
}

function loadNotifications() {
  ensureNotificationsDir();
  try {
    if (fs.existsSync(NOTIFICATIONS_FILE)) {
      const data = fs.readFileSync(NOTIFICATIONS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveNotifications(notifications) {
  ensureNotificationsDir();
  try {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2), 'utf-8');
  } catch (error) {
    appendDebugLog('notification', 'save_error', { message: safeErrorMessage(error) }, 'error');
  }
}

const NotificationManager = {
  _notifications: null,
  _listeners: new Set(),
  _ztoolsNotify: null,

  _load() {
    if (this._notifications === null) {
      this._notifications = loadNotifications();
    }
    return this._notifications;
  },

  _persist() {
    saveNotifications(this._notifications);
  },

  _notifyChange() {
    for (const listener of this._listeners) {
      try { listener(this._notifications); } catch {}
    }
  },

  onChange(listener) {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  },

  _getZToolsNotify() {
    if (this._ztoolsNotify === null) {
      if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.notify === 'function') {
        this._ztoolsNotify = window.ztools.notify.bind(window.ztools);
      } else {
        this._ztoolsNotify = false;
      }
    }
    return this._ztoolsNotify;
  },

  notify(options = {}) {
    const title = String(options.title || options.subject || 'Kuke Agent');
    const body = String(options.body || options.message || '');
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const notification = {
      id: notifId,
      title,
      body,
      type: options.type || 'info',
      read: false,
      createdAt: Date.now(),
    };

    const notifications = this._load();
    notifications.unshift(notification);
    if (notifications.length > 200) {
      notifications.splice(200);
    }
    this._persist();
    this._notifyChange();

    const ztoolsNotify = this._getZToolsNotify();
    if (ztoolsNotify) {
      try {
        ztoolsNotify({ title, body });
      } catch (error) {
        appendDebugLog('notification', 'ztools_error', { message: safeErrorMessage(error) }, 'error');
      }
    }

    if (bashNotificationEnabled) {
      showWindowsNotification(title, body);
    }

    appendDebugLog('notification', 'sent', { notifId, title, hasNative: !!ztoolsNotify, hasWindows: bashNotificationEnabled });
    return { success: true, data: { notifId, notification } };
  },

  listNotifications(options = {}) {
    const notifications = this._load();
    const unreadOnly = Boolean(options?.unreadOnly);
    const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200);
    let filtered = notifications;
    if (unreadOnly) {
      filtered = filtered.filter(n => !n.read);
    }
    return { success: true, data: filtered.slice(0, limit) };
  },

  markRead(notifId) {
    const notifications = this._load();
    const notif = notifications.find(n => n.id === notifId);
    if (!notif) return { success: false, error: '通知不存在' };
    notif.read = true;
    this._persist();
    this._notifyChange();
    return { success: true };
  },

  markAllRead() {
    const notifications = this._load();
    for (const n of notifications) { n.read = true; }
    this._persist();
    this._notifyChange();
    return { success: true };
  },

  removeNotification(notifId) {
    const notifications = this._load();
    const idx = notifications.findIndex(n => n.id === notifId);
    if (idx === -1) return { success: false, error: '通知不存在' };
    notifications.splice(idx, 1);
    this._persist();
    this._notifyChange();
    return { success: true };
  },

  clearAll() {
    this._notifications = [];
    this._persist();
    this._notifyChange();
    return { success: true };
  },

  getUnreadCount() {
    const notifications = this._load();
    return { success: true, data: { count: notifications.filter(n => !n.read).length } };
  },
};

let pendingLaunchPayload = null;
const launchPayloadSubscribers = new Set();

const notifyLaunchPayload = (payload) => {
  if (!payload || typeof payload !== 'string' || !payload.trim()) {
    return;
  }
  const value = payload.trim();
  if (launchPayloadSubscribers.size === 0) {
    pendingLaunchPayload = value;
    return;
  }
  for (const callback of launchPayloadSubscribers) {
    try {
      callback(value);
    } catch (error) {
      appendDebugLog('launch', 'subscriber_error', {
        message: safeErrorMessage(error),
      }, 'error');
    }
  }
};

if (typeof window !== 'undefined' && window.ztools) {
  window.ztools.onMainPush(
    (queryData) => {
      const query = typeof queryData === 'string' ? queryData : (queryData?.payload ?? '');
      if (!query || typeof query !== 'string' || !query.trim()) {
        return [];
      }
      return [
        {
          label: 'Kuke AI Agent',
          description: `向 Kuke Agent 提问：${query.slice(0, 60)}${query.length > 60 ? '...' : ''}`,
          icon: 'bot',
          data: { query: query.trim() },
        },
      ];
    },
    (selectData) => {
      if (selectData?.data?.query) {
        notifyLaunchPayload(selectData.data.query);
      }
      return true;
    }
  );

  window.ztools.onPluginEnter((param) => {
    if (param?.payload) {
      const raw = typeof param.payload === 'string' ? param.payload : (param.payload?.query ?? null);
      if (raw) {
        notifyLaunchPayload(raw);
      }
    }
  });
}

window.localTools = {
  getPendingLaunchPayload: () => {
    const payload = pendingLaunchPayload;
    pendingLaunchPayload = null;
    return payload;
  },

  onLaunchPayload: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    launchPayloadSubscribers.add(callback);
    if (pendingLaunchPayload) {
      const payload = pendingLaunchPayload;
      pendingLaunchPayload = null;
      try {
        callback(payload);
      } catch (error) {
        appendDebugLog('launch', 'subscriber_error', {
          message: safeErrorMessage(error),
        }, 'error');
      }
    }
    return () => {
      launchPayloadSubscribers.delete(callback);
    };
  },

  chat: async (config, messages, tools, handlers, options = {}) => {
    const requestId = options?.requestId || createTraceId('chat_request');
    const traceId = createTraceId(`chat_${requestId}`);
    const startAt = now();
    const controller = new AbortController();
    activeChatControllers.set(requestId, controller);
    try {
      const response = await createChatResponse(
        config,
        messages,
        tools,
        handlers,
        traceId,
        controller.signal,
      );
      appendDebugLog('chat', 'success', { traceId, requestId, durationMs: now() - startAt });
      return { success: true, data: response };
    } catch (error) {
      if (isAbortError(error)) {
        appendDebugLog('chat', 'aborted', { traceId, requestId, durationMs: now() - startAt });
        return { success: false, aborted: true, error: '请求已中断' };
      }
      const message = safeErrorMessage(error);
      appendDebugLog('chat', 'error', { traceId, requestId, durationMs: now() - startAt, message }, 'error');
      return { success: false, error: message };
    } finally {
      activeChatControllers.delete(requestId);
    }
  },

  cancelChat: (requestId) => {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) {
      return { success: false, error: 'requestId 不能为空' };
    }
    const controller = activeChatControllers.get(normalizedRequestId);
    if (!controller) {
      return { success: true, aborted: false };
    }
    controller.abort();
    activeChatControllers.delete(normalizedRequestId);
    appendDebugLog('chat', 'cancel_requested', { requestId: normalizedRequestId });
    return { success: true, aborted: true };
  },

  getModels: async (config) => {
    const traceId = createTraceId('models');
    const startAt = now();
    const providerType = config?.providerType || 'openai';

    if (providerType === 'anthropic') {
      // Latest Claude 4 models + legacy Claude 3.5/3 models
      const models = [
        // Claude 4 models (latest)
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5-20251001',
        // Legacy Claude 3.5/3 models
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241017',
        'claude-3-opus-20240229',
      ];
      appendDebugLog('models', 'success', {
        traceId,
        providerType,
        durationMs: now() - startAt,
        total: models.length,
      });
      return { success: true, data: models.map(id => ({ id })) };
    }

    try {
      const openai = createOpenAIClient(config);
      const response = await openai.models.list();
      appendDebugLog('models', 'success', {
        traceId,
        durationMs: now() - startAt,
        total: Array.isArray(response?.data) ? response.data.length : 0,
      });
      return { success: true, data: response.data };
    } catch (error) {
      const message = safeErrorMessage(error);
      appendDebugLog('models', 'error', { traceId, durationMs: now() - startAt, message }, 'error');
      return { success: false, error: message };
    }
  },

  BashTool: (optionsOrCommand, maybeCwd) => {
    if (typeof optionsOrCommand === 'string') {
      return executeShellCommand(optionsOrCommand, maybeCwd);
    }
    const opts = optionsOrCommand || {};
    const command = String(opts.command ?? '');
    const cwd = opts.cwd ? String(opts.cwd) : undefined;
    const description = typeof opts.description === 'string' ? opts.description : '';
    const runInBackground = Boolean(opts.runInBackground);
    const timeoutMs = opts.timeout != null ? Number(opts.timeout) : undefined;
    if (runInBackground) {
      return startBackgroundBash(command, cwd, { description });
    }
    return executeShellCommand(command, cwd, { timeoutMs, description });
  },

  BashOutputTool: (options) => readBackgroundBashOutput(options || {}),
  KillShellTool: (options) => killBackgroundBash(options || {}),
  listBackgroundBashes: () => listBackgroundBashes(),

  NotebookEditTool: (options) => editNotebookCells(options || {}),
  TodoWriteTool: (options) => runTodoWrite(options || {}),

  WebFetchTool: async (optionsOrUrl) => {
    const traceId = createTraceId('web_fetch');
    const startAt = now();
    const opts = typeof optionsOrUrl === 'string' ? { url: optionsOrUrl } : (optionsOrUrl || {});
    const rawUrl = opts.url;
    const prompt = String(opts.prompt ?? '').trim();
    const llmConfig = opts.llmConfig || null;
    let normalizedUrl = '';
    try {
      normalizedUrl = normalizeHttpUrl(rawUrl);
      const parsedUrl = new URL(normalizedUrl);
      const hostname = parsedUrl.hostname.toLowerCase();
      const isPrivateIpv4 = /^10\./.test(hostname)
        || /^127\./.test(hostname)
        || /^192\.168\./.test(hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
        || /^169\.254\./.test(hostname);
      const isLocalHost = hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1' || hostname === '[::1]';
      if (isLocalHost || isPrivateIpv4 || hostname.endsWith('.local')) {
        throw new Error('禁止访问本地或内网地址');
      }
      const { response } = await fetchWithFallback([normalizedUrl], {
        redirect: 'follow',
        headers: {
          'user-agent': 'KukeAgent/1.0',
        },
      });
      const rawText = await response.text();
      const contentType = response.headers.get('content-type') || 'unknown';
      const plainText = contentType.includes('html') ? htmlToPlainText(rawText) : rawText;
      const { text, truncated } = truncateText(plainText, 50000);

      let analysis = null;
      let analysisError = null;
      if (prompt && llmConfig && llmConfig.apiKey && llmConfig.model) {
        try {
          const analysisClient = createOpenAIClient(llmConfig);
          const analysisController = new AbortController();
          const timeoutHandle = setTimeout(() => analysisController.abort(), 45_000);
          try {
            const analysisResponse = await analysisClient.chat.completions.create(
              {
                model: llmConfig.model,
                messages: [
                  {
                    role: 'system',
                    content: '你是网页摘要助手。根据用户 prompt 从给定网页内容中抽取关键信息，如果 prompt 是提问请直接回答。回答要精准、结构清晰，避免复述整个页面。',
                  },
                  {
                    role: 'user',
                    content: `网页 URL: ${response.url || normalizedUrl}\n\n网页正文（已做纯文本提取，可能截断）:\n${text}\n\n用户 prompt: ${prompt}`,
                  },
                ],
                stream: false,
              },
              { signal: analysisController.signal },
            );
            analysis = analysisResponse.choices?.[0]?.message?.content || '';
          } finally {
            clearTimeout(timeoutHandle);
          }
        } catch (error) {
          analysisError = safeErrorMessage(error);
        }
      } else if (prompt && (!llmConfig || !llmConfig.apiKey || !llmConfig.model)) {
        analysisError = '缺少 LLM 配置（apiKey / model），已跳过 prompt 摘要。';
      }

      appendDebugLog('web.fetch', 'success', {
        traceId,
        durationMs: now() - startAt,
        url: normalizedUrl,
        finalUrl: response.url,
        status: response.status,
        contentType,
        truncated,
        analyzed: Boolean(analysis),
        analysisError,
      });
      return {
        success: true,
        data: {
          url: response.url || normalizedUrl,
          status: response.status,
          contentType,
          content: text,
          truncated,
          prompt: prompt || null,
          analysis: analysis || null,
          analysisError: analysisError || null,
        },
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      appendDebugLog('web.fetch', 'error', {
        traceId,
        durationMs: now() - startAt,
        url: normalizedUrl || String(rawUrl || ''),
        message,
      }, 'error');
      return { success: false, error: message };
    }
  },

  WebSearchTool: async (queryOrOptions, count, apiKey) => {
    const traceId = createTraceId('web_search');
    const startAt = now();
    let normalizedQuery = '';
    let resultLimit = 5;
    let normalizedApiKey = '';
    let allowedDomains = [];
    let blockedDomains = [];
    if (typeof queryOrOptions === 'object' && queryOrOptions !== null) {
      normalizedQuery = String(queryOrOptions.query ?? '').trim();
      resultLimit = Math.min(Math.max(Number(queryOrOptions.count) || 5, 1), 10);
      normalizedApiKey = String(queryOrOptions.apiKey ?? '').trim();
      allowedDomains = Array.isArray(queryOrOptions.allowedDomains)
        ? queryOrOptions.allowedDomains.map((d) => String(d || '').trim().toLowerCase()).filter(Boolean)
        : [];
      blockedDomains = Array.isArray(queryOrOptions.blockedDomains)
        ? queryOrOptions.blockedDomains.map((d) => String(d || '').trim().toLowerCase()).filter(Boolean)
        : [];
    } else {
      normalizedQuery = String(queryOrOptions ?? '').trim();
      resultLimit = Math.min(Math.max(Number(count) || 5, 1), 10);
      normalizedApiKey = String(apiKey ?? '').trim();
    }
    if (!normalizedQuery) {
      return { success: false, error: 'query 不能为空' };
    }
    if (!normalizedApiKey) {
      return { success: false, error: '请先在设置中配置 Tavily API Key' };
    }

    try {
      const client = tavily({ apiKey: normalizedApiKey });
      const response = await client.search(normalizedQuery, {
        searchDepth: 'advanced',
        maxResults: Math.max(resultLimit, 10),
      });
      const rawResults = Array.isArray(response?.results) ? response.results : [];
      const matchHost = (hostname, pattern) => {
        if (!hostname || !pattern) return false;
        const host = hostname.toLowerCase();
        if (pattern.startsWith('*.')) {
          const tail = pattern.slice(1);
          return host === tail.slice(1) || host.endsWith(tail);
        }
        return host === pattern || host.endsWith(`.${pattern}`);
      };

      const filtered = [];
      let filteredOut = 0;
      for (const item of rawResults) {
        const urlString = String(item?.url ?? '').trim();
        if (!urlString) continue;
        let host = '';
        try {
          host = new URL(urlString).hostname.toLowerCase();
        } catch {
          host = '';
        }
        if (blockedDomains.length && blockedDomains.some((pattern) => matchHost(host, pattern))) {
          filteredOut += 1;
          continue;
        }
        if (allowedDomains.length && !allowedDomains.some((pattern) => matchHost(host, pattern))) {
          filteredOut += 1;
          continue;
        }
        filtered.push({
          rank: filtered.length + 1,
          title: compactSearchText(item?.title, 120),
          url: urlString,
          snippet: compactSearchText(item?.content, 360),
          score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
        });
        if (filtered.length >= resultLimit) break;
      }
      const answer = compactSearchText(response?.answer, 500);

      appendDebugLog('web.search', 'success', {
        traceId,
        durationMs: now() - startAt,
        query: normalizedQuery,
        requestedCount: resultLimit,
        resultCount: filtered.length,
        filteredOut,
        provider: 'tavily',
      });
      return {
        success: true,
        data: {
          query: normalizedQuery,
          provider: 'Tavily',
          answer: answer || null,
          results: filtered,
          filteredOut,
          allowedDomains,
          blockedDomains,
          responseTime: Number(response?.response_time ?? 0) || null,
          requestId: String(response?.request_id ?? ''),
        },
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      appendDebugLog('web.search', 'error', {
        traceId,
        durationMs: now() - startAt,
        query: normalizedQuery,
        message,
      }, 'error');
      return { success: false, error: message };
    }
  },

  FileReadTool: (optionsOrPath) => {
    if (typeof optionsOrPath === 'string') {
      return readFileRich({ filePath: optionsOrPath });
    }
    return readFileRich(optionsOrPath || {});
  },

  FileEditTool: (options = {}) => {
    const traceId = createTraceId('file_edit');
    const startAt = now();
    let targetPath = '';
    try {
      const filePath = options?.filePath;
      targetPath = resolveLocalPath(filePath, 'filePath');
      const context = options?.__context || null;
      if (context) {
        snapshotFileBefore(context, targetPath);
      }
      const currentContent = fs.readFileSync(targetPath, 'utf-8');
      const normalizedEdits = Array.isArray(options?.edits) && options.edits.length
        ? options.edits
        : [options];

      let nextContent = currentContent;
      const appliedEdits = [];

      for (const edit of normalizedEdits) {
        const search = edit?.oldText ?? edit?.old_string ?? edit?.search;
        if (typeof search !== 'string' || !search) {
          throw new Error('FileEditTool 需要提供 oldText / old_string / search');
        }
        const replaceValue = edit?.newText ?? edit?.new_string ?? edit?.replace ?? '';
        const replaceAll = Boolean(edit?.replaceAll);
        if (!nextContent.includes(search)) {
          throw new Error(`未找到要替换的文本: ${search.slice(0, 80)}`);
        }

        const occurrenceCount = nextContent.split(search).length - 1;
        if (!replaceAll && occurrenceCount > 1) {
          throw new Error(`替换文本命中 ${occurrenceCount} 处，请使用更精确的 oldText/search 或开启 replaceAll`);
        }
        nextContent = replaceAll
          ? nextContent.split(search).join(String(replaceValue))
          : nextContent.replace(search, String(replaceValue));

        appliedEdits.push({
          searchPreview: search.slice(0, 120),
          replaceAll,
          occurrenceCount,
        });
      }

      if (nextContent !== currentContent) {
        fs.writeFileSync(targetPath, nextContent, 'utf-8');
      }

      const diff = buildToolDiffMeta(targetPath, currentContent, nextContent);

      appendDebugLog('file.edit', 'success', {
        traceId,
        durationMs: now() - startAt,
        filePath: targetPath,
        editCount: appliedEdits.length,
        changed: nextContent !== currentContent,
        addedLines: diff?.addedLines ?? 0,
        removedLines: diff?.removedLines ?? 0,
      });
      return {
        success: true,
        data: {
          filePath: targetPath,
          changed: nextContent !== currentContent,
          appliedEdits,
          diff,
        },
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      appendDebugLog('file.edit', 'error', {
        traceId,
        durationMs: now() - startAt,
        filePath: targetPath,
        message,
      }, 'error');
      return { success: false, error: message };
    }
  },

  FileWriteTool: (filePath, content) => writeFileContent(filePath, content),

  FileDeleteTool: (options = {}) => {
    const traceId = createTraceId('file_delete');
    const startAt = now();
    let targetPath = '';
    try {
      const filePath = options?.filePath;
      targetPath = resolveLocalPath(filePath, 'filePath');
      const recursive = Boolean(options?.recursive);
      const context = options?.__context || null;
      if (!fs.existsSync(targetPath)) {
        throw new Error('目标不存在');
      }
      const stats = fs.statSync(targetPath);
      const isDirectory = stats.isDirectory();
      if (isDirectory && !recursive) {
        throw new Error('目标是目录，需要设置 recursive: true 才能删除。');
      }
      if (context) {
        snapshotFileBefore(context, targetPath);
      }
      let diff = null;
      let deletedFileCount = 0;
      let totalRemovedLines = 0;
      if (isDirectory) {
        // Walk the directory to sum removed line counts from text files.
        const stack = [targetPath];
        while (stack.length) {
          const current = stack.pop();
          let currentStats;
          try {
            currentStats = fs.statSync(current);
          } catch {
            continue;
          }
          if (currentStats.isDirectory()) {
            try {
              const entries = fs.readdirSync(current);
              for (const entry of entries) {
                stack.push(path.join(current, entry));
              }
            } catch {
              // ignore
            }
          } else if (currentStats.isFile()) {
            deletedFileCount += 1;
            if (shouldTreatAsTextFile(current)) {
              try {
                const content = fs.readFileSync(current, 'utf-8');
                totalRemovedLines += splitForDiff(content).length;
              } catch {
                // ignore
              }
            }
          }
        }
        fs.rmSync(targetPath, { recursive: true, force: true });
        diff = {
          filePath: targetPath,
          addedLines: 0,
          removedLines: totalRemovedLines,
          diffText: `@@ deleted directory (${deletedFileCount} files) @@`,
          tooLarge: deletedFileCount > 50,
          diffTruncated: false,
        };
      } else {
        let previousContent = '';
        if (shouldTreatAsTextFile(targetPath)) {
          try {
            previousContent = fs.readFileSync(targetPath, 'utf-8');
          } catch {
            previousContent = '';
          }
        }
        fs.unlinkSync(targetPath);
        diff = buildToolDiffMeta(targetPath, previousContent, '');
        deletedFileCount = 1;
      }
      appendDebugLog('file.delete', 'success', {
        traceId,
        durationMs: now() - startAt,
        filePath: targetPath,
        isDirectory,
        recursive,
        deletedFileCount,
        removedLines: diff?.removedLines ?? 0,
      });
      return {
        success: true,
        data: {
          filePath: targetPath,
          isDirectory,
          recursive,
          deletedFileCount,
          diff,
        },
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      appendDebugLog('file.delete', 'error', {
        traceId,
        durationMs: now() - startAt,
        filePath: targetPath,
        message,
      }, 'error');
      return { success: false, error: message };
    }
  },

  GlobTool: (options = {}) => {
    const traceId = createTraceId('glob');
    const startAt = now();
    try {
      const pattern = String(options?.pattern ?? '').trim();
      if (!pattern) {
        throw new Error('pattern 不能为空');
      }

      const includeDirectories = Boolean(options?.includeDirectories);
      const limit = Math.max(1, Math.min(Number(options?.limit) || 200, 5000));
      const { startPath, results } = walkEntries(options?.path || process.cwd(), {
        includeDirectories,
        maxEntries: 10000,
      });
      const matcher = globToRegExp(pattern);
      const matchRelativePath = pattern.replace(/\\/g, '/').includes('/');
      const matches = [];
      for (const entry of results) {
        if (!includeDirectories && entry.type === 'directory') {
          continue;
        }
        const candidate = matchRelativePath
          ? path.relative(startPath, entry.path).replace(/\\/g, '/')
          : path.basename(entry.path);
        if (!matcher.test(candidate)) continue;
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(entry.path).mtimeMs || 0;
        } catch {
          mtimeMs = 0;
        }
        matches.push({ path: entry.path, type: entry.type, mtimeMs });
      }
      matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const limited = matches.slice(0, limit);

      appendDebugLog('file.glob', 'success', {
        traceId,
        durationMs: now() - startAt,
        pattern,
        startPath,
        resultCount: limited.length,
        totalMatched: matches.length,
      });
      return {
        success: true,
        data: limited,
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      appendDebugLog('file.glob', 'error', {
        traceId,
        durationMs: now() - startAt,
        pattern: options?.pattern || '',
        path: options?.path || '',
        message,
      }, 'error');
      return { success: false, error: message };
    }
  },

  GrepTool: (options = {}) => runGrep(options),

  readDir: (dirPath) => listDirectory(dirPath),
  readFile: (filePath) => readFileContent(filePath),
  writeFile: (filePath, content) => writeFileContent(filePath, content),
  execCommand: (command, cwd) => executeShellCommand(command, cwd),

  snapshotFile: (context, filePath) => {
    try {
      const normalized = resolveLocalPath(filePath, 'filePath');
      return snapshotFileBefore(context || {}, normalized);
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  },
  restoreSnapshot: (options = {}) => {
    const sessionId = options?.sessionId;
    const messageId = options?.messageId ?? options?.userMessageId;
    if (!messageId) {
      return { success: false, error: 'messageId 不能为空' };
    }
    return restoreFileSnapshots(sessionId, messageId);
  },
  listSessionSnapshots: (sessionId) => listSnapshotsForSession(sessionId),
  clearSessionSnapshots: (sessionId) => clearSnapshotsForSession(sessionId),
  clearMessageSnapshot: (options = {}) => {
    const sessionId = options?.sessionId;
    const messageId = options?.messageId ?? options?.userMessageId;
    return clearSnapshotForMessage(sessionId, messageId);
  },

  statPath: (p) => statLocalPath(p),
  getPathForFile: (file) => {
    try {
      const resolved = resolveFileLocalPath(file);
      return {
        success: true,
        data: {
          path: resolved,
          hasElectronWebUtils: Boolean(electronWebUtils && typeof electronWebUtils.getPathForFile === 'function'),
        },
      };
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  },
  saveClipboardImage: (dataUrl, ext) => saveClipboardImage(dataUrl, ext),
  saveUploadedFile: (options) => saveUploadedFile(options),
  readFileAsDataURL: (filePath) => readFileAsDataURL(filePath),
  cleanupUploads: (maxAgeMs) => cleanupStaleUploads(maxAgeMs),
  setWorkspaceRoot: (p) => setWorkspaceRoot(p),
  getWorkspaceRoot: () => getWorkspaceRoot(),
  SetWorkspaceRootTool: (options = {}) => {
    const rawPath = typeof options === 'string' ? options : (options?.path ?? options?.cwd ?? options?.root);
    if (!rawPath) {
      return { success: false, error: 'path 不能为空' };
    }
    return setWorkspaceRoot(String(rawPath));
  },
  GetWorkspaceRootTool: () => getWorkspaceRoot(),

  getDebugLogs: (limit = 300) => {
    const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), MAX_DEBUG_LOGS);
    return {
      success: true,
      data: debugLogs.slice(-normalizedLimit),
    };
  },

  clearDebugLogs: () => {
    debugLogs.splice(0, debugLogs.length);
    appendDebugLog('debug', 'cleared', {}, 'info');
    return { success: true };
  },

  connectMcp: async (options) => {
    const connectPromise = (async () => {
      const url = options?.url;
      if (url) {
        const connectResult = connectMcpHttpServer(options);
        if (!connectResult.success) return connectResult;
        const initResult = await initializeMcpHttpServer(connectResult.data.serverId);
        if (!initResult.success) return initResult;
        const listResult = await listMcpHttpTools(connectResult.data.serverId);
        if (!listResult.success) return listResult;
        return { success: true, data: { ...connectResult.data, tools: listResult.data } };
      }
      const connectResult = connectMcpServer(options);
      if (!connectResult.success) return connectResult;
      const initResult = await initializeMcpServer(connectResult.data.serverId);
      if (!initResult.success) return initResult;
      const listResult = await listMcpTools(connectResult.data.serverId);
      if (!listResult.success) return listResult;
      return { success: true, data: { ...connectResult.data, tools: listResult.data } };
    })();

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('MCP连接超时（30秒）')), 30000);
    });

    return Promise.race([connectPromise, timeoutPromise]);
  },

  connectMcpAsync: (options) => {
    const url = options?.url;
    if (url) {
      const connectResult = connectMcpHttpServer(options);
      if (!connectResult.success) return connectResult;
      initializeMcpHttpServerAsync(connectResult.data.serverId);
      return { success: true, data: { serverId: connectResult.data.serverId, name: connectResult.data.name, status: 'connecting' } };
    }
    const connectResult = connectMcpServer(options);
    if (!connectResult.success) return connectResult;
    initializeMcpServerAsync(connectResult.data.serverId);
    return { success: true, data: { serverId: connectResult.data.serverId, name: connectResult.data.name, status: 'connecting' } };
  },
  disconnectMcp: (options) => {
    const serverId = String(options?.serverId ?? '').trim();
    if (!serverId) return { success: false, error: 'serverId 不能为空' };
    return disconnectMcpServer(serverId);
  },
  listMcpServers,
  listMcpTools: async (options) => {
    const serverId = String(options?.serverId ?? '').trim();
    if (!serverId) return { success: false, error: 'serverId 不能为空' };
    return listMcpTools(serverId);
  },
  callMcpTool: async (options) => {
    const serverId = String(options?.serverId ?? '').trim();
    const toolName = String(options?.toolName ?? options?.name ?? '').trim();
    const args = options?.arguments ?? options?.args ?? {};
    if (!serverId) return { success: false, error: 'serverId 不能为空' };
    if (!toolName) return { success: false, error: 'toolName 不能为空' };
    return callMcpTool(serverId, toolName, args);
  },
  readMcpServerOutput,
  getMcpServerLogs,

  discoverSkills,
  saveSkill: (options) => {
    const name = String(options?.name ?? '').trim();
    const description = String(options?.description ?? '').trim();
    const content = String(options?.content ?? '');
    if (!name) return { success: false, error: 'name 不能为空' };
    if (!description) return { success: false, error: 'description 不能为空' };
    return saveSkill(name, description, content);
  },
  saveSkillFromContent: (options) => {
    const content = String(options?.content ?? '');
    const fileName = String(options?.fileName ?? '').trim();
    if (!content) return { success: false, error: '文件内容不能为空' };
    try {
      const fm = parseFrontmatter(content);
      if (!fm || !fm.name) {
        return { success: false, error: '文件缺少 YAML frontmatter 或 name 字段' };
      }
      return saveSkill(fm.name, fm.description || '', content);
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  },
  deleteSkill: (options) => {
    const entry = String(options?.entry ?? '');
    if (!entry) return { success: false, error: 'entry 不能为空' };
    return deleteSkill(entry);
  },
  readSkillFile: (options) => {
    const entry = String(options?.entry ?? '');
    if (!entry) return { success: false, error: 'entry 不能为空' };
    return readSkillFile(entry);
  },
  importStandardSkill: (options) => {
    const name = String(options?.name ?? '').trim();
    if (!name) return { success: false, error: 'name 不能为空' };
    return importStandardSkill(name);
  },
  listStandardSkillTemplates,
  importSkillFromFilePath: (options) => {
    const filePath = String(options?.filePath ?? '').trim();
    if (!filePath) return { success: false, error: 'filePath 不能为空' };
    return importSkillFromFilePath(filePath);
  },
  saveUploadedFileToTemp: (options) => {
    try {
      const base64Content = String(options?.content ?? '');
      const fileName = String(options?.fileName ?? 'upload').trim();
      if (!base64Content) return { success: false, error: 'content 不能为空' };
      const buffer = Buffer.from(base64Content, 'base64');
      const tmpDir = os.tmpdir();
      const uniqueName = `skill_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fileName}`;
      const filePath = path.join(tmpDir, uniqueName);
      fs.writeFileSync(filePath, buffer);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  },

  getEnvironment: () => {
    try {
      let username = '';
      try {
        username = os.userInfo().username || '';
      } catch {
        username = '';
      }
      let timezone = '';
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {
        timezone = '';
      }
      return {
        success: true,
        data: {
          platform: process.platform,
          osType: os.type(),
          osRelease: os.release(),
          arch: process.arch,
          cwd: process.cwd(),
          homedir: os.homedir(),
          hostname: os.hostname(),
          user: username,
          nodeVersion: process.versions.node,
          timezone,
          locale:
            (typeof process.env.LANG === 'string' && process.env.LANG)
            || (typeof process.env.LC_ALL === 'string' && process.env.LC_ALL)
            || '',
        },
      };
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) };
    }
  },

  // Bash notification setting
  setBashNotificationEnabled: (enabled) => {
    bashNotificationEnabled = Boolean(enabled);
    return { success: true, data: { enabled: bashNotificationEnabled } };
  },
  getBashNotificationEnabled: () => {
    return { success: true, data: { enabled: bashNotificationEnabled } };
  },

  // Background Task APIs
  addBackgroundTask: (options) => BackgroundTaskManager.addTask(options),
  updateBackgroundTask: (taskId, updates) => BackgroundTaskManager.updateTask(taskId, updates),
  getBackgroundTask: (taskId) => BackgroundTaskManager.getTask(taskId),
  listBackgroundTasks: () => BackgroundTaskManager.listTasks(),
  removeBackgroundTask: (taskId) => BackgroundTaskManager.removeTask(taskId),
  clearCompletedBackgroundTasks: () => BackgroundTaskManager.clearCompleted(),
  onBackgroundTasksChange: (listener) => BackgroundTaskManager.onChange(listener),

  // Notification APIs
  sendNotification: (options) => NotificationManager.notify(options),
  listNotifications: (options) => NotificationManager.listNotifications(options),
  markNotificationRead: (notifId) => NotificationManager.markRead(notifId),
  markAllNotificationsRead: () => NotificationManager.markAllRead(),
  removeNotification: (notifId) => NotificationManager.removeNotification(notifId),
  clearAllNotifications: () => NotificationManager.clearAll(),
  getUnreadNotificationCount: () => NotificationManager.getUnreadCount(),
  onNotificationsChange: (listener) => NotificationManager.onChange(listener),

  // Memory APIs
  listMemoryBlocks: () => listMemoryBlocks(),
  getMemoryBlock: (options) => {
    const label = String(options?.label ?? '').trim();
    if (!label) return { success: false, error: 'label 不能为空' };
    return getMemoryBlock(label);
  },
  setMemoryBlock: (options) => {
    const label = String(options?.label ?? '').trim();
    const description = String(options?.description ?? '').trim();
    const value = String(options?.value ?? '');
    const read_only = Boolean(options?.read_only);
    const chars_limit = options?.chars_limit;
    if (!label) return { success: false, error: 'label 不能为空' };
    return setMemoryBlock(label, description, value, { chars_limit, read_only });
  },
  replaceMemoryBlockText: (options) => {
    const label = String(options?.label ?? '').trim();
    const oldText = String(options?.oldText ?? '');
    const newText = String(options?.newText ?? '');
    if (!label) return { success: false, error: 'label 不能为空' };
    if (!oldText) return { success: false, error: 'oldText 不能为空' };
    return replaceMemoryBlockText(label, oldText, newText);
  },
  deleteMemoryBlock: (options) => {
    const label = String(options?.label ?? '').trim();
    if (!label) return { success: false, error: 'label 不能为空' };
    return deleteMemoryBlock(label);
  },
};
