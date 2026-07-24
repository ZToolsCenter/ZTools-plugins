# UUID 百宝箱（uuid-kit）

ZTools 插件：一个输入框搞定 UUID 的解析、互转、生成与体检。

- **粘贴即解析**：任意形式的 id 直接粘贴进搜索框——标准 UUID、32 位 hex、
  uuid62（shortuuid base62）、base57（python-shortuuid 默认）、base58（bitcoin）、
  base64url，支持 `order-`、`user-` 这类带前缀的短 id，自动识别方向并列出全部形式，
  进入插件时主结果已复制。
- **生成 v1/v3/v4/v5/v6/v7**：`uuid` 默认 v4；`uuid7`（毫秒时间戳前缀、可排序，
  适合做数据库主键）；`uuid4 x10` 批量；`uuid5 dns example.com` 确定性生成
  （命名空间 dns/url/oid/x500 或任意 UUID）。
- **体检**：粘贴 UUID 自动显示版本、variant，v1/v6/v7 直接还原出生成时间，
  v1/v6 展示 node 与时钟序列。

## 用法

| 输入 | 行为 |
| --- | --- |
| `9H6Eec99g7BsAVi8QeCwyN` | 短 id → UUID（自动识别字母表） |
| `28d463fe-1b43-45fa-8346-a08ff924c724` | UUID → 全部短 id 形式 |
| `order-1F2krUyRcqDfa3cNxwq76q` | 带前缀短 id，前缀原样保留 |
| `uuid` / `uuid7` / `uuid1` / `uuid6` | 生成一个，meta 行显示时间戳 |
| `uuid4 x10` | 批量生成，Enter 复制全部（换行分隔） |
| `uuid5 dns example.com` | v3/v5 确定性生成，同输入恒同输出 |

窗口内 `Enter` 复制主结果（高亮行），点击任意行复制该形式。

**歧义处理**：base57/58/62 编码 UUID 后长度都是 22 字符，一个短 id 可能在多个
字母表下都合法。本插件默认按 **base62** 解并高亮，其余合法解法全部列出、
绝不静默二选一；含 `0OIl` 的输入自动排除 base57/58，含 `-`/`_` 只按 base64url。

## 正确性

所有算法以 python 标准库/知名实现为权威向量做跨语言对拍：

- 编码：python-shortuuid（含其"字母表会被排序"的行为）、`base58.b58encode(uuid.bytes)`
  bitcoin 语义、`base64.urlsafe_b64encode`；
- 生成：v3/v5 与 python `uuid.uuid3/uuid5` 逐字节一致（MD5/SHA-1 为内嵌同步实现，
  与 hashlib 对拍过 padding 边界与多字节字符）；
- 插件每次启动自动跑 KAT 自检，一旦失败顶部红条警示，绝不静默给错误结果。

开发回归：`node tests/test_uuid_core.js && node tests/test_ui.js`
（`tests/uuid_vectors.json` 由 python 权威实现生成，请勿手改）。

## 结构

```
uuid-kit/
├── plugin.json     # 插件声明（regex 触发 + 关键词）
├── index.html      # UI（无构建、无依赖）
├── uuid-core.js    # 核心：codec 注册表 / 生成 / 体检 / 命令解析 / KAT 自检
├── preload.js      # 剪贴板兜底
├── logo.png
└── tests/          # node 测试与 python 生成的权威向量
```

## License

MIT
