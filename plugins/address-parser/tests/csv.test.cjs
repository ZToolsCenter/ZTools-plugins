"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const csv = require("../core/csv.js");

test("CSV 默认包含 UTF-8 BOM、固定表头和 CRLF", function () {
  const output = csv.recordsToCsv([]);
  assert.equal(output.charCodeAt(0), 0xFEFF);
  assert.match(output, /^\uFEFF序号,姓名,电话,省,市,区县,详细地址,完整原文,缺失字段\r\n$/);
});

test("CSV 正确转义逗号、引号和换行", function () {
  const output = csv.recordsToCsv([{ id: 1, name: '张"三', phone: "13800138000", province: "广东省", city: "深圳市", district: "南山区", detail: "科技园,1号", original: "第一行\n第二行", missingFields: [] }], { includeBom: false });
  assert.match(output, /"张""三"/);
  assert.match(output, /"科技园,1号"/);
  assert.match(output, /"第一行\n第二行"/);
});

test("CSV 防止公式注入并输出中文缺失字段", function () {
  const output = csv.recordsToCsv([{ id: 1, name: "=cmd", phone: "", province: "", city: "", district: "", detail: "", original: "@SUM(1)", missingFields: ["phone", "district"] }], { includeBom: false });
  assert.match(output, /'=cmd/);
  assert.match(output, /'@SUM\(1\)/);
  assert.match(output, /电话、区县/);
});

test("Excel 打开 CSV 时保留手机和座机的前导零", function () {
  const output = csv.recordsToCsv([
    { id: 1, name: "赵敏", phone: "02161234567", province: "上海市", city: "上海市", district: "浦东新区", detail: "张江路1号", original: "", missingFields: [] },
    { id: 2, name: "张三", phone: "13800138000", province: "广东省", city: "深圳市", district: "南山区", detail: "科苑路1号", original: "", missingFields: [] }
  ], { includeBom: false });
  assert.match(output, /,="02161234567",/);
  assert.match(output, /,="13800138000",/);
  assert.equal(csv.formatPhoneCell("+86=cmd"), "'+86=cmd");
});

test("CSV 公式防护覆盖控制字符和前导空白", function () {
  assert.equal(csv.escapeCell(" =1+1"), "' =1+1");
  assert.equal(csv.escapeCell("\t=1+1"), "'\t=1+1");
  assert.equal(csv.escapeCell("\r@SUM(1)"), "\"'\r@SUM(1)\"");
});
