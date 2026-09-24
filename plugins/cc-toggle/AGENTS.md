# Agent 规则

## 图片处理

- 任何用户消息若包含图片附件、截图，或引用本地图片文件（`.png`、`.jpg`、`.jpeg`、`.webp`、`.gif` 等路径），必须先调用 `image-reader` skill 读取图片内容，再基于内容回复。
- 不要因为"当前模型不支持看图"而跳过：图片描述来自 `image-reader` skill 中的 `scripts/read-image.py`。
- 若图片是 UI 设计稿且用户希望按设计还原界面，按 skill 内的 UI 设计稿模式提取完整设计规范。
