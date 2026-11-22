# 改动声明（Apache-2.0 §4(b) / §4(d)）

本插件包含 **CyberChef v11.5.0 官方离线发布包**的修改版。
上游项目：<https://github.com/gchq/CyberChef>，版权 Crown Copyright 2016-2026，
许可 **Apache License 2.0**（全文见 `LICENSE.txt`）。

按 Apache-2.0 第 4 条 (b)「修改过的文件必须带醒目改动声明」，逐项列明如下。
两个入口 HTML 的 `<head>` 里也嵌入了同内容的内联改动声明。

> 目录说明：为兼容 ZTools 的 `main: index.html` 惯例与相对资源路径，
> CyberChef 离线包已**平铺在插件根目录**（不再套子目录）。

## 1. 相对官方离线包的修改文件

| 文件 | 改动内容 |
|---|---|
| `index.html` | ① 全部可见界面文字中文化；② `<html lang>` 改为 `zh-CN`；③ 标题改为「CyberChef 中文版」；④ meta description 中文化；⑤ 注入 `assets/i18n-zh.js` 运行时中文层；⑥ 注入 `plugin-bridge.js` 用于 ZTools 入口参数接入；⑦ 增加 Apache-2.0 改动声明注释 |
| `CyberChef_v11.5.0.html` | 同上（与 `index.html` 字节一致，保留原入口文件名） |
| `assets/main.js` | ① 两份内嵌 `OperationConfig` 中 505 段操作说明替换为中文（共 1010 处）；② 2580 处参数标签、770 处选项显示名静态替换；③ `addOperation(t.textContent)` 改为 `addOperation(window.__CCZH_UNTRANSLATE__(t.textContent))`，保证双击添加时内部仍用英文键；④ **未改动**任何算法、操作名、分类名、选项 value；⑤ v1.0.1 修复双语名泄漏（见 §1a）；⑥ v1.0.2 三栏布局自适应（见 §1b） |
| `assets/i18n-zh.js` | **新增文件**。由 `zh-dict.js`（1435 条译文）+ `i18n-core.js`（MutationObserver 显示层）组成，仅改 DOM 显示，不改逻辑键；v1.0.2 增加搜索结果双语重建（见 §1b） |

## 1a. v1.0.1 修复：双语名泄漏进配方状态（Worker 端 OperationConfig 查不到键 → 懒加载模块操作全部卡死）

**问题**：显示层把操作名渲染为 `中文（English）` 双语文本后，CyberChef 的部分逻辑
会**从 DOM 读回文本当作内部键**使用。以 `Recipe.getConfig()` 为例，它通过
`a[s].querySelector(".op-title").textContent` 取操作名——读到的是被翻译过的双语文本，
于是发往 Worker 的 `recipeConfig` 变成 `{"op":"AES 解密（AES Decrypt）",...}`，
Worker 侧 `OperationConfig["AES 解密（AES Decrypt）"]` 为 `undefined`，
`loadRequiredModules` 抛出 `TypeError: Cannot read properties of undefined (reading 'module')`，
烘焙静默卡死（凡需懒加载模块的操作如 AES Decrypt 全部受影响；Default 模块操作不受影响）。

**修复**：在 5 处「DOM 文本 → 内部状态」的读回点包一层
`(window.__CCZH_UNTRANSLATE__||function(s){return s})(...)`（该函数对非双语字符串原样返回，
对官方英文原版行为零影响）：

| 位置 | 原代码 | 泄漏场景 |
|---|---|---|
| `Recipe.getConfig()` | `o={op:a[s].querySelector(".op-title").textContent,args:e}` | **烘焙 / recipe URL / Magic / 后台烘焙**（最关键） |
| `Ops.searchOperations()`（搜索框回车） | `this.manager.recipe.addOperation(t[r].innerHTML)` | 搜索结果回车添加 |
| `Recipe.buildRecipeOperation()` | `var t,r=e.textContent,n=new Ys(r,...)` | 从操作列表拖拽进配方 |
| `Ops.favDrop()` | `this.app.addFavourite(t)` | 拖拽添加收藏 |
| `Ops.createSortableSeedList().setData` | `e.setData("Text",t.textContent)` | 拖拽携带的文本 |

