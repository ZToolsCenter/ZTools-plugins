import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compareContracts, createFindingPageCollector, humanFindingKind, parseDocument, pathContract, reportMarkdown } from '../src/core/contract.js';

const require = createRequire(import.meta.url);
const preload = require('../src/preload/index.cjs');
const doc = (operation, extra = {}) => ({ openapi: '3.1.0', paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], get: operation } }, ...extra });
const operation = (overrides = {}) => ({ responses: { 200: { content: { 'application/json': { schema: { type: 'string', enum: ['ok'] } } } } }, ...overrides });
const has = (findings, kind) => findings.some((item) => item.kind === kind && item.level === 'breaking');

test('manifest declarations and preload registrations use the same short MCP names', () => {
  const calls = new Map();
  preload.bridge({ registerTool(name, handler) { calls.set(name, handler); } });
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.tools).sort(), Object.values(preload.TOOL_NAMES).sort());
  assert.deepEqual([...calls.keys()].sort(), Object.values(preload.TOOL_NAMES).sort());
  assert.ok([...calls.values()].every((handler) => typeof handler === 'function'));
});

test('legacy hosts without registerTool retain the renderer bridge', () => {
  const renderer = preload.bridge({});
  assert.equal(typeof renderer.choose, 'function');
  assert.equal(typeof renderer.readGranted, 'function');
});

test('one registerTool failure does not block the renderer bridge or remaining tool', () => {
  const registered = [];
  const renderer = preload.bridge({ registerTool(name) { if (name === preload.TOOL_NAMES.compareInline) throw Error('one failure'); registered.push(name); } });
  assert.deepEqual(registered, [preload.TOOL_NAMES.compareApprovedFiles]);
  assert.equal(typeof renderer.choose, 'function');
});

test('inline MCP comparison returns deterministic full counts and paginated evidence', async () => {
  const calls = new Map();
  preload.bridge({ registerTool(name, handler) { calls.set(name, handler); } });
  const before = JSON.stringify({ openapi: '3.1.0', paths: { '/pets': { get: operation() } } });
  const after = JSON.stringify({ openapi: '3.1.0', paths: {} });
  const result = await calls.get(preload.TOOL_NAMES.compareInline)({ before, after, format: 'json', includeMarkdown: true, offset: 0, limit: 1 });
  assert.equal(result.gatePassed, false);
  assert.equal(result.counts.breaking, 1);
  assert.equal(result.counts.total, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, 'endpoint');
  assert.match(result.markdown, /接口端点/);
  assert.doesNotMatch(result.markdown, /endpoint/);
});

test('inline MCP comparison rejects hostile fields and byte or page overflow before parsing', async () => {
  const valid = JSON.stringify({ openapi: '3.1.0', paths: {} });
  await assert.rejects(preload.compareInline({ before: valid, after: valid, command: 'write' }), (error) => error.code === 'INVALID_TOOL_INPUT');
  const hostile = JSON.parse(`{"before":${JSON.stringify(valid)},"after":${JSON.stringify(valid)},"__proto__":{"polluted":true}}`);
  await assert.rejects(preload.compareInline(hostile), (error) => error.code === 'INVALID_TOOL_INPUT');
  await assert.rejects(preload.compareInline({ before: '你'.repeat(110000), after: valid }), /320 KiB/);
  await assert.rejects(preload.compareInline({ before: valid, after: valid, limit: 201 }), /1—200/);
  let getterCalled = false;
  const accessor = { after: valid };
  Object.defineProperty(accessor, 'before', { enumerable: true, get() { getterCalled = true; return valid; } });
  await assert.rejects(preload.compareInline(accessor), (error) => error.code === 'INVALID_TOOL_INPUT');
  assert.equal(getterCalled, false);
  const symbolInput = { before: valid, after: valid }; symbolInput[Symbol('hidden')] = true;
  await assert.rejects(preload.compareInline(symbolInput), (error) => error.code === 'INVALID_TOOL_INPUT');
});

test('MCP comparison streams a half-MiB long-pointer attack into a bounded response', async () => {
  const route = `/${'r'.repeat(260000)}`;
  const parameters = Array.from({ length: 200 }, (_, index) => ({ name: `q${index}`, in: 'query', schema: { type: 'string' } }));
  const before = JSON.stringify({ openapi: '3.1.0', paths: { [route]: { get: operation({ parameters }) } } });
  const after = JSON.stringify({ openapi: '3.1.0', paths: { [route]: { get: operation() } } });
  const requestBytes = Buffer.byteLength(before) + Buffer.byteLength(after);
  assert.ok(requestBytes > 500 * 1024 && requestBytes < 640 * 1024);
  const rssBefore = process.memoryUsage().rss;
  const result = await preload.compareInline({ before, after, format: 'json', includeMarkdown: true, offset: 0, limit: 200 });
  const rssGrowth = Math.max(0, process.memoryUsage().rss - rssBefore);
  assert.equal(result.counts.breaking, 200);
  assert.equal(result.counts.total, 200);
  assert.equal(result.gatePassed, false);
  assert.equal(result.responseTruncated, true);
  assert.ok(result.findings.every((item) => Buffer.byteLength(item.pointer) <= 1024 && Buffer.byteLength(item.reason) <= 768));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 512 * 1024);
  assert.ok(rssGrowth < 160 * 1024 * 1024, `RSS grew by ${rssGrowth} bytes`);
  const source = fs.readFileSync(new URL('../src/preload/index.cjs', import.meta.url), 'utf8');
  assert.match(source, /compareContracts\([^;]+collector\)/);
  assert.doesNotMatch(source, /const findings = mod\.compareContracts/);
});

