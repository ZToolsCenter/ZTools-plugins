<div align="center">

![HushReader Logo](public/logo.png)

# [隐阅盒 · HushReader](https://github.com/me1dlinger/hushreader)

适配 [ZTools](https://github.com/ZToolsCenter/ZTools) 的阅读插件，支持 TXT / EPUB / MOBI 格式

</div>

***

[更新日志](./CHANGELOG.md)

***

## 功能一览

### 隐阅窗口
- 悬浮窗口，可置于任意位置
- 翻页控制：滚轮翻页 / 快捷键翻页 / 自动翻页
- 进度管理：百分比进度编辑跳转、章节列表高亮当前进度、书签功能（添加/列表/跳转/删除）
- 全文搜索：搜索全书内容，按句子展示结果，支持分页浏览、关键词高亮、双击跳转
- 窗口行为：鼠标移出隐藏三模式（不隐藏/仅进度/全隐藏）、移入显示延迟可调、窗口大小锁定
- 快捷操作：添加书签快捷键（Shift+F）、销毁窗口快捷键（Shift+D）

### 书架管理
- 书籍导入：拖拽导入 / 快捷文件导入（`导入书籍`）
- 信息管理：书籍信息窗口（封面、简介、分类、阅读统计）、右键编辑元数据（标题、作者、分类）
- 批量操作：多选模式 + 批量重载/删除/设置分类、重载元数据 / 恢复封面
- 阅读状态：已读完标记 + 标记为未读完、书架统计栏（总书籍/已读/阅读时长）
- 筛选排序：书籍分类筛选栏、按添加时间/书名/作者/最近阅读排序

### 个性化设置
- 外观控制：背景透明度与整体透明度分离控制、亮色/暗色主题切换、列表书架模式
- 字体样式：自定义字体（支持添加系统字体）、十六进制颜色输入 + 颜色选择器
- 配置管理：设置实时预览、取消可还原、多配置方案切换

### 技术特性
- 只显示完整行，文字不残缺
- 文本预处理：压缩空行、清理空白
- 阅读进度持久化，关闭再开继续读

## 截图

![书架](https://files.seeusercontent.com/2026/06/24/Pqs5/image_105.png)
![列表书架](https://files.seeusercontent.com/2026/06/24/1xDq/image_110.png)
![暗色模式](https://files.seeusercontent.com/2026/06/24/iR3q/image_106.png)
![右键菜单](https://files.seeusercontent.com/2026/06/24/Mb0u/image_107.png)
![书籍信息](https://files.seeusercontent.com/2026/06/24/6oZd/image_109.png)
![章节列表](https://files.seeusercontent.com/2026/06/24/zc1T/image_111.png)
![书签列表](https://files.seeusercontent.com/2026/06/24/Sur5/image_112.png)
![搜索跳转](https://files.seeusercontent.com/2026/06/24/5Nhl/image_113.png)
![书籍分类](https://files.seeusercontent.com/2026/06/24/7xXx/image_114.png)
![隐阅窗口设置](https://files.seeusercontent.com/2026/06/24/Dl4e/image_115.png)
![功能设置](https://files.seeusercontent.com/2026/06/24/9Nle/image_117.png)
![其他设置](https://files.seeusercontent.com/2026/06/24/Wta6/image_118.png)
![隐阅效果](https://files.seeusercontent.com/2026/06/18/h1Jb/show.gif)


## 快速开始

### 安装

- 已上架市场，ZTools插件市场搜索**隐阅盒**，点击**安装**按钮
- 下载github-release文件，在ZTools**搜索框**完成导入

### 开发

```bash
npm install
npm run dev      # 启动开发服务器
npm run build    # 构建生产版本
```

### 触发方式

在 ZTools 中输入以下关键词即可唤起：

`隐阅盒` · `hushreader` · `摸鱼阅读` · `书架` · `yyh` · `开始阅读` · `导入书籍`（支持拖入 txt/epub/mobi 文件）

## 技术细节

<details>
<summary><b> 阅读进度持久化</b></summary>

阅读进度使用**字符偏移量**（`progressIndex`）而非页码保存，窗口大小或字体变化时进度不会丢失。

**存储策略**：轻量数据（书籍列表不含封面、阅读进度、配置）使用 `ztools.dbStorage`，回退到 `localStorage`；封面和章节内容使用 `ztools.db`（PouchDB 风格数据库），通过 `ztools.db.promises` API 管理 `cover_{bookId}`、`custom_cover_{bookId}`、`chapters_{bookId}` 等文档。

**保存时机**：翻页时 · 章节切换时 · 自动翻页 tick · 插件退出时

**每本书保存**：

| 字段                 | 说明          |
| ------------------ | ----------- |
| `lastChapter`      | 当前章节索引      |
| `progressIndex`    | 章节内字符偏移量    |
| `lastReadAt`       | 最后阅读时间戳     |
| `totalChapters`    | 总章节数        |
| `firstReadAt`      | 首次阅读时间戳     |
| `readingTimeMs`    | 累计阅读时长（毫秒）  |
| `readingSpeed`     | 阅读速度（字/分钟）  |
| `readingPercent`   | 阅读百分比       |
| `updatedAt`        | 更新时间戳       |
| `description`      | 书籍简介        |
| `categories`       | 分类数组        |
| `customCoverImage` | 自定义封面       |
| `fileModifiedAt`   | 文件修改时间      |
| `isFinished`       | 是否已读完       |
| `bookmarks`        | 书签列表（章节索引、字符偏移、内容预览、创建时间） |

</details>

<details>
<summary><b>连续分页算法</b></summary>

基于"页面起始索引表"（`pageStarts`）实现连续翻页：

- **下一页**：当前页 `endIndex` → 下一页 `startIndex`
- **上一页**：在 `pageStarts` 中二分查找定位上一页起始位置
- **跨章节**：下一章从 `progressIndex=0` 开始，上一章跳到末页

只显示完整行：固定行高 + `overflow: hidden`，行数通过 `Math.floor(readableHeight / linePx)` 精确计算。

</details>

<details>
<summary><b>透明度分离控制</b></summary>

- **整体透明度**（`opacity`）：CSS `opacity`，同时影响背景和文字
- **背景透明度**（`bgOpacity`）：背景色 alpha 通道，使用 `rgba` 格式

两者独立控制，可实现"背景半透明 + 文字清晰"的沉浸效果。

</details>

<details>
<summary><b>文本预处理</b></summary>

解析 TXT / EPUB / MOBI 时自动预处理：

- `\r\n` / `\r` → 统一为 `\n`
- Tab / 全角空格 → 普通空格
- 连续空格 → 压缩为一个
- 三个以上换行 → 保留一个空行
- 开头结尾空行 → 移除

</details>

<details>
<summary><b>MOBI 格式解析</b></summary>

### 加密检测（DRM）

本应用**不支持**解密 DRM 加密的书籍，但会正确识别加密类型并返回用户友好的提示：

| 加密类型 | 说明 | 提示信息 |
| -------- | ---- | -------- |
| `0` | 未加密 | 正常解析正文 |
| `1` | 旧版 Mobipocket（单 PID） | 提示使用旧版加密方案，正文受保护 |
| `2` | Mobipocket/Kindle DRM（多 PID） | 提示使用现代加密方案，正文受保护 |

**即使书籍加密，仍可读取**：标题、作者、封面等元数据（这些存储在未加密的记录区域）。

### 压缩格式支持

| 压缩类型 | 值 | 支持情况 |
| -------- | --- | -------- |
| `COMPRESSION_NONE` | `1` | ✅ 支持，直接读取原始内容 |
| `COMPRESSION_PALMDOC` | `2` | ✅ 支持，实现了 PalmDOC 解压缩算法 |
| `COMPRESSION_HUFFCDIC` | `17480` | ❌ 暂不支持，返回明确提示 |

### 封面提取

封面图片存储在独立的资源记录中（不受正文加密影响）：

1. 从 EXTH 记录 201 获取封面索引偏移
2. 将偏移值与 MOBI 头的 `firstImageIndex` 相加得到实际记录索引
3. 从对应 PDB 记录中提取图片数据
4. 自动检测图片格式（JPEG / PNG / GIF），转换为 Base64 URL

### 解析流程

```
PDB 文件头 (78字节) → 读取总记录数
        ↓
记录偏移表 → 获取每条记录的起始位置
        ↓
Record 0 → PalmDOC 头 + MOBI 头 + EXTH 记录
        ↓
元数据提取：标题(FullName)、作者(EXTH 100)、封面(EXTH 201)
        ↓
加密检测 → 若加密，返回元数据 + 提示信息
        ↓
正文记录 → 按 firstNonBookIndex 或 recordCount 读取文本记录
        ↓
解压缩 → PalmDOC 压缩格式解码
        ↓
编码检测 → UTF-8 或 Windows-1252 解码
        ↓
HTML/纯文本判断 → 分章解析或按 TXT 逻辑处理
```

</details>

## 项目结构

```
├── public/
│   ├── hushreader.html           # 隐阅窗口
│   ├── plugin.json               # ZTools 插件配置
│   ├── logo.png                  # 插件图标
│   └── preload/
│       ├── package.json
│       └── services.js           # Node.js 能力扩展
├── src/
│   ├── App.vue                   # 根组件
│   ├── main.ts                   # 应用入口
│   ├── main.css                  # 应用样式
│   ├── env.d.ts                  # 环境变量类型定义
│   ├── stores/
│   │   ├── books.ts              # 书籍数据 + 持久化
│   │   ├── config.ts             # 配置数据 + 持久化
│   │   └── reader.ts             # 阅读器状态 + 分页
│   ├── utils/
│   │   ├── db.ts                 # 数据库操作工具（封面/章节缓存）
│   │   ├── txtParser.ts          # TXT 解析 + 分页 + 预处理
│   │   ├── epubParser.ts         # EPUB 解析
│   │   └── mobiParser.ts         # MOBI 解析 + 加密检测 + 封面提取
│   └── components/
│       ├── Bookshelf/            # 书架组件
│       │   ├── index.vue
│       │   ├── BookCard.vue
│       │   ├── BookInfoModal.vue # 书籍信息窗口
│       │   ├── ContextMenu.vue   # 右键菜单
│       │   ├── Modal.vue         # 通用弹窗
│       │   ├── ThemeToggle.vue   # 主题切换
│       │   └── Toast.vue         # Toast 提示
│       └── Settings/             # 设置面板
│           └── index.vue
├── .gitignore
├── CHANGELOG.md                  # 更新日志
├── LICENSE
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── ztools.api.md                 # ZTools API 文档
```

## 开源协议

[GPL V3](./LICENSE)

***
