const surnames = [
  "赵",
  "钱",
  "孙",
  "李",
  "周",
  "吴",
  "郑",
  "王",
  "冯",
  "陈",
  "褚",
  "卫",
  "蒋",
  "沈",
  "韩",
  "杨",
  "朱",
  "秦",
  "尤",
  "许",
  "何",
  "吕",
  "施",
  "张",
  "孔",
  "曹",
  "严",
  "华",
  "金",
  "魏",
  "陶",
  "姜",
  "谢",
  "邹",
  "喻",
  "柏",
  "水",
  "窦",
  "章",
  "云",
  "苏",
  "潘",
  "葛",
  "奚",
  "范",
  "彭",
  "郎",
  "鲁",
  "韦",
  "昌",
  "马",
  "苗",
  "凤",
  "花",
  "方",
  "俞",
  "任",
  "袁",
  "柳",
];
const nameChars = [
  "子",
  "一",
  "宇",
  "泽",
  "辰",
  "睿",
  "嘉",
  "明",
  "景",
  "安",
  "梓",
  "浩",
  "然",
  "文",
  "思",
  "语",
  "若",
  "清",
  "宁",
  "欣",
  "雨",
  "涵",
  "瑶",
  "妍",
  "璇",
  "知",
  "遥",
  "昕",
  "芮",
  "可",
  "乐",
  "南",
  "北",
  "川",
  "舟",
  "航",
  "屿",
  "森",
  "朗",
  "越",
  "恒",
  "卓",
  "瑜",
  "诺",
  "尧",
  "晗",
  "奕",
  "庭",
  "沐",
  "栩",
  "棠",
  "初",
  "夏",
  "禾",
  "橙",
];
const phonePrefixes = [
  "130",
  "131",
  "132",
  "133",
  "135",
  "136",
  "137",
  "138",
  "139",
  "150",
  "151",
  "152",
  "155",
  "156",
  "157",
  "158",
  "159",
  "166",
  "170",
  "171",
  "172",
  "173",
  "175",
  "176",
  "177",
  "178",
  "180",
  "181",
  "182",
  "183",
  "184",
  "185",
  "186",
  "187",
  "188",
  "189",
  "198",
  "199",
];
const provinces = [
  "京",
  "津",
  "沪",
  "渝",
  "冀",
  "豫",
  "云",
  "辽",
  "黑",
  "湘",
  "皖",
  "鲁",
  "新",
  "苏",
  "浙",
  "赣",
  "鄂",
  "桂",
  "甘",
  "晋",
  "蒙",
  "陕",
  "吉",
  "闽",
  "贵",
  "粤",
  "青",
  "藏",
  "川",
  "宁",
  "琼",
];
const areas = [
  { code: "110105", province: "北京市", city: "北京市", district: "朝阳区" },
  { code: "110108", province: "北京市", city: "北京市", district: "海淀区" },
  { code: "310101", province: "上海市", city: "上海市", district: "黄浦区" },
  { code: "310115", province: "上海市", city: "上海市", district: "浦东新区" },
  { code: "440106", province: "广东省", city: "广州市", district: "天河区" },
  { code: "440305", province: "广东省", city: "深圳市", district: "南山区" },
  { code: "330106", province: "浙江省", city: "杭州市", district: "西湖区" },
  { code: "320102", province: "江苏省", city: "南京市", district: "玄武区" },
  { code: "510107", province: "四川省", city: "成都市", district: "武侯区" },
  { code: "420106", province: "湖北省", city: "武汉市", district: "武昌区" },
  { code: "610113", province: "陕西省", city: "西安市", district: "雁塔区" },
  { code: "350203", province: "福建省", city: "厦门市", district: "思明区" },
];
const roads = [
  "人民路",
  "建设路",
  "解放路",
  "中山路",
  "和平路",
  "新华路",
  "青年路",
  "长江路",
  "黄河路",
  "科技路",
  "文昌路",
  "滨河路",
  "望江路",
  "星河路",
];
const buildings = [
  "国际中心",
  "时代广场",
  "创业园",
  "未来城",
  "阳光花园",
  "金茂大厦",
  "云海公馆",
  "星辰社区",
  "绿地中心",
  "创智园",
];
const domains = [
  "example.com",
  "demo.cn",
  "test.io",
  "mail.test",
  "sample.net",
];
const words = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "nova",
  "orbit",
  "pixel",
  "river",
  "stone",
  "tango",
  "vector",
  "zen",
];
const companySuffixes = [
  "科技有限公司",
  "信息技术有限公司",
  "网络科技有限公司",
  "贸易有限公司",
  "文化传媒有限公司",
  "企业管理有限公司",
  "电子商务有限公司",
  "智能科技有限公司",
];
const jobs = [
  "产品经理",
  "前端工程师",
  "后端工程师",
  "测试工程师",
  "运维工程师",
  "数据分析师",
  "设计师",
  "运营专员",
  "项目经理",
  "销售经理",
  "财务专员",
  "人事专员",
];
const sentenceParts = [
  "系统正在处理新的测试数据",
  "用户提交了一条有效记录",
  "页面展示了完整的业务信息",
  "接口返回了稳定的响应结果",
  "流程进入下一步审批节点",
  "任务已经同步到目标环境",
  "配置项保持默认状态",
  "数据已写入临时表",
];
const bankPrefixes = [
  "622202",
  "622848",
  "621226",
  "622700",
  "621661",
  "622262",
  "622588",
  "621098",
  "622155",
  "622689",
];
const bankNames = [
  "中国工商银行",
  "中国农业银行",
  "中国银行",
  "中国建设银行",
  "交通银行",
  "招商银行",
  "浦发银行",
  "中信银行",
  "兴业银行",
  "民生银行",
  "平安银行",
  "中国邮政储蓄银行",
];
const englishFirstNames = [
  "James",
  "Robert",
  "John",
  "Michael",
  "William",
  "David",
  "Richard",
  "Joseph",
  "Thomas",
  "Daniel",
  "Mary",
  "Patricia",
  "Jennifer",
  "Linda",
  "Elizabeth",
  "Barbara",
  "Susan",
  "Jessica",
  "Sarah",
  "Karen",
];
const englishLastNames = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Wilson",
  "Anderson",
  "Taylor",
  "Thomas",
  "Moore",
  "Martin",
  "Lee",
  "Perez",
];
const mimeTypes = [
  "application/json",
  "application/xml",
  "application/pdf",
  "application/zip",
  "text/plain",
  "text/html",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
];
const fileExtensions = [
  "txt",
  "json",
  "csv",
  "xlsx",
  "pdf",
  "png",
  "jpg",
  "webp",
  "zip",
  "log",
  "md",
  "docx",
];
const browsers = ["Chrome", "Safari", "Firefox", "Edge"];
const systems = [
  "Windows NT 10.0; Win64; x64",
  "Macintosh; Intel Mac OS X 10_15_7",
  "X11; Linux x86_64",
  "iPhone; CPU iPhone OS 17_0 like Mac OS X",
];
const nonsensePieces = [
  "这件事情从结果来看其实并不复杂",
  "但是如果换一个角度继续分析",
  "很多细节又会呈现出完全不同的状态",
  "所以我们需要在现有基础上保持观察",
  "并且结合上下文做出相对稳妥的判断",
  "换句话说这并不是单一变量造成的现象",
  "而是多个条件同时作用后的阶段性结果",
  "从实际体验来看这种说法也比较容易理解",
  "当然这里还可以继续补充更多背景信息",
  "以便让整体表达显得更加完整和自然",
  "在没有额外限制的前提下",
  "这个结论基本可以满足当前场景的需要",
  "后续如果条件发生变化",
  "对应的处理方式也可以继续调整",
  "这就是目前比较常见的一种说明方式",
];
const chineseWords = [
  "测试",
  "数据",
  "流程",
  "系统",
  "用户",
  "订单",
  "配置",
  "接口",
  "任务",
  "状态",
  "记录",
  "页面",
  "服务",
  "节点",
  "环境",
  "权限",
  "消息",
  "文件",
  "缓存",
  "日志",
];
const emojis = [
  "😀",
  "😄",
  "😉",
  "😍",
  "🤔",
  "😎",
  "🥳",
  "👍",
  "🔥",
  "✨",
  "🚀",
  "🌟",
  "🍀",
  "🎯",
  "📌",
  "✅",
  "💡",
  "📦",
  "🧪",
  "🛠️",
];
const SETTINGS_STORAGE_KEY = "generator-settings";
const SETTINGS_DOC_ID = "__random_data_settings__";
const GENERATOR_ICON = "logo.svg";
const removedGeneratorCodes = [
  "randomGender",
  "randomAge",
  "randomCoordinate",
  "randomNegativeNumber",
  "randomPercentage",
  "randomDecimal",
  "randomInteger",
  "randomBooleanUpper",
  "randomBooleanNumber",
  "randomMoney",
  "randomBoolean",
  "randomParagraph",
  "randomVersion",
  "randomSku",
  "randomNumber",
];
const generatorDefinitions = [
  {
    code: "randomName",
    explain: "生成随机姓名",
    cmds: ["mz", "name", "姓名", "名字"],
  },
  {
    code: "randomPhone",
    explain: "生成随机手机号",
    cmds: ["sj", "手机", "phone", "手机号"],
  },
  {
    code: "randomEmail",
    explain: "生成随机邮箱",
    cmds: ["email", "mail", "邮箱"],
  },
  {
    code: "randomUsername",
    explain: "生成随机用户名",
    cmds: ["user", "username", "账号", "用户名"],
  },
  {
    code: "randomPassword",
    explain: "生成随机密码",
    cmds: ["pwd", "password", "密码"],
  },
  {
    code: "randomIdCard",
    explain: "生成随机身份证号",
    cmds: ["sfz", "idcard", "身份证", "身份证号"],
  },
  {
    code: "randomAddress",
    explain: "生成随机地址",
    cmds: ["dz", "address", "地址"],
  },
  {
    code: "randomCompany",
    explain: "生成随机公司名",
    cmds: ["gs", "company", "公司"],
  },
  {
    code: "randomJob",
    explain: "生成随机职位",
    cmds: ["job", "zw", "职位"],
  },
  {
    code: "randomNonsense100",
    explain: "生成 100 字废话",
    cmds: ["废话100", "100字", "nonsense100"],
  },
  {
    code: "randomNonsense200",
    explain: "生成 200 字废话",
    cmds: ["废话200", "200字", "nonsense200"],
  },
  {
    code: "randomNonsense300",
    explain: "生成 300 字废话",
    cmds: ["废话300", "300字", "nonsense300"],
  },
  {
    code: "randomNonsense500",
    explain: "生成 500 字废话",
    cmds: ["废话500", "500字", "nonsense500"],
  },
  {
    code: "randomEnglishName",
    explain: "生成随机英文名",
    cmds: ["enname", "englishname", "英文名"],
  },
  {
    code: "randomChineseWord",
    explain: "生成随机中文词语",
    cmds: ["word", "词语", "中文词"],
  },
  {
    code: "randomUuid",
    explain: "生成随机 UUID",
    cmds: ["uuid", "guid"],
  },
  {
    code: "randomUuid32",
    explain: "生成无横杠 UUID",
    cmds: ["uuid32", "uuidn", "uuid无横杠", "uuid无杠"],
  },
  {
    code: "randomOrderNo",
    explain: "生成随机订单号",
    cmds: ["order", "orderno", "订单", "订单号"],
  },
  {
    code: "randomDate",
    explain: "生成随机日期",
    cmds: ["date", "rq", "日期"],
  },
  {
    code: "randomDateTime",
    explain: "生成随机日期时间",
    cmds: ["time", "datetime", "sjc", "时间"],
  },
  {
    code: "randomTimestamp",
    explain: "生成随机时间戳",
    cmds: ["ts", "timestamp", "时间戳"],
  },
  {
    code: "randomUrl",
    explain: "生成随机 URL",
    cmds: ["url", "网址", "链接"],
  },
  {
    code: "randomDomain",
    explain: "生成随机域名",
    cmds: ["domain", "域名"],
  },
  {
    code: "randomIp",
    explain: "生成随机 IPv4",
    cmds: ["ip", "ipv4"],
  },
  {
    code: "randomIpv6",
    explain: "生成随机 IPv6",
    cmds: ["ipv6"],
  },
  {
    code: "randomMac",
    explain: "生成随机 MAC 地址",
    cmds: ["mac", "mac地址"],
  },
  {
    code: "randomUserAgent",
    explain: "生成随机 User-Agent",
    cmds: ["ua", "useragent"],
  },
  {
    code: "randomBankCard",
    explain: "生成随机银行卡号",
    cmds: ["yhk", "card", "银行卡", "银行卡号"],
  },
  {
    code: "randomBankName",
    explain: "生成随机银行名称",
    cmds: ["bankname", "bank", "银行名称"],
  },
  {
    code: "randomBankBranch",
    explain: "生成随机银行支行名称",
    cmds: ["bankbranch", "银行支行", "支行名称"],
  },
  {
    code: "randomPlate",
    explain: "生成随机车牌号",
    cmds: ["cp", "plate", "车牌", "车牌号"],
  },
  {
    code: "randomPostcode",
    explain: "生成随机邮编",
    cmds: ["yb", "postcode", "zip", "邮编"],
  },
  {
    code: "randomFileName",
    explain: "生成随机文件名",
    cmds: ["filename", "file", "文件名"],
  },
  {
    code: "randomMime",
    explain: "生成随机 MIME 类型",
    cmds: ["mime", "mimetype"],
  },
  {
    code: "randomColor",
    explain: "生成随机颜色",
    cmds: ["color", "hex", "颜色"],
  },
  {
    code: "randomRgb",
    explain: "生成随机 RGB 颜色",
    cmds: ["rgb"],
  },
  {
    code: "randomEmoji",
    explain: "生成随机表情",
    cmds: ["emoji", "表情"],
  },
  {
    code: "randomSentence",
    explain: "生成随机短句",
    cmds: ["sentence", "句子", "短句"],
  },
  {
    code: "randomToken",
    explain: "生成随机 Token",
    cmds: ["token", "access_token", "令牌"],
  },
  {
    code: "randomMd5",
    explain: "生成随机 MD5 字符串",
    cmds: ["md5"],
  },
  {
    code: "randomSha1",
    explain: "生成随机 SHA1 字符串",
    cmds: ["sha1"],
  },
  {
    code: "randomSha256",
    explain: "生成随机 SHA256 字符串",
    cmds: ["sha256"],
  },
  {
    code: "randomBase64",
    explain: "生成随机 Base64",
    cmds: ["base64", "b64"],
  },
  {
    code: "randomJson",
    explain: "生成随机 JSON",
    cmds: ["json"],
  },
  {
    code: "randomCsv",
    explain: "生成随机 CSV",
    cmds: ["csv"],
  },
  {
    code: "randomCron",
    explain: "生成随机 Cron 表达式",
    cmds: ["cron"],
  },
];

