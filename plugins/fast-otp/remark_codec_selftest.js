const assert = require('assert');
const { escapeRemark, unescapeRemark } = require('./remark_codec');

function roundTrip(input) {
  return unescapeRemark(escapeRemark(input));
}

const cases = [
  '',
  'plain',
  '中文备注',
  'line1\nline2',
  'folder\\name', // 字面量 \n
  'literal \\n',
  'trailing backslash \\',
  'mix: \\\\ and \\n and \n',
  'contains & = % ? #',
];

for (const input of cases) {
  const output = roundTrip(input);
  assert.strictEqual(output, input, `roundtrip failed: ${JSON.stringify({ input, output })}`);
}

assert.strictEqual(escapeRemark('a\nb'), 'a\\nb');
assert.strictEqual(unescapeRemark('a\\nb'), 'a\nb');
assert.strictEqual(unescapeRemark('a\\\\nb'), 'a\\nb');

console.log('OK: remark codec roundtrip');
