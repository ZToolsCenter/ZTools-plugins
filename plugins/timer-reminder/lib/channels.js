/**
 * channels.js —— 额外提醒通道：邮件(SMTP) / 短信(短信宝) / 自定义 Webhook（preload 专用）
 *
 * 密钥（SMTP 密码、短信宝密钥）不存明文，由 store.getSecrets() 从 dbCryptoStorage 读取后传入。
 * 所有发送失败只记录结果、不抛异常，避免影响主提醒流程。
 */
'use strict';

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const http = require('./http.js');
const TimeFormat = require('./time-format.js');

let transport = http;
/** 仅供自测注入假传输层 */
function __setTransport(t) {
  transport = t || http;
}

/* ------------------------------------------------------------------ *
 * 消息构造
 * ------------------------------------------------------------------ */

function buildMessage(reminder, now) {
  now = now == null ? Date.now() : now;
  const when = reminder.nextRunAt || reminder.lastFiredAt || now;
  const repeat = reminder.mode === 'repeat' ? TimeFormat.formatRepeat(reminder.repeat) : '';
  return {
    title: reminder.title || '提醒',
    time: TimeFormat.formatDateTime(when),
    human: TimeFormat.formatHuman(when, now),
    note: reminder.note || '',
    repeat: repeat,
    text:
      (reminder.title || '提醒') +
      '（' + TimeFormat.formatHuman(when, now) + '）' +
      (repeat ? ' [' + repeat + ']' : '') +
      (reminder.note ? ' ' + reminder.note : '')
  };
}

function renderTemplate(tpl, msg) {
  return String(tpl == null ? '' : tpl)
    .replace(/\{title\}/g, msg.title)
    .replace(/\{time\}/g, msg.time)
    .replace(/\{human\}/g, msg.human)
    .replace(/\{note\}/g, msg.note)
    .replace(/\{repeat\}/g, msg.repeat)
    .replace(/\{text\}/g, msg.text);
}

/* ------------------------------------------------------------------ *
 * 邮件：极简 SMTP 客户端（支持 465 隐式 TLS 与 587/25 STARTTLS）
 * ------------------------------------------------------------------ */

function b64(s) {
  return Buffer.from(String(s), 'utf8').toString('base64');
}