test('approved-file MCP comparison consumes exactly the UI grants and accepts no paths', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  const calls = new Map();
  preload.bridge({ registerTool(name, handler) { calls.set(name, handler); } });
  preload.__testClear();
  await assert.rejects(calls.get(preload.TOOL_NAMES.compareApprovedFiles)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED');
  preload.__testGrant([fixture, fixture]);
  const documents = preload.readGranted();
  assert.equal(documents.length, 2);
  assert.equal(preload.__testGrants().length, 2, 'human UI read must preserve the latest two-file MCP grant');
  const result = await calls.get(preload.TOOL_NAMES.compareApprovedFiles)({ offset: 0, limit: 10 });
  assert.equal(result.gatePassed, true);
  assert.equal(result.counts.total, 0);
  assert.equal(preload.__testGrants().length, 0);
  preload.__testGrant([fixture]);
  await assert.rejects(calls.get(preload.TOOL_NAMES.compareApprovedFiles)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED');
  assert.equal(preload.__testGrants().length, 0);
  preload.__testGrant([fixture, fixture]);
  preload.__testGrants()[0].until = 0;
  await assert.rejects(calls.get(preload.TOOL_NAMES.compareApprovedFiles)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED');
  assert.equal(preload.__testGrants().length, 0);
  await assert.rejects(calls.get(preload.TOOL_NAMES.compareApprovedFiles)({ path: fixture }), (error) => error.code === 'INVALID_TOOL_INPUT');
});

test('approved-file MCP failures are stable and never expose a changed file path', async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'test', 'openapi-mcp-failure-'));
  const before = path.join(directory, 'before.json'), after = path.join(directory, 'after.json');
  const value = JSON.stringify({ openapi: '3.1.0', paths: {} });
  fs.writeFileSync(before, value); fs.writeFileSync(after, value);
  preload.__testGrant([before, after]);
  fs.appendFileSync(before, ' ');
  await assert.rejects(preload.compareApprovedFiles({}), (error) => {
    assert.equal(error.code, 'APPROVED_CONTRACT_FAILED');
    assert.equal(error.message.includes(directory), false);
    assert.equal(error.message.includes(before), false);
    return true;
  });
  assert.equal(preload.__testGrants().length, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('plugin exit prevents an in-flight approved comparison from returning a stale result', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testGrant([fixture, fixture]);
  const selected = [...preload.__testGrants()];
  const pending = preload.compareApprovedFiles({ offset: 0, limit: 10 });
  preload.__testExpireSession();
  await assert.rejects(pending, (error) => error?.code === 'SESSION_EXPIRED');
  assert.equal(preload.__testGrants().length, 0);
  for (const item of selected) assert.throws(() => fs.fstatSync(item.fd), { code: 'EBADF' });
});

test('request and response variance has opposite enum/type directions', () => {
  const before = doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: ['string', 'null'], enum: ['a', 'b'] } }], requestBody: { content: { 'application/json': { schema: { type: 'string', enum: ['a', 'b'] } } } } }));
  const after = doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: 'string', enum: ['a'] } }], requestBody: { content: { 'application/json': { schema: { type: 'string', enum: ['a'] } } } }, responses: { 200: { content: { 'application/json': { schema: { type: ['string', 'null'], enum: ['ok', 'unknown'] } } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'schema.type'));
  assert.ok(has(findings, 'schema.enum'));
});

test('query header path and cookie schemas are compared', () => {
  const before = doc(operation({ parameters: ['query', 'header', 'path', 'cookie'].map((location) => ({ name: location === 'path' ? 'id' : location, in: location, required: location === 'path', schema: { type: 'string', enum: ['a', 'b'] } })) }));
  const after = doc(operation({ parameters: ['query', 'header', 'path', 'cookie'].map((location) => ({ name: location === 'path' ? 'id' : location, in: location, required: location === 'path', schema: { type: 'string', enum: ['a'] } })) }));
  assert.ok(compareContracts(before, after).filter((item) => item.kind === 'schema.enum').length >= 4);
});

test('Swagger 2 non-body parameter type and enum are compared directly', () => {
  const before = { swagger: '2.0', paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }], get: { parameters: [{ name: 'q', in: 'query', type: 'string', enum: ['a', 'b'] }], responses: { 200: { schema: { type: 'string' } } } } } } };
  const after = { swagger: '2.0', paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }], get: { parameters: [{ name: 'q', in: 'query', type: 'string', enum: ['a'] }], responses: { 200: { schema: { type: 'string' } } } } } } };
  assert.ok(has(compareContracts(before, after), 'schema.enum'));
});

