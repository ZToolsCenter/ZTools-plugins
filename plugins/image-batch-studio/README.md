# 图片批处理

ZTools 图片批处理插件，提供面向图片文件、PDF 文件和文件夹入口的批量处理能力。当前仅支持 macOS，Windows 适配开发中。

## 界面截图

![图片批处理插件界面](./screenshots/main.jpg)

## 平台支持

- macOS：当前版本已支持 Apple Silicon M 系列（arm64）和 Intel（x64）。
- Windows：适配开发中，后续版本发布。

## 功能

- 图片压缩：按质量预设或滑块输出更小体积图片。
- 添加水印：支持文本水印和图片水印。
- 格式转换：支持 JPEG、PNG、WebP、AVIF、HEIF、TIFF、GIF。
- 调整尺寸：支持等比缩放、指定尺寸、长边/短边约束。
- 图片裁剪：支持预设裁剪和手动裁剪。
- 图片旋转与翻转：支持常见角度、水平/垂直翻转。
- 添加边框和圆角：支持颜色、宽度、圆角半径设置。
- 合并 PDF：按导入顺序合并多个 PDF。
- 合并图片：支持纵向、横向、宫格拼图。
- 合成 GIF：将多张图片合成为动图。

## 使用方式

1. 在 ZTools 中搜索 `图片批处理`、`图片压缩`、`图片转换` 或 `图片水印`。
2. 导入图片、PDF 或文件夹。
3. 在左侧选择处理模块并调整参数。
4. 点击执行，处理结果会输出到选择的目录。

## 支持入口

- 文本命令：`图片批处理`、`图片压缩`、`图片转换`、`图片水印`。
- 图片入口：对单张图片直接进入批处理。
- 文件入口：支持 jpg、jpeg、png、webp、avif、heif、heic、tiff、gif、pdf。
- 文件夹入口：批量读取文件夹内支持的图片和 PDF 文件。

## 技术实现

- React + Vite 构建界面。
- TypeScript 编写 UI、预加载层和处理器。
- Sharp 处理图片压缩、转换、裁剪、水印、拼图、圆角等能力。
- pdf-lib 处理 PDF 合并。
- gifenc 处理 GIF 合成。
- 所有处理在 ZTools 插件本地预加载进程内完成。

## 本地开发

```bash
npm install
npm run dev
```

开发模式入口为 `http://127.0.0.1:5177`。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run verify:runtime
npm run install:local
npm run smoke:installed
```

`verify:runtime` 会检测打包产物是否包含 macOS arm64/x64 两套 Sharp 运行时。`smoke:installed` 会在本地生成测试图片和 PDF，验证图片处理、拼图、GIF 合成、PDF 合并以及 ZTools 安装记录。