const settingsFeatureDefinition = {
  code: "randomDataSettings",
  explain: "打开随机数据设置",
  icon: GENERATOR_ICON,
  cmds: ["随机数据设置", "数据指令设置", "rdsetting"],
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[randomInt(0, list.length - 1)];
}

function pad(value, length) {
  return String(value).padStart(length, "0");
}

function randomDigits(length) {
  let text = "";

  for (let index = 0; index < length; index += 1) {
    text += randomInt(0, 9);
  }

  return text;
}

function formatDate(date, withTime) {
  const value = `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;

  if (!withTime) {
    return value;
  }

  return `${value} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`;
}

function createName() {
  let name = pick(surnames);
  const length = Math.random() < 0.35 ? 1 : 2;

  for (let index = 0; index < length; index += 1) {
    name += pick(nameChars);
  }

  return name;
}

function createPhone() {
  return `${pick(phonePrefixes)}${randomDigits(8)}`;
}

function createUuid() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const number = randomInt(0, 15);
    return (value === "x" ? number : (number & 0x3) | 0x8).toString(16);
  });
}

function createUuid32() {
  return createUuid().replace(/-/g, "");
}

function createAddress() {
  const area = pick(areas);
  const city = area.province === area.city ? "" : area.city;
  return `${area.province}${city}${area.district}${pick(roads)}${randomInt(1, 999)}号${pick(buildings)}${randomInt(1, 28)}栋${randomInt(101, 3202)}室`;
}

function createIdCard() {
  const area = pick(areas);
  const year = randomInt(1970, 2005);
  const month = randomInt(1, 12);
  const day = randomInt(1, new Date(year, month, 0).getDate());
  const body = `${area.code}${year}${pad(month, 2)}${pad(day, 2)}${randomDigits(3)}`;
  const factors = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
  let sum = 0;

  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * factors[index];
  }

  return `${body}${checks[sum % 11]}`;
}

function luhnCheckDigit(body) {
  let sum = 0;
  let doubleDigit = true;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    let number = Number(body[index]);

    if (doubleDigit) {
      number *= 2;

      if (number > 9) {
        number -= 9;
      }
    }

    sum += number;
    doubleDigit = !doubleDigit;
  }

  return String((10 - (sum % 10)) % 10);
}

function createBankCard() {
  const body = `${pick(bankPrefixes)}${randomDigits(12)}`;
  return `${body}${luhnCheckDigit(body)}`;
}

function createBankName() {
  return pick(bankNames);
}

function createBankBranch() {
  const area = pick(areas);
  const city = area.province === area.city ? area.district : area.city;
  return `${pick(bankNames)}${city}${pick(["支行", "分行", "营业部", "分理处", "开发区支行", "高新区支行", "自贸区支行", "科技支行", "小微支行", "社区支行"])}`;
}

function createUsername() {
  return `${pick(words)}_${pick(words)}_${randomInt(10, 9999)}`;
}

function createEmail() {
  return `${createUsername()}@${pick(domains)}`;
}

function createPassword() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  let text = "";

  for (let index = 0; index < 16; index += 1) {
    text += chars[randomInt(0, chars.length - 1)];
  }

  return text;
}

function createDate(offsetStart, offsetEnd) {
  const date = new Date();
  date.setDate(date.getDate() + randomInt(offsetStart, offsetEnd));
  date.setHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59), 0);
  return date;
}

function createUrl() {
  return `https://${pick(words)}.${pick(["com", "cn", "net", "io"])}/${pick(words)}/${randomInt(1000, 999999)}`;
}

