# PDF 中文字体

PDF 导出使用 `NotoSansSC-Regular.ttf` 或 `NotoSansSC-Regular.otf` 渲染中文。该字体数 MB，未随源码提交。

主应用构建（`vite build`）若发现本目录缺少字体，会自动下载 Noto Sans SC SubsetOTF Regular。

也可手动放置：

1. 访问 [Google Fonts — Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)
2. 点击右上角 "Get font" → "Download all"
3. 解压后取 Regular 的 `.ttf` / `.otf`，放到本目录：

```
public/fonts/NotoSansSC-Regular.ttf
# 或
public/fonts/NotoSansSC-Regular.otf
```

## 行为

- 字体存在：导出前读成 data URL 再交给 @react-pdf（避免 uTools/ZTools 的 file:// 去 fetch `/fonts/...` 根路径 404）
- 字体缺失：控制台 warn，保留 BlockNote 默认 Inter，**不注册 404 URL**，导出不会因此 Failed to fetch；中文可能变成方框

> 仅 PDF 导出依赖此字体；Markdown / HTML / DOCX / PNG 导出不受影响。小窗构建会删掉拷进 dist-quicknote 的 fonts。
