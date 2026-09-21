# snap-translate

**截图 → OCR → 翻译** 的 ZTools 插件。优先走宿主默认 OCR / 翻译提供商；默认不可用时再回退微信 / Paddle 与微软 / 谷歌等。

## 入口

| feature | 入口 |
| --- | --- |
| `snap-translate` | 「贴图」→ 悬浮贴：OCR、翻译覆盖原文、再点恢复原文 |
| `snap-ocr-only` | 「OCR」→ 主窗识别文字，可再选语言翻译 |
| `snap-ocr-translate` | 「OCR翻译」→ 识别并翻译对照 |
| `image-translate` | 「翻译图片」→ 拖入图片 |
| `text-translate` | 「翻译文本」→ 选中文本翻译 |
| `settings` | 「截图翻译设置」 |

## 行为要点

- OCR / 翻译均优先宿主默认提供商；OCR 失败回退微信明细 / Paddle，翻译失败回退微软 / 谷歌等
- 贴图：未识别时点「翻译」会识别并盖上译文；成功后按钮变为「原文」，点击还原
- 结果窗 / 主窗底部小字展示实际使用的 OCR、翻译引擎

## 开发

```bash
npm install
npm run dev      # 端口 5180
npm run build
npm test
```

## 结构

```
/
├── public/plugin.json
├── public/preload/      # 贴窗、OCR、翻译
├── index.html / board.html / result.html
└── src/                 # Vue
```