function createIp() {
  return `${randomInt(1, 223)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

function createIpv6() {
  const parts = [];

  for (let index = 0; index < 8; index += 1) {
    parts.push(randomInt(0, 65535).toString(16));
  }

  return parts.join(":");
}

function createMac() {
  const parts = [];

  for (let index = 0; index < 6; index += 1) {
    parts.push(pad(randomInt(0, 255).toString(16).toUpperCase(), 2));
  }

  return parts.join(":");
}

function createCompany() {
  return `${pick(areas).city}${pick(words).replace(/^\w/, (value) => value.toUpperCase())}${pick(companySuffixes)}`;
}

function createPlate() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let text = `${pick(provinces)}${letters[randomInt(0, letters.length - 1)]}`;

  for (let index = 0; index < 5; index += 1) {
    text += chars[randomInt(0, chars.length - 1)];
  }

  return text;
}

function createColor() {
  return `#${randomInt(0, 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

function createSentence() {
  return `${pick(sentenceParts)}，编号为 ${randomInt(100000, 999999)}。`;
}

function createNonsense(length) {
  let text = "";

  while (text.length < length) {
    text += pick(nonsensePieces);
    text += pick(["，", "。"]);
  }

  const result = text.slice(0, length);
  return /[，。]$/.test(result) ? result : `${result.slice(0, length - 1)}。`;
}

function createOrderNo() {
  const date = new Date();
  return `DD${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}${randomDigits(10)}`;
}

function createMoney() {
  return (Math.random() * 999999 + 1).toFixed(2);
}

function createEnglishName() {
  return `${pick(englishFirstNames)} ${pick(englishLastNames)}`;
}

function createDomain() {
  return `${pick(words)}-${randomInt(10, 999)}.${pick(["com", "cn", "net", "io", "dev"])}`;
}

function createFileName() {
  return `${pick(words)}-${Date.now()}-${randomInt(100, 999)}.${pick(fileExtensions)}`;
}

function createBase64() {
  const text = `${pick(words)}:${randomDigits(12)}:${Date.now()}`;

  if (typeof btoa === "function") {
    return btoa(text);
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(text).toString("base64");
  }

  return text;
}

function createHex(length) {
  const chars = "0123456789abcdef";
  let text = "";

  for (let index = 0; index < length; index += 1) {
    text += chars[randomInt(0, chars.length - 1)];
  }

  return text;
}

function createToken() {
  return `${createHex(16)}.${createHex(24)}.${createHex(32)}`;
}

function createJson() {
  return JSON.stringify({
    id: createUuid32(),
    name: createName(),
    phone: createPhone(),
    email: createEmail(),
    amount: createMoney(),
    enabled: Math.random() < 0.5,
  });
}

function createCsv() {
  return [
    "id,name,phone,email",
    `1,${createName()},${createPhone()},${createEmail()}`,
    `2,${createName()},${createPhone()},${createEmail()}`,
  ].join("\n");
}

function createCron() {
  return `${randomInt(0, 59)} ${randomInt(0, 23)} ${randomInt(1, 28)} ${randomInt(1, 12)} *`;
}

function createUserAgent() {
  const browser = pick(browsers);
  const system = pick(systems);

  if (browser === "Safari") {
    return `Mozilla/5.0 (${system}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${randomInt(14, 18)}.0 Safari/605.1.15`;
  }

  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) ${browser}/${randomInt(90, 126)}.0.${randomInt(1000, 9999)}.${randomInt(10, 200)} Safari/537.36`;
}

function createRgb() {
  return `rgb(${randomInt(0, 255)}, ${randomInt(0, 255)}, ${randomInt(0, 255)})`;
}

function createChineseWord() {
  return `${pick(chineseWords)}${pick(chineseWords)}`;
}

const generatorCreators = {
  randomName: createName,
  randomPhone: createPhone,
  randomUuid: createUuid,
  randomUuid32: createUuid32,
  randomAddress: createAddress,
  randomIdCard: createIdCard,
  randomBankCard: createBankCard,
  randomBankName: createBankName,
  randomBankBranch: createBankBranch,
  randomEmail: createEmail,
  randomUsername: createUsername,
  randomPassword: createPassword,
  randomDate: () => formatDate(createDate(-3650, 3650), false),
  randomDateTime: () => formatDate(createDate(-3650, 3650), true),
  randomTimestamp: () => String(createDate(-3650, 3650).getTime()),
  randomUrl: createUrl,
  randomIp: createIp,
  randomIpv6: createIpv6,
  randomMac: createMac,
  randomCompany: createCompany,
  randomJob: () => pick(jobs),
  randomNonsense100: () => createNonsense(100),
  randomNonsense200: () => createNonsense(200),
  randomNonsense300: () => createNonsense(300),
  randomNonsense500: () => createNonsense(500),
  randomPlate: createPlate,
  randomPostcode: () => randomDigits(6),
  randomColor: createColor,
  randomSentence: createSentence,
  randomOrderNo: createOrderNo,
  randomEnglishName: createEnglishName,
  randomDomain: createDomain,
  randomFileName: createFileName,
  randomMime: () => pick(mimeTypes),
  randomBase64: createBase64,
  randomToken: createToken,
  randomMd5: () => createHex(32),
  randomSha1: () => createHex(40),
  randomSha256: () => createHex(64),
  randomJson: createJson,
  randomCsv: createCsv,
  randomCron: createCron,
  randomUserAgent: createUserAgent,
  randomRgb: createRgb,
  randomEmoji: () => pick(emojis),
  randomChineseWord: createChineseWord,
};

function complete(text) {
  if (typeof window.ztools.hideMainWindowTypeString === "function") {
    window.ztools.hideMainWindowTypeString(text);
    window.ztools.outPlugin();
    return Promise.resolve();
  }

  if (
    window.ztools &&
    window.ztools.clipboard &&
    typeof window.ztools.clipboard.writeContent === "function" &&
    typeof window.ztools.hideMainWindow === "function" &&
    typeof window.ztools.simulateKeyboardTap === "function"
  ) {
    return window.ztools.hideMainWindow(true).then(async () => {
      await window.ztools.clipboard.writeContent(
        {
          type: "text",
          content: text,
        },
        false,
      );

      if (window.ztools.isMacOs && window.ztools.isMacOs()) {
        window.ztools.simulateKeyboardTap("v", "command");
      } else {
        window.ztools.simulateKeyboardTap("v", "control");
      }

      window.ztools.outPlugin();
    });
  }

  if (typeof window.ztools.sendInputEvent === "function") {
    return window.ztools.hideMainWindow(true).then(() => {
      for (const char of text) {
        window.ztools.sendInputEvent({ type: "char", keyCode: char });
      }

      window.ztools.outPlugin();
    });
  }

  window.ztools.outPlugin();
  return Promise.resolve();
}

function createHandler(code) {
  return {
    mode: "none",
    args: {
      async enter() {
        const setting = currentSettings[code];

        if (setting && setting.enabled === false) {
          if (
            window.ztools &&
            typeof window.ztools.showNotification === "function"
          ) {
            window.ztools.showNotification(
              "该随机数据项已关闭，请先到设置页开启",
            );
          }

          return { success: false, data: "" };
        }

        const creator = generatorCreators[code];
        const text = creator();
        await complete(text);
        return { success: true, data: text };
      },
    },
  };
}

function splitCommands(value) {
  if (typeof value !== "string") {
    return [];
  }

  return value.split(/[\n,，]/);
}

function normalizeCommands(commands, fallback) {
  const list = Array.isArray(commands) ? commands : splitCommands(commands);
  const normalized = [];

  for (const item of list) {
    const value = String(item).trim();

    if (value && normalized.includes(value) === false) {
      normalized.push(value);
    }
  }

  return normalized;
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const normalized = {};

  for (const definition of generatorDefinitions) {
    const item =
      source[definition.code] && typeof source[definition.code] === "object"
        ? source[definition.code]
        : {};
    normalized[definition.code] = {
      enabled: item.enabled !== false,
      commands:
        Object.prototype.hasOwnProperty.call(item, "commands") && Array.isArray(item.commands)
          ? normalizeCommands(item.commands, definition.cmds)
          : definition.cmds.slice(),
    };
  }

  return normalized;
}

async function loadSettingsFromDb() {
  if (
    window.ztools.dbStorage &&
    typeof window.ztools.dbStorage.getItem === "function"
  ) {
    return await window.ztools.dbStorage.getItem(SETTINGS_STORAGE_KEY);
  }

  if (window.ztools.db && typeof window.ztools.db.get === "function") {
    const document = await window.ztools.db.get(SETTINGS_DOC_ID);
    return document && document.value ? document.value : null;
  }

  return null;
}

async function loadSettings() {
  return normalizeSettings(await loadSettingsFromDb());
}

async function saveSettings(settings) {
  if (
    window.ztools.dbStorage &&
    typeof window.ztools.dbStorage.setItem === "function"
  ) {
    await window.ztools.dbStorage.setItem(SETTINGS_STORAGE_KEY, settings);
    return;
  }

  if (
    window.ztools.db &&
    typeof window.ztools.db.put === "function" &&
    typeof window.ztools.db.get === "function"
  ) {
    const current = await window.ztools.db.get(SETTINGS_DOC_ID);
    const document = {
      _id: SETTINGS_DOC_ID,
      value: settings,
    };

    if (current && current._rev) {
      document._rev = current._rev;
    }

    await window.ztools.db.put(document);
  }
}

function buildDynamicFeature(definition, cmds) {
  return {
    code: definition.code,
    explain: definition.explain,
    icon: GENERATOR_ICON,
    cmds,
  };
}

function syncFeatures(settings) {
  if (
    typeof window.ztools.removeFeature !== "function"
  ) {
    return;
  }

  for (const code of removedGeneratorCodes) {
    window.ztools.removeFeature(code);
  }

  for (const definition of generatorDefinitions) {
    const setting = settings[definition.code];

    window.ztools.removeFeature(definition.code);

    if (!setting || setting.enabled === false || setting.commands.length === 0) {
      continue;
    }

    if (typeof window.ztools.setFeature === "function") {
      window.ztools.setFeature(
        buildDynamicFeature(definition, setting.commands),
      );
    }
  }
}

function listSettingsItems() {
  return generatorDefinitions.map((definition) => {
    const setting = currentSettings[definition.code];
    return {
      code: definition.code,
      explain: definition.explain,
      enabled: setting.enabled,
      commands: setting.commands.slice(),
    };
  });
}

async function saveItems(items) {
  const itemList = Array.isArray(items) ? items : [];
  const itemMap = {};

  for (const item of itemList) {
    if (item && typeof item.code === "string") {
      itemMap[item.code] = item;
    }
  }

  const nextSettings = {};

  for (const definition of generatorDefinitions) {
    const current = currentSettings[definition.code];
    const incoming = itemMap[definition.code];
    nextSettings[definition.code] = {
      enabled: incoming ? incoming.enabled !== false : current.enabled,
      commands: incoming ? incoming.commands : current.commands,
    };
  }

  currentSettings = normalizeSettings(nextSettings);
  await saveSettings(currentSettings);
  syncFeatures(currentSettings);
  return listSettingsItems();
}

function generateSample(code) {
  const creator = generatorCreators[code];
  return typeof creator === "function" ? creator() : "";
}

const CUSTOM_STORAGE_KEY = "custom-fill-items";
const CUSTOM_DOC_ID = "__random_data_custom_items__";
const CUSTOM_FEATURE_PREFIX = "customFill_";

function buildCustomFeatureCode(id) {
  return `${CUSTOM_FEATURE_PREFIX}${id}`;
}

function generateCustomItemId() {
  return `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCustomItem(raw) {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : generateCustomItemId(),
    enabled: raw.enabled !== false,
    content: typeof raw.content === "string" ? raw.content : "",
    commands: normalizeCommands(raw.commands || []),
  };
}

function normalizeCustomItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const result = [];
  const seenIds = new Set();

  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const item = normalizeCustomItem(raw);

    if (seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    result.push(item);
  }

  return result;
}

async function loadCustomItemsFromDb() {
  if (
    window.ztools.dbStorage &&
    typeof window.ztools.dbStorage.getItem === "function"
  ) {
    return await window.ztools.dbStorage.getItem(CUSTOM_STORAGE_KEY);
  }

  if (window.ztools.db && typeof window.ztools.db.get === "function") {
    const document = await window.ztools.db.get(CUSTOM_DOC_ID);
    return document && document.value ? document.value : null;
  }

  return null;
}

async function loadCustomItems() {
  return normalizeCustomItems(await loadCustomItemsFromDb());
}

async function saveCustomItemsToDb(items) {
  if (
    window.ztools.dbStorage &&
    typeof window.ztools.dbStorage.setItem === "function"
  ) {
    await window.ztools.dbStorage.setItem(CUSTOM_STORAGE_KEY, items);
    return;
  }

  if (
    window.ztools.db &&
    typeof window.ztools.db.put === "function" &&
    typeof window.ztools.db.get === "function"
  ) {
    const current = await window.ztools.db.get(CUSTOM_DOC_ID);
    const document = {
      _id: CUSTOM_DOC_ID,
      value: items,
    };

    if (current && current._rev) {
      document._rev = current._rev;
    }

    await window.ztools.db.put(document);
  }
}

