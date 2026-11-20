# 第三方声明索引

## CyberChef 本体

- 项目：GCHQ / CyberChef v11.5.0
- 许可：Apache License 2.0（全文见 `LICENSE.txt`）
- 版权：Crown Copyright 2016-2026（见 `index.html` 的 `<meta name=copyright>`）
- 改动：见 `MODIFICATIONS.md`

## 打包进离线包的第三方库

官方离线包为 webpack 构建产物，把各依赖的许可证声明抽成了 30 个 `*.LICENSE.txt` 文件，
分布在插件根目录、`assets/`、`assets/tesseract/` 与 `modules/` 下。
本次分发**原样保留全部 30 份，未删除、未修改**，因此各依赖的版权与许可声明随包完整保留。

已抽查的声明涉及（不限于）：MIT、ISC、BSD-2-Clause、BSD-3-Clause、Apache-2.0、
MPL-2.0（DOMPurify 为 Apache-2.0 / MPL-2.0 双许可）、SheetJS/cptable 等。
逐个依赖的准确许可与版权请以对应 `*.LICENSE.txt` 原文为准。

```bash
# 列出全部声明文件
find . -name "*.LICENSE.txt" | sort
```

检索结果：30 份声明中**未出现 GNU GPL / AGPL 全文**；本插件未额外引入任何 npm 包、
未引入来源不明代码、未引入在线 CDN 资源，可完全离线运行。

## 图标

`logo.png` 取自官方离线包 `images/cyberchef-128x128.png`，未修改，仅为满足
ZTools 对实体 PNG 图标的要求而复制到插件根目录。

## 字体与静态资源

`assets/` 下的字体、图标与 `images/` 下的图片均为官方离线包原有资源，随包原样分发。
