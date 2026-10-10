/**
 * llm.js —— 大语言模型接入（OpenAI 兼容 Chat Completions）（preload 专用）
 *
 * 用途：规则解析（lib/time-parse.js）失败时，用大模型做自然语言 → 提醒结构的智能解析。
 * 兼容 DeepSeek / OpenAI / 月之暗面 / 智谱 / 通义千问 等提供 OpenAI 兼容接口的服务。
 * API Key 存于 dbCryptoStorage（加密），不写入明文设置。
 */
'use strict';

const http = require('./http.js');
const Schedule = require('./schedule.js');

let transport = http;
/** 仅供自测注入假传输层 */
function __setTransport(t) {
  transport = t || http;
}

/** 界面预设：value 为 baseUrl */
const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'moonshot', label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  { id: 'custom', label: '自定义', baseUrl: '', model: '' }
];

function endpointOf(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
}

/**
 * 调用 Chat Completions。
 * @returns {Promise<string>} 模型回复文本
 */
async function chat(messages, cfg, apiKey) {
  if (!cfg || !cfg.baseUrl) throw new Error('未配置大模型 Base URL');
  if (!cfg.model) throw new Error('未配置大模型模型名');
  if (!apiKey) throw new Error('未配置大模型 API Key');

  const res = await transport.request(endpointOf(cfg.baseUrl), {
    method: 'POST',
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: messages,
      temperature: cfg.temperature != null ? Number(cfg.temperature) : 0.2
    })
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error('大模型接口返回 ' + res.status + ': ' + String(res.body).slice(0, 200));
  }
  let json;
  try {
    json = JSON.parse(res.body);
  } catch (e) {
    throw new Error('大模型返回不是合法 JSON');
  }
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof content !== 'string' || !content) throw new Error('大模型返回内容为空');
  return content;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

const WEEK_INDEX = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

/**
 * 把模型输出规整为与 time-parse 相同的结果结构。
 */
function normalizeAiResult(raw, now) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '大模型返回无法解析' };
  const title = String(raw.title || '').trim();
  if (!title) return { ok: false, error: '大模型未给出提醒内容' };

  if (raw.mode === 'repeat' && raw.repeat && raw.repeat.kind) {
    const repeat = Schedule.normalizeRepeat({
      kind: raw.repeat.kind,
      everyMinutes: raw.repeat.everyMinutes,
      timeOfDay: raw.repeat.timeOfDay,
      dayOfMonth: raw.repeat.dayOfMonth,
      weekdays: Array.isArray(raw.repeat.weekdays)
        ? raw.repeat.weekdays.map((w) => (typeof w === 'number' ? w : WEEK_INDEX[w]))
        : undefined
    });
    const nextRunAt = Schedule.computeNextRun({ mode: 'repeat', repeat: repeat }, now);
    if (nextRunAt == null) return { ok: false, error: '大模型给出的重复规则无法计算下次时间' };
    return { ok: true, source: 'ai', title: title, mode: 'repeat', repeat: repeat, nextRunAt: nextRunAt };
  }

  // once：接受 "YYYY-MM-DD HH:mm" 或 ISO 字符串或时间戳
  let at = null;
  if (typeof raw.at === 'number') {
    at = raw.at;
  } else if (typeof raw.at === 'string') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/.exec(raw.at.trim());
    if (m) {
      at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0).getTime();
    } else {
      const t = Date.parse(raw.at);
      if (!isNaN(t)) at = t;
    }
  }
  if (at == null || !isFinite(at)) return { ok: false, error: '大模型未给出有效时间' };
  if (at <= now) return { ok: false, error: '大模型给出的时间已过去' };
  return { ok: true, source: 'ai', title: title, mode: 'once', at: at, nextRunAt: at };
}

const SYSTEM_PROMPT =
  '你是一个提醒事项解析器。把用户的一句话解析为一个提醒，只输出一个 JSON 对象，不要输出任何解释。' +
  'JSON 结构二选一：' +
  '{"title":string,"mode":"once","at":"YYYY-MM-DD HH:mm"} 或 ' +
  '{"title":string,"mode":"repeat","repeat":{"kind":"interval|hourly|daily|weekly|workday|monthly","everyMinutes":number,"timeOfDay":"HH:MM","weekdays":[0-6],"dayOfMonth":number}}。' +
  'weekdays 中 0 表示周日。title 只保留提醒内容本身，不要包含时间词。无法确定时间时输出 {"error":"原因"}。';

/**
 * 智能解析入口。
 * @returns {Promise<object>} 与 time-parse.parse 相同形状的结果（额外带 source:'ai'）
 */
async function parseText(text, cfg, apiKey, now) {
  now = now == null ? Date.now() : now;
  const d = new Date(now);
  const nowText =
    d.getFullYear() + '-' + Schedule.pad2(d.getMonth() + 1) + '-' + Schedule.pad2(d.getDate()) +
    ' ' + Schedule.pad2(d.getHours()) + ':' + Schedule.pad2(d.getMinutes()) +
    ' 周' + TimeFormatWeekday(d);

  const content = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: '当前时间：' + nowText + '\n用户输入：' + text }
    ],
    cfg,
    apiKey
  );
  const raw = extractJson(content);
  if (raw && raw.error) return { ok: false, error: String(raw.error) };
  return normalizeAiResult(raw, now);
}

function TimeFormatWeekday(d) {
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

/**
 * 连通性测试。
 */
async function testConnection(cfg, apiKey) {
  const content = await chat([{ role: 'user', content: '回复 ok 两个字母即可' }], cfg, apiKey);
  return String(content).slice(0, 50);
}

module.exports = { PRESETS, chat, parseText, testConnection, normalizeAiResult, extractJson, __setTransport };
