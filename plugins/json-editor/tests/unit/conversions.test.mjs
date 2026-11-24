import assert from 'node:assert/strict'
import test from 'node:test'
import jsonToTs from 'json-to-ts'
import stripComments from 'strip-json-comments'
import { formatInput } from '../../src/json/format.ts'
import { compactJson, escapeCompactJson, parseJson, stringifyJson } from '../../src/json/parse.ts'

test('formats URL params and YAML using the original four-space indentation', () => {
  assert.equal(formatInput('name=hello+world&tag=1&tag=2'), '{\n    "name": "hello world",\n    "tag": "2"\n}')
  assert.equal(formatInput('name: test\nitems: [1, 2]'), '{\n    "name": "test",\n    "items": [\n        1,\n        2\n    ]\n}')
  assert.equal(formatInput('a=1'), 'a=1')
  assert.equal(formatInput('name: ['), 'name: [')
  assert.equal(formatInput(' \n\t'), '')
})

test('converts escaped JSON and keeps Unicode escapes required by the JSON syntax', () => {
  assert.equal(formatInput(String.raw`{\"text\":\"\u4e2d\"}`), '{"text":"中"}')
  assert.equal(formatInput(String.raw`{"text":"\u000a"}`), String.raw`{"text":"\u000a"}`)
  assert.equal(formatInput(String.raw`{"text":"\\u006e"}`), String.raw`{"text":"\\u006e"}`)
})

test('preserves long numeric literals and trailing backslashes when compressing JSON', () => {
  const source = String.raw`{ "big": 9007199254740993, "path": "C:\\", "words": "leave spaces" }`
  const compact = String.raw`{"big":9007199254740993,"path":"C:\\","words":"leave spaces"}`
  assert.equal(compactJson(source), compact)
  assert.equal(JSON.parse('"' + escapeCompactJson(source) + '"'), compact)
  assert.match(stringifyJson(parseJson(compact)), /9007199254740993/)
})

test('removes comments without damaging URL strings and produces the original TypeScript shape', () => {
  const text = stripComments('{// a comment\n"a": "https://example.com", /* another */ "b": true}')
  const value = parseJson(text)
  assert.equal(value.a, 'https://example.com')
  assert.equal(jsonToTs(value).join('\n\n'), 'interface RootObject {\n  a: string;\n  b: boolean;\n}')
  assert.throws(() => jsonToTs(parseJson('[1,2]')), /Only \(Object\)/)
})
