# img-comp

适用于 ZTools 的本地图片压缩插件，基于 Vue 3、Vite、JavaScript 与 WebAssembly 实现，离线压缩不依赖任何网络服务，页面设计借鉴 uTools 图片压缩

![软件界面](https://raw.githubusercontent.com/z-hanzhe/ztools-img-comp/refs/heads/main/docs/images/demo.png)

![设置页面](https://raw.githubusercontent.com/z-hanzhe/ztools-img-comp/refs/heads/main/docs/images/settings.png)

## 支持格式

- **JPEG**：使用 `@jsquash/jpeg` 的 MozJPEG WebAssembly 编码器重新编码，默认质量 75，可在设置中调整为 1-100。
- **PNG**：使用 `@jsquash/oxipng` WebAssembly 优化器，执行无损优化并保留透明度。
- **GIF**：使用 `gifuct-js` 解码动画帧，使用 `gifenc` 重新编码，保留动画和帧时序。
- **SVG**：使用 `svgo` 进行结构优化，保留 `viewBox`。

如果输出文件没有变小，插件会保留原文件作为结果，不会用更大的文件替换它。

## 使用方式

| 操作 | 结果 |
| --- | --- |
| 搜索 `图片压缩` | 打开空界面，可拖入或粘贴图片 |
| 选择一张或多张图片后触发 ZTools | 创建一个批量压缩任务 |
| 选择一个文件夹后触发 ZTools | 按设置决定是否递归压缩文件夹中的图片，默认只处理当前目录 |
| 在资源管理器/访达中呼出 ZTools | 按设置决定是否递归压缩当前目录中的图片 |
| 复制截图后打开 ZTools | 压缩剪贴板中的图片 |

选择目录后会立即打开扫描中的批次标签页，显示已扫描条目和已发现图片数量；扫描过程中可以取消，取消后该标签页关闭。压缩完成后，列表中的替换和复制按钮只作用于当前图片并保持窗口打开，底部批量操作才会隐藏主窗口。点击左下角齿轮可以设置 JPEG 压缩率、并发线程数、是否递归子文件夹以及递归时需要忽略的目录名称。任务历史只保存文件路径和压缩统计，不保存图片内容；历史最多保存 8 条，压缩临时文件超过 24 小时后会在插件启动时清理。

## 安装

将 `dist/` 作为完整插件目录导入 ZTools 开发者工具，或等待官方 Action 将其打包后安装。

执行 `npm run build` 后，`dist/` 是可直接导入的完整插件目录；官方插件仓库的 Action 会从该目录内容创建 ZIP 安装包。

## 许可证

本项目自身代码采用 MIT License。运行时依赖及其 WASM 编解码器继续采用各自的上游许可证，构建时会随运行时依赖一并分发其原始许可证文件和许可证元数据。
