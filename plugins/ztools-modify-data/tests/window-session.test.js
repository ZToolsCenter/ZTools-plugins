'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sessions = require('../lib/window-session');

test('large-window transfer preserves a large unsaved draft and can only be consumed once', () => {
  const context = { root: 'test-root', account: 'default', plugin: 'notes', draft: '{\n' + ' '.repeat(600000) + '"value":false\n}', mode: 'document', initial: '{}', record: { token: 'original-token' } };
  const token = sessions.create(context);
  try { assert.deepEqual(sessions.take(token), context); assert.throws(() => sessions.take(token), /ENOENT/); }
  finally { sessions.discard(token); }
});

test('window transfer rejects paths and oversized payloads', () => {
  assert.throws(() => sessions.take('../../outside'), /会话无效/);
  assert.throws(() => sessions.create({ draft: 'x'.repeat(17 * 1024 * 1024) }), /内容过大/);
});
