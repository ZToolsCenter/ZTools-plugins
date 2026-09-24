// 编解码往返测试（node 直跑，不依赖 DOM）
// 用法: node scripts/test-codec.mjs

import { encodeCell, encodeRow, encodeTable, parseDelimited, encodeCsv, parseCsv, parseTsv } from '../src/domain/codec/tsv.ts'
import {
  rowsToTsv,
  parseImportText,
  splitMulti,
  mapRowValues,
  autoColumnMap,
  formatCell
} from '../src/domain/codec/tableCodec.ts'
import { toBackup, serializeBackup, parseBackup } from '../src/domain/codec/jsonBackup.ts'
import { coerceFieldValue, defaultValue, displayValue } from '../src/domain/fieldTypes.ts'

let pass = 0
let fail = 0
function assert(name, cond, detail) {
  if (cond) {
    pass += 1
    console.log('PASS', name)
  } else {
    fail += 1
    console.error('FAIL', name, detail ?? '')
  }
}
function assertEq(name, a, b) {
  assert(name, JSON.stringify(a) === JSON.stringify(b), `got=${JSON.stringify(a)} expected=${JSON.stringify(b)}`)
}

// --- cell encode ---
assertEq('empty cell', encodeCell(''), '')
assertEq('plain cell', encodeCell('成绩管理'), '成绩管理')
assertEq('quote cell', encodeCell('a"b'), '"a""b"')
assertEq('tab cell', encodeCell('a\tb'), '"a\tb"')
assertEq('newline cell', encodeCell('a\nb'), '"a\nb"')
assertEq('chinese', encodeCell('标签、中文'), '标签、中文')

// --- roundtrip cells ---
const tricky = ['', '普通', '含\t制表', '含\n换行', '含"引号"', 'a""b', '#125189', 'https://x.com/?a=1&b=2', 'v1、成绩录入、成绩标记']
const rowStr = encodeRow(tricky)
const parsedRow = parseDelimited(rowStr)[0]
assertEq('roundtrip row cells', parsedRow, tricky)

// --- multi rows ---
const matrix = [
  ['pm号', '模块', '标签', '笔记链接'],
  ['#125189', '成绩管理', 'v1、成绩录入', ''],
  ['#103313', '成绩管理', 'v1', 'https://a.com/x'],
  ['含\t与"混', '模\n块', 'a、b', '']
]
const tsv = encodeTable(matrix)
assertEq('roundtrip matrix tsv', parseTsv(tsv), matrix)
const csv = encodeCsv(matrix)
assertEq('roundtrip matrix csv', parseCsv(csv), matrix)

// --- splitMulti ---
assertEq('split 、', splitMulti('v1、成绩录入、成绩标记'), ['v1', '成绩录入', '成绩标记'])
assertEq('split ,', splitMulti('a, b ,c'), ['a', 'b', 'c'])
assertEq('split ，', splitMulti('x，y'), ['x', 'y'])
assertEq('split |', splitMulti('x|y'), ['x', 'y'])
assertEq('url intact', splitMulti('https://a.com/b/c'), ['https://a.com/b/c'])
assertEq('empty multi', splitMulti('  '), [])
assertEq('mixed seps', splitMulti('v1, v2|v3、v4'), ['v1', 'v2', 'v3', 'v4'])

// --- field coerce ---
assertEq('coerce number', coerceFieldValue({ id: '1', name: 'n', type: 'number' }, '1,234'), 1234)
assertEq('coerce date', coerceFieldValue({ id: '1', name: 'd', type: 'date' }, '2026/9/3'), '2026-09-03')
assertEq('coerce checkbox', coerceFieldValue({ id: '1', name: 'c', type: 'checkbox' }, '是'), true)
assertEq('coerce multi', coerceFieldValue({ id: '1', name: 'm', type: 'list' }, 'a、b,c'), ['a', 'b', 'c'])

// --- fields + rows export ---
const fields = [
  { id: 'f1', name: 'pm号', type: 'text' },
  { id: 'f2', name: '模块', type: 'select', options: ['成绩管理'] },
  { id: 'f3', name: '标签', type: 'multi_select', options: [] },
  { id: 'f4', name: '笔记链接', type: 'url' }
]
const rows = [
  {
    id: 'r1',
    tableId: 't1',
    createdAt: 1,
    updatedAt: 1,
    values: { f1: '#125189', f2: '成绩管理', f3: ['v1', '成绩录入', '成绩标记'], f4: '' }
  },
  {
    id: 'r2',
    tableId: 't1',
    createdAt: 2,
    updatedAt: 2,
    values: { f1: '#103313', f2: '成绩管理', f3: ['v1', '学生端', '成绩查询'], f4: 'https://n.com/1' }
  }
]
const outTsv = rowsToTsv(fields, rows)
const back = parseImportText(outTsv)
assertEq('export headers', back.headers, ['pm号', '模块', '标签', '笔记链接'])
assertEq('export row0 tags', back.dataRows[0][2], 'v1、成绩录入、成绩标记')
assertEq('export data rows', back.dataRows.length, 2)

const cmap = autoColumnMap(fields, back.headers)
assertEq('auto map', cmap, { 0: 'f1', 1: 'f2', 2: 'f3', 3: 'f4' })
const mapped = mapRowValues(fields, back.headers, back.dataRows[0], cmap)
assertEq('map tags back', mapped.f3, ['v1', '成绩录入', '成绩标记'])
assertEq('map pm', mapped.f1, '#125189')

// --- JSON backup roundtrip ---
const schema = {
  id: 't1',
  name: '工作记录',
  fields,
  createdAt: 1,
  updatedAt: 2
}
const backup = toBackup([schema], { t1: rows }, '、')
const restored = parseBackup(serializeBackup(backup))
assertEq('backup tables', restored.tables.length, 1)
assertEq('backup rows', restored.tables[0].rows.length, 2)
assertEq('backup fields', restored.tables[0].schema.fields.length, 4)

// --- display ---
assertEq('display multi', formatCell(fields[2], ['a', 'b']), 'a、b')
assertEq('display empty multi', formatCell(fields[2], []), '')
assertEq('default multi', defaultValue('multi_select'), [])
assertEq('display checkbox true', displayValue({ id: 'x', name: 'c', type: 'checkbox' }, true), '是')

// --- empty / edge import ---
assertEq('parse empty', parseImportText(''), { headers: [], dataRows: [] })
const onlyHeader = parseImportText('a\tb\n')
assertEq('only header', onlyHeader.dataRows.length, 0)

console.log(`\nResult: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