function createCustomHandler(id) {
  return {
    mode: "none",
    args: {
      async enter() {
        const item = currentCustomItems.find((entry) => entry.id === id);

        if (!item || item.enabled === false) {
          if (
            window.ztools &&
            typeof window.ztools.showNotification === "function"
          ) {
            window.ztools.showNotification("该自定义项已关闭或已删除");
          }

          return { success: false, data: "" };
        }

        const text = item.content || "";
        await complete(text);
        return { success: true, data: text };
      },
    },
  };
}

function syncCustomFeatures(items, previousItems) {
  if (typeof window.ztools.removeFeature !== "function") {
    return;
  }

  const currentIds = new Set(items.map((item) => item.id));

  for (const old of previousItems || []) {
    if (!currentIds.has(old.id)) {
      const oldCode = buildCustomFeatureCode(old.id);
      window.ztools.removeFeature(oldCode);

      if (window.exports) {
        delete window.exports[oldCode];
      }
    }
  }

  for (const item of items) {
    const code = buildCustomFeatureCode(item.id);
    window.ztools.removeFeature(code);

    if (item.enabled === false || item.commands.length === 0) {
      continue;
    }

    if (window.exports && !window.exports[code]) {
      window.exports[code] = createCustomHandler(item.id);
    }

    if (typeof window.ztools.setFeature === "function") {
      window.ztools.setFeature({
        code,
        explain: item.content
          ? `自定义：${item.content.slice(0, 24)}`
          : "自定义填充",
        icon: GENERATOR_ICON,
        cmds: item.commands.slice(),
      });
    }
  }
}