另核实：词典中会被翻译、且可能流入 option 值的键仅 `Raw→原始` 一条，而全部
226 组 `toggleValues` 均不含 `Raw`；原生 `<select>` 的显示文本虽被翻译，
但 `value` 属性强制保留英文且 `getConfig` 读取 `.value`，不受影响。

## 1b. v1.0.2 改动：搜索结果双语显示 + 窄窗口三栏布局自适应

**1. 搜索结果显示为英文的原因与修复**：搜索结果由 `Ops.filterOperations()` 生成，
命中的字符经 `highlightSearchStrings()` 包上 `<b>`（如 `<b>AES</b> Decrypt`），
操作名 DOM 被拆成多个文本节点，运行时层的**整词查表**全部失效，于是下拉里一直是英文。
修复在 `assets/i18n-zh.js` 运行时层新增 `handleSearchResults()`：扫描
`#search-results > li`，用 `textContent` 还原完整英文名 → 查 `ops` 词典 → 重建为
`中文（<b>命中的英文</b>…）`（保留官方高亮样式），并以 `data-cczh-bil` 防止重复处理。
重建后的 textContent 是「中文（English）」双语串，**回车添加 / 双击添加 / 拖拽添加**
三条路径在 v1.0.1 中已全部包了 `__CCZH_UNTRANSLATE__`，自动还原英文内部键，逻辑不受影响。

**2. 窄窗口 UI 挤压的原因与修复**：CyberChef 三栏布局用 Split.js
（`#operations` / `#recipe` / `#IO`），官方初始化为
`{sizes:[20,30,50], minSize:[240,310,450], expandToMin:true}`——三栏最小宽合计
1008px + 2×4px 分隔条，而 ZTools 插件窗口约 800px（宽度由宿主决定，无 API 可改），
`expandToMin` 强制各栏撑到最小宽 → 互相溢出，配方栏被挤成一条黑图标。
修复：`assets/main.js` 中 `initialiseSplitter` 的 minSize 按视口宽自适应——

```
minSize:e?[0,0,0]:window.innerWidth<1024?[178,214,286]:[240,310,450]
```

窄视口（<1024px，即 ZTools 插件窗）下三栏最小宽合计 686px，可完整放下，
打开即是「操作列表 / 配方 / 输入·输出」三栏齐备的布局；大窗口与「输出最大化」
（`e=true` → `[0,0,0]`）行为与官方一致。仅改动最小宽这一个值，初始比例
`sizes:[20,30,50]` 与拖拽逻辑未动。宽屏（≥1024px，如分离为独立窗口）仍用官方最小宽。

## 2. 删除的文件（不含代码，仅为部署/验证产物）


- 59 个 `*.gz` / `*.br` 预压缩副本 —— 供 HTTP 服务器使用，本地 `file://` 插件不需要。
- `verify_dom.html` —— 本地化工程的浏览器验证残留。

其余 75 个文件（含 `assets/`、`modules/`、`images/`、30 份 `*.LICENSE.txt`）**与官方离线包字节一致，未作任何修改**。

## 3. 新增的插件外壳（本插件自身代码，非 CyberChef 代码）

| 文件 | 说明 |
|---|---|
| `plugin.json` | ZTools 插件清单 |
| `preload.js` | 逐行可读的 Node 能力桥（文件读取、剪贴板、对话框、toast） |
| `plugin-bridge.js` | 页面侧桥接层：申请窗口高度、解析 `onPluginEnter`、调用 `window.app.manager.input.setInput()` 自动带入 |
| `logo.png` | 取自官方离线包 `images/cyberchef-128x128.png`，未修改 |
| `LICENSE.txt` | Apache-2.0 全文 |
| `THIRD_PARTY_NOTICES.md` | 第三方声明索引 |
| `README.md` | 安装与使用说明 |

## 4. 本地化方式说明

中文本地化只作用于**展示层**：操作名、分类名、选项 `value`、recipe URL、搜索索引、
收藏与 Worker 通信中的标识符一律保持英文原文。左侧分类与操作名以 `中文（English）`
双语形式显示，其余界面（含设置与全部悬浮提示）为纯中文。专业术语保持英文。

## 5. 商标

CyberChef 名称与图标归原权利人所有。本插件仅用于描述作品来源，不构成商标授权，
也未以原项目名义发布。