test('Swagger 2 global consumes and produces compare effective media type sets', () => {
  const swaggerOperation = { responses: { 200: { schema: { type: 'string' } } } };
  const before = { swagger: '2.0', consumes: ['application/json', 'application/xml'], produces: ['application/json'], paths: { '/pets': { post: swaggerOperation } } };
  const after = { swagger: '2.0', consumes: ['application/xml', 'text/plain'], produces: ['application/xml'], paths: { '/pets': { post: structuredClone(swaggerOperation) } } };
  const findings = compareContracts(before, after);
  assert.ok(findings.some((item) => item.level === 'breaking' && item.kind === 'requestBody.content' && item.reason.includes('application/json')));
  assert.ok(findings.some((item) => item.level === 'non-breaking' && item.kind === 'requestBody.content' && item.reason.includes('text/plain')));
  assert.ok(findings.some((item) => item.level === 'breaking' && item.kind === 'response.content' && item.reason.includes('application/json')));
  assert.ok(findings.some((item) => item.level === 'non-breaking' && item.kind === 'response.content' && item.reason.includes('application/xml')));
  assert.ok(findings.every((item) => item.pointer.startsWith('/paths/~1pets/post/')));
  const markdown = reportMarkdown(findings);
  assert.match(markdown, /请求体内容类型/);
  assert.match(markdown, /响应内容类型/);
  assert.doesNotMatch(markdown, /requestBody\.content|response\.content/);
});

test('Swagger 2 operation media types override globals while absent fields inherit them', () => {
  const response = { responses: { 200: { schema: { type: 'string' } } } };
  const before = { swagger: '2.0', consumes: ['application/json'], produces: ['application/json'], paths: { '/pets': { get: { ...structuredClone(response), consumes: ['text/plain'], produces: ['text/plain'] }, post: structuredClone(response) } } };
  const after = { swagger: '2.0', consumes: ['application/xml'], produces: ['application/xml'], paths: { '/pets': { get: { ...structuredClone(response), consumes: ['text/plain'], produces: ['text/plain'] }, post: structuredClone(response) } } };
  const findings = compareContracts(before, after).filter((item) => item.kind === 'requestBody.content' || item.kind === 'response.content');
  assert.equal(findings.length, 4);
  assert.ok(findings.every((item) => item.pointer.startsWith('/paths/~1pets/post/')));
  assert.equal(findings.some((item) => item.pointer.includes('/get/')), false);
});

test('Swagger 2 inherited and operation-level declarations with equal effective sets do not differ', () => {
  const response = { responses: { 200: { schema: { type: 'string' } } } };
  const before = { swagger: '2.0', consumes: ['application/json'], produces: ['application/json'], paths: { '/pets': { post: structuredClone(response) } } };
  const after = { swagger: '2.0', consumes: ['application/xml'], produces: ['application/xml'], paths: { '/pets': { post: { ...structuredClone(response), consumes: ['application/json'], produces: ['application/json'] } } } };
  const findings = compareContracts(before, after);
  assert.equal(findings.some((item) => item.kind === 'requestBody.content' || item.kind === 'response.content'), false);
});

test('OpenAPI 3 ignores Swagger consumes and produces compatibility keywords', () => {
  const before = doc(operation(), { consumes: ['application/json'], produces: ['application/json'] });
  const after = doc(operation(), { consumes: ['application/xml'], produces: ['application/xml'] });
  const findings = compareContracts(before, after);
  assert.equal(findings.some((item) => item.kind === 'requestBody.content' || item.kind === 'response.content'), false);
});

test('request body required and content removal are breaking', () => {
  const before = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object' } }, 'application/xml': { schema: { type: 'object' } } } } }));
  const after = doc(operation({ requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'requestBody.required'));
  assert.ok(has(findings, 'requestBody.content'));
  assert.ok(has(compareContracts(before, doc(operation())), 'requestBody.content'));
});

test('response compares matching media types and required output guarantees', () => {
  const before = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string', enum: ['a'] } } } }, 'application/xml': { schema: { type: 'string' } } } } } }));
  const after = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { properties: { id: { enum: ['a', 'b'] } } } } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'response.content'));
  assert.ok(has(findings, 'schema.required'));
  assert.ok(has(findings, 'schema.type'));
  assert.ok(has(findings, 'schema.enum'));
});