function smtpSend(cfg, pass, msg) {
  const host = cfg.host;
  const port = Number(cfg.port) || (cfg.secure ? 465 : 25);
  const from = cfg.from || cfg.user;
  const tos = String(cfg.to || '')
    .split(/[,;\s]+/)
    .filter(Boolean);

  return new Promise((resolve, reject) => {
    if (!host || !cfg.user || !tos.length) {
      reject(new Error('SMTP 配置不完整（host/user/to 必填）'));
      return;
    }
    if (!pass) {
      reject(new Error('未配置 SMTP 密码/授权码'));
      return;
    }

    let socket = null;
    let buffer = '';
    let pending = null;
    let done = false;
    let offersStarttls = false;
    let secured = !!cfg.secure;
    const timeout = 20000;

    function finish(err, val) {
      if (done) return;
      done = true;
      if (socket) {
        try {
          socket.destroy();
        } catch (e) {
          /* 忽略 */
        }
      }
      if (err) reject(err);
      else resolve(val);
    }
    function expect(cb) {
      pending = cb;
    }
    function send(line) {
      socket.write(line + '\r\n');
    }
    function handleLine(line) {
      if (/STARTTLS/i.test(line)) offersStarttls = true;
      if (!pending) return;
      if (line.length >= 4 && line[3] === '-') return; // 多行回复的中间行
      const cb = pending;
      pending = null;
      cb(parseInt(line.slice(0, 3), 10), line);
    }
    function onData(chunk) {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleLine(line);
      }
    }
    function attach(sock) {
      socket = sock;
      socket.setEncoding('utf8');
      socket.setTimeout(timeout);
      socket.on('timeout', () => finish(new Error('SMTP 超时: ' + host + ':' + port)));
      socket.on('error', (e) => finish(e));
      socket.on('data', onData);
    }

    function ehlo(after) {
      expect((code) => {
        if (code !== 250) return finish(new Error('SMTP EHLO 失败: ' + code));
        after();
      });
      send('EHLO localhost');
    }
    function auth() {
      expect((code) => {
        if (code !== 334) return finish(new Error('SMTP 不支持 AUTH LOGIN: ' + code));
        send(b64(cfg.user));
        expect((c2) => {
          if (c2 !== 334) return finish(new Error('SMTP 认证失败(用户名): ' + c2));
          send(b64(pass));
          expect((c3) => {
            if (c3 !== 235) return finish(new Error('SMTP 认证失败(密码/授权码): ' + c3));
            mailFrom();
          });
        });
      });
      send('AUTH LOGIN');
    }
    function mailFrom() {
      expect((code) => {
        if (code !== 250) return finish(new Error('MAIL FROM 被拒: ' + code));
        rcpt(0);
      });
      send('MAIL FROM:<' + from + '>');
    }
    function rcpt(i) {
      if (i >= tos.length) return data();
      expect((code) => {
        if (code !== 250) return finish(new Error('RCPT TO 被拒: ' + tos[i]));
        rcpt(i + 1);
      });
      send('RCPT TO:<' + tos[i] + '>');
    }
    function data() {
      expect((code) => {
        if (code !== 354) return finish(new Error('DATA 被拒: ' + code));
        const body =
          msg.title +
          '\r\n\r\n' +
          '时间：' + msg.time +
          '\r\n' + (msg.repeat ? '规则：' + msg.repeat + '\r\n' : '') +
          (msg.note ? '备注：' + msg.note + '\r\n' : '') +
          '\r\n-- 由 ZTools「自然语言定时提醒」插件发送';
        const lines = [
          'From: ' + from,
          'To: ' + tos.join(', '),
          'Subject: =?UTF-8?B?' + b64('⏰ ' + msg.title) + '?=',
          'Date: ' + new Date().toUTCString(),
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Transfer-Encoding: base64'
        ];
        lines.forEach(send);
        send('');
        const encoded = Buffer.from(body, 'utf8').toString('base64');
        for (let i = 0; i < encoded.length; i += 76) send(encoded.slice(i, i + 76));
        send('.');
        expect((c) => {
          if (c !== 250) return finish(new Error('邮件投递被拒: ' + c));
          send('QUIT');
          finish(null, true);
        });
      });
      send('DATA');
    }

    attach(
      secured
        ? tls.connect({ host: host, port: port, servername: host })
        : net.connect({ host: host, port: port })
    );

    expect((code) => {
      if (code !== 220) return finish(new Error('SMTP 连接被拒: ' + code));
      ehlo(() => {
        if (!secured && offersStarttls && cfg.starttls !== false) {
          expect((c) => {
            if (c !== 220) return finish(new Error('STARTTLS 被拒: ' + c));
            const old = socket;
            old.removeAllListeners('data');
            const tlsSock = tls.connect({ socket: old, host: host, servername: host });
            secured = true;
            buffer = '';
            attach(tlsSock);
            ehlo(auth);
          });
          send('STARTTLS');
        } else {
          auth();
        }
      });
    });
  });
}

/* ------------------------------------------------------------------ *
 * 短信：短信宝（api.smsbao.com）
 * ------------------------------------------------------------------ */

async function smsbaoSend(cfg, key, msg) {
  if (!cfg.user || !cfg.phone) throw new Error('短信宝配置不完整（账号/手机号必填）');
  if (!key) throw new Error('未配置短信宝密钥');
  const p = crypto.createHash('md5').update(String(key), 'utf8').digest('hex');
  const url =
    'https://api.smsbao.com/sms?u=' + encodeURIComponent(cfg.user) +
    '&p=' + p +
    '&m=' + encodeURIComponent(cfg.phone) +
    '&c=' + encodeURIComponent('【提醒】' + msg.text);
  const res = await transport.get(url);
  const code = String(res.body || '').trim();
  if (code === '0') return true;
  throw new Error('短信宝返回码: ' + code);
}

