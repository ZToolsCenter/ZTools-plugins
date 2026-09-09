// 单元测试 - 直接用 Node 运行：node converter_test.js
const path = require('path');
const converter = require('./converter.js');

const { numberToCapital, convertInteger, addThousandSeparator, isValidNumber } = converter;

let pass = 0;
let fail = 0;
const failures = [];

function eq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push({ label, actual, expected });
  }
}

// ---- 整数部分 ----
eq('0',        convertInteger('0'),       '零');
eq('1',        convertInteger('1'),       '壹');
eq('5',        convertInteger('5'),       '伍');
eq('10',       convertInteger('10'),      '壹拾');
eq('100',      convertInteger('100'),     '壹佰');
eq('123',      convertInteger('123'),     '壹佰贰拾叁');
eq('1234',     convertInteger('1234'),    '壹仟贰佰叁拾肆');
eq('10000',    convertInteger('10000'),   '壹万');
eq('10001',    convertInteger('10001'),   '壹万壹');
eq('1000001',  convertInteger('1000001'), '壹佰万零壹');
eq('1000101',  convertInteger('1000101'), '壹佰万零壹佰零壹');
eq('10000001', convertInteger('10000001'),'壹仟万零壹');
eq('11000001', convertInteger('11000001'),'壹仟壹佰万零壹');
eq('100000001',convertInteger('100000001'),'壹亿零壹');
eq('101000001',convertInteger('101000001'),'壹亿零壹佰万零壹');  // 1亿1百万1
eq('123456789',convertInteger('123456789'),'壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖');
eq('10010000',  convertInteger('10010000'),  '壹仟零壹万');      // 1001万（组内 0）
eq('10001000',  convertInteger('10001000'),  '壹仟万壹仟');      // 1000万 + 1000（不补零）
eq('1001000',   convertInteger('1001000'),   '壹佰万壹仟');      // 100万 + 1000（不补零）
eq('1000100',   convertInteger('1000100'),   '壹佰万零壹佰');    // 100万 + 100（补零）
eq('10000100',  convertInteger('10000100'),  '壹仟万零壹佰');    // 1000万 + 100（补零）
eq('11001',     convertInteger('11001'),     '壹万壹仟零壹');    // 1万 + 1千 + 1
eq('10001',     convertInteger('10001'),     '壹万壹');          // 1万 + 1（不补零）
eq('10000000000000', convertInteger('10000000000000'),'壹拾兆');  // 10 兆 (10万亿)
eq('100000000000000', convertInteger('100000000000000'),'壹佰兆');  // 100 兆

// ---- numberToCapital 整数（始终带"整"） ----
eq('100',      numberToCapital('100').result,      '壹佰元整');
eq('123',      numberToCapital('123').result,      '壹佰贰拾叁元整');
eq('1234',     numberToCapital('1234').result,     '壹仟贰佰叁拾肆元整');
eq('12345',    numberToCapital('12345').result,    '壹万贰仟叁佰肆拾伍元整');
eq('100000000',numberToCapital('100000000').result,'壹亿元整');
eq('16位整数', numberToCapital('9999999999999999').result, '玖仟玖佰玖拾玖兆玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元整');

// ---- numberToCapital 小数（含分位不加"整"，角位加"整"） ----
eq('100.5',    numberToCapital('100.5').result,  '壹佰元伍角整');
eq('100.50',   numberToCapital('100.50').result, '壹佰元伍角整');  // .50 末尾 0 应被截断
eq('100.05',   numberToCapital('100.05').result, '壹佰元零伍分');  // 含分严禁加整
eq('100.55',   numberToCapital('100.55').result, '壹佰元伍角伍分');
eq('0.5',      numberToCapital('0.5').result,    '零元伍角整');
eq('0.55',     numberToCapital('0.55').result,   '零元伍角伍分');
eq('0',        numberToCapital('0').result,      '零元整');
eq('0.00',     numberToCapital('0.00').result,   '零元整');

// ---- 含逗号输入 ----
eq('带逗号 1', numberToCapital('1,234').result, '壹仟贰佰叁拾肆元整');
eq('带逗号 2', numberToCapital('1,234,567').result, '壹佰贰拾叁万肆仟伍佰陆拾柒元整');

// ---- 千分位格式化 ----
eq('千分位 1234',     numberToCapital('1234').thousandSeparated,     '1,234');
eq('千分位 12345',    numberToCapital('12345').thousandSeparated,    '12,345');
eq('千分位 1234567',  numberToCapital('1234567').thousandSeparated,  '1,234,567');
eq('千分位 100',      numberToCapital('100').thousandSeparated,      '');    // < 1000 不显示
eq('千分位 999',      numberToCapital('999').thousandSeparated,      '');
eq('千分位 1000',     numberToCapital('1000').thousandSeparated,     '1,000');
eq('千分位 0',        numberToCapital('0').thousandSeparated,        '');
eq('千分位 100.5',    numberToCapital('100.5').thousandSeparated,    '');
eq('千分位 1234.56',  numberToCapital('1234.56').thousandSeparated,  '1,234.56');
eq('千分位 16位',     numberToCapital('9999999999999999').thousandSeparated, '9,999,999,999,999,999');

// ---- isValidNumber（上限 16 位） ----
eq('valid 1',     isValidNumber('123'), true);
eq('valid 2',     isValidNumber('1,234'), true);
eq('valid 3',     isValidNumber('123.45'), true);
eq('valid 4',     isValidNumber('1,234,567.89'), true);
eq('valid 16',    isValidNumber('9999999999999999'), true);
eq('valid 16逗号', isValidNumber('9,999,999,999,999,999'), true);
eq('invalid 超16', isValidNumber('99999999999999999'), false);  // 17 位
eq('invalid 1',   isValidNumber('abc'), false);
eq('invalid 2',   isValidNumber('12.345'), false);     // 3 位小数
eq('invalid 3',   isValidNumber(''), false);
eq('invalid 4',   isValidNumber('1,2'), false);        // 非法逗号位置
eq('invalid 5',   isValidNumber(',123'), false);
eq('invalid 6',   isValidNumber('123,'), false);
eq('invalid 18位逗号', isValidNumber('11,222,333,444,555,666'), false); // 18 位千分位应被拒绝
eq('invalid 17位逗号', isValidNumber('12,222,333,444,555,666'), false); // 17 位千分位应被拒绝
eq('valid 16位2开头',   isValidNumber('1,222,333,444,555,666'), true);  // 16 位 = 1 + 5×3
eq('valid 16位9开头',   isValidNumber('9,999,999,999,999,999'), true);
eq('valid 最大千分位',  isValidNumber('999,999,999,999,999'), true);     // 15 位

// ---- 加整规则 - 仅角位 ----
eq('0.1 整',  numberToCapital('0.1').result, '零元壹角整');
eq('0.10 整', numberToCapital('0.10').result, '零元壹角整');

// ---- 边界 ----
eq('超大千分位', numberToCapital('999999999999999').thousandSeparated, '999,999,999,999,999');

// ---- 报告 ----
console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${pass}`);
console.log(`失败: ${fail}`);
if (fail > 0) {
  console.log(`\n失败的用例:`);
  failures.forEach(f => {
    console.log(`  [${f.label}]`);
    console.log(`    期望: ${JSON.stringify(f.expected)}`);
    console.log(`    实际: ${JSON.stringify(f.actual)}`);
  });
  process.exit(1);
}
console.log('全部通过 ✓');
