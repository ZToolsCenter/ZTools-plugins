const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 60;
const MAX_NODES = 40000;
const MAX_FINDINGS = 10000;
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

export function pathContract(platform, file) {
  const name = String(file || '').split(platform === 'win32' ? /[\\/]/ : /\//).pop();
  return { platform, name, accepted: /\.(json|ya?ml)$/i.test(name) };
}

function utf8Length(text) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : Buffer.byteLength(text, 'utf8');
}

function auditDocument(root) {
  const stack = [[root, 0]];
  const seen = new Set();
  let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (depth > MAX_DEPTH) throw Error('契约文档嵌套层级超过限制');
    if (++nodes > MAX_NODES) throw Error('契约文档节点数量超过限制');
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const [key, next] of Object.entries(value)) {
      if (key === '$ref' && typeof next === 'string' && !next.startsWith('#/')) throw Error('不允许远程 $ref');
      stack.push([next, depth + 1]);
    }
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateDocumentShape(document) {
  const openapi3 = typeof document?.openapi === 'string' && /^3\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(document.openapi);
  const swagger2 = document?.swagger === '2.0';
  if (!isPlainObject(document) || (!openapi3 && !swagger2)) throw Error('根节点必须是 OpenAPI 3.x 或 Swagger 2.0 契约');
  if (!isPlainObject(document.paths)) throw Error('paths 必须是普通对象');
}

export function parseDocument(text) {
  const source = String(text);
  if (utf8Length(source) > MAX_BYTES) throw Error('契约文档超过 10 MiB 限制');
  let document;
  try { document = JSON.parse(source); } catch { throw Error('JSON 契约格式无效'); }
  validateDocumentShape(document);
  auditDocument(document);
  return document;
}

export function createFindingPageCollector(offset = 0, limit = 100) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Error('差异分页参数无效');
  const findings = [];
  const counts = { breaking: 0, nonBreaking: 0, info: 0, total: 0 };
  return {
    findings,
    counts,
    offset,
    limit,
    push(item) {
      const index = counts.total++;
      if (item?.level === 'breaking') counts.breaking++;
      else if (item?.level === 'non-breaking') counts.nonBreaking++;
      else if (item?.level === 'info') counts.info++;
      if (index >= offset && findings.length < limit) findings.push(item);
      return counts.total;
    }
  };
}

