/**
 * http.js —— 极简 HTTP/HTTPS 请求封装（preload 专用，CommonJS）
 *
 * 不依赖 global fetch（preload 的 Node 版本不保证提供），统一走 node:http / node:https。
 * 供大模型客户端、短信宝、自定义 Webhook 使用。
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

/**
 * 发起请求。
 * @param {string} url 完整地址
 * @param {{method?:string, headers?:object, body?:string|Buffer, timeout?:number}} [options]
 * @returns {Promise<{status:number, body:string, headers:object}>}
 */
function request(url, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(new Error('URL 不合法: ' + url));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      {
        method: opts.method || 'GET',
        headers: opts.headers || {},
        timeout: opts.timeout != null ? opts.timeout : 15000
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('请求超时: ' + url));
    });
    req.on('error', (e) => reject(e));
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}

function postJson(url, payload, headers) {
  const body = JSON.stringify(payload);
  return request(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}),
    body
  });
}

function postForm(url, params, headers) {
  const body = Object.keys(params)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return request(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, headers || {}),
    body
  });
}

function get(url, headers) {
  return request(url, { method: 'GET', headers: headers || {} });
}

module.exports = { request, postJson, postForm, get };
