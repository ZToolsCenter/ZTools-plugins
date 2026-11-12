# Changelog

## 1.3.0 - 2026-11-07

- JWT 栏目支持伪造签名：none / None / NONE、HS256·384·512、RS256·384·512。
- 可编辑 Header / Payload，填写密钥后即时生成伪造 Token；HS* 密钥正确时提示原签名匹配。
- RS* 可用 PEM 私钥签名，也可把公钥当作 HS* 密钥做算法混淆。

## 1.2.0 - 2026-10-20

- 首次发布网安 CTF 工具箱：编码转换、哈希、JWT 解析、古典密码。
- 新增 PHP 绕过构造独立栏目，可按函数名生成取反、异或、或、自增 Payload。
- 新增公开 Payload 速查：PHP 伪协议、LFI、XSS、SSTI、SQLi、XXE、SSRF、上传绕过。
- 构造栏加入 eval 过滤字母数字的示例，可一键填入 phpinfo / system / assert。
- 使用原创几何 Logo，界面跟随系统浅色 / 深色主题。
