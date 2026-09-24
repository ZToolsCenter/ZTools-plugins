'use strict';
/*
 * 轻量 HTTP GET 客户端（ZTools 插件用）
 * - 直连 / HTTP 代理（https 目标走 CONNECT 隧道）
 * - proxy: 'auto' 时先直连，失败后自动尝试本机 Clash（127.0.0.1:7891）并记住结果
 * - 重试：默认 1 次；只在网络错误/5xx 时换下一个候选
 * 注意：preload 里 require 不到 electron 之外的东西，所以这里只用 node 内置模块。
 */
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const { URL } = require('node:url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT = 9000;
const FALLBACK_PROXY = 'http://127.0.0.1:7891';

let learnedProxy = null;

function getLearnedProxy() { return learnedProxy; }
function setLearnedProxy(p) { learnedProxy = p || null; }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function decodeBody(body, encoding) {
  if (encoding === 'gbk' || encoding === 'gb18030') {
    try { return new TextDecoder('gbk').decode(body); } catch (e) { /* 走到下面 */ }
  }
  return body.toString('utf8');
}

function proxyCandidates(proxy) {
  if (!proxy || proxy === 'direct' || proxy === 'off' || proxy === false) return [null];
  if (proxy === 'auto') {
    const list = [];
    if (learnedProxy) list.push(learnedProxy);
    list.push(null);
    if (!learnedProxy) list.push(FALLBACK_PROXY);
    return list;
  }
  return [proxy, null];
}

/** 单次请求，不做重试 */
function rawRequest(urlStr, opts) {
  const o = opts || {};
  const headers = o.headers || {};
  const proxy = o.proxy || null;
  const timeout = o.timeout || DEFAULT_TIMEOUT;

  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('URL 无效: ' + urlStr)); }
    const isHttps = u.protocol === 'https:';
    const port = Number(u.port || (isHttps ? 443 : 80));
    const hdrs = Object.assign({ 'User-Agent': UA, 'Accept': '*/*', 'Connection': 'close' }, headers, { Host: u.host });

    let settled = false;
    let req = null;
    const timer = setTimeout(() => {
      try { if (req) req.destroy(); } catch (e) { /* ignore */ }
      done(reject, new Error('请求超时 ' + u.hostname));
    }, timeout);
    function done(fn, arg) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    }
    function onResponse(res) {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', (e) => done(reject, e));
    }

    if (!proxy) {
      const mod = isHttps ? https : http;
      try {
        req = mod.request({ protocol: u.protocol, host: u.hostname, port, path: u.pathname + u.search, method: 'GET', headers: hdrs }, onResponse);
      } catch (e) { return done(reject, e); }
      req.on('error', (e) => done(reject, e));
      req.end();
      return;
    }

    let p;
    try { p = new URL(proxy); } catch (e) { return done(reject, new Error('代理地址无效: ' + proxy)); }
    const pPort = Number(p.port || 80);

    if (!isHttps) {
      // http 目标：明文代理，直接把完整 URL 当路径发过去
      try {
        req = http.request({ host: p.hostname, port: pPort, path: u.href, method: 'GET', headers: hdrs }, onResponse);
      } catch (e) { return done(reject, e); }
      req.on('error', (e) => done(reject, e));
      req.end();
      return;
    }

    // https 目标：CONNECT 建隧道 → TLS
    const sock = net.connect(pPort, p.hostname);
    const onErr = (e) => { try { sock.destroy(); } catch (x) { /* ignore */ } done(reject, e); };
    sock.on('error', onErr);
    sock.setTimeout(timeout, () => onErr(new Error('代理连接超时 ' + p.hostname + ':' + pPort)));
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('latin1');
      if (buf.indexOf('\r\n\r\n') < 0) return;
      sock.removeListener('data', onData);
      sock.setTimeout(0);
      if (!/^HTTP\/1\.[01] 200/.test(buf)) return onErr(new Error('代理 CONNECT 失败: ' + buf.split('\r\n')[0]));
      const tlsSock = tls.connect({ socket: sock, servername: u.hostname });
      tlsSock.on('error', onErr);
      try {
        req = https.request({
          host: u.hostname, port, path: u.pathname + u.search, method: 'GET',
          headers: hdrs, agent: false, createConnection: () => tlsSock
        }, onResponse);
      } catch (e) { return onErr(e); }
      req.on('error', onErr);
      req.end();
    };
    sock.on('data', onData);
    let auth = '';
    if (p.username) {
      auth = 'Proxy-Authorization: Basic ' + Buffer.from(decodeURIComponent(p.username) + ':' + decodeURIComponent(p.password || '')).toString('base64') + '\r\n';
    }
    sock.write('CONNECT ' + u.hostname + ':' + port + ' HTTP/1.1\r\nHost: ' + u.hostname + ':' + port + '\r\n' + auth + '\r\n');
  });
}

/**
 * GET 并返回文本
 * @param {string} url
 * @param {{headers?:object, proxy?:string, timeout?:number, retries?:number, encoding?:string}} [opts]
 */
async function httpGet(url, opts) {
  const o = opts || {};
  const retries = o.retries === undefined ? 1 : o.retries;
  const candidates = proxyCandidates(o.proxy);
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      try {
        const res = await rawRequest(url, { headers: o.headers, proxy: cand, timeout: o.timeout });
        if (res.status >= 200 && res.status < 300) {
          if (cand && cand !== learnedProxy) setLearnedProxy(cand);
          return decodeBody(res.body, o.encoding);
        }
        lastErr = new Error('HTTP ' + res.status + ' ' + hostOf(url));
      } catch (e) {
        lastErr = e;
      }
      if (attempt < retries) await sleep(200 + attempt * 300);
    }
  }
  throw lastErr || new Error('请求失败 ' + url);
}

async function httpGetJSON(url, opts) {
  const txt = await httpGet(url, opts);
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error('返回不是 JSON（' + hostOf(url) + '）：' + txt.slice(0, 80));
  }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return String(url).slice(0, 40); }
}

module.exports = { httpGet, httpGetJSON, getLearnedProxy, setLearnedProxy, FALLBACK_PROXY, UA };
