# PDF 中文字体

不再内置 Noto Sans SC。构建不会下载或拷贝 `public/fonts` 里的 otf/ttf，避免 8MB 打进 dist。

首次导出 PDF 时从钉版本 CDN 远程加载 SubsetOTF Regular（otf，不用 woff2），同会话内存缓存。失败则走系统 / 已有降级，中文可能变成方框。

- 主源：`https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`
- 备用：`https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`

拉到后转成 data URL 再 `Font.register`。uTools 以 file:// 打开页面时，不能把字体 src 设成站点根 `/fonts/...`（会变成 `file:///fonts/...`）。

> 仅 PDF 导出依赖此字体；Markdown / HTML / DOCX / PNG 导出不受影响。
