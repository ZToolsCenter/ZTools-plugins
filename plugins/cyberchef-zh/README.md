# CyberChef 中文版 · ZTools 插件

把已完整中文化、可完全离线运行的 **CyberChef v11.5.0** 封装为 ZTools 有界面插件。
界面、505 段操作说明、参数与选项、设置项、全部悬浮提示均为简体中文；
左侧分类与操作名以 `中文（English）` 双语显示，内部逻辑键保持英文，
因此 recipe URL、搜索、收藏、双击添加与 Worker 执行都不受影响。

## 唤起

在 ZTools 搜索框输入以下任一指令：

```
cyberchef    赛博厨师    编码解码    cc    base64    加解密    厨师
```

选中一个文件时，也可用功能「用 CyberChef 中文版打开」（`files` 指令）。

> 未使用 `over` 全局匹配，插件不会与其他插件抢同一份输入。

## 输入与输出

| 场景 | 行为 |
|---|---|
| 带文件唤起 | 文本文件按 UTF-8 填入；二进制文件转 Base64 填入并提示（面板内可用「从 Base64 解码」还原） |
| 无入口参数 | Input 保持空白，**不读取剪贴板**（v1.0.3 起移除自动读剪贴板行为） |
| 超过 2 MB 的文件 / 512 KB 的文本 | 不自动带入，提示改用面板内「打开文件」按钮 |
| 输出结果 | 用 CyberChef 自带的复制 / 保存 / 下载按钮，插件不接管 |

每次打开只自动带入一次；失败会给出具体提示，不会静默白屏。
普通浏览器直接打开 `index.html` 时桥接层完全静默，方便调试。

## 已知限制：在浏览器里直接双击打开会卡死（官方包固有，非本插件问题）

AES Decrypt 等大量操作属于**懒加载模块**（Ciphers / Compression / Regex …）：执行时
Worker 才会 `importScripts(所在目录/modules/模块名.js)`。用浏览器直接以 `file://`
打开任何 CyberChef 离线包（官方 v10.22.1、v11.5.0 与本插件同样），该加载都会被
CORS 拦截（`NetworkError: Failed to execute 'importScripts' …`），界面永远停在
「Baking input 1...」。而 From Base64 等 Default 模块操作不受影响——这正是
「Base64 能出结果、AES 一执行就卡死」的原因。

| 打开方式 | AES Decrypt | 原因 |
|---|---|---|
| ZTools 插件窗口 | ✅ 正常 | Electron `webSecurity:false`，不拦 `file://` importScripts |
| 在线 gchq.github.io / 本地 HTTP 服务 | ✅ 正常 | `http(s)` 同源加载 |
| 浏览器双击 `file://` 打开（任何版本离线包） | ❌ 卡死 | CORS 拦截 Worker 内 importScripts，官方包固有行为 |

要在浏览器里用本地包：`py -m http.server` 后访问 `http://127.0.0.1:8000/index.html`，
或给 Chrome 加 `--allow-file-access-from-files` 启动参数。**直接在 ZTools 里用本插件即可，无需任何处理。**

## 窗口与布局说明（v1.0.2 起）

插件窗口的**宽度由 ZTools 宿主决定**（约 800px，官方 API 只提供 `setExpendHeight` 调高度），
无法在插件内加宽。v1.0.2 已针对窄窗做了自适应：三栏（操作列表 / 配方 / 输入·输出）
最小宽度在窄视口自动收窄，打开即是三栏齐备的布局，不再互相挤压；
官方三栏最小宽合计 1008px，此前 `expandToMin` 会让三栏溢出、配方栏被挤成一条。
需要更大空间时，可把插件**分离为独立窗口**自由拉伸（宽屏下自动恢复官方布局）。

搜索结果下拉自 v1.0.2 起同样显示 `中文（English）` 双语（命中的英文部分保留官方高亮样式），
回车 / 双击 / 拖拽添加仍是英文内部键，配方执行不受影响。

## 安装

用 `package_plugin.py` 生成的 `cyberchef-zh.zip` 安装。ZTools 本地安装入口的
菜单名称随宿主版本变化，请以所用版本的插件管理界面为准。
`plugin.json` 位于 zip 根层，解压后目录结构不应再套一层同名文件夹。

## 目录结构

```
cyberchef-zh/
├── plugin.json              ZTools 清单（main: index.html）
├── preload.js               逐行可读的 Node 能力桥（未压缩/未混淆）
├── plugin-bridge.js         页面侧桥接层
├── index.html               插件入口 = CyberChef 中文版主页面
├── CyberChef_v11.5.0.html   同内容副本，保留官方入口名
├── logo.png                 官方 cyberchef-128x128.png
├── assets/ modules/ images/ 官方离线包资源（平铺，未套子目录）
├── *.LICENSE.txt            30 份官方第三方许可证声明，原样保留
├── LICENSE.txt              Apache-2.0 全文
├── MODIFICATIONS.md          Apache-2.0 §4(b) 改动声明
├── THIRD_PARTY_NOTICES.md   第三方声明索引
├── README.md                本文件
```

