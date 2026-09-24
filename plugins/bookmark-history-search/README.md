# 书签历史搜索（ZTools 插件）

> **作者**：一个成熟的剪辑猿


在 ZTools 搜索框里**实时搜索浏览器的书签和历史记录**，并支持**导入本地书签**（解决 Chrome 书签为空/想合并旧浏览器书签的问题）。

## 功能

- **书签搜索**：自动抓取 **Chrome + Edge + Firefox** 的书签（含多 Profile、文件夹路径），实时搜索标题/URL/文件夹名
- **历史记录搜索**：抓取 **Chrome + Edge + Firefox** 最近 3000 条历史（每 60 秒刷新），支持搜索标题/URL
- **导入书签**：导入**浏览器导出的书签文件**（Netscape HTML，Chrome/Edge/Firefox 导出格式）或 **Chrome JSON** 书签文件，存入插件存储，与浏览器书签合并搜索
- **搜索联动**：主窗口搜索框输入即搜（mainPush 联想）+ `书签` / `历史` / `bookmark` 等命令直达
- **选中文字搜索**：选中文字后从超级面板触发「书签历史搜索」，直接按选中词搜索
- **结果去重**：同一 URL 在多个浏览器重复（如同步账号）时只保留一条，优先级：书签 > 导入书签 > 历史
- **自选数据源**：搜索框输入 `书签设置` 可单独开关 Chrome / Edge / Firefox / 导入书签 的抓取

## 安装

1. ZTools → 设置 → 插件 → 右上角「更多」→ **导入本地插件**
2. 选择 `bookmark-history-search.zip`
3. 预览页点 **安装插件** → 安全警告点 **已知风险，继续安装**

## 用法

**搜索**（书签优先，历史兜底，最多 50 条）：
- 打开 ZTools 搜索框，输入关键词（支持多词空格 AND），结果实时出现
- 或输入命令 `书签` / `历史` / `bookmark` 进入搜索
- 点击结果 → 用系统默认浏览器打开
- 结果前缀：⭐ Chrome/Edge 书签 / 🦊 Firefox 书签 / 📥 导入书签 / 🕘 历史记录
- 无关键词时默认展示最近 10 条历史

**导入书签**：
1. 在浏览器里导出书签（Chrome：书签管理器 → 导出书签，得到 HTML 文件；Firefox：书签管理 → 导入和备份 → 导出书签 HTML；或直接拿 Chrome `User Data/<Profile>/Bookmarks` JSON）
2. 选中书签文件 → 长按悬浮球 → 超级面板 → **导入书签**；或搜索框输入 `导入书签` 直接弹文件选择器
3. 成功会收到通知：`已导入 N 条书签（共 M 条）`（按 URL 自动去重）

**选择数据源**：
- 搜索框输入 `书签设置` → 列表显示 4 个来源的开关状态（Chrome / Edge / Firefox / 导入书签）
- 点选某项切换开/关，通知确认；只留你想用的浏览器，搜索更快更干净

## 数据说明

- 书签：读取 `Chrome/Edge User Data/<Profile>/Bookmarks`（JSON）和 `Firefox Profiles/<profile>/places.sqlite`（moz_bookmarks），每 5 分钟刷新
- 历史：复制各浏览器 `History` / `places.sqlite`（SQLite）到临时目录后用内置 sql.js 读取，避免文件锁，每 60 秒刷新
- 导入书签：存在 ZTools 插件存储（`dbStorage.imported_bookmarks`），卸载插件会丢失，请保留原始文件
- 打开链接：系统默认浏览器（`shellOpenExternal`）

## 文件说明

| 文件 | 作用 |
|------|------|
| `plugin.json` | 插件清单：search（list 模式+mainPush）+ import（files 导入） |
| `preload.js` | 交互层：搜索回调、导入流程、数据缓存 |
| `lib/books.js` | 抓取 Chrome/Edge 书签 |
| `lib/history.js` | 用 sql.js 读 Chrome/Edge 历史 |
| `lib/firefox.js` | 读 Firefox places.sqlite（书签 + 历史） |
| `lib/import.js` | 解析 Netscape HTML / Chrome JSON 书签文件 |
| `lib/sql-wasm.js/.wasm` | vendored SQLite（读取 History / places.sqlite） |

## 已知限制

- 历史只读最近 3000 条（可接受范围，够用）
- 导入书签按 URL 去重，同 URL 新导入的会覆盖旧条目标题
- Firefox 无需导出，直接读 places.sqlite；但 Firefox 书签文件夹名是英文（toolbar/menu 等）
