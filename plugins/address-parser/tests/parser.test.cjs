"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../core/address-parser.js");

test("解析常规的姓名、手机号和省市区", function () {
  const result = parser.parseAddress("张三 13800138000 广东省深圳市南山区粤海街道科技园科苑路 15 号", 1);
  assert.deepEqual(
    { name: result.name, phone: result.phone, province: result.province, city: result.city, district: result.district, detail: result.detail },
    { name: "张三", phone: "13800138000", province: "广东省", city: "深圳市", district: "南山区", detail: "粤海街道科技园科苑路 15 号" }
  );
  assert.equal(result.complete, true);
});

test("识别字段标签、带分隔符手机号和直辖市", function () {
  const result = parser.parseAddress("收件人：李晓明 电话：139-1234-5678 地址：北京市朝阳区望京街道阜通东大街 6 号");
  assert.equal(result.name, "李晓明");
  assert.equal(result.phone, "13912345678");
  assert.equal(result.province, "北京市");
  assert.equal(result.city, "北京市");
  assert.equal(result.district, "朝阳区");
  assert.equal(result.detail, "望京街道阜通东大街 6 号");
});

test("识别 +86 手机号、全角数字和自治区", function () {
  const result = parser.parseAddress("姓名:阿依古丽 手机:+８６ １３３ ００００ ２２２２ 收货地址:新疆维吾尔自治区乌鲁木齐市天山区青年路1号");
  assert.equal(result.name, "阿依古丽");
  assert.equal(result.phone, "13300002222");
  assert.equal(result.province, "新疆维吾尔自治区");
  assert.equal(result.city, "乌鲁木齐市");
  assert.equal(result.district, "天山区");
  assert.equal(result.detail, "青年路1号");
});

test("识别座机号码与直辖市新区", function () {
  const result = parser.parseAddress("赵敏 021-61234567 上海市浦东新区张江镇祖冲之路 1239 弄 2 号楼");
  assert.equal(result.phone, "02161234567");
  assert.equal(result.phoneType, "landline");
  assert.equal(result.city, "上海市");
  assert.equal(result.district, "浦东新区");
});

test("缺失字段会被逐项标记", function () {
  const result = parser.parseAddress("张三 13800138000 广东省深圳市科技园 1 号");
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingFields, ["district"]);
});

test("每行一条模式保留缺少电话的记录", function () {
  const results = parser.parseBatch("张三 13800138000 广东省深圳市南山区科苑路1号\n李四 浙江省杭州市余杭区文一西路2号", "line");
  assert.equal(results.length, 2);
  assert.equal(results[0].name, "张三");
  assert.equal(results[1].phone, "");
  assert.ok(results[1].missingFields.includes("phone"));
});

test("空行分组模式把多行字段合并为一条", function () {
  const input = "收件人：张三\n电话：13800138000\n地址：广东省深圳市南山区科苑路1号\n\n收件人：李四\n电话：13900139000\n地址：浙江省杭州市余杭区文一西路2号";
  const results = parser.parseBatch(input, "blank");
  assert.equal(results.length, 2);
  assert.equal(results[0].name, "张三");
  assert.equal(results[0].district, "南山区");
  assert.equal(results[1].name, "李四");
});

test("人工补全字段后重新计算完整状态", function () {
  const parsed = parser.parseAddress("张三 13800138000 广东省深圳市科技园 1 号");
  parsed.district = "南山区";
  const refreshed = parser.refreshRecord(parsed);
  assert.equal(refreshed.complete, true);
  assert.deepEqual(refreshed.missingFields, []);
});

test("覆盖 34 个省级行政区的规范名称", function () {
  const provinces = [
    "北京市", "天津市", "上海市", "重庆市", "河北省", "山西省", "辽宁省", "吉林省", "黑龙江省",
    "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省", "河南省", "湖北省", "湖南省",
    "广东省", "海南省", "四川省", "贵州省", "云南省", "陕西省", "甘肃省", "青海省", "台湾省",
    "内蒙古自治区", "广西壮族自治区", "西藏自治区", "宁夏回族自治区", "新疆维吾尔自治区",
    "香港特别行政区", "澳门特别行政区"
  ];
  provinces.forEach(function (province) {
    const result = parser.parseAddress("姓名：张三 电话：13800138000 省份：" + province + " 城市：测试市 区县：测试区 详细地址：测试路1号");
    assert.equal(result.province, province);
    assert.equal(result.city, "测试市");
    assert.equal(result.district, "测试区");
  });
});

test("批量解析保持记录顺序和稳定编号", function () {
  const line = "张三 13800138000 广东省深圳市南山区科技园1号";
  const results = parser.parseBatch(Array.from({ length: 1000 }, function () { return line; }).join("\n"), "line");
  assert.equal(results.length, 1000);
  assert.equal(results[0].id, 1);
  assert.equal(results[999].id, 1000);
  assert.equal(results.every(function (record) { return record.complete; }), true);
});

test("省份优先匹配规范行政区名称而不是姓名中的简称", function () {
  const result = parser.parseAddress("张广东 13800138000 浙江省杭州市余杭区文一西路 998 号");
  assert.equal(result.name, "张广东");
  assert.equal(result.province, "浙江省");
  assert.equal(result.city, "杭州市");
  assert.equal(result.district, "余杭区");
});

test("手机号不能从订单号、身份证号或运单号中截取", function () {
  const result = parser.parseAddress("张三 913800138000012345 浙江省杭州市余杭区文一西路 998 号");
  assert.equal(result.phone, "");
  assert.ok(result.missingFields.includes("phone"));
  assert.equal(result.detail.includes("913800138000012345"), true);
});
