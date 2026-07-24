# ZapAPI Test Server

用于测试 ZapAPI 各功能的 HTTP/WebSocket/TCP/UDP 服务器。

## 快速开始

```bash
python scripts/test_server.py
```

服务器启动后将同时运行 4 个服务：

| 服务 | 端口 | 地址 |
|------|------|------|
| HTTP | 8765 | http://localhost:8765 |
| WebSocket | 8766 | ws://localhost:8766 |
| TCP | 8767 | localhost:8767 |
| UDP | 8768 | localhost:8768 |

## HTTP 端点

### 基础功能

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 服务器信息和端点列表 |
| `/echo` | * | 回显请求详情（方法、路径、请求头、请求体） |
| `/methods` | GET | 列出所有支持的 HTTP 方法 |
| `/methods/{METHOD}` | * | 测试特定 HTTP 方法（如 `/methods/POST`） |
| `/headers` | GET | 返回所有请求头 |
| `/query` | GET | 返回查询参数 |

### 状态控制

| 端点 | 参数 | 描述 |
|------|------|------|
| `/status` | `code` - 状态码（默认 200）<br>`message` - 自定义消息 | 返回指定状态码 |
| `/delay` | `ms` - 延迟毫秒数（默认 1000） | 延迟响应 |
| `/redirect` | `count` - 重定向次数<br>`to` - 最终目标路径 | 重定向测试 |

示例：
```bash
# 返回 404 状态码
curl http://localhost:8765/status?code=404

# 延迟 2 秒响应
curl http://localhost:8765/delay?ms=2000

# 3 次重定向后到达 /echo
curl http://localhost:8765/redirect?count=3&to=/echo
```

### Cookie 测试

| 端点 | 参数 | 描述 |
|------|------|------|
| `/cookies` | `action=set` - 设置 Cookie<br>`name` - Cookie 名称<br>`value` - Cookie 值 | 设置 Cookie |
| `/cookies` | `action=get` | 获取所有 Cookie |
| `/cookies` | `action=clear` | 清除所有 Cookie |

示例：
```bash
# 设置 Cookie
curl -c - "http://localhost:8765/cookies?action=set&name=session&value=abc123"

# 获取 Cookie
curl -b "session=abc123" "http://localhost:8765/cookies?action=get"
```

### 认证测试

#### Basic Auth

```bash
curl -u admin:password http://localhost:8765/auth/basic
```

凭据：`admin` / `password`

#### Bearer Token

```bash
curl -H "Authorization: Bearer valid-token-123" http://localhost:8765/auth/bearer
```

有效 Token：`valid-token-123`

#### API Key

Header 方式：
```bash
curl -H "X-API-Key: sk-test-123456" http://localhost:8765/auth/apikey
```

Query 方式：
```bash
curl "http://localhost:8765/auth/apikey?api_key=sk-test-123456"
```

有效 API Key：`sk-test-123456`

#### JWT

```bash
# 使用 HS256 算法生成 JWT
# Secret: zapapi-test-secret-key-2024

curl -H "Authorization: Bearer <your-jwt-token>" http://localhost:8765/auth/jwt
```

#### Digest Auth

```bash
curl --digest -u admin:password http://localhost:8765/auth/digest
```

凭据：`admin` / `password`

支持的算法：`MD5`、`MD5-sess`、`SHA-256`、`SHA-256-sess`

```bash
curl --digest -u admin:password "http://localhost:8765/auth/digest?algorithm=SHA-256"
```

### 请求体测试

#### JSON

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"name": "test", "value": 123}' \
  http://localhost:8765/body/json
```

#### URL-encoded Form

```bash
curl -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "field1=value1&field2=value2" \
  http://localhost:8765/body/form
```

#### Multipart Form-data

```bash
curl -X POST \
  -F "field1=text-value" \
  -F "file=@test.txt" \
  http://localhost:8765/body/multipart
```

#### Raw Body

```bash
curl -X POST \
  -H "Content-Type: text/plain" \
  -d "Raw text content" \
  http://localhost:8765/body/raw
```

#### Binary

```bash
curl -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary @image.png \
  http://localhost:8765/body/binary
```

### 文件操作

#### 上传

```bash
curl -X POST \
  -F "file=@document.pdf" \
  -F "description=Test upload" \
  http://localhost:8765/upload
```

#### 下载

```bash
# 下载 JSON 文件
curl "http://localhost:8765/download?size=1024&type=json" -o test.json

