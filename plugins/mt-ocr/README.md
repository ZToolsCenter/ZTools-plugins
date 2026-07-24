# mt-ocr

> 馒头OCR — 多引擎 OCR 文字识别，支持截图/本地图片/剪贴板/拖放

基于 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件，支持腾讯云、百度云、阿里云 OCR 服务。

## 功能特性

- **多引擎支持**：腾讯云 / 百度云 / 阿里云 OCR，可任意切换
- **多种输入方式**：截图识别、打开本地图片、剪贴板粘贴、拖放图片
- **一键翻译**：识别结果可直接跳转到「易翻翻译」插件进行翻译
- **结果操作**：支持复制识别文字、保存为 txt 文件、保存图片到本地
- **配置管理**：支持导入/导出 OCR 密钥配置

## 项目结构

```
.
├── public/
│   ├── logo.svg              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── env.d.ts              # 类型声明
│   └── Ocr/                  # OCR 识别功能
│       ├── index.vue         # 主组件
│       ├── types.ts          # 类型定义
│       └── services/         # OCR 服务实现
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

## 使用指南

### 配置 OCR 服务

1. 打开插件，点击工具栏右侧的齿轮图标进入配置
2. 选择对应的 OCR 厂商（腾讯云/百度云/阿里云）
3. 填写 API 密钥并保存

### 识别文字

- **截图**：点击「截图」按钮，框选屏幕区域
- **本地图片**：点击「打开」按钮选择图片文件
- **剪贴板**：复制图片后直接粘贴到插件窗口
- **拖放**：拖拽图片文件到插件窗口

### 识别结果操作

- **复制**：复制识别文字到剪贴板
- **保存**：保存识别文字为 txt 文件
- **翻译**：将识别文字传入「易翻翻译」插件进行翻译

## 插件配置

编辑 `public/plugin.json` 可修改插件名称、描述、触发指令等：

```json
{
  "name": "mt-ocr",
  "title": "馒头OCR",
  "description": "支持腾讯云/百度云/阿里云的多引擎 OCR 文字识别工具",
  "features": [
    {
      "code": "ocr",
      "explain": "OCR 文字识别",
      "cmds": ["OCR", "ocr", "文字识别", "图片转文字", "截图识别"]
    }
  ]
}
```

## Node.js 能力扩展

Preload 脚本 `public/preload/services.js` 提供以下服务：

| 方法 | 说明 |
|------|------|
| `writeTextFile(text)` | 文本写入下载目录 |
| `writeImageFile(base64Url)` | 图片写入下载目录 |
| `readImageFile(filePath)` | 读取图片文件为 Base64 Data URL |

## 常见问题

### Q: 如何调试插件？

A: 使用 `npm run dev` 启动开发服务器，在插件界面中点击插件头像图标，在弹出的菜单中选择"打开开发者工具"进行调试。

### Q: 插件图标不显示？

A: 确保 `public/logo.svg` 文件存在，且在 `plugin.json` 中正确配置了 `logo` 字段。

### Q: OCR 识别失败？

A: 检查是否已正确配置 API 密钥，确认 OCR 服务配额未用完，网络是否正常。

## 开源协议

MIT License
