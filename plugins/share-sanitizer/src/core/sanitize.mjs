const MAX_INPUT = 1024 * 1024;
const MAX_FINDINGS = 500;
const MAX_REDACTION_FINDINGS = 10_000;
const RULES = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,
  phone_cn: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g,
  ipv4: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g,
  win_path: /(?<![\w])(?:[A-Za-z]:\\|\\\\[^\\/\s]+\\[^\\/\s]+\\)[^\0<>:"|?*\s\r\n]*/g,
  posix_path: /(?<![\w/])\/(?:[^\0\r\n/ ]+\/)*[^\0\r\n/ ]+/g,
  bearer: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}\b/gi,
  api_key: /\b(?:api[_-]?key|token|secret)\s*[:=]\s*['\"]?[A-Za-z0-9_\-.]{12,}/gi,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  id_cn: /(?<!\d)\d{17}[\dXx](?!\d)/g
};
const DEFAULT_ENABLED = Object.freeze(Object.fromEntries(Object.keys(RULES).map((key) => [key, true])));

function chineseIdValid(value) {
  if (!/^\d{17}[\dXx]$/.test(value)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const check = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(value[i]) * weights[i];
  return check[sum % 11].toLowerCase() === value[17].toLowerCase();
}

function runRule(type, regex, text, whitelist, limit) {
  regex.lastIndex = 0;
  const findings = [];
  let truncated = false;
  let match;
  while ((match = regex.exec(text))) {
    const value = match[0];
    if (type === 'id_cn' && !chineseIdValid(value)) continue;
    if (whitelist.has(value.toLowerCase())) continue;
    findings.push({ start: match.index, end: match.index + value.length, value, type, confidence: type === 'id_cn' ? 0.99 : 0.92 });
    if (findings.length > limit) {
      truncated = true;
      break;
    }
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return { findings, truncated };
}

function findingLimit(value, fallback) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REDACTION_FINDINGS) throw new RangeError(`发现数量上限必须介于 1 到 ${MAX_REDACTION_FINDINGS} 之间。`);
  return limit;
}

export function inspectSensitive(text, options = {}) {
  const source = String(text ?? '');
  if (new TextEncoder().encode(source).byteLength > (options.maxInput || MAX_INPUT)) throw new RangeError('文本超过 1 MiB 安全上限。');
  const maxFindings = findingLimit(options.maxFindings, MAX_FINDINGS);
  const enabled = { ...DEFAULT_ENABLED, ...(options.enabled || {}) };
  const list = options.whitelist || []; if (!Array.isArray(list) || list.length > 200) throw new RangeError('允许列表超过 200 项安全上限。');
  const whitelist = new Set(list.map((item) => String(item).toLowerCase()));
  if (Object.keys(enabled).filter((key)=>enabled[key] && Object.prototype.hasOwnProperty.call(RULES,key)).length > Object.keys(RULES).length) throw new RangeError('启用的规则过多。');
  let findings = [];
  let candidateTruncated = false;
  for (const [type, regex] of Object.entries(RULES)) {
    if (!enabled[type]) continue;
    const result = runRule(type, regex, source, whitelist, maxFindings);
    findings = findings.concat(result.findings);
    candidateTruncated ||= result.truncated;
  }
  findings.sort((a, b) => a.start - b.start || b.end - a.end || a.type.localeCompare(b.type));
  const nonOverlapping = [];
  for (const item of findings) {
    const prior = nonOverlapping[nonOverlapping.length - 1];
    if (!prior || item.start >= prior.end) nonOverlapping.push(item);
    if (nonOverlapping.length > maxFindings) break;
  }
  const truncated = candidateTruncated || nonOverlapping.length > maxFindings;
  return {
    findings: nonOverlapping.slice(0, maxFindings),
    truncated,
    total: truncated ? null : nonOverlapping.length,
    totalAtLeast: truncated && nonOverlapping.length > maxFindings ? maxFindings + 1 : nonOverlapping.length
  };
}

export function detectSensitive(text, options = {}) {
  const result = inspectSensitive(text, options);
  Object.defineProperties(result.findings, {
    truncated: { value: result.truncated, enumerable: false },
    total: { value: result.total, enumerable: false },
    totalAtLeast: { value: result.totalAtLeast, enumerable: false }
  });
  return result.findings;
}

export function redactText(text, options = {}) {
  const source = String(text ?? '');
  const maxFindings = findingLimit(options.maxFindings, MAX_REDACTION_FINDINGS);
  const result = inspectSensitive(source, { ...options, maxFindings });
  if (result.truncated) throw new RangeError(`文本超过 ${maxFindings.toLocaleString('zh-CN')} 项完整脱敏安全上限；请拆分内容后再脱敏。`);
  const findings = result.findings;
  const replacement = options.replacement ?? '[REDACTED]';
  if (typeof replacement !== 'string') throw new RangeError('replacement 必须是字符串。');
  // Do not let a caller use the replacement field to put a value matched by an
  // enabled rule straight back into every redacted span.  An exact value in the
  // caller's explicit whitelist remains an intentional exception.
  const replacementFindings = inspectSensitive(replacement, {
    enabled: options.enabled,
    whitelist: options.whitelist,
    maxFindings: MAX_FINDINGS
  });
  if (replacementFindings.findings.length > 0) {
    throw new RangeError('replacement 不能包含任何启用脱敏规则可识别的敏感值。');
  }
  let cursor = 0;
  let output = '';
  for (const finding of findings) {
    output += source.slice(cursor, finding.start) + replacement;
    cursor = finding.end;
  }
  output += source.slice(cursor);
  // A replacement can be harmless in isolation but create a secret when it
  // joins surrounding source text (for example `Bearer ` + `/abcdefghijkl`).
  // Re-scan the complete result with the caller's enabled rules and explicit
  // whitelist.  Whitelisted full values remain an intentional user decision.
  const outputFindings = inspectSensitive(output, {
    enabled: options.enabled,
    whitelist: options.whitelist,
    maxFindings: MAX_FINDINGS,
    maxInput: Math.max(MAX_INPUT, new TextEncoder().encode(output).byteLength)
  });
  if (outputFindings.findings.length > 0 || outputFindings.truncated) {
    throw new RangeError('脱敏后的文本仍包含任何启用规则可识别的非白名单敏感值。');
  }
  return { text: output, findings, total: findings.length, truncated: false };
}

export function imageExportDecision(maskCount, metadataConfirmed = false) {
  if (Number(maskCount) > 0) return { ok: true, mode: 'redacted' };
  return metadataConfirmed ? { ok: true, mode: 'metadata-only' } : { ok: false, mode: 'confirm-metadata-only' };
}

export const defaults = Object.freeze({ MAX_INPUT, MAX_FINDINGS, MAX_REDACTION_FINDINGS, DEFAULT_ENABLED });