# 下载文本文件
curl "http://localhost:8765/download?size=512&type=text" -o test.txt

# 下载二进制文件
curl "http://localhost:8765/download?size=2048&type=binary" -o test.bin
```

### 响应格式测试

#### 流式响应

```bash
curl "http://localhost:8765/stream?lines=10&delay=0.1"
```

#### 分块传输

```bash
curl "http://localhost:8765/chunked?chunks=5&delay=0.2"
```

#### Gzip 压缩

```bash
curl --compressed "http://localhost:8765/gzip?size=1024"
```

#### 大响应

```bash
# 生成 1MB 响应
curl "http://localhost:8765/large?size=1048576"
```

### 数据工具

#### UUID 生成

```bash
# 生成单个 UUID
curl http://localhost:8765/uuid

# 生成多个 UUID
curl "http://localhost:8765/uuid?count=5"
```

#### 哈希计算

```bash
# MD5
curl "http://localhost:8765/hash?data=hello&algo=md5"

# SHA-256
curl "http://localhost:8765/hash?data=hello&algo=sha256"

# SHA-512
curl "http://localhost:8765/hash?data=hello&algo=sha512"
```

#### Base64 编解码

```bash
# 编码
curl "http://localhost:8765/base64?data=hello&action=encode"

# 解码
curl "http://localhost:8765/base64?data=aGVsbG8=&action=decode"
```

#### XML 响应

```bash
curl http://localhost:8765/xml
```

#### HTML 响应

```bash
curl http://localhost:8765/html
```

#### 图片响应

```bash
# SVG 图片
curl "http://localhost:8765/image?type=svg" -o image.svg

# PNG 图片
curl "http://localhost:8765/image?type=png" -o image.png
```

#### 编码测试

```bash
# UTF-8
curl "http://localhost:8765/encoding?enc=utf-8"

# GBK
curl "http://localhost:8765/encoding?enc=gbk"

# Shift-JIS
curl "http://localhost:8765/encoding?enc=shift-jis"

# EUC-KR
curl "http://localhost:8765/encoding?enc=euc-kr"
```

## WebSocket 测试

连接地址：`ws://localhost:8766`

服务器会回显收到的消息：

```json
{
  "echo": "your message",
  "length": 12,
  "time": 1234567890.123,
  "type": "echo"
}
```

使用 ZapAPI 测试：
1. 方法选择 `WS`
2. URL 填写 `ws://localhost:8766`
3. 点击连接
4. 发送消息测试

## TCP 测试

连接地址：`localhost:8767`

服务器会回显收到的消息：

```json
{
  "echo": "your message",
  "length": 12,
  "time": 1234567890.123
}
```

使用 ZapAPI 测试：
1. 方法选择 `TCP`
2. URL 填写 `localhost:8767`
3. 点击连接
4. 发送消息测试

## UDP 测试

连接地址：`localhost:8768`

服务器会回显收到的消息：

```json
{
  "echo": "your message",
  "length": 12,
  "time": 1234567890.123,
  "from": "127.0.0.1:12345"
}
```

使用 ZapAPI 测试：
1. 方法选择 `UDP`
2. URL 填写 `localhost:8768`
3. 点击连接
4. 发送消息测试

## 在 ZapAPI 中使用

### 测试 HTTP 请求

1. 在 ZapAPI 中创建新请求
2. 输入测试服务器 URL（如 `http://localhost:8765/echo`）
3. 根据需要设置请求头、请求体、认证等
4. 发送请求查看响应

### 测试认证

1. 在请求设置中选择认证类型
2. 填写对应的认证信息：
   - Basic: 用户名 `admin`，密码 `password`
   - Bearer: Token `valid-token-123`
   - API Key: Key `sk-test-123456`
   - Digest: 用户名 `admin`，密码 `password`
3. 发送请求验证认证是否成功

### 测试 WebSocket

1. 新建请求，方法选择 `WS`
2. URL 填写 `ws://localhost:8766`
3. 点击连接按钮
4. 在消息输入框输入内容并发送
5. 查看服务器回显的消息

## 注意事项

- 所有服务默认绑定 `0.0.0.0`，可从任意网络接口访问
- HTTP 服务支持 CORS，允许跨域请求
- WebSocket 使用标准 RFC 6455 协议
- TCP/UDP 服务为简单的回显服务
- 服务器无状态，重启后所有数据重置
