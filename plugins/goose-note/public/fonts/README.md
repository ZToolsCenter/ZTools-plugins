# PDF 中文字体

PDF 导出使用 `NotoSansSC-Regular.ttf` 渲染中文。该字体 ~4MB，未随源码提交，需要用户手动放置。

## 下载步骤

1. 访问 [Google Fonts — Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)
2. 点击右上角 "Get font" → "Download all"
3. 解压后取 `NotoSansSC-Regular.ttf`，放到本目录：

```
public/fonts/NotoSansSC-Regular.ttf
```

## 行为

- 字体存在：PDF 中文正常渲染
- 字体缺失：控制台 warn，回退到 react-pdf 内置 Helvetica（**中文会显示为方框**），不阻塞导出流程

> 仅 PDF 导出依赖此字体；Markdown / HTML / DOCX / PNG 导出不受影响。
