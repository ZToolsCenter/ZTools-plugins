export interface RegexExample {
  id: string
  name: string
  category: string
  pattern: string
  flags: string
  testText: string
  description: string
}

export const REGEX_CATEGORIES = ['全部', '验证', '文本', '网络', '数字', '开发'] as const

export const REGEX_EXAMPLES: RegexExample[] = [
  {
    id: 'email',
    name: '电子邮箱',
    category: '验证',
    pattern: String.raw`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`,
    flags: 'i',
    testText: 'contact@example.com\ninvalid-email@\nbad@domain',
    description: '匹配常见格式的电子邮件地址'
  },
  {
    id: 'phone-cn',
    name: '中国大陆手机号',
    category: '验证',
    pattern: String.raw`^1[3-9]\d{9}$`,
    flags: '',
    testText: '13812345678\n19987654321\n12345678901',
    description: '11 位中国大陆手机号码'
  },
  {
    id: 'id-card',
    name: '身份证号',
    category: '验证',
    pattern: String.raw`^\d{17}[\dXx]$`,
    flags: '',
    testText: '110101199001011234\n32010219880505123X\n12345',
    description: '18 位中国大陆居民身份证号'
  },
  {
    id: 'url',
    name: 'URL 地址',
    category: '网络',
    pattern: String.raw`^https?:\/\/[\w\-]+(\.[\w\-]+)+[/#?]?.*$`,
    flags: 'i',
    testText: 'https://www.example.com/path?q=1\nhttp://localhost:3000\nnot-a-url',
    description: '匹配 http/https 开头的 URL'
  },
  {
    id: 'ipv4',
    name: 'IPv4 地址',
    category: '网络',
    pattern: String.raw`^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$`,
    flags: '',
    testText: '192.168.1.1\n10.0.0.255\n999.999.999.999',
    description: '标准 IPv4 点分十进制地址'
  },
  {
    id: 'domain',
    name: '域名',
    category: '网络',
    pattern: String.raw`^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
    flags: 'i',
    testText: 'example.com\nsub.domain.co.uk\n-invalid.com',
    description: '常见域名格式'
  },
  {
    id: 'date-iso',
    name: '日期 YYYY-MM-DD',
    category: '验证',
    pattern: String.raw`^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`,
    flags: '',
    testText: '2024-06-15\n2024-13-01\n2024-02-30',
    description: 'ISO 8601 日期格式'
  },
  {
    id: 'time-24h',
    name: '24 小时制时间',
    category: '验证',
    pattern: String.raw`^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$`,
    flags: '',
    testText: '09:30\n23:59:59\n25:00',
    description: 'HH:MM 或 HH:MM:SS 格式'
  },
  {
    id: 'chinese',
    name: '中文字符',
    category: '文本',
    pattern: String.raw`[\u4e00-\u9fff]+`,
    flags: 'g',
    testText: 'Hello 你好 World 世界',
    description: '匹配一个或多个汉字'
  },
  {
    id: 'integer',
    name: '整数',
    category: '数字',
    pattern: String.raw`^-?\d+$`,
    flags: '',
    testText: '42\n-100\n3.14\nabc',
    description: '正负整数'
  },
  {
    id: 'decimal',
    name: '小数',
    category: '数字',
    pattern: String.raw`^-?\d+(\.\d+)?$`,
    flags: '',
    testText: '3.14\n-0.5\n42\n1.2.3',
    description: '正负整数或小数'
  },
  {
    id: 'hex-color',
    name: '十六进制颜色',
    category: '开发',
    pattern: String.raw`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`,
    flags: '',
    testText: '#fff\n#1a2b3c\n#gggggg',
    description: '#RGB 或 #RRGGBB 颜色值'
  },
  {
    id: 'html-tag',
    name: 'HTML 标签',
    category: '开发',
    pattern: String.raw`<([a-zA-Z][\w-]*)\b[^>]*>(.*?)<\/\1>`,
    flags: 'gis',
    testText: '<div class="box">内容</div>\n<span>text</span>',
    description: '匹配成对的 HTML 标签及内容'
  },
  {
    id: 'password-strong',
    name: '强密码',
    category: '验证',
    pattern: String.raw`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$`,
    flags: '',
    testText: 'Abc123!@\nweakpass\nNoSpecial1',
    description: '至少 8 位，含大小写、数字和特殊字符'
  },
  {
    id: 'blank-line',
    name: '空白行',
    category: '文本',
    pattern: String.raw`^\s*$`,
    flags: 'gm',
    testText: 'line1\n\nline2\n   \nline3',
    description: '匹配空行或仅含空白字符的行'
  },
  {
    id: 'duplicate-word',
    name: '重复单词',
    category: '文本',
    pattern: String.raw`\b(\w+)\s+\1\b`,
    flags: 'gi',
    testText: 'the the quick brown fox fox jumps',
    description: '查找连续重复的单词'
  },
  {
    id: 'markdown-link',
    name: 'Markdown 链接',
    category: '文本',
    pattern: String.raw`\[([^\]]+)\]\(([^)]+)\)`,
    flags: 'g',
    testText: '[Google](https://google.com)\n[text](url)',
    description: '提取 Markdown 链接的文本和 URL'
  },
  {
    id: 'json-string',
    name: 'JSON 字符串键',
    category: '开发',
    pattern: String.raw`"([^"\\]|\\.)*"\s*:`,
    flags: 'g',
    testText: '{"name": "test", "age": 18}',
    description: '匹配 JSON 对象中的键名'
  },
  {
    id: 'filename',
    name: '文件名（无扩展名）',
    category: '开发',
    pattern: String.raw`^[^<>:"/\\|?*\x00-\x1f]+\.([a-zA-Z0-9]+)$`,
    flags: '',
    testText: 'document.pdf\nreport.docx\nbad<file.txt',
    description: '常见文件名格式'
  },
  {
    id: 'uuid',
    name: 'UUID',
    category: '开发',
    pattern: String.raw`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    flags: 'i',
    testText: '550e8400-e29b-41d4-a716-446655440000\nnot-a-uuid',
    description: '标准 UUID v1-v5 格式'
  }
]
