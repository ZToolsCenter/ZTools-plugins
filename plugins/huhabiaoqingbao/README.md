# 呼哈表情包管理器 (BQB)

一个优雅的 ZTools 表情包管理插件，可以保存和收藏喜欢的表情包，可以联网检索表情包，可以自己制作表情包，让你的表情包收藏和使用更加便捷。

-- 表情存储在本地，请注意备份，避免数据丢失，可以通过导出功能导出全部表情包，这是咱宝贵的资产，丢了可亏大了。
-- 联网检索支持不同的接口，接口都来自互联网，如有无法使用的情况，那就是被 ban 了，请自行更换接口。
-- 发送按钮目前仅支持分离为独立窗口运行时，粘贴图片到光标所在位置。

作者是个后端开发，该工具全靠 AI 辅助开发，作者几乎零编码。兄弟们有任何问题和建议都可以提，我继续去敲打 AI。

## ✨ 功能特点

让你的表情包管理更加优雅高效！

🎯 **简洁优雅的界面设计**
- 精心设计的用户界面，让你的表情包管理体验前所未有的流畅
- 固定窗口大小（800x600），完美适配各种使用场景

📂 **智能的表情包管理**
- 支持点击或粘贴导入表情包
- 智能分类和标签管理
- 快速预览和编辑功能
- 支持表情包制作和简单编辑
- 支持表情包联网检索
- 支持 emoji 检索
- 支持颜表情检索
- 支持 AI 生成表情功能（需自备凭据）
- 支持视频转 GIF 功能

## 使用方法

可以通过以下任意命令唤起表情包管理器：
- 表情包
- bqb
- BiaoQingBao
- 表情
- emoji

选中文本后还可以通过「用呼哈表情包搜索」直接检索该关键词。

### AI 生成表情功能

该功能依赖扣子（Coze）的 API，需要你自己的凭据：

1. 打开插件的「系统设置 → AI 生成」
2. 填写自己的 Coze Token 与 Bot ID 并保存
3. 在「AI 生成表情」菜单中输入描述文本，点击「生成表情」
4. 对生成的表情包进行保存或复制操作，生成结果会自动带上「AI 生成」标签

未填写凭据时该功能不可用，其余功能不受影响。凭据仅保存在本机的插件数据目录中，不会上传。

### 壁纸/表情联网搜索翻译（可选）

中文关键词翻译成英文可以提升部分图源的搜索效果。在「系统设置 → 壁纸搜索翻译」中填写你自己的百度翻译开放平台 APPID 与密钥即可启用；不填则直接使用原关键词搜索。

### 视频转 GIF 功能

在「视频转 GIF」菜单中，你可以：
1. 上传视频文件（支持 MP4、AVI、MOV、WMV 等格式）
2. 预览视频内容
3. 调整 GIF 输出设置：质量（1-10）、帧率（1-30fps）、输出尺寸（原始尺寸、480p、360p、240p）
4. 视频裁剪
5. 添加文字
6. 一键转换为 GIF 格式
7. 支持 GIF 循环播放
8. 转换完成后可以直接保存到表情包库中

## 技术架构

- 前端框架：Vue 3 + TypeScript
- UI 组件：Element Plus
- 构建工具：Vite
- 数据存储：本地文件 + IndexedDB
- 插件运行时：ZTools API（`window.ztools`）+ preload.js

## 项目结构

```
baoqingbao_ztools/
├── src/                # 源代码目录
│   ├── api/           # 外部接口封装（搜索、翻译、AI）
│   ├── assets/        # 静态资源
│   ├── components/    # Vue 组件
│   ├── config/        # 资源路径与凭据读写
│   ├── services/      # 业务服务
│   ├── store/         # 状态管理
│   ├── types/         # 类型声明（含 ztools.d.ts）
│   ├── utils/         # 工具函数
│   └── App.vue        # 主组件
├── public/            # 随插件打包的静态文件
│   ├── images/        # 关于页图标
│   └── preset-images/ # 预设表情包图片
│       ├── funny/     # 搞笑类表情
│       ├── animal/    # 动物类表情
│       └── face/      # 表情类表情
├── scripts/           # 构建脚本
├── plugin.json        # ZTools 插件配置
├── preload.js         # ZTools preload（CommonJS）
└── package.json       # 项目依赖
```

预设图片与关于页图标全部随插件打包在 `public/` 下，插件运行时不依赖任何对象存储服务。

## 本地运行

### 前置条件

1. 安装 Node.js 和 npm
   - 访问 [Node.js 官网](https://nodejs.org/)
   - 下载并安装最新的 LTS 版本
   - 验证安装：
     ```bash
     node --version
     npm --version
     ```

2. 安装 [ZTools](https://github.com/ZToolsCenter/ZTools)

### 开发步骤

1. 安装依赖
```bash
npm install
```

2. 开发模式运行
```bash
npm run dev
```

`plugin.json` 中的 `development.main` 指向 `http://localhost:5173`，在 ZTools 中以开发模式加载本项目目录即可热更新调试。

3. 构建插件
```bash
npm run build
```

构建产物在 `dist/`，其中已包含 `plugin.json`、`preload.js`、`logo.png` 及全部静态资源。

4. 在 ZTools 中加载插件
- 打开 ZTools 插件管理
- 选择开发者/本地插件
- 选择本项目目录（开发模式）或 `dist/` 目录（构建产物）

## 数据存储说明

### 存储位置

表情包和相关数据存储在 ZTools 的插件数据目录下：
- Windows: `%APPDATA%/<ZTools 数据目录>/bqb/emoticons/`
- macOS: `~/Library/Application Support/<ZTools 数据目录>/bqb/emoticons/`
- Linux: `~/.config/<ZTools 数据目录>/bqb/emoticons/`

具体路径由 ZTools 的 `getPath` 决定。

### 存储内容

1. 表情包文件
   - 位置：`emoticons/[表情包ID].dat`
   - 格式：二进制文件
   - 说明：每个表情包单独存储，保证数据隔离

2. 元数据文件
   - 位置：`emoticons/metadata.json`
   - 格式：JSON
   - 内容：包含表情包的名称、标签、收藏状态等信息
   - 示例：
     ```json
     {
       "id": "unique-id",
       "name": "表情包名称",
       "tags": ["搞笑", "动物"],
       "favorite": true,
       "createdAt": 1678086524140
     }
     ```

3. 设置文件
   - 位置：`emoticons/settings.json`
   - 内容：界面设置、主题色，以及你自己填写的 Coze / 百度翻译凭据

### 注意事项

1. 请不要手动修改存储目录中的文件
2. 如需备份，请备份整个 emoticons 目录
3. 卸载插件前请先导出重要数据
4. `settings.json` 中可能包含你的第三方凭据，分享数据目录前请先清空相关设置

## License

见 [LICENSE](./LICENSE)。