function listCustomItems() {
  return currentCustomItems.map((item) => ({
    id: item.id,
    enabled: item.enabled,
    content: item.content,
    commands: item.commands.slice(),
  }));
}

async function saveCustomItems(items) {
  const previous = currentCustomItems;
  currentCustomItems = normalizeCustomItems(items);
  await saveCustomItemsToDb(currentCustomItems);
  syncCustomFeatures(currentCustomItems, previous);
  return listCustomItems();
}

let currentSettings = {};
let currentCustomItems = [];

window.exports = {
  ...Object.fromEntries(
    generatorDefinitions.map((definition) => [
      definition.code,
      createHandler(definition.code),
    ]),
  ),
};

const readyPromise = (async () => {
  currentSettings = await loadSettings();
  currentCustomItems = await loadCustomItems();

  for (const item of currentCustomItems) {
    window.exports[buildCustomFeatureCode(item.id)] = createCustomHandler(item.id);
  }

  syncFeatures(currentSettings);
  syncCustomFeatures(currentCustomItems, []);
})();

window.randomDataApi = {
  async getItems() {
    await readyPromise;
    return listSettingsItems();
  },
  async saveItems(items) {
    await readyPromise;
    return await saveItems(items);
  },
  generateSample,
};

window.customFillApi = {
  async getItems() {
    await readyPromise;
    return listCustomItems();
  },
  async saveItems(items) {
    await readyPromise;
    return await saveCustomItems(items);
  },
};
