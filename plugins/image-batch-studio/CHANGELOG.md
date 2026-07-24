# Changelog

## v0.1.0 - 2026-06-02

- 初始发布图片批处理插件，当前支持 macOS，Windows 适配开发中。
- 支持 Apple Silicon M 系列（arm64）和 Intel（x64）两类 macOS 设备，打包产物内置双架构 Sharp 运行时。
- 支持 JPG、JPEG、PNG、WebP、AVIF、HEIF、HEIC、TIFF、GIF 和 PDF 文件入口。
- 支持图片压缩、添加水印、格式转换、调整尺寸、图片裁剪、手动裁剪、图片旋转、图片翻转、添加边框和设置圆角。
- 支持合并 PDF、合并图片和合成 GIF。
- 所有图片处理、PDF 合并和 GIF 合成均在本地离线完成。
- 增加 typecheck、单元测试、macOS 双架构运行时检测、本地安装 smoke 和插件打包验证。
