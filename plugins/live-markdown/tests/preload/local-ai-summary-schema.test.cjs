const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateOutputSchema } = require('../../preload/local-ai/output-constraint.cjs');

test('allows bounded fact ID arrays without opening unsupported schema keywords', () => {
  const schema = { type: 'object', properties: { ids: { type: 'array', items: { enum: ['f1', 'f2'] }, minItems: 0, maxItems: 2 } }, required: ['ids'], additionalProperties: false };
  assert.equal(JSON.stringify(validateOutputSchema(schema)), JSON.stringify(schema));
});
test('rejects unsafe array bounds, tuples, and recursive unsupported item constraints', () => {
  for (const schema of [
    { type: 'array', items: [] },
    { type: 'array', items: { $ref: '#/$defs/missing' } },
    { type: 'array', items: { $ref: '#/$defs/loop' }, $defs: { loop: { type: 'array', items: { $ref: '#/$defs/loop' } } } },
    { type: 'array', items: { type: 'string', pattern: '.*' } },
    { type: 'array', items: { type: 'string' }, minItems: -1 },
    { type: 'array', items: { type: 'string' }, maxItems: 257 },
    { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 2 }
  ]) assert.throws(() => validateOutputSchema(schema));
});
