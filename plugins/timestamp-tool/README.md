# 时间戳工具

基于 Vue 3、Vite 和 TypeScript 构建的 zTools 时间戳插件，页面设计借鉴 uTools 时间戳工具

## 效果展示

![时间戳工具首页](https://raw.githubusercontent.com/z-hanzhe/ztools-timestamp-tool/refs/heads/main/docs/images/demo.png)

## 功能

- 在 zTools 中输入“时间戳工具”或 `timestamp` 打开插件。
- 默认填入当前毫秒级时间戳，并自动聚焦输入框。
- 支持秒级/毫秒级 Unix 时间戳、ISO 日期、常见日期分隔符、中文日期和紧凑日期格式。
- 实时显示中国标准时间、日期、秒级时间戳、毫秒级时间戳和 UTC 时间。
- 从“其他时区”侧栏选择更多固定 UTC 偏移时区或 UTC ISO 8601 格式，选择结果会追加到首页并保存。
- 前 9 项结果支持 `Alt+1` 到 `Alt+9` 快速复制，也可以点击每项右侧的复制按钮。
- 主窗口复制后自动关闭；自动分离后的独立窗口复制后保持打开。

## 开发

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

构建插件：

```bash
npm run build
```

构建产物位于 `dist/`，可将 `dist/` 作为完整插件目录导入 zTools 开发者工具。发布到官方插件仓库时，请在项目根目录执行 `ztools publish`，官方 Action 会先执行构建，再将 `dist/` 内容打包为可安装 ZIP。