test('unconstrained schemas becoming constrained are request breaks', () => {
  const before = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { legacy: {} }, additionalProperties: false } } } } }));
  const after = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { added: { type: 'string' } }, additionalProperties: false } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'schema.property'));
  assert.equal(has(findings, 'schema.type'), false);
  assert.equal(has(findings, 'schema.enum'), false);
  const constrained = doc(operation({ requestBody: { content: { 'application/json': { schema: { enum: ['a'] } } } } }));
  const loose = doc(operation({ requestBody: { content: { 'application/json': { schema: {} } } } }));
  assert.equal(has(compareContracts(constrained, loose), 'schema.enum'), false);
  assert.ok(has(compareContracts(loose, constrained), 'schema.enum'));
  const typed = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'string' } } } } }));
  assert.ok(has(compareContracts(loose, typed), 'schema.type'));
});

test('additionalProperties uses conservative request and response variance', () => {
  const requestBefore = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } }));
  const requestAfter = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } } }));
  assert.ok(has(compareContracts(requestBefore, requestAfter), 'schema.additionalProperties'));
  const responseBefore = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } } } }));
  const responseAfter = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } } }));
  assert.ok(has(compareContracts(responseBefore, responseAfter), 'schema.additionalProperties'));
  const schemaBefore = doc(operation({
    requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: { type: 'string' } } } } }
  }));
  const schemaAfter = doc(operation({
    requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: { type: 'number' } } } } }
  }));
  assert.ok(has(compareContracts(schemaBefore, schemaAfter), 'schema.type'));
});

test('common assertion tightening is checked in both variance directions', () => {
  const request = (schema) => doc(operation({ requestBody: { content: { 'application/json': { schema } } } }));
  assert.ok(has(compareContracts(request({ type: 'string', maxLength: 12 }), request({ type: 'string', maxLength: 4 })), 'schema.maxLength'));
  assert.ok(has(compareContracts(request({ type: 'string' }), request({ type: 'string', pattern: '^[A-Z]+$' })), 'schema.pattern'));
  assert.ok(has(compareContracts(request({ type: 'number', minimum: 1, maximum: 10 }), request({ type: 'number', minimum: 2, maximum: 9 })), 'schema.minimum'));
  assert.ok(has(compareContracts(request({ type: 'array', items: { type: 'string' } }), request({ type: 'array', items: { type: 'number' }, uniqueItems: true })), 'schema.type'));
  assert.ok(has(compareContracts(request({ nullable: true }), request({ nullable: false, const: 'x' })), 'schema.nullable'));
  const response = (schema) => doc(operation({ responses: { 200: { content: { 'application/json': { schema } } } } }));
  assert.ok(has(compareContracts(response({ type: 'string', maxLength: 4, pattern: '^[A-Z]+$' }), response({ type: 'string', maxLength: 12 })), 'schema.maxLength'));
  assert.ok(has(compareContracts(response({ type: 'array', uniqueItems: true, items: { type: 'string' } }), response({ type: 'array', uniqueItems: false, items: { type: 'string' } })), 'schema.uniqueItems'));
  assert.ok(compareContracts(request({ oneOf: [{ type: 'string' }] }), request({ oneOf: [{ type: 'number' }] })).some((item) => item.kind === 'schema.inconclusive'));
});

test('boolean schemas, const changes, hostile properties, Swagger keywords, and unknown assertions fail closed', () => {
  const request = (schema) => doc(operation({ requestBody: { content: { 'application/json': { schema } } } }));
  assert.ok(has(compareContracts(request(true), request(false)), 'schema.boolean'));
  assert.ok(has(compareContracts(request({ type: 'array', items: true }), request({ type: 'array', items: false })), 'schema.boolean'));
  assert.ok(has(compareContracts(request({ const: 'A' }), request({ const: 'B' })), 'schema.const'));
  const hostileProperties = Object.create(null); Object.defineProperty(hostileProperties, '__proto__', { value: { type: 'string' }, enumerable: true });
  assert.ok(has(compareContracts(request({ type: 'object', properties: hostileProperties }), request({ type: 'object', properties: {} })), 'schema.property'));
  const swaggerBefore = { swagger: '2.0', paths: { '/x': { get: { parameters: [{ name: 'q', in: 'query', type: 'string', maxLength: 12 }], responses: { 200: { schema: { type: 'string' } } } } } } };
  const swaggerAfter = structuredClone(swaggerBefore); swaggerAfter.paths['/x'].get.parameters[0].maxLength = 4;
  assert.ok(has(compareContracts(swaggerBefore, swaggerAfter), 'schema.maxLength'));
  assert.ok(compareContracts(request({ minContains: 1 }), request({ minContains: 2 })).some((item) => item.kind === 'schema.inconclusive'));
});