/* ------------------------------------------------------------------ *
 * 自定义 Webhook（可接任意短信/推送服务）
 * ------------------------------------------------------------------ */

async function webhookSend(cfg, msg) {
  if (!cfg.url) throw new Error('未配置 Webhook URL');
  const method = String(cfg.method || 'POST').toUpperCase();
  const ct = cfg.contentType || 'json';
  const headers = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {};

  if (ct === 'text') {
    const body = renderTemplate(cfg.template, msg) || msg.text;
    const res = await transport.request(cfg.url, {
      method,
      headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers),
      body
    });
    if (res.status >= 200 && res.status < 300) return true;
    throw new Error('Webhook 返回 ' + res.status);
  }
  if (ct === 'form') {
    const body = renderTemplate(cfg.template, msg) || 'text=' + encodeURIComponent(msg.text);
    const res = await transport.request(cfg.url, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, headers),
      body
    });
    if (res.status >= 200 && res.status < 300) return true;
    throw new Error('Webhook 返回 ' + res.status);
  }
  // json
  const payload = {
    title: msg.title,
    time: msg.time,
    human: msg.human,
    note: msg.note,
    repeat: msg.repeat,
    text: cfg.template ? renderTemplate(cfg.template, msg) : msg.text
  };
  const res = await transport.request(cfg.url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers),
    body: JSON.stringify(payload)
  });
  if (res.status >= 200 && res.status < 300) return true;
  throw new Error('Webhook 返回 ' + res.status);
}

/* ------------------------------------------------------------------ *
 * 统一入口
 * ------------------------------------------------------------------ */

/**
 * 按配置把一条提醒发送到所有启用的额外通道。
 * @returns {Promise<Array<{kind:string, ok:boolean, error?:string}>>}
 */
async function send(reminder, settings, secrets) {
  const ch = (settings && settings.channels) || {};
  const results = [];
  if (ch.enabled === false) return results;
  const msg = buildMessage(reminder, Date.now());
  const sec = secrets || {};

  if (ch.smtp && ch.smtp.enabled) {
    try {
      await smtpSend(ch.smtp, sec.smtpPass || '', msg);
      results.push({ kind: 'smtp', ok: true });
    } catch (e) {
      results.push({ kind: 'smtp', ok: false, error: String((e && e.message) || e) });
    }
  }
  if (ch.smsbao && ch.smsbao.enabled) {
    try {
      await smsbaoSend(ch.smsbao, sec.smsbaoKey || '', msg);
      results.push({ kind: 'smsbao', ok: true });
    } catch (e) {
      results.push({ kind: 'smsbao', ok: false, error: String((e && e.message) || e) });
    }
  }
  if (ch.webhook && ch.webhook.enabled) {
    try {
      await webhookSend(ch.webhook, msg);
      results.push({ kind: 'webhook', ok: true });
    } catch (e) {
      results.push({ kind: 'webhook', ok: false, error: String((e && e.message) || e) });
    }
  }
  return results;
}

/**
 * 发送某通道的测试消息。
 */
async function testChannel(kind, settings, secrets) {
  const ch = (settings && settings.channels) || {};
  const msg = buildMessage(
    { title: '测试提醒', note: '这是一条通道测试消息', mode: 'once', nextRunAt: Date.now() },
    Date.now()
  );
  const sec = secrets || {};
  if (kind === 'smtp') return smtpSend(ch.smtp || {}, sec.smtpPass || '', msg);
  if (kind === 'smsbao') return smsbaoSend(ch.smsbao || {}, sec.smsbaoKey || '', msg);
  if (kind === 'webhook') return webhookSend(ch.webhook || {}, msg);
  throw new Error('未知通道: ' + kind);
}

module.exports = {
  buildMessage,
  renderTemplate,
  smtpSend,
  smsbaoSend,
  webhookSend,
  send,
  testChannel,
  __setTransport
};
