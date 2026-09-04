# ylinx-calculated-length

> 一个用于计算字符串字符数和字节数的 ZTools 插件，支持 UTF-8 和 GBK 编码统计。

## 功能说明

- 输入任意文本，实时统计字符数
- 支持切换 `UTF-8` 和 `GBK` 两种编码查看字节数
- 支持从插件进入参数中读取粘贴文本并自动带入输入框
- 支持浅色和深色主题显示

## 开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

构建插件：

```bash
npm run build
```

## 目录说明

```text
.
├── public/
│   ├── logo.png
│   └── plugin.json
├── src/
│   ├── App.vue
│   ├── main.css
│   ├── main.ts
│   ├── env.d.ts
│   └── Calcu/
│       └── index.vue
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.js
```