test('local refs decode JSON Pointer and resolve all comparison entry points', () => {
  const base = {
    openapi: '3.1.0',
    components: {
      schemas: { 'A/B': { type: 'string' }, 'T~N': { type: 'number' } },
      parameters: { query: { name: 'q', in: 'query', schema: { $ref: '#/components/schemas/A~1B' } } },
      requestBodies: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/A~1B' } } } } },
      responses: { ok: { content: { 'application/json': { schema: { $ref: '#/components/schemas/A~1B' } } } } }
    },
    paths: { '/x': { get: { parameters: [{ $ref: '#/components/parameters/query' }], requestBody: { $ref: '#/components/requestBodies/body' }, responses: { 200: { $ref: '#/components/responses/ok' } } } } }
  };
  const changed = structuredClone(base);
  changed.components.schemas['A/B'] = { $ref: '#/components/schemas/T~0N' };
  const findings = compareContracts(base, changed);
  assert.ok(has(findings, 'schema.type'));
  const pathRef = structuredClone(base);
  pathRef.components.pathItems = { x: pathRef.paths['/x'] };
  pathRef.paths['/x'] = { $ref: '#/components/pathItems/x' };
  assert.doesNotThrow(() => compareContracts(pathRef, pathRef));
  const cycle = structuredClone(base);
  cycle.components.schemas.loop = { $ref: '#/components/schemas/loop' };
  cycle.components.parameters.query.schema = { $ref: '#/components/schemas/loop' };
  assert.throws(() => compareContracts(cycle, base), /循环引用/);
  const bad = structuredClone(base);
  bad.components.parameters.query = { $ref: '#/components/parameters/missing' };
  assert.throws(() => compareContracts(bad, base), /本地 \$ref 无效/);
});

test('effective global and operation security respects explicit empty arrays', () => {
  const before = doc(operation(), { security: [{ bearer: [] }] });
  const anonymous = doc(operation({ security: [] }), { security: [{ bearer: [] }] });
  const required = doc(operation(), {});
  assert.ok(compareContracts(before, anonymous).some((item) => item.level === 'info' && item.kind === 'security'));
  assert.ok(has(compareContracts(anonymous, before), 'security'));
  assert.ok(has(compareContracts(required, before), 'security'));
  assert.equal(compareContracts(required, doc(operation({ security: [] }))).some((item) => item.kind === 'security'), false);
  const reordered = doc(operation(), { security: [{ oauth: ['write', 'read'], bearer: [] }, { api: [] }] });
  assert.equal(compareContracts(doc(operation(), { security: [{ api: [] }, { bearer: [], oauth: ['read', 'write'] }] }), reordered).some((item) => item.kind === 'security'), false);
});

test('an empty security requirement object remains a valid anonymous alternative', () => {
  const anonymousObject = doc(operation({ security: [{}] }));
  const anonymousMixed = doc(operation({ security: [{ bearer: [] }, {}] }));
  const anonymousEmpty = doc(operation({ security: [] }));
  const required = doc(operation({ security: [{ bearer: [] }] }));
  assert.equal(compareContracts(anonymousObject, anonymousEmpty).some((item) => item.kind === 'security'), false);
  assert.equal(compareContracts(anonymousMixed, anonymousEmpty).some((item) => item.kind === 'security'), false);
  assert.ok(has(compareContracts(anonymousObject, required), 'security'));
  assert.ok(compareContracts(required, anonymousObject).some((item) => item.level === 'info' && item.kind === 'security'));
});

test('reports non-breaking methods, optional parameters and properties', () => {
  const before = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {} } } } } }));
  const after = {
    openapi: '3.1.0',
    paths: {
      '/pets/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: operation({ parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } } } } } } }),
        post: operation()
      }
    }
  };
  const levels = compareContracts(before, after).filter((item) => item.level === 'non-breaking');
  assert.ok(levels.some((item) => item.reason.includes('新增可选参数')));
  assert.ok(levels.some((item) => item.reason.includes('新增可选请求属性')));
  assert.ok(levels.some((item) => item.kind === 'method'));
});

test('YAML is parsed only in preload and aliases/tags are rejected there', () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testGrant([fixture]);
  assert.equal(JSON.parse(preload.readGranted()[0]).paths['/pets'].get.parameters[0].name, 'limit');
  for (const name of ['alias.yaml', 'tag.yaml']) {
    preload.__testGrant([fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))]);
    assert.throws(() => preload.readGranted(), /不允许 YAML 锚点、别名或显式标签/);
  }
  assert.throws(() => parseDocument('openapi: 3.1.0\npaths: {}'));
});

test('markdown escapes untrusted fields and pointers are escaped', () => {
  const markdown = reportMarkdown([{ level: 'breaking', kind: 'schema.type', pointer: '/a/~b', reason: '<bad>\ntext' }]);
  assert.match(markdown, /数据类型/);
  assert.doesNotMatch(markdown, /schema\.type/);
  assert.match(markdown, /\\<bad\\> text/);
  assert.match(markdown, /^# OpenAPI 契约门禁报告/m);
  assert.match(markdown, /^## 破坏性变更/m);
  assert.ok(compareContracts({ openapi: '3.0.0', paths: { '/a/b': { get: operation() } } }, { openapi: '3.0.0', paths: {} }).some((item) => item.pointer === '/paths/~1a~1b'));
  const nested = compareContracts(doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }] })), doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: 'number' } }] })));
  assert.ok(nested.some((item) => item.pointer === '/paths/~1pets~1{id}/get/parameters/query:q/schema'));
});

