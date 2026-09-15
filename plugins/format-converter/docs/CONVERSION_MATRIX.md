# 转换矩阵

| 来源 | 推荐输出 | 模式 | 说明 |
|---|---|---|---|
| Word / Excel / PPT | PDF、图片 | visual | OfficeCLI exporter、LibreOffice 或浏览器渲染 |
| Word / Excel / PPT | 文本、HTML、数据 | extract | OfficeCLI 内容提取 |
| Word / Excel / PPT | 另一种 Office | editable | 语义重建，不保留完整版式 |
| PDF | 图片 | visual | PDF.js 逐页渲染 |
| PDF | 文本、JSON、CSV | extract / editable | 文本层提取；扫描页可选 OCR |
| PDF | Word / PPT | visual / editable | 页面图片或文本重建 |
| 图片 | 图片、PDF | visual | Sharp 转码或 pdf-lib 封装 |
| 图片 | 文本、数据 | editable | Tesseract OCR |
| 图片 | Word / Excel / PPT | visual / editable | 图片嵌入或 OCR 重建 |
| TXT / Markdown / HTML | Office、PDF、图片 | editable / visual | 默认模板排版 |
| CSV / TSV / JSON | Excel、文本、数据 | editable | 保留表格行列 |

不承诺保留 VBA、宏、ActiveX、OLE、数字签名、IRM、PPT 动画、复杂公式缓存和全部字体。PDF/图片反向生成可编辑 Office 时必须展示版式损失提示。
