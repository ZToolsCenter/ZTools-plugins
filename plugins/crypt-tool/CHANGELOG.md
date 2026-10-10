# Changelog

## 1.1.0 - 2026-09-25

### 首次发布

**编码转换 (10 种)**

- Base64 / Safe Base64 / Base32 / Base58 编解码
- Hex / URL 编码
- Unicode 转义 / HTML 实体 / Punycode 编码
- 摩尔斯电码编解码

**哈希摘要 (8 种)**

- MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512
- SHA3-256 / SHA3-512 / RIPEMD-160

**对称加密 (4 种)**

- AES (CBC / GCM 模式)
- 3DES
- ChaCha20-Poly1305
- XOR 流密码

**非对称加密 (4 种)**

- RSA 加解密与密钥对生成
- ECDSA 签名与验证
- Ed25519 数字签名
- ECDH 密钥交换

**密钥派生 (5 种)**

- Argon2 / bcrypt / scrypt 密码哈希
- PBKDF2 口令派生
- HKDF 密钥派生

**消息认证 (1 种)**

- HMAC-SHA256 消息认证码

**实用工具 (7 种)**

- JWT 解码
- JSON 格式化与压缩
- UUID / Random Bytes 生成器
- 密码强度分析
- CRC32 / Adler-32 校验和