test('every stable finding kind has a deterministic Chinese human label', () => {
  const expected = { endpoint: '接口端点', method: '请求方法', parameter: '参数', 'parameter.required': '参数必填性', response: '响应', security: '安全要求', 'requestBody.required': '请求体必填性', 'requestBody.content': '请求体内容类型', 'response.content': '响应内容类型', 'schema.type': '数据类型', 'schema.enum': '枚举范围', 'schema.required': '必填字段', 'schema.property': '对象属性', 'schema.additionalProperties': '附加属性策略', 'schema.boolean': '布尔结构定义', 'schema.inconclusive': '无法确定的结构约束', 'schema.minLength': '最小长度', 'schema.minimum': '最小值', 'schema.exclusiveMinimum': '排他最小值', 'schema.minItems': '最少元素数', 'schema.minProperties': '最少属性数', 'schema.maxLength': '最大长度', 'schema.maximum': '最大值', 'schema.exclusiveMaximum': '排他最大值', 'schema.maxItems': '最多元素数', 'schema.maxProperties': '最多属性数', 'schema.nullable': '可空性', 'schema.const': '常量值', 'schema.pattern': '正则模式', 'schema.format': '格式约束', 'schema.multipleOf': '倍数约束', 'schema.uniqueItems': '元素唯一性', 'schema.items': '数组元素' };
  for (const [kind, label] of Object.entries(expected)) assert.equal(humanFindingKind(kind), label);
  assert.equal(humanFindingKind('schema.future'), '未分类变更');
});

test('preload clears canceled, expired and failed multi-file selections', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testGrant([fixture]);
  const preserved = preload.__testGrants()[0];
  preload.readGranted();
  assert.equal(preload.__testGrants().length, 1);
  assert.doesNotThrow(() => fs.fstatSync(preserved.fd));
  let replacedGrantClosed = false;
  preload.__testSetCloseSync(function observedClose(fd) {
    if (fd === preserved.fd) replacedGrantClosed = true;
    return fs.closeSync(fd);
  });
  try { preload.__testGrant([fixture]); }
  finally { preload.__testResetCloseSync(); }
  assert.equal(replacedGrantClosed, true);
  await preload.bridge({ showOpenDialog: async () => ({ filePaths: [] }) }).choose();
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => preload.__testGrant([fixture, '/does-not-exist.yaml']));
  assert.equal(preload.__testGrants().length, 0);
  preload.__testGrant([fixture]);
  preload.__testGrants()[0].until = 0;
  assert.throws(() => preload.readGranted(), /授权已过期/);
  assert.equal(preload.__testGrants().length, 0);
  preload.__testGrant([fixture], 5);
  const automaticallyExpired = preload.__testGrants()[0];
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(automaticallyExpired.fd), { code: 'EBADF' });
});

test('failed descriptor close revokes file metadata and the next authorization retries it immediately', () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testClear();
  preload.__testGrant([fixture]);
  const selected = preload.__testGrants()[0];
  let failOnce = true;
  let retried = false;
  preload.__testSetCloseSync((fd) => {
    if (fd === selected.fd && failOnce) {
      failOnce = false;
      const error = new Error('simulated interrupted close');
      error.code = 'EINTR';
      throw error;
    }
    if (fd === selected.fd) retried = true;
    return fs.closeSync(fd);
  });
  try {
    preload.__testClear();
    assert.equal(preload.__testGrants().length, 0);
    assert.equal(preload.__testPendingCloses().length, 1);
    assert.deepEqual(Object.keys(preload.__testPendingCloses()[0]).sort(), ['closeFailed', 'closed', 'fd']);
    assert.equal(Object.hasOwn(preload.__testPendingCloses()[0], 'real'), false);
    assert.doesNotThrow(() => fs.fstatSync(selected.fd));

    preload.__testGrant([fixture]);
    assert.equal(preload.__testPendingCloses().length, 0);
    assert.equal(retried, true);
  } finally {
    preload.__testResetCloseSync();
    preload.__testRetryPendingCloses();
    preload.__testClear();
  }
});

test('grant replacement queues only a descriptor and plugin exit retries it', () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testClear();
  preload.__testGrant([fixture]);
  const replaced = preload.__testGrants()[0];
  let failOnce = true;
  preload.__testSetCloseSync((fd) => {
    if (fd === replaced.fd && failOnce) {
      failOnce = false;
      const error = new Error('simulated close failure');
      error.code = 'EIO';
      throw error;
    }
    return fs.closeSync(fd);
  });
  try {
    preload.__testGrant([fixture]);
    const replacement = preload.__testGrants()[0];
    assert.equal(preload.__testPendingCloses().length, 1);
    assert.deepEqual(Object.keys(preload.__testPendingCloses()[0]).sort(), ['closeFailed', 'closed', 'fd']);
    assert.equal(JSON.stringify(preload.__testPendingCloses()).includes(fixture), false);

    let onPluginOut;
    preload.bridge({ onPluginOut(listener) { onPluginOut = listener; } });
    onPluginOut();
    assert.equal(preload.__testPendingCloses().length, 0);
    assert.equal(preload.__testGrants().length, 0);
    assert.throws(() => fs.fstatSync(replaced.fd), { code: 'EBADF' });
    assert.throws(() => fs.fstatSync(replacement.fd), { code: 'EBADF' });
  } finally {
    preload.__testResetCloseSync();
    preload.__testRetryPendingCloses();
    preload.__testClear();
  }
});

