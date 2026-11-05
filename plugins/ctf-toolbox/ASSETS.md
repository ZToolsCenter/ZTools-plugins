# 素材与版权说明

本插件只使用原创代码、公开算法与公开安全知识，不引入第三方商业图标、字体文件或受版权保护的图片。

## Logo

`logo.png` 由本项目用 Python Pillow 几何绘制生成（圆角矩形、盾形轮廓、折线、点阵装饰），不临摹任何商标、游戏或商业产品外观。作者以 MIT License 释出。

界面不嵌入自定义字体文件，仅使用系统字体栈：

- `-apple-system`
- `BlinkMacSystemFont`
- `"Segoe UI"`
- `Roboto`
- `"Noto Sans CJK SC"`
- `"SF Mono"`, `Menlo`, `Consolas`, `monospace`

## 算法与 Payload

编解码、哈希、JWT 解析实现依据公开标准：

- RFC 4648 Base64 / Base32
- RFC 3986 URL encoding
- HTML 字符引用
- Unicode 转义
- Bitcoin Base58 字母表（公开约定）
- Morse ITU 国际电码表
- MD5 / SHA 系列（通过 Node.js `crypto` 或 Web Crypto）

Payload 速查内容来自长期公开的 CTF / Web 安全资料（PHP 手册包装器、OWASP、PortSwigger 公开 Cheat Sheet 中的常见探针写法），由本项目重新整理与注释。它们是**知识点速查**，不是针对具体系统的利用程序。

## 使用边界

仅用于 CTF、本地靶场与已获得书面授权的安全测试。请勿用于未授权访问。