开发期验证脚本（mock 宿主断言、原版对照验证）已移出插件包，
位于上级工作目录 `cyberchef-zh-dev/`，不参与插件运行与发布。

体积约 **48 MB / 81 个文件**：已去掉官方包里 59 个 `.gz`/`.br` 预压缩副本
（约 32 MB，仅 HTTP 部署需要）和一个浏览器验证残留文件；功能无任何删减。
全离线，不请求网络、不依赖 CDN、不引入 npm 包。

## 许可证

上游 GCHQ/CyberChef v11.5.0 为 **Apache-2.0**（`LICENSE.txt`），
版权 Crown Copyright 2016-2026。本插件是修改版，改动清单见 `MODIFICATIONS.md`，
第三方声明见 `THIRD_PARTY_NOTICES.md`。30 份官方 `*.LICENSE.txt` 全部原样保留，
未发现 GPL/AGPL 全文。CyberChef 名称与图标归原权利人所有。

## 已验证

**已在本机验证**：

1. `validate_plugin.py`：结构校验通过，0 个警告。
2. `run_mock_test.py`（mock 宿主 + `file://` 入口，**12 项全部通过**）：
   窗口高度申请、`onPluginEnter` 注册、CyberChef 完整初始化、中文界面与双语分类/操作名、
   运行时词典含「执行！」译文、入口文本自动填入 Input、找到并双击「转为 Base64（To Base64）」、
   配方操作使用英文逻辑键、自动执行已开启、页面无加载错误、运行期无 JS 错误。
3. `verify_plugin_real_time.py`（不用虚拟时间的真实等待，**原版英文 vs 中文插件对照**）：
   两组均 PASS —— 各创建 5 个 Worker、收到 `workerLoaded` / `bakeComplete` /
   `dishReturned` 等消息、零 Worker 错误、零页面错误。证明 `file://` 下内联 blob Worker
   与配方执行链路由中文版完整保留，行为与原版一致。
   在 `--virtual-time-budget` 模式下还曾直接读到输出区文本 `aGVsbG8=`。
4. **v1.0.1 AES 端到端回归**（`verify_aes_realtime.py`，Worker 消息携带 dish 作为判据）：
   修复双语名泄漏后，中文插件在 `http://` 下以完整配方
   「From Base64 + AES Decrypt（HEX 256 位 Key/IV、CBC、Raw/Raw）」对真实 960 字符密文
   执行，Worker `bakeComplete` 直接携带明文 JSON（`apiHost: api.tuoxin-task.net`），
   1.5 秒完成，Magic 智能识别同场正常。同矩阵中：
   `file://` 打开官方包与本插件均复现懒加载卡死（`importScripts` NetworkError），
   加 `--allow-file-access-from-files` 后恢复，行为与官方 v11.5.0 / v10.22.1 完全一致。
5. **v1.0.2 UI 回归**（`..\verify_ui_v102.py`，802×796 headless Chrome 模拟 ZTools 插件窗）：
   三栏 178 / 214 / 386px 全部可见、无横向溢出；搜索 "aes" 得 84 条结果，
   81 条双语、73 条保留官方 `<b>` 高亮（其余为词典未收录操作，与左栏行为一致）；
   双击添加后配方标题双语显示、Worker bake 的 `recipeConfig.op` 仍为英文键
   `"AES Decrypt"`，页面 0 错误。

> 验证环境限制：常驻 headless Chrome（不带虚拟时间）下 CodeMirror 6 不渲染
> `.cm-content` 文本，因此该模式无法直接读取输出字符串；改用 Worker 完成消息作为
> 执行完毕的判据。原版英文包在同一环境下表现完全相同，故这不是本地化或插件封装引入的回归。

## 复现验证

验证脚本在插件包外的工作目录 `cyberchef-zh-dev/`，不参与插件运行：

```bash
# 1) 结构校验 + mock 宿主 12 项断言（需 ztools-plugin-builder skill 的 scripts/）
python <skill>/scripts/validate_plugin.py <插件目录>
python <skill>/scripts/run_mock_test.py <插件目录> --test <工作目录>/cyberchef-zh-dev/test.js --budget 40000

# 2) 真实时间对照：原版英文包 vs 本插件，验证 Worker 与配方执行链
python <插件目录>/dev/verify_runtime.py            # 两组
python <插件目录>/dev/verify_runtime.py plugin     # 只测插件
# 解压到别处时用环境变量指定：CCZH_PLUGIN_DIR / CCZH_PRISTINE_DIR
```