test('TTL cleanup uses the fd-only timer fallback and EBADF is already closed', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testClear();
  preload.__testGrant([fixture], 5);
  const expiring = preload.__testGrants()[0];
  let failOnce = true;
  preload.__testSetCloseSync((fd) => {
    if (fd === expiring.fd && failOnce) {
      failOnce = false;
      const error = new Error('simulated close failure');
      error.code = 'EIO';
      throw error;
    }
    return fs.closeSync(fd);
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(preload.__testGrants().length, 0);
    assert.equal(preload.__testPendingCloses().length, 1);
    await new Promise((resolve) => setTimeout(resolve, 125));
    assert.equal(preload.__testPendingCloses().length, 0);
    assert.throws(() => fs.fstatSync(expiring.fd), { code: 'EBADF' });

    preload.__testGrant([fixture]);
    const externallyClosed = preload.__testGrants()[0];
    fs.closeSync(externallyClosed.fd);
    preload.__testClear();
    assert.equal(preload.__testPendingCloses().length, 0);
  } finally {
    preload.__testResetCloseSync();
    preload.__testRetryPendingCloses();
    preload.__testClear();
  }
});

test('plugin exit clears preserved UI grants without exposing paths or tokens', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  let onPluginOut;
  const renderer = preload.bridge({
    onPluginOut(callback) { onPluginOut = callback; },
    showOpenDialog: async () => ({ filePaths: [fixture, fixture] })
  });
  const names = await renderer.choose();
  assert.deepEqual(names, ['openapi.yaml', 'openapi.yaml']);
  assert.equal(JSON.stringify(names).includes(path.dirname(fixture)), false);
  assert.deepEqual(Object.keys(renderer).sort(), ['choose', 'copyText', 'readGranted']);
  renderer.readGranted();
  const selected = [...preload.__testGrants()];
  assert.equal(selected.length, 2);
  onPluginOut();
  assert.equal(preload.__testGrants().length, 0);
  for (const item of selected) assert.throws(() => fs.fstatSync(item.fd), { code: 'EBADF' });
});

test('plugin exit invalidates a pending contract chooser before it can restore file grants', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  let onPluginOut;
  let resolveDialog;
  const dialog = new Promise((resolve) => { resolveDialog = resolve; });
  const renderer = preload.bridge({
    onPluginOut(callback) { onPluginOut = callback; },
    showOpenDialog: async () => dialog
  });
  const pending = renderer.choose();
  onPluginOut();
  resolveDialog({ filePaths: [fixture, fixture] });
  await assert.rejects(pending, (error) => error?.code === 'SESSION_EXPIRED');
  assert.equal(preload.__testGrants().length, 0);
});

