# 网安 CTF 工具箱

面向 [ZTools](https://github.com/ZToolsCenter/ZTools) 的本地插件：编码转换、哈希、JWT 解析、古典密码，以及公开 Payload 速查。

仅用于 CTF、本地靶场和**已获得书面授权**的安全测试。

## 功能

- 编码 / 解码：Base64、Base64URL、Base32、Base58、Hex、URL、HTML 实体、Unicode、二进制、Quoted-Printable、ROT13、Caesar、Morse
- 自动识别常见编码并一键切换对应解码
- MD5 / SHA1 / SHA256 / SHA512，可选 HMAC-SHA256
- JWT Header / Payload 解析（不伪造签名）
- 古典密码：Caesar、ROT13、栅栏
- Payload 速查：PHP 伪协议、LFI、XSS、SSTI、SQLi、XXE、SSRF、上传绕过
- PHP 绕过构造（独立栏目）：输入函数名，即时生成取反 / 异或 / 或 / 自增
- Payload 速查仍保留笔记里的固定示例

## 目录

```
ctf-toolbox/
├── plugin.json
├── preload.js
├── index.html
├── styles.css
├── app.js
├── codec.js
├── payloads.js
├── logo.png
├── ASSETS.md
├── LICENSE
└── README.md
```
