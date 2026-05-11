# 开发加解密编码工具

这是一个 ZTools UI 插件，覆盖常用开发场景：

- Base64、Base64URL、URL、HTML Entity、Unicode escape、Hex、Binary
- JSON 格式化、压缩
- MD5、SHA-1、SHA-256、SHA-384、SHA-512
- HMAC-SHA256、HMAC-SHA384、HMAC-SHA512
- AES-GCM、AES-CBC 基于口令加密和解密
- JWT 解码、HS256/HS384/HS512 校验

## 导入到 ZTools

1. 打开 ZTools 设置。
2. 进入「已安装插件」或「开发项目」相关页面。
3. 选择导入开发中插件，并选择本目录下的 `plugin.json`：

```text
/Users/pamali/project/developer-codec-tools/plugin.json
```

## 本地校验

```bash
npm test
```

## 开发

```bash
pnpm install
pnpm dev
```

开发服务器默认运行在：

```text
http://localhost:5178
```