function pointer(...parts) {
  const base = typeof parts[0] === 'string' && parts[0].startsWith('/') ? parts.shift().replace(/\/$/, '') : '';
  return `${base}/${parts.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}
function resolve(value, document) {
  let current = value;
  const visited = new Set();
  for (let depth = 0; current?.$ref; depth++) {
    const ref = current.$ref;
    if (depth >= MAX_DEPTH || visited.has(ref)) throw Error('本地 $ref 循环引用超过限制');
    if (typeof ref !== 'string' || !ref.startsWith('#/')) throw Error('仅允许本地 $ref 值');
    visited.add(ref);
    let target = document;
    for (const rawPart of ref.slice(2).split('/')) {
      const part = decodeURIComponent(rawPart).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!target || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, part)) throw Error(`本地 $ref 无效：${ref}`);
      target = target[part];
    }
    current = target;
  }
  return current === undefined ? {} : current;
}
function schemaForParameter(parameter) {
  if (parameter?.schema) return parameter.schema;
  const contentSchema = Object.values(parameter?.content || {})[0]?.schema;
  if (contentSchema) return contentSchema;
  if (!parameter) return undefined;
  const { name, in: location, required, description, ...schema } = parameter;
  return Object.keys(schema).length ? schema : undefined;
}
function finding(level, kind, where, reason) { return { level, kind, pointer: where, reason }; }
function directionLabel(direction) { return direction === 'request' ? '请求' : '响应'; }
function values(value) { return value === undefined ? null : new Set(Array.isArray(value) ? value : [value]); }
function missing(from, within) { return [...from].filter((item) => !within.has(item)); }
function additionalMode(schema) {
  const value = schema.additionalProperties;
  return value === undefined || value === true ? 'any' : value === false ? 'none' : 'schema';
}
function compareAdditionalProperties(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs) {
  const oldMode = additionalMode(oldValue), newMode = additionalMode(newValue);
  const requestBreak = oldMode === 'any' && newMode !== 'any' || oldMode === 'schema' && newMode === 'none';
  const responseBreak = oldMode === 'none' && newMode !== 'none' || oldMode === 'schema' && newMode === 'any';
  if (direction === 'request' && requestBreak || direction === 'response' && responseBreak) {
    out.push(finding('breaking', 'schema.additionalProperties', pointer(where, 'additionalProperties'), `${directionLabel(direction)}的 additionalProperties 兼容范围收窄`));
  }
  if (oldMode === 'schema' && newMode === 'schema') {
    compareSchema(oldValue.additionalProperties, newValue.additionalProperties, pointer(where, 'additionalProperties'), out, oldDoc, newDoc, direction, pairs);
  }
}
function changed(left, right) { return JSON.stringify(left) !== JSON.stringify(right); }
function breakingConstraint(out, where, name, direction) { out.push(finding('breaking', `schema.${name}`, pointer(where, name), `${directionLabel(direction)}约束 ${name} 的兼容性发生变化`)); }
function compareAssertions(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs) {
  const request = direction === 'request';
  const tightenedMinimum = (name) => request ? newValue[name] !== undefined && (oldValue[name] === undefined || newValue[name] > oldValue[name]) : oldValue[name] !== undefined && (newValue[name] === undefined || newValue[name] < oldValue[name]);
  const tightenedMaximum = (name) => request ? newValue[name] !== undefined && (oldValue[name] === undefined || newValue[name] < oldValue[name]) : oldValue[name] !== undefined && (newValue[name] === undefined || newValue[name] > oldValue[name]);
  for (const name of ['minLength', 'minimum', 'exclusiveMinimum', 'minItems', 'minProperties']) if (tightenedMinimum(name)) breakingConstraint(out, where, name, direction);
  for (const name of ['maxLength', 'maximum', 'exclusiveMaximum', 'maxItems', 'maxProperties']) if (tightenedMaximum(name)) breakingConstraint(out, where, name, direction);
  if (request && oldValue.nullable && !newValue.nullable || !request && !oldValue.nullable && newValue.nullable) breakingConstraint(out, where, 'nullable', direction);
  if (request && newValue.const !== undefined && changed(oldValue.const, newValue.const) || !request && oldValue.const !== undefined && changed(oldValue.const, newValue.const)) breakingConstraint(out, where, 'const', direction);
  for (const name of ['pattern', 'format', 'multipleOf']) {
    const oldAssertion = oldValue[name], newAssertion = newValue[name];
    if (request && newAssertion !== undefined && changed(oldAssertion, newAssertion) || !request && oldAssertion !== undefined && changed(oldAssertion, newAssertion)) breakingConstraint(out, where, name, direction);
  }
  if (request && !oldValue.uniqueItems && newValue.uniqueItems || !request && oldValue.uniqueItems && !newValue.uniqueItems) breakingConstraint(out, where, 'uniqueItems', direction);
  if (Object.prototype.hasOwnProperty.call(oldValue, 'items') || Object.prototype.hasOwnProperty.call(newValue, 'items')) {
    if (!Object.prototype.hasOwnProperty.call(oldValue, 'items') || !Object.prototype.hasOwnProperty.call(newValue, 'items')) breakingConstraint(out, where, 'items', direction);
    else compareSchema(oldValue.items, newValue.items, pointer(where, 'items'), out, oldDoc, newDoc, direction, pairs);
  }
  for (const name of ['oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'contains', 'prefixItems']) {
    if (changed(oldValue[name], newValue[name])) out.push(finding('breaking', 'schema.inconclusive', pointer(where, name), `${directionLabel(direction)}约束 ${name} 发生变化，无法证明兼容性`));
  }
  const handled = new Set(['$ref', 'type', 'enum', 'nullable', 'const', 'minLength', 'maxLength', 'pattern', 'format', 'multipleOf', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'uniqueItems', 'items', 'minProperties', 'maxProperties', 'properties', 'required', 'additionalProperties', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'contains', 'prefixItems']);
  const metadata = new Set(['title', 'description', 'default', 'example', 'examples', 'deprecated', 'externalDocs', '$id', '$schema']);
  for (const name of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
    if (!handled.has(name) && !metadata.has(name) && changed(oldValue[name], newValue[name])) out.push(finding('breaking', 'schema.inconclusive', pointer(where, name), `${directionLabel(direction)}约束 ${name} 发生变化，无法证明兼容性`));
  }
}

function compareSchema(oldSchema, newSchema, where, out, oldDoc, newDoc, direction, pairs = new WeakMap()) {
  if (oldSchema === undefined || newSchema === undefined) return;
  const oldValue = resolve(oldSchema, oldDoc);
  const newValue = resolve(newSchema, newDoc);
  if (typeof oldValue === 'boolean' || typeof newValue === 'boolean') {
    if (oldValue !== newValue) out.push(finding('breaking', 'schema.boolean', where, `${directionLabel(direction)}的布尔 Schema 兼容性发生变化`));
    return;
  }
  if (typeof oldValue === 'object' && typeof newValue === 'object') {
    let targets = pairs.get(oldValue);
    if (!targets) { targets = new WeakSet(); pairs.set(oldValue, targets); }
    if (targets.has(newValue)) return;
    targets.add(newValue);
  }
  const oldTypes = values(oldValue.type), newTypes = values(newValue.type);
  if ((direction === 'request' && !oldTypes && newTypes) || (direction === 'response' && oldTypes && !newTypes)) {
    out.push(finding('breaking', 'schema.type', where, `${directionLabel(direction)}类型兼容范围收窄`));
  } else if (oldTypes && newTypes) {
    const invalid = direction === 'request' ? missing(oldTypes, newTypes) : missing(newTypes, oldTypes);
    if (invalid.length) out.push(finding('breaking', 'schema.type', where, `${directionLabel(direction)}类型兼容性发生变化：${invalid.join('、')}`));
  }
  if ((direction === 'request' && !oldValue.enum && newValue.enum) || (direction === 'response' && oldValue.enum && !newValue.enum)) {
    out.push(finding('breaking', 'schema.enum', where, `${directionLabel(direction)}枚举兼容范围收窄`));
  } else if (oldValue.enum && newValue.enum) {
    const invalid = direction === 'request' ? missing(new Set(oldValue.enum), new Set(newValue.enum)) : missing(new Set(newValue.enum), new Set(oldValue.enum));
    if (invalid.length) out.push(finding('breaking', 'schema.enum', where, `${directionLabel(direction)}枚举兼容性发生变化：${invalid.join('、')}`));
  }
  const oldRequired = new Set(oldValue.required || []), newRequired = new Set(newValue.required || []);
  if (direction === 'request') for (const name of missing(newRequired, oldRequired)) out.push(finding('breaking', 'schema.required', pointer(where, 'required'), `字段 ${name} 变为必填`));
  if (direction === 'response') for (const name of missing(oldRequired, newRequired)) out.push(finding('breaking', 'schema.required', pointer(where, 'required'), `响应字段 ${name} 不再保证必填`));
  const oldProperties = oldValue.properties || {}, newProperties = newValue.properties || {};
  for (const [name, oldProperty] of Object.entries(oldProperties)) {
    if (!Object.prototype.hasOwnProperty.call(newProperties, name)) {
      if (direction === 'response') out.push(finding('breaking', 'schema.property', pointer(where, 'properties', name), '响应属性已移除'));
      if (direction === 'request') out.push(finding('breaking', 'schema.property', pointer(where, 'properties', name), '原本接受的请求属性已移除'));
      continue;
    }
    compareSchema(oldProperty, newProperties[name], pointer(where, 'properties', name), out, oldDoc, newDoc, direction, pairs);
  }
  compareAdditionalProperties(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs);
  compareAssertions(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs);
  if (direction === 'request') for (const name of Object.keys(newProperties)) if (!Object.prototype.hasOwnProperty.call(oldProperties, name) && !newRequired.has(name)) out.push(finding('non-breaking', 'schema.property', pointer(where, 'properties', name), '新增可选请求属性'));
}

function parameters(operation, pathItem, document) {
  const merged = new Map();
  for (const parameter of [...(pathItem?.parameters || []), ...(operation.parameters || [])]) {
    const resolved = resolve(parameter, document);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }
  return [...merged.values()];
}
function effectiveSecurity(document, operation) {
  const value = Object.prototype.hasOwnProperty.call(operation, 'security') ? operation.security : document.security;
  if (!Array.isArray(value) || value.length === 0) return [];
  if (value.some((requirement) => isPlainObject(requirement) && Object.keys(requirement).length === 0)) return [];
  return value.map((requirement) => Object.fromEntries(Object.keys(requirement).sort().map((key) => [key, [...(requirement[key] || [])].sort()])))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
function sameSecurity(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function compareSecurity(oldDoc, newDoc, oldOperation, newOperation, where, out) {
  const oldSecurity = effectiveSecurity(oldDoc, oldOperation), newSecurity = effectiveSecurity(newDoc, newOperation);
  if (sameSecurity(oldSecurity, newSecurity)) return;
  if (newSecurity.length === 0) out.push(finding('info', 'security', where, '操作现在允许匿名访问'));
  else if (oldSecurity.length === 0) out.push(finding('breaking', 'security', where, '操作现在要求身份验证'));
  else out.push(finding('breaking', 'security', where, '实际生效的安全要求发生变化'));
}
function compareRequestBody(oldBody, newBody, where, out, oldDoc, newDoc) {
  oldBody = oldBody && resolve(oldBody, oldDoc);
  newBody = newBody && resolve(newBody, newDoc);
  if (!oldBody && newBody?.required) { out.push(finding('breaking', 'requestBody.required', where, '新增必填请求体')); return; }
  if (oldBody && !newBody) { out.push(finding('breaking', 'requestBody.content', where, '已移除请求体支持')); return; }
  if (!oldBody || !newBody) return;
  if (!oldBody.required && newBody.required) out.push(finding('breaking', 'requestBody.required', where, '请求体变为必填'));
  for (const [type, media] of Object.entries(oldBody.content || {})) {
    if (!newBody.content?.[type]) out.push(finding('breaking', 'requestBody.content', pointer(where, 'content', type), `已移除原本接受的内容类型 ${type}`));
    else compareSchema(media.schema, newBody.content[type].schema, pointer(where, 'content', type, 'schema'), out, oldDoc, newDoc, 'request');
  }
}
function compareResponse(oldResponse, newResponse, where, out, oldDoc, newDoc) {
  oldResponse = resolve(oldResponse, oldDoc);
  newResponse = resolve(newResponse, newDoc);
  const oldContent = oldResponse.content;
  const newContent = newResponse.content;
  if (!oldContent && !newContent) {
    compareSchema(oldResponse.schema, newResponse.schema, pointer(where, 'schema'), out, oldDoc, newDoc, 'response');
    return;
  }
  for (const [type, media] of Object.entries(oldContent || {})) {
    if (!newContent?.[type]) out.push(finding('breaking', 'response.content', pointer(where, 'content', type), `已移除响应内容类型 ${type}`));
    else compareSchema(media.schema, newContent[type].schema, pointer(where, 'content', type, 'schema'), out, oldDoc, newDoc, 'response');
  }
}

function effectiveSwaggerMediaTypes(document, operation, field) {
  if (document?.swagger !== '2.0') return null;
  const source = Object.prototype.hasOwnProperty.call(operation, field) ? operation[field] : document[field];
  return new Set(Array.isArray(source) ? source.filter((item) => typeof item === 'string') : []);
}
function compareSwaggerMediaTypeSet(oldDoc, newDoc, oldOperation, newOperation, base, field, kind, label, out) {
  const oldTypes = effectiveSwaggerMediaTypes(oldDoc, oldOperation, field);
  const newTypes = effectiveSwaggerMediaTypes(newDoc, newOperation, field);
  if (!oldTypes || !newTypes) return;
  const removed = missing(oldTypes, newTypes).sort();
  const added = missing(newTypes, oldTypes).sort();
  const where = pointer(base, field);
  if (removed.length) out.push(finding('breaking', kind, where, `Swagger 2 有效 ${label} 已移除内容类型：${removed.join('、')}`));
  if (added.length) out.push(finding('non-breaking', kind, where, `Swagger 2 有效 ${label} 新增内容类型：${added.join('、')}`));
}
function compareSwaggerMediaTypes(oldDoc, newDoc, oldOperation, newOperation, base, out) {
  compareSwaggerMediaTypeSet(oldDoc, newDoc, oldOperation, newOperation, base, 'consumes', 'requestBody.content', 'consumes', out);
  compareSwaggerMediaTypeSet(oldDoc, newDoc, oldOperation, newOperation, base, 'produces', 'response.content', 'produces', out);
}

export function compareContracts(oldDoc, newDoc, collector) {
  const target = collector && typeof collector.push === 'function' ? collector : [];
  let findingCount = 0;
  const out = { push(item) {
    if (++findingCount > MAX_FINDINGS) throw Error(`契约差异数量超过 ${MAX_FINDINGS} 条限制`);
    return target.push(item);
  } };
  const oldPaths = oldDoc.paths || {}, newPaths = newDoc.paths || {};
  for (const [route, oldPath] of Object.entries(oldPaths)) {
    if (!newPaths[route]) { out.push(finding('breaking', 'endpoint', pointer('paths', route), '接口端点已移除')); continue; }
    const oldPathItem = resolve(oldPath, oldDoc), newPathItem = resolve(newPaths[route], newDoc);
    for (const method of METHODS) {
      const oldOperation = oldPathItem[method], newOperation = newPathItem[method];
      if (!oldOperation) continue;
      const base = pointer('paths', route, method);
      if (!newOperation) { out.push(finding('breaking', 'method', base, '请求方法已移除')); continue; }
      const oldParameters = parameters(oldOperation, oldPathItem, oldDoc), newParameters = parameters(newOperation, newPathItem, newDoc);
      const nextByKey = new Map(newParameters.map((item) => [`${item.in}:${item.name}`, item]));
      const oldKeys = new Set(oldParameters.map((item) => `${item.in}:${item.name}`));
      for (const parameter of oldParameters) {
        const key = `${parameter.in}:${parameter.name}`, next = nextByKey.get(key), where = pointer(base, 'parameters', key);
        if (!next) out.push(finding('breaking', 'parameter', where, `参数 ${key} 已移除`));
        else {
          if (!parameter.required && next.required) out.push(finding('breaking', 'parameter.required', where, `参数 ${key} 变为必填`));
          compareSchema(schemaForParameter(parameter), schemaForParameter(next), pointer(where, 'schema'), out, oldDoc, newDoc, 'request');
        }
      }
      for (const parameter of newParameters) {
        const key = `${parameter.in}:${parameter.name}`;
        if (!oldKeys.has(key)) out.push(finding(parameter.required ? 'breaking' : 'non-breaking', 'parameter', pointer(base, 'parameters', key), parameter.required ? `新增必填参数 ${key}` : `新增可选参数 ${key}`));
      }
      compareSecurity(oldDoc, newDoc, oldOperation, newOperation, base, out);
      compareSwaggerMediaTypes(oldDoc, newDoc, oldOperation, newOperation, base, out);
      compareRequestBody(oldOperation.requestBody, newOperation.requestBody, pointer(base, 'requestBody'), out, oldDoc, newDoc);
      for (const [status, oldResponse] of Object.entries(oldOperation.responses || {})) {
        const next = newOperation.responses?.[status];
        if (!next) out.push(finding('breaking', 'response', pointer(base, 'responses', status), `响应 ${status} 已移除`));
        else compareResponse(oldResponse, next, pointer(base, 'responses', status), out, oldDoc, newDoc);
      }
    }
    for (const method of METHODS) {
      if (!oldPathItem[method] && newPathItem[method]) {
        out.push(finding('non-breaking', 'method', pointer('paths', route, method), `新增请求方法 ${method.toUpperCase()}`));
      }
    }
  }
  for (const [route, pathItem] of Object.entries(newPaths)) if (!oldPaths[route]) out.push(finding('non-breaking', 'endpoint', pointer('paths', route), `新增接口端点（${Object.keys(pathItem).filter((key) => METHODS.includes(key)).join('、')}）`));
  return target;
}

function escapeMarkdown(value) { return String(value).replace(/[\\`*_{}\[\]<>]/g, '\\$&').replace(/\r?\n/g, ' '); }
const HUMAN_FINDING_KINDS = Object.freeze({
  endpoint: '接口端点',
  method: '请求方法',
  parameter: '参数',
  'parameter.required': '参数必填性',
  response: '响应',
  security: '安全要求',
  'requestBody.required': '请求体必填性',
  'requestBody.content': '请求体内容类型',
  'response.content': '响应内容类型',
  'schema.type': '数据类型',
  'schema.enum': '枚举范围',
  'schema.required': '必填字段',
  'schema.property': '对象属性',
  'schema.additionalProperties': '附加属性策略',
  'schema.boolean': '布尔结构定义',
  'schema.inconclusive': '无法确定的结构约束',
  'schema.minLength': '最小长度',
  'schema.minimum': '最小值',
  'schema.exclusiveMinimum': '排他最小值',
  'schema.minItems': '最少元素数',
  'schema.minProperties': '最少属性数',
  'schema.maxLength': '最大长度',
  'schema.maximum': '最大值',
  'schema.exclusiveMaximum': '排他最大值',
  'schema.maxItems': '最多元素数',
  'schema.maxProperties': '最多属性数',
  'schema.nullable': '可空性',
  'schema.const': '常量值',
  'schema.pattern': '正则模式',
  'schema.format': '格式约束',
  'schema.multipleOf': '倍数约束',
  'schema.uniqueItems': '元素唯一性',
  'schema.items': '数组元素'
});
export function humanFindingKind(value) { return HUMAN_FINDING_KINDS[String(value ?? '')] || '未分类变更'; }
export function reportMarkdown(findings) {
  const groups = ['breaking', 'non-breaking', 'info'];
  const groupLabels = { breaking: '破坏性变更', 'non-breaking': '兼容性变更', info: '信息' };
  return ['# OpenAPI 契约门禁报告', '', ...groups.flatMap((group) => {
    const items = findings.filter((item) => item.level === group).map((item) => `- **${escapeMarkdown(humanFindingKind(item.kind))}**，位置 \`${escapeMarkdown(item.pointer)}\`：${escapeMarkdown(item.reason)}`);
    return [`## ${groupLabels[group]}`, ...(items.length ? items : ['- 无'])];
  })].join('\n');
}
