# Changelog

## 1.0.0 - 2026-07-18

首个版本。


- 粘贴即解析：自动识别标准 UUID / hex32 / uuid62 / base57（python-shortuuid 默认）/
  base58（bitcoin）/ base64url，支持 `order-` 等带前缀短 id，进入插件时主结果自动复制
- 多字母表歧义处理：同一短 id 多字母表下都合法时默认按 base62 解并高亮，
  其余合法解法全部列出，绝不静默二选一
- 生成 UUID v1/v3/v4/v5/v6/v7：`uuid` 默认 v4，`uuid4 x10` 批量，
  `uuid5 dns example.com` 确定性生成（命名空间 dns/url/oid/x500 或任意 UUID）
- 体检：自动显示版本与 variant，v1/v6/v7 还原生成时间，v1/v6 展示 node 与时钟序列