test('grant identity rejects same-inode same-size rewrites with restored mtime', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'test', 'openapi-identity-'));
  const file = path.join(directory, 'contract.json');
  const before = JSON.stringify({ openapi: '3.1.0', paths: {}, info: { title: 'A' } });
  const after = JSON.stringify({ openapi: '3.1.0', paths: {}, info: { title: 'B' } });
  assert.equal(Buffer.byteLength(before), Buffer.byteLength(after));
  fs.writeFileSync(file, before);
  const fixedTime = new Date(1700000000000);
  fs.utimesSync(file, fixedTime, fixedTime);
  const original = fs.statSync(file);
  preload.__testGrant([file]);
  const identity = preload.__testGrants()[0];
  assert.equal(typeof identity.ctime, 'number');
  assert.match(identity.digest, /^[a-f0-9]{64}$/);
  fs.writeFileSync(file, after);
  fs.utimesSync(file, original.atime, original.mtime);
  const changed = fs.statSync(file);
  assert.equal(changed.ino, original.ino);
  assert.equal(changed.size, original.size);
  assert.equal(changed.mtimeMs, original.mtimeMs);
  assert.throws(() => preload.readGranted(), /发生变化|不一致/);
  assert.equal(preload.__testGrants().length, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('grant identity fails closed when a file is rewritten during the same-handle read', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'test', 'openapi-mid-read-'));
  const file = path.join(directory, 'contract.json');
  const before = JSON.stringify({ openapi: '3.1.0', paths: {}, info: { title: 'A' } });
  const after = JSON.stringify({ openapi: '3.1.0', paths: {}, info: { title: 'B' } });
  fs.writeFileSync(file, before);
  const fixedTime = new Date(1700000000000);
  fs.utimesSync(file, fixedTime, fixedTime);
  const original = fs.statSync(file);
  preload.__testGrant([file]);
  const selectedFd = preload.__testGrants()[0].fd;
  const originalRead = fs.readSync;
  let rewritten = false;
  fs.readSync = function patchedRead(fd, ...args) {
    if (fd === selectedFd && !rewritten) {
      rewritten = true;
      fs.writeFileSync(file, after);
      fs.utimesSync(file, original.atime, original.mtime);
    }
    return originalRead.call(this, fd, ...args);
  };
  try {
    assert.throws(() => preload.readGranted(), /读取期间发生变化|不一致/);
    assert.equal(rewritten, true);
    assert.equal(preload.__testGrants().length, 0);
  } finally {
    fs.readSync = originalRead;
    preload.__testClear();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('document parsing accepts only OpenAPI 3.x or Swagger 2.0 with plain-object paths', async () => {
  assert.doesNotThrow(() => parseDocument(JSON.stringify({ openapi: '3.0.0', paths: {} })));
  assert.doesNotThrow(() => parseDocument(JSON.stringify({ openapi: '3.1.1-beta.1', paths: {} })));
  assert.doesNotThrow(() => parseDocument(JSON.stringify({ openapi: '3.1.1-beta.1+build.7', paths: {} })));
  assert.doesNotThrow(() => parseDocument(JSON.stringify({ swagger: '2.0', paths: {} })));
  for (const invalid of [
    { openapi: '2.0.0', paths: {} },
    { openapi: '4.0.0', paths: {} },
    { openapi: 3.1, paths: {} },
    { swagger: '2.1', paths: {} },
    { swagger: 2, paths: {} },
    { openapi: '3.1.0', paths: [] },
    { openapi: '3.1.0', paths: null }
  ]) assert.throws(() => parseDocument(JSON.stringify(invalid)), /OpenAPI 3\.x|paths 必须是普通对象/);
  const valid = JSON.stringify({ openapi: '3.1.0', paths: {} });
  await assert.rejects(preload.compareInline({ before: JSON.stringify({ openapi: '4.0.0', paths: {} }), after: valid, format: 'json' }), (error) => error.code === 'CONTRACT_COMPARISON_FAILED');
});

test('node auditing counts flat object fields and array entries', () => {
  const fields = Object.fromEntries(Array.from({ length: 40001 }, (_, index) => [`f${index}`, index]));
  assert.throws(() => parseDocument(JSON.stringify({ openapi: '3.1.0', paths: {}, components: fields })), /节点数量超过限制/);
  assert.throws(() => parseDocument(JSON.stringify({ openapi: '3.1.0', paths: {}, values: Array(40001).fill(0) })), /节点数量超过限制/);
});

test('large comparisons use a bounded page collector and a hard finding ceiling', () => {
  const paths = Object.fromEntries(Array.from({ length: 350 }, (_, index) => [`/route-${String(index).padStart(3, '0')}`, { get: operation() }]));
  const collector = createFindingPageCollector(100, 100);
  assert.equal(compareContracts({ openapi: '3.1.0', paths }, { openapi: '3.1.0', paths: {} }, collector), collector);
  assert.equal(collector.counts.breaking, 350);
  assert.equal(collector.counts.total, 350);
  assert.equal(collector.findings.length, 100);
  assert.equal(collector.findings[0].pointer, '/paths/~1route-100');
  const excessivePaths = Object.fromEntries(Array.from({ length: 10001 }, (_, index) => [`/x-${index}`, { get: operation() }]));
  assert.throws(() => compareContracts({ openapi: '3.1.0', paths: excessivePaths }, { openapi: '3.1.0', paths: {} }), /差异数量超过 10000 条限制/);
});

test('renderer uses DOM text and path contract is cross-platform', () => {
  const renderer = fs.readFileSync(new URL('../src/main/app.js', import.meta.url), 'utf8');
  assert.equal(renderer.includes('innerHTML'), false);
  assert.match(renderer, /const UI_PAGE_SIZE = 100/);
  assert.match(renderer, /createFindingPageCollector\(offset, UI_PAGE_SIZE\)/);
  assert.match(renderer, /humanFindingKind\(finding\.kind\)/);
  assert.match(renderer, /function showError\(error\)[\s\S]*?currentPage = null;[\s\S]*?setResultControls\(false\)/);
  assert.match(renderer, /if \(currentPage\) window\.contractGate\?\.copyText/);
  const html = fs.readFileSync(new URL('../src/main/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="copy-md" disabled/);
  assert.match(html, /id="previous-page" disabled/);
  assert.match(html, /id="next-page" disabled/);
  const style = fs.readFileSync(new URL('../src/main/style.css', import.meta.url), 'utf8');
  assert.match(style, /\.entry code\{[^}]*overflow-wrap:anywhere/);
  assert.match(style, /textarea\{[^}]*min-width:0/);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/core/contract.js', import.meta.url), 'utf8'), /^\s*import\s/m);
  for (const platform of ['win32', 'darwin', 'linux']) assert.ok(pathContract(platform, platform === 'win32' ? 'C:\\x\\a.yaml' : '/x/a.yaml').accepted);
});
