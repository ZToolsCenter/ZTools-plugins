<div align="center">

# [解散文件夹](https://github.com/me1dlinger/dir-break)

适配 [ZTools](https://github.com/ZToolsCenter/ZTools) 的解散文件夹插件，支持单层或递归解散，可预览结果，可撤销解散操作

</div>

***

[更新日志](./CHANGELOG.md)

***

## 使用方式

1. 在 ZTools 中输入 `解散文件夹` 打开插件
2. 直接拖入文件夹到插件窗口
3. 点击「选择文件夹」按钮选取目录

## 截图

<p align="center">
  <img src="https://files.seeusercontent.com/2026/07/19/4wbK/image_139.png" width="360" />
  <img src="https://files.seeusercontent.com/2026/07/19/Kvd2/image_144.png" width="360" />
  <img src="https://files.seeusercontent.com/2026/07/19/o2cC/image_140.png" width="360" />
  <img src="https://files.seeusercontent.com/2026/07/19/Eh7s/image_142.png" width="360" />
  <img src="https://files.seeusercontent.com/2026/07/19/atK6/image_141.png" width="360" />
  <img src="https://files.seeusercontent.com/2026/07/19/xH5s/image_143.png" width="360" />
  
</p>

## 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置清单
│   └── preload/
│       ├── package.json      # 强制 CommonJS 模块
│       └── services.js       # Node.js 文件操作层
├── src/
│   ├── main.ts               # Vue 入口
│   ├── main.css              # 全局样式、主题令牌、按钮与加载动画
│   ├── App.vue               # 根组件（分发 enterAction）
│   ├── env.d.ts              # 类型声明 + ztools/services 接口
│   ├── types.ts              # ScanResult / BreakRecord 等类型
│   └── Break/
│       ├── index.vue         # 核心编排组件
│       └── widgets/
│           ├── DropArea.vue      # 拖拽区 + 选择按钮
│           ├── FolderBar.vue     # 路径显示 + 资源管理器打开
│           ├── ConfigBar.vue     # 模式切换 + 冲突策略选择
│           ├── PreviewPanel.vue  # 统计栏、类型徽标、对比树、文件/目录列表
│           ├── ConfirmDialog.vue # 执行前确认弹窗
│           └── HistoryList.vue   # 历史记录列表 + 撤回按钮
├── index.html
├── vite.config.js
├── tsconfig.json
├── package.json
└── CHANGELOG.md
```

## Preload 服务

`public/preload/services.js` 提供 5 个后端函数，运行在 Node.js 上下文：

| 函数 | 说明 |
|------|------|
| `scanDirectory(dirPath, recursive)` | 同步扫描目录，返回文件/目录统计与类型分布 |
| `breakDirectory(dirPath, options)` | 执行解散：移动文件、清空目录、记录历史、自动处理名称冲突 |
| `undoBreak(record)` | 撤回指定记录，将文件原路移回并重建目录 |
| `getHistory()` | 读取本地持久化的操作历史 |
| `clearHistory()` | 清空所有历史记录 |

历史记录存储在 `userData/dir-break-history.json`，上限 50 条。

## 开发

```bash
npm install
npm run dev    # 开发模式 http://localhost:5173
npm run build  # 构建到 dist/
```

## 开源协议

[GPL V3](./LICENSE)

***