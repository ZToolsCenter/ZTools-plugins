# File Renamer - 文件批量重命名工具

> 批量文件重命名工具，支持多种重命名规则

使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件，提供完整的批量文件重命名功能。

![主界面](images/main.png)

## 功能特性

### 已支持的重命名规则

| 规则 | 说明 | 示例 |
|------|------|------|
| **查找替换** | 支持纯文本和正则表达式替换 | `photo_001.jpg` → `image_001.jpg` |
| **前缀/后缀** | 在文件名添加前缀或后缀 | `file.txt` → `new_file_final.txt` |
| **大小写转换** | 转换为小写、大写、驼峰、蛇形等 | `My File Name.txt` → `my_file_name.txt` |
| **序列号** | 添加递增序号，支持起始值、步长、位置 | `img.jpg` → `img01.jpg` |
| **模板** | 使用模板变量自定义命名 | `{name}_{date}.{ext}` |
| **时间戳** | 添加文件创建/修改时间戳 | `doc.pdf` → `doc_2024-01-15.pdf` |
| **清理名称** | 移除特殊字符和空格 | `my file#1.txt` → `myfile1.txt` |
| **删除字符** | 按字符、类型、位置或去重删除 | `file name.txt` → `filename.txt` |
| **扩展名转换** | 批量更改文件扩展名 | `photo.jpeg` → `photo.jpg` |
| **去重** | 自动处理重复文件名 | `file.txt`, `file.txt` → `file.txt`, `file_1.txt` |

![工作流](images/workflow.png)

## 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── images/
│   ├── main.png              # 主界面截图
│   └── workflow.png          # 工作流截图
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── core/                 # 核心引擎
│   │   ├── engine.ts        # 重命名引擎
│   │   ├── registry.ts      # 插件注册表
│   │   ├── types.ts         # 类型定义
│   │   └── bridge.ts        # 桥接层
│   ├── plugins/              # 重命名规则插件
│   │   ├── index.ts         # 插件导出
│   │   ├── replace.ts       # 查找替换
│   │   ├── add-prefix-suffix.ts  # 前缀/后缀
│   │   ├── case-transform.ts     # 大小写转换
│   │   ├── sequence.ts     # 序列号
│   │   ├── template.ts     # 模板
│   │   ├── timestamp.ts    # 时间戳
│   │   ├── clean-name.ts   # 清理名称
│   │   ├── delete-char.ts  # 删除字符
│   │   ├── extension-transform.ts # 扩展名转换
│   │   └── uniqueify.ts    # 去重
│   ├── components/          # Vue 组件
│   │   ├── layout/          # 布局组件
│   │   ├── workflow/        # 工作流组件
│   │   └── preview/         # 预览组件
│   ├── locales/             # 国际化
│   │   ├── zh.json
│   │   └── en.json
│   └── i18n/                 # 国际化配置
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
pnpm build
```

构建产物将输出到 `dist/` 目录。

## 使用说明

### 1. 添加文件

通过拖拽或命令触发方式添加需要重命名的文件。

### 2. 配置重命名规则

从左侧规则面板选择需要的重命名规则，配置相应参数：

- **查找替换**：设置要替换的文本和替换文本，支持正则表达式
- **前缀/后缀**：输入要添加的前缀和后缀
- **大小写转换**：选择目标大小写风格
- **序列号**：设置起始值、步长、位数和位置
- **模板**：使用变量自定义命名格式
- **时间戳**：选择时间格式和位置
- **清理名称**：设置清理选项
- **删除字符**：选择删除模式（字符/类型/位置/去重）并配置参数
- **扩展名转换**：输入新的扩展名
- **去重**：选择冲突处理方式

### 3. 预览和应用

在右侧预览区域查看重命名效果，确认无误后执行重命名操作。

## 技术栈

- Vue 3 (Composition API)
- TypeScript
- Vite
- Tailwind CSS

## 开源协议

MIT License

---

作者: [nichijoux](https://github.com/nichijoux)
