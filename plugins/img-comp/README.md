# img-comp

适用于 ZTools 的本地图片压缩插件，离线压缩不依赖任何网络服务，页面设计借鉴 uTools 图片压缩

![软件界面](https://raw.githubusercontent.com/z-hanzhe/ztools-img-comp/refs/heads/main/assets/demo.png)

## 支持格式

- **JPEG**：使用 `@jsquash/jpeg` 的 MozJPEG WebAssembly 编码器重新编码，质量 85，肉眼几乎无损。
- **PNG**：使用 `@jsquash/oxipng` WebAssembly 优化器，执行无损优化并保留透明度。
- **GIF**：使用 `gifuct-js` 解码动画帧，使用 `gifenc` 重新编码，保留动画和帧时序。
- **SVG**：使用 `svgo` 进行结构优化，保留 `viewBox`。

如果输出文件没有变小，插件会保留原文件作为结果，不会用更大的文件替换它。

## 使用方式

| 操作 | 结果 |
| --- | --- |
| 搜索 `图片压缩` | 打开空界面，可拖入或粘贴图片 |
| 选择一张或多张图片后触发 ZTools | 创建一个批量压缩任务 |
| 选择一个文件夹后触发 ZTools | 递归压缩文件夹中的图片 |
| 在资源管理器/访达中呼出 ZTools | 压缩当前目录中的图片（递归） |
| 复制截图后打开 ZTools | 压缩剪贴板中的图片 |

压缩完成后可以逐张或批量复制结果，也可以一键写回原文件。任务历史只保存文件路径和压缩统计，不保存图片内容；历史最多保存 8 条，压缩临时文件超过 24 小时后会在插件启动时清理。

## 安装

将 `dist/img-comp.zpx` 拖入 ZTools 的插件安装入口即可，或直接在 ZTools 插件市场搜索“图片压缩”安装。

执行 `npm run build` 后，`dist/` 是可直接导入的完整插件目录；官方插件仓库的 Action 会从该目录内容生成 ZIP 安装包。

## 许可证

本项目自身代码采用 MIT License。运行时依赖及其 WASM 编解码器继续采用各自的上游许可证，构建时会随运行时依赖一并分发其原始许可证文件和许可证元数据。
