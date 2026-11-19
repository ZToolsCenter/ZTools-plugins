# 第三方说明

本项目是第三方 ZTools 插件，不隶属于 FSearch 或 ZTools 官方。

## 外部引擎：noahdunnagan/fsearch

项目：https://github.com/noahdunnagan/fsearch\
已验证版本：v0.2.1（macOS Apple Silicon）\
许可证：MIT。FSearch 由用户独立安装，本插件不捆绑其二进制、不复制其索引或实现代码，仅使用公开的 JSON Lines 接口。以下保留其许可声明以便用户了解依赖。

```text
MIT License

Copyright (c) 2026 Noah Dunnagan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Windows：Everything 和 ES

Everything 索引服务由用户独立安装。插件随包分发 voidtools 的官方 ES 1.1.0.38 命令行工具，许可证和来源见 [vendor/es](vendor/es/README.md)。

## 宿主与图标

ZTools 由用户独立安装。本项目调用公开插件 API，不捆绑宿主代码或二进制；宿主许可证以其项目声明为准：https://github.com/ZToolsCenter/ZTools 。

插件 Logo 的 SVG 源文件及 PNG 导出随本项目 MIT 许可证分发。渲染导出使用 @resvg/resvg-js 2.6.2（MPL-2.0），渲染器不进入运行文件或安装产物。本项目没有 npm 运行时第三方依赖。

若后续改为捆绑引擎或引入第三方实现，需要重新核查所有随包组件的许可与声明；此文档不代表官方市场已审核。
