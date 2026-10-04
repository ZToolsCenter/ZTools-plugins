# SAZ 解析插件 · 设计与开发文档

> **本文是公开仓库版（自动脱敏生成）**：所有真实归档名、被抓包业务域名与业务名已替换为
> `样本-NN` / `域名-NN` / `业务-NN` / `协议-NN` 别名，本机路径替换为 `<基线目录>` / `<ZTools 安装目录>` 等占位。**数字全部原样保留**（sid、条数、字节数、帧数、耗时未做任何修改），
> 因此本文中的实测结论仍可逐条核对；别名与原名的对应关系仅存在于开发本机，不随仓库发布。
> 由 `node tools/desensitize-doc.js` 生成，请勿手工编辑本文件（改动会在下次生成时被覆盖）。

> 状态：**v0.5.8 · A/B/C 三层全部落地并已发布（M5 完成）—— 中心仓库 PR [#638](https://github.com/ZToolsCenter/ZTools-plugins/pull/638) 已 Ready for review；五条验收线在真实样本上全绿（74 + 56 + 24 + 210 + 20 断言），插件已装进本机并由构建自动更新（当前 v0.2.4）**
> v0.4 实证新增：缺陷 **B10**（原算法完全丢弃 `raw/<sid>_w.txt` WebSocket 帧日志）与功能 **F26**；B1 影响面由 11.1% 修正为大样本 CONNECT **60/60**；三档分类口径调整（含帧日志的 WebSocket 归 A 档）
> v0.5 新增：**D18 定为 b**（首版纳入 4 个 MCP tools）；preload 三件套 + Vue3 UI + 装配脚本；`tools/verify-preload.js`（147 断言）与 `tools/assemble.js`（审核硬约束自检）；与 Python 产物的 7.2 目录树对拍已跑完（18/18，差异全部可归因）
> v0.5.1 修正：**粘贴触发解析失败**（用户实测）——从 app.asar 源码确证 `onPluginEnter` 的 files payload 真实结构，拾回绝对路径并禁止 `open()` 把相对路径拼到 CWD（见 1.10）；新增**安装件自动产出** `release/<name>-v<version>.zip`（见 2.6）；**输出目录默认值改为归档所在目录**（见第 8 节）
> v0.5.2 新增：**F27 一键解析**（不开界面直接落盘，与 `解析SAZ.py` 同位同名同效，见 D19）；**D11 已定**（author=乐幻，GitHub 已登录 `gh`）；**自动部署**：`npm run build` 最后一步直接替换 `~\.ztools\plugins\saz-parser`，以后改动不需用户手动导入（见 2.6）
> v0.5.3 修正：**“一键解析还是打开了界面”（用户实测）** —— 从宿主源码找到真正的无界面三机制（`mainHide` / `shouldKeepMainWindowHidden` / 插件自报 `get-plugin-mode`），写入 2.7
> v0.5.4 修正（两件事，都是**跑出来的数字**不是预期）：
> ① **交互按用户口径定稿**，推翻上一轮的“方案 B 收敛为唯一指令”：粘贴/拖入/输入路径给**两条候选**（`saz-quick` 一键落盘 / `saz-view` 开界面），直接搜 `saz` 只给**一条**（`saz-view`）；`quickMode` 开关整体删除（判定只认 featureCode，设置项不参与抢判）；顺带修掉 `settingsSet` 合并顺序 bug（改一个开关会把其他设置静默重置为默认）。`version → 0.2.1`
> ② **Cookie / 响应头传递链修复**：复核外部 AI 意见后确认其定位属实但主断点在**消费侧**；三步改完在本机 **50 个 .saz / 793.4MB** 上做改前基线→改后对拍，A 族（Set-Cookie→Cookie）进账本 **1 → 676 / 1078**，生产者精确率 **676/676 = 100%**，方向污染 **398 → 0**，剩余 402 条全部可归因（见 1.11）
> v0.5.5 修正：**搜 `saz` 出 4 行重复入口**（用户实测）—— 从渲染端源码确证宿主搜索规则（每条关键词 = 一行 / 忽略大小写 + 双向包含 + 拼音 / 自动插一行“插件标题”），写入 2.8；关键词从 6 个收敛为 **1 个且与 title 全等**（抑制自动标题行），实测 4 行→ 1 行；另修掉一个真缺陷：**宿主在输入框通路会剥掉 regex flags**，靠 `/i` 的路径正则对 `X.SAZ` 会漏 → 改为显式字符类。`version → 0.2.2`
> v0.5.5 登记（外部 AI 反馈复核，仅登记、本轮不动引擎）：它说的 SSE 不美化**属实**（实测 19 会话 / 5030 事件 / 5023 个 data 是合法 JSON，全 passthrough）；但复核时挖出一个**更底层的缺陷 B11**——`Transfer-Encoding: chunked` 的分块框架根本没剥（全包 36 条带此头，36/36 未剥，其中 34 条标 json → 整块 JSON 0 条能解，字段索引直接归零）。新增 **F28 拆帧** 与 **D20 待拍板**，实测见 1.12，探针 `tools/probe-stream-bodies.js`。
> v0.5.6 实施（用户拍板 **①+②+③ 全做**，数字全部为改前基线 → 改后对拍，见 1.13）：
> ① **B11 chunked transfer-decoding**：`core/decode.js` 新增 `dechunk()`（按字节逐块、支持块扩展与 trailer、**框架不合法就整块退还**），`decodeBody` 改为“先解框再解压”；实测全包带此头的响应 **245 条 → 未剥框 0 条**，且其中 **209 条带 Content-Encoding 的会话改前因长度行混在压缩流开头而解压失败（正文整条不可用）→ 改后解压失败 0 条**
> ② **F28 流式拆帧**：新增 `core/stream.js`（SSE 逐事件 + 顶层多值 JSON，判据为硬约束），接入 detail（`withStream`）、分析包（新增 **`66-stream.md`** + 会话正文「事件流拆分」段）、MCP **第 5 个工具 `saz_stream`**、UI「事件流」页；实测 5030 事件全部结构化命中
> ③ **beautify 支持顶层多值与事件流**（仅兼容层导出）：实测候选会话 passthrough **39 → 1**；事件流只统一排版不改 `data` 语义（展开需显式 `expandSseData`，因会改变重放拼接结果）
> v0.5.7 实施（用户拍板“按建议优先级执行”，把上一轮我自己列出的 6 个缺口 A1–A7 补掉，数字全为实测，见 1.14）：
> **A1 伪 SSE 回退**：标 `text/event-stream` 但正文是每行一份裸 JSON（无 `data:`）的会话，旧路径只交出“1 个事件、data 为空”→ 现回退成多值拆分。全包声明该头的 21 条里命中 **3 条**（`样本-20` sid3561/3663/3731），3/3 救回（各 3 份值全部可解析）
> **A2 错标 CT 按内容命中**：闸门与美化层都不再只看头就下结论——`样本-01` sid1642（`text/html`，290.8KB，9 份顶层值）现能拆能重排；**候选 3125 条里只命中 1 条，JS/CSS/HTML 假阳性 0**（预门收窄到只认 `{`/`[`：实测放宽到“任意 JSON 值开头”会让扫描从 39 次膨胀到 6271 次而收益一条没多）
> **A3 chunked 与 Python 真实产物对拍**：`verify-legacy` 新增第 7 节，用磁盘上真实存在的 `样本-16_解析结果` 逐条对拍（**18/18 原算法产物开头就是十六进制长度行** → B11 在对方侧有实物证据；我们 18/18 已剥且落盘字节 == `dechunk(归档原字节)`）；**18 → 24 断言**
> **A5/A6/A7**：五个拆帧参数进 `DEFAULTS`/第 8 节/导出面板；`saz_query` 新增 `transferEncoding[]`/`chunkedOnly`/`eventStreamOnly`（**不新增第 6 个工具**，命中数与 `summary.transferChunked.responses` 完全对得上）；UI 事件流页可点开一行看单事件全文
> 美化 passthrough 由 39 → **0**（上轮“剩的 1 条”根因不是形态未覆盖，而是美化层按头分派；已按内容兜底）。另修掉探针一个 CLI bug：`--diff base afterN` 的位置参数被静默忽略（会比对到历史快照）
> `version → 0.2.3`；工具数 4 → **5**；新增回归断言 17（verify）+ 13（verify-package）+ 15（verify-preload）条。
> v0.5.7 `version → 0.2.4`；工具仍 **5 个**（没加第 6 个，改成给 `saz_query` 加条件维度）；新增回归断言 **14（verify：60→74）+ 6（verify-legacy：18→24）+ 7（verify-preload：203→210）** 条，全量 **74 + 56 + 24 + 210 + 20 全绿**；新增探针 `tools/probe-stream-cost.js`（内容改判的覆盖面与成本实测）。
> v0.5.8 实施（**M5 发布完成**，全部为源码级确证 + 发布后对拍，见 2.4.1）：
> ① **发布通路确证**：`@ztools-center/plugin-cli@1.3.2` 的 `copyPluginFiles()` 是**整目录递归复制且不读 `.gitignore`**（忽略清单写死在代码里）—— 在工作区根直接 publish 会把 `tools/out-*`（含真实 Cookie 的实测快照）、脱敏映射表、`release/*.zip`、取证原稿全部推进公开 PR。因此新增 `tools/make-publish-tree.js`：只把 `plugin/` + README/CHANGELOG/LICENSE/`docs/`（脱敏版）+ `images/` 装进 `publish/<name>/`，并自带集合不变量、CLI 契约预检、逐文件敏感扫描与 noreply 身份提交
> ② **发布闸门又抓到两处真泄露**（上一轮只扫了包内注释，判据本身有洞）：随包源码 4 处注释 + 构建产物里出现 **WebSocket 子协议名**（不命名字也能定位业务的指纹）；脱敏文档里 `业务-01 注册` / `业务-02 登录`（**带空格的散文写法**）与 `协议-01` 整批漏过 —— 原判据只列了连写形式。已全部改掉并把判据加严（业务名单独一类 `业务-NN` / 协议指纹 `协议-NN`；归档名字符集排除 `:;,=`；主机前缀统一剥离；`C:\Users\<user>` 占位豁免）。脱敏版重生成后 **16 个业务词 0 残留**，原稿同判据命中 30 类（双向有效）
> ③ **发布产物与身份**：发布树 **36 文件**（28 运行时 + 4 份仓库材料 + 1 份脱敏文档 + 3 张截图），30 个文本文件扫描 **0 命中**；推送后**逐 blob SHA 与本地 36/36 一致、远端无多余文件、PR diff 仅涉及 `plugins/saz-parser/`**（`tools/verify-publish-remote.js`）；公开提交的 author/committer 均为 `131270813+账号-01@users.noreply.github.com`（私人邮箱用 `GIT_CONFIG_GLOBAL` 临时副本替换掉身份，**未改动用户 git config**）
> ④ **演示素材**：新增 `tools/capture-ui.js`（本机 Chrome headless + CDP，零依赖），三张图全部来自**开发态假数据界面**（`*.example.com` / `DEV 事件` / `demo-*`），脚本自带素材自检四项（含 DEV 角标、假域名、无业务名、无本机路径），409.7KB / 3 张
> ⑤ **CI 侧现状**：中心仓库 `Build PR Plugin Package` 已触发两次，状态 `action_required`（首次贡献者需维护者批准运行 workflow，非我侧可推进）
> 下一步：M5 已发完（PR #638 等审核）；余下是 M0 真机项收尾（**“code 递不递到”已不再关键**：现在以宿主的 `get-plugin-mode` 询问为 featureCode 的可靠来源，只需确认真机诊断页出现 `saz-quick → 答 none` 与留痕 `headless`）、M6 增量（HAR / 多归档 / L3 分卷优化），以及 1 个待拍板项：`maxTrackedValues` 是否把凭证类值前置加权（见 1.11 分诊）
> 目标平台：ZTools 插件中心（客户端版本 3.2.0）
> 算法基线：`<基线目录>\解析SAZ.py`（538 行）+ `识别API请求并按域名分组.py`（67 行）
> 实证脚本：`tools/verify.js`（A 层）、`tools/verify-package.js`（B 层）、`tools/verify-legacy.js`（兼容层对拍）、`tools/verify-preload.js`（preload/MCP/UI 契约）、`tools/check-requires.js`、`tools/assemble.js`、`tools/make-publish-tree.js`（发布树 + 发布闸门）、`tools/verify-publish-remote.js`（发布后逐 blob 对拍）、`tools/capture-ui.js`（假数据界面截图）

---

## 0. 第一目的与设计基线

**第一目的：把 `.saz` 转换为"可供 AI 进行抓包分析"的高质量素材。**
UI 浏览是手段，**AI 可消费**才是目标。原 Python 工具链的真实终点就是把解析结果交给 AI 分析（业务-01 注册 / 业务-02 登录类协议还原）；第二个脚本（按域名分组、排除 CONNECT 与埋点域名）本质是在**为 AI 准备目录**。

由此确立三条设计基线（v0.2 违反它们的地方已在本版修正）：

1. **信息完整性优先于视觉简洁**：任何"过滤 / 折叠 / 脱敏"只允许作用于**视图层**，绝不允许在**数据层**丢字节。Cookie / Authorization / token / device_id / sign 这些隐私字段恰恰是协议分析的**主要研究对象** → **默认全量保留，脱敏只能是可选副本**（见 D9 修正）。
2. **面对 LLM 的形态优先于面对磁盘的形态**：全量落盘目录树不是终点 —— 实测 1.74MB 的 SAZ 展开后是 3.3MB 纯文本 ≈ **97 万 token**（1.6 节），必须提供分层摘要 + token 预算 + 按业务流程分卷的"分析包"（4.4 节）。
3. **可编程取数优先于鼠标点击**：筛选条件必须能由机器（AI / MCP 工具入参 / 配置文件）给定，而不只是人在 UI 里点（见 4.5）。

原 Python 工具在此目的下的三个痛点（均有实测支撑）：
1. 落盘形态对 AI 不友好：数千个平铺文件，无摘要、无流程分组、无 token 控制；
2. 手工二跳：还得再跑一个脚本才能挑出真正关心的 API；
3. 全量读入内存，面对 324MB 真实样本属高危操作。

### 能力边界（用户已明确）

本插件**只实现解析算法本身**，不调用任何大模型：
- ❌ 不使用 `ztools.ai()` / `allAiModels()`（那是宿主已配置的模型能力，与本插件无关）；
- ❌ 不做"模型分享/对话/结果推送"类功能；
- ✅ 只负责把 `.saz` 解成**完整、分层、体积可控的分析包**，交给用户在外部 AI 里分析；
- ℹ️ `tools`/MCP 属于"让外部 AI 来取数据"（插件不发起模型调用）→ **D18 已定：首版就纳入**（四个工具，见 4.5 与 1.9）。

### 1.7 运行环境实测（推翻本文档 v0.2 的关键假设）

直接解剖本机已安装的 ZTools（`<ZTools 安装目录>`，5 个进程运行中）：

| 项 | 实测值 | 来源 |
|---|---|---|
| Electron 版本 | **41.4.0** | `resources\ztools-install-info.json` + exe 内 UA 常量 `Electron/41.4.0` |
| Chromium | **146.0.7680.216** | `ZTools.exe`(212.9MB) 内 UA 常量 |
| NODE_MODULE_VERSION | **145** | exe 内 `node_module_version": 145` |
| **zlib zstd** | ✅ **`zstdDecompressSync` / `createZstdDecompress` / `zstdCompressSync` 符号均存在于主二进制** | 二进制符号扫描 |
| zlib brotli | ✅ `brotliDecompressSync` 存在 | 同上 |
| 数据目录 | `C:\Users\<user>\.ztools`（**不是** `%APPDATA%\ZTools`） | 进程命令行 `--user-data-dir` |
| 插件安装位置 | `~\.ztools\plugins\<name>-<ver>-<hash>.asar`（+ `.asar.unpacked`） | 目录实测 |
| 每插件会话隔离 | `~\.ztools\Partitions\<plugin-name>` | 目录实测 |
| 主进程日志 | `~\.ztools\logs\main.log`（electron-log） | 实测 |

**结论：R1 风险解除。** v0.2 写"Electron 内嵌 Node 通常 20/22，zstd 极可能不可用"是错的 —— 本机 Electron 41 内嵌的 Node 已含 zstd，**无需 vendor `fzstd`**（改为特性检测 + 不可用时明确提示，见 5.3 / D5）。

> 但要注意：这是**本机**客户端版本的事实。发布给其他用户时不能假设他们已升到 41.x，故 `zstdDecompressSync` 仍需运行时特性检测；`plugin.json` 的 `platform` 不限制版本，**建议在 README/描述里标注最低 ZTools 版本**。

---

## 1. 输入特性（实证数据，非推测）

样本来自本机 `<基线目录>\`，共 5 个真实 `.saz`：

| 文件 | 大小 | ZIP 条目 |
|---|---|---|
| 样本-01 | **324.3 MB** | 11,304 |
| 样本-05 | 2.01 MB | 838 |
| 样本-03 | 1.74 MB | 554 |
| 样本-09 | 136 KB | 8 |
| 样本-07 | 11 KB | 5 |

### 1.1 归档结构（实测确认）

```
[xxx].saz  = ZIP 归档（OPC 包）
├── [Content_Types].xml      # OPC 描述文件，293B，非会话数据
└── raw/                     # ⚠️ ZIP 里存在一个 0 字节的 "raw/" 目录条目，必须先于配对剔除
    ├── 1897_c.txt     # 请求原始报文（wire format）
    ├── 1897_s.txt     # 响应原始报文（wire format）
    ├── 1897_m.xml     # 会话元数据：<Session SID BitFlags ServerCertificatePolicyErrors>
    │                  #            <SessionTimers ClientConnected/ClientBeginRequest/
    │                  #             GotRequestHeaders/ServerConnected/DNSTime/TCPConnectTime...>
    └── 1897_w.txt     # ★ 本轮新发现：Fiddler 的 WebSocket 帧日志（原算法完全不知道它存在）
```

- 配对键是 **Fiddler SessionID，不连续**（样本中出现 `1897`、`540`），必须按数值排序后重新编号。
- 命名后缀需兼容 `_c/_s`、`_req/_resp`、`_client/_server`（原算法已支持，保留），并**新增 `_w`（WebSocket 帧日志）**。
- **请求/响应数量不对称**：4,221 个响应 vs 3,756 个请求，存在有请求无响应（或反之）的半截会话 → 配对必须容错。
- `_m.xml` 含完整时间线与证书错误标记，**原算法 100% 丢弃**，这是可挖的增值数据。
- **`_w.txt` 实测规模**（324MB 样本）：34 个会话、**1,984 帧、明文 1,007KB**，全部挂在 `HTTP/1.1 101 Switching Protocols` 会话上
  （`域名-03/ws/v2` 子协议 `协议-01`、`域名-02/ws/realtime`）。
  帧分布：binary 1,611 / text 335 / close 38；客户端帧掩码 976 条（与 request 方向数完全吻合，符合 RFC 6455）。
- **响应状态行存在非三位码**：`HTTP/1.1 0 FIDDLER GENERATED - RESPONSE DATA WAS MISSING`（抓包丢响应时的占位行），
  解析必须宽容并单独留痕，不得当"解析失败"丢弃。

### 1.2 报文头部特性（实测）

请求行实测形态（前 4,221 条统计）：

| 方法 + URL 形态 | 数量 | 说明 |
|---|---|---|
| `GET \| ABSOLUTE_URL` | 2,291 | `GET https://域名-04/c.gif?rnd=...` |
| `POST \| ABSOLUTE_URL` | 1,545 | 同上，绝对 URL |
| `CONNECT \| RELATIVE_PATH` | 322 | 隧道建立，非业务 API |
| `OPTIONS \| ABSOLUTE_URL` | 63 | 预检 |

**结论：本批样本中，除 CONNECT 外 100% 是绝对 URL**（HTTPS 解密后 Fiddler 写绝对 URL）。HTTP 会话才会是 `/path` 相对形态，两种都必须处理。

→ 实测补充：绝对 URL 会话的报文里**往往不再带 Host 头**（host 已含在 URL 中），这个事实直接决定了 B1 的实际影响面，见 1.5。

响应状态分布：`200`×3664、`204`×445、`302`×45、`101`×37（WebSocket 升级）、`400`×16、`304`×9、`504`×2、`401`×1。

### 1.3 编码与类型分布（决定必需实现哪些解码器）

响应 `Content-Encoding`（共 4,221）：

| 编码 | 数量 | 占比 | Node/Electron 内置支持 |
|---|---|---|---|
| 无 | 1,750 | 41.5% | — |
| gzip | 1,288 | 30.5% | `zlib.gunzipSync` ✅ |
| **zstd** | **1,100** | **26.1%** | ⚠️ 仅 Node ≥ 23，**Electron 内嵌 Node 通常 20/22 → 极可能不可用** |
| br | 83 | 2.0% | `zlib.brotliDecompressSync` ✅（Node ≥ 14） |

请求侧 `Content-Encoding`：4,221 条全部为无 → **请求体不需要解码**。

响应 `Content-Type`（Top）：`application/json`×1305、`application/x-javascript`×844、`application/javascript`×638、无×468、`text/html`×231、`text/plain`×166、`text/css`×159、`text/javascript`×104、`video/mp4`×98、`image/*`×~150、`font/woff2`×8、`application/x-protobuf`×7、`application/wasm`×6。

请求 `Content-Type`：无×2619、`application/json`×866、`text/plain`×310、`x-www-form-urlencoded`×238、`multipart/form-data`×146、`application/reports+json`×35、`x-protobuf`×7。

**推导出的必需能力**：
- 解码器：gzip / deflate / **zstd（必须带非内置 fallback）** / br
- 美化器：JSON（原生）、JS（**1,586 条，比 JSON 还多，不能省**）、CSS、HTML、XML
- 结构化展示：`x-www-form-urlencoded`（438 条）、`multipart/form-data`（146 条，原算法把整个 multipart 当纯文本塞进 `.txt`，边界与二进制混杂 → 应拆 part）
- 二进制（image/video/font/wasm/protobuf，约 380+ 条）：只需按需另存，**不必默认落盘**

### 1.4 体积模型（决定架构）

响应原始体积（4,221 条）：中位数 **3.6 KB**，P95 **94 KB**，最大 **33.6 MB**（`raw/540_s.txt`），总计 **311.7 MB**（ZIP 内未压缩总量 360.2 MB，压缩率 89.6%）。

→ **绝大多数会话极小，极少数巨大**。全量常驻内存模型不成立；"只读头部建索引 + 点开才读体"的懒加载模型才成立（读头部只需从每个 entry 取前几 KB）。

### 1.5 已验证的原算法缺陷（插件必须修正）

| # | 缺陷 | 证据 / 影响 |
|---|---|---|
| B1 | `url_label = f"{method} {host}{url_path}"`，当 Host 头与 URL 同时存在时重复拼接 | ⚠️ 断言修正过两次：v0.2 静态推断"100% 非 CONNECT"（错）→ v0.3 实测旧产物 467 目录得 11.1% → **v0.4 直接在 324MB 样本上逐字复刻原公式（第 306–328 行）实测：抽样 60 条 CONNECT 全部带 Host 头，双拼 60/60**。实物 `001_CONNECT optimizationguide-pa.googleapis.com_443optimizationguide-pa.googleapis.com_443`。绝对 URL 会话因无 Host 头走 `elif` 分支故不受影响 |
| B2 | `get_ext_from_content_type` 对 `image/` 返回 `.`、对 `image/x.fb.keyframes` 返回 `.x.fb.keyframes` | 产生 `响应体.`（非法/怪名）与超长扩展名，实测样本中各 1 / 20 条 |
| B3 | `shutil.rmtree(output_dir)` 无条件强删重建 | 同名结果目录被静默删除，破坏性操作，插件里不可接受 |
| B4 | 全量 `raw_cache[f] = zf.read(f)` + 多进程 pickle 复制 | 360MB 常驻 + 跨进程复制，峰值内存远超物理可用；插件必须改流式 |
| B5 | zstd/br 缺失时仅 `print` 警告后**原样写出压缩字节**，且仍写进 `.txt` | 用户看到乱码文件却不知原因；需显式标记"未解码" |
| B6 | 解压后删除响应头中的 `Content-Encoding` 行，但未处理随之失效的 `Content-Length` | 头部信息误导（长度对不上实际明文） |
| B7 | 文件名未处理 Windows 保留名（`CON/PRN/AUX/NUL/COM1-9`）与结尾点/空格；未防 MAX_PATH 超长 | `safe_filename` 只过滤 `<>:"/\|?*`；实测最长目录名 124 字、最长完整路径 177 字（尚未撞 260），但 324MB 样本路径更深、URL 更长，风险仍存在 |
| B8 | 完全忽略 `_m.xml` | 丢失时间线/耗时/证书错误数据（原用户另写脚本手工挑 API，正说明需要更多筛选维度） |
| B9 | 无任何"面向分析"的抽象层：无摘要、无流程分组、无 token 控制、无字段级索引 | 实测 97 万 token 的无结构平铺文本直接交给 LLM，检索与推理质量均下降（见 1.6）；这是本次重新定位的主修正项 |
| **B10** | **完全忽略 `raw/<sid>_w.txt`**：`RAW_FILE_RE` 只认 `_c/_s/_m`，WebSocket 帧日志既不解析也不告警 | 本轮实证新发现。324MB 样本中 **34 个会话 / 1,984 帧 / 1,007KB 明文被无声丢弃**，而这些长连接帧是 业务-02(协议-01) 与 业务-01 realtime **业务数据的唯一载体**。对"把抓包交给 AI 分析"的第一目的是直接的数据缺失 → 新增 F26 修正 |

> 修正 B1/B2/B7 会导致导出目录名与原 Python **不完全一致**，这是"有意不一致"，在第 7 节 golden 对比里作为白名单列出。

### 1.6 AI 消费负担实测（决定"分析包"必须存在）

对原算法已生成的 4 个解析结果目录逐文件统计（token 按 3.5 字符/token 粗估，仅看量级）：

| 解析结果目录 | 会话子目录 | 文件数 | 纯文本量 | 二进制量 | ≈token |
|---|---|---|---|---|---|
| 样本-04_解析结果 | 184 | 601 | **3,328 KB** | 88 KB | **≈ 97 万** |
| 样本-06_解析结果 | 278 | 559 | 2,361 KB | 44 KB | ≈ 69 万 |
| 样本-08_解析结果 | 1 | 3 | 10 KB | 0 | ≈ 3 千 |
| 样本-10_解析结果 | 2 | 6 | 5 KB | 123 KB | ≈ 1.4 千 |

三个关键推论：
1. 仅 1.74MB 的 SAZ 展开就是 **97 万 token**；324MB 样本（3756 请求 / 311.7MB 响应）按体积外推是**千万级 token** → 任何上下文窗口都吞不下，"全量平铺"对 AI 是负优化。
2. 文本几乎 100% 都是分析素材（二进制仅占 44–88 KB）→ 靠"剔二进制"瘦不了身，**瘦身必须靠分层 + 摘要 + 选取**。
3. 因此插件的核心产出不是"一堆文件"，而是**可控体积、可分卷、可分层的分析包**（第 4.4 节）。

### 1.8 A 层引擎实证结果（v0.4 建立，v0.5.6 扩充至 `tools/verify.js` 60/60 全绿）

本节全部是**跑出来的数字**，不是设计预期。脚本失败即非 0 退出码，可接入 CI。

| 断言 | 实测结果 | 意义 |
|---|---|---|
| 324MB / 3756 会话索引耗时 | **1870ms**（RSS 73MB → 172MB） | 秒级索引建立成立；内存型原算法（B4）已规避 |
| gzip / zstd / br 真实解码 | 抽样 25/25/18 条，**failed = 0**，多个响应可被 `JSON.parse` 整解析 | **D5 决策最终确证**：不引入 fzstd，靠原生 `zlib` 就够 |
| 索引期解压能力误报 | `undecodable = 0` | 修掉一个真实 bug：HTTP 令牌 `br` 与 `capabilities()` 键名 `brotli` 不同名，直接 `caps[a]` 会把可用的 brotli 误报为不可解 |
| Cookie / Authorization 字节保真 | 与归档原始报文逐条相等（5/5） | 基线 1 成立：隐私值不被任何环节改写 |
| `_m.xml` 时间戳解析率 | **3756/3756 = 100%**（含 7 位小数 + `+08:00`） | 手写解析跨平台一致；F23 流程分组主轴可用 |
| B1 双拼复现 | 逐字复刻原公式，抽样 60 条 CONNECT → **双拼 60/60** | 修正必要性从推断升级为实测 |
| 目录名安全性 | 3756 个全唯一、最长 139 字、无方法名污染 | 截断不覆盖（sid 后缀）；防 B7 |
| WebSocket 帧日志 | 34 会话 / **1984 帧全解**、帧长自洽异常 0、帧边界异常 0、解帧中断 0 | F26 落地；完整解帧仅 **25ms** |
| 索引阶段接口参数名覆盖 | 1604 个接口会话中 **1533（95.6%）**已带请求字段 | 请求侧无压缩→不卸响应就能回答"这个接口有哪些参数" |
| 解析警告数 | 两个样本均 **0 条**（包含目录条目与 `[Content_Types].xml`） | 无静默降级条目 |

**过程中被发现并已修的真实缺陷**（都进了回归断言）：
1. `br` / `brotli` 键名不一致 → 18 条 brotli 响应被误标不可解；
2. CONNECT 的 `url` 字段被写入 `CONNECT host:443` → 目录名退化为 `CONNECT_CONNECT_...`；
3. 状态行正则 `(\d{3})` 不容 Fiddler 占位码 `0` → 整条响应被降级为空报文，且**仅以警告形式淹没**（分类结果静默从 noise 变成 api）；
4. `readAndParse` 吞异常后仍参与分类 → 教训：**任何条目级异常必须让验收断言失败，不得只看统计差异**。

### 1.9 B/C 层与 preload 实证结果（v0.5 建立，v0.5.4 复跑：五条验收线全绿）

#### B 层 `tools/verify-package.js` 56/56

| 断言 | 实测结果 |
|---|---|
| 小样本 L2 成包 | 229ms / 181 文件 / 2073.6KB，**每文件 token ≤ 预算** |
| 隐私三档口径 | `full 92117 / masked 26656 / names-only 26057`（只改摘要呈现，字节不动） |
| 324MB 大样本施压 | 851ms，最大文件 19730 ≤ 20000；`trimLog` 6 条（含“摘要需 27 卷仅写 3 卷，丢弃 2949 条”） |
| F23 生产者回溯 | 从 0 个 → **19/60 找到字面生产者**（扫描 300 条响应 / 29MB 并留痕）；**此为 v0.5 单样本旧口径，全量实测见 1.11** |
| L3 全量 | 4,410,477 token / 1215 文件 / 5.7s；`1202 + 1993 == 3195` 去向恒等成立 |

#### 兼容层 `tools/verify-legacy.js` 18/18（与 Python 产物逐目录对拍）

184/184 目录、seq 集合完全一致；文件名集合一致；头部不可解释差异 **0**；JSON 语义等价 88 / 不等 0；
正文差异全部可归因（换行改写 8 + 对方环境装了 jsbeautifier 重排 22 + **无法归因 0**）；
另设不依赖原算法的**绝对不变量**：落盘正文字节 == 归档解码明文 37 条、不一致 0。

#### preload / MCP `tools/verify-preload.js` 203/203（纯 Node，假 host + **假 electron.ipcRenderer** + 真样本；第 8 节一键解析，第 9 节宿主搜索索引复刻与 regex flags 剥离对照组，第 2e-2 节 `saz_stream` 与解框留痕）

| 组 | 关键断言 |
|---|---|
| 挂载通路 | 无 window 不崩；直挂 `window.sazApi`；`contextIsolated=true` 走 `contextBridge`；**sazApi 表面扁平（32 个成员全是函数，无带方法的嵌套对象）** |
| MCP 派发 | `__invokeRegisteredTool` 兜底可用；宿主已有同名函数时**包装而非吞掉**（我们的工具走我们，别人家的回落宿主）；`registerTool` 逐个注册 4 个声明工具 |
| 工具错误 | 未注册名 / 缺参 / 未解析均返回 `ok:false` 结构化错误，**绝不抛异常**（抛出后主进程只能看到超时） |
| 跳桥安全 | 四个工具的返回值递归扫描：**无 Buffer / Map / Set / function / NaN / undefined**，JSON 往返成功 |
| 句柄 LRU | 上限 2；淘汰的是最久未用而非最先打开；淘汰后读条目报 `fd` 失效（证实真的 `close()` 而非只从 Map 移除） |
| 口径一致 | 每一档 `list().matched == summary.categoryCount`；分档之和 == 会话总数（两个样本） |
| 隐私保真 | 23 个 Cookie/Authorization 值：detail 头部 == 索引记录 == 归档原始字节；`masked` 只折叠渲染行，API 层仍给完整原值 |
| 宿主事件 | `collectSazTargets`：实测结构 + 5 种兼容形状均能取出**绝对路径**；只给文件名时回查剪贴板（实测 `{type:'file',data:[...]}`）；回查失败发 `enter-needs-path` 并带 `names/reason`；`diag.hostEvents` 同时留痕**结构骨架**与原始 payload |

**本轮新发现并修掉的真实缺陷**：
1. `preload/api.js`、`preload/store.js` 的相对路径写成 `../core/...`（应为 `./core/...`）——纯 Node 一跑就爆，已新增 `tools/check-requires.js` 静态拦截同类问题；
2. `saz_parse` 原本全量返回 3756 行（实测 2MB+ JSON），与“交给 AI 分析”直接相左 → 工具侧默认只返回概览 + 前 200 行并写明下一步调哪个工具（UI 仍走 `api.open()` 拿全量）；
3. 长任务进度原本靠渲染端传回调（跳桥不可靠）→ 改为 preload 内部事件总线 `progress` 广播；
4. 历史写入失败会连带工具报错 → 改为 `Promise.resolve().catch()`，主路结果优先；
5. 兼容层导出无法只导一个会话（F9）→ `legacy-export` 补 `selection: {sids|filter}`，与分析包同口径。
6. **粘贴触发解析失败**（用户实测，见 1.10）→ 取值优先级 + `open()` 拒绝相对路径 + 剪贴板回查。

#### 1.10 M0 ① 确证：`onPluginEnter` 的 files payload 真实结构（v0.5.1）

用户实测：把任意目录下的 `.saz` 复制后粘贴进 ZTools 搜索框，插件报
`文件不存在：<ZTools 安装目录>\样本-13`，而真实文件在 `<样本集目录>\`。

没有猜：直接读 `resources/app.asar`（未混淆）里构造 payload 的源码，`tools/probe-enter-payload.js` 可重现：

| 证据位置 | 实测结论 |
|---|---|
| 渲染端 `SearchBox` 粘贴处理 | `c = await ztools.getLastCopiedContent()`；`c.type==='file'` 时文件列表在 **`c.data`**，项为 `{path,name,isDirectory,isFile}`，`path` 为**绝对路径** |
| 渲染端启动插件 | `cmdType==='files'` 时 `payload = pastedFiles.map(f => ({isFile, isDirectory, name, path}))`，外层 `param:{payload, type, inputState}` |
| 主进程 `buildEnterPayload` | `payload = {...action, __assemblyId, __ts}` —— 所以字段顺序里 **`name` 在 `path` 之前** |

**根因是两个字叠加**：
1. 旧 `collectSazPaths` “递归拿第一个以 `.saz` 结尾的字符串”，按 `Object.keys` 顺序先命中 `name`（裸文件名）；
2. `api.open` 用 `path.resolve()` 把裸文件名按 **CWD（= ZTools 安装目录）** 补成假绝对路径，
   于是报错文本把人和 AI 一起引向“文件不存在于 <ZTools 安装目录>”。

**修正**（三层，都有对拍断言）：
- `collectSazTargets` 返回 `{paths, names}`：**清洗后**按 `path.isAbsolute` 归类，字段名不作为判据；实测结构里 `name/path` 共存时取 `path`，文件名只登记不参与打开；
- 只剩文件名 → `api.lastCopiedFile(fileName)` 按真实形状 `{type,data}` 回查剪贴板（并兼容旧的 `file/files` 猜测键）；仍无 → `enter-needs-path {names, reason}`，UI 显示具体文件名与原因；
- `api.open` **拒绝非绝对路径**（不再猜测补全），错误文本包含原值与 `process.cwd()`；同时清洗引号/换行/首尾空白（搜索框与正则触发常带）。

顺带确证到的未文档化签名：`getPathForFile(file)` = `electron.webUtils.getPathForFile`；`checkFilePaths(paths)` → `[{path,isDirectory,exists}]`；`registerTool`/`__invokeRegisteredTool` 通路不变。

#### 1.11 Cookie / 响应头传递链实测（v0.5.4，本机 50 个 .saz / 793.4MB 全量）

**起因**：外部 AI 指出 `flow.js` 的生产者扫描只读 `d.response.bodyBuf`、不读响应头，所以 `Set-Cookie` 下发的 token 会漏判。**定位属实，结论轻了**：它只看见生产侧，而真正的卡点在消费侧 —— 旧版把整串 `Cookie: a=1; b=2` 当作一个值，被 `isTraceableValue` 的 `/[\s\u0000-\u001f]/` 直接拒收（`privacy.parseCookieHeader` 在全仓库**零调用**）。实测它的改法在 5 样本上只能救 7/201 条。

**实测口径**（`tools/probe-cookie-chain.js`，不猜因果，只按字面值 + 时序判真伪）：
- A 族：`Set-Cookie` 下发的值 → 后续请求 `Cookie` 项里出现同字面值（提供方 seq < 使用方 seq）；
- B 族：任意响应头下发的值 → 后续请求侧（query / body / header）出现同字面值；
- 指标：`tracked`（进了值账本）/ `withProducer`（找到了生产者）/ `producerIsTruth`（生产者就是真值方）/ 方向污染（账本 `users` 里出现 `scope=responseHeader`）。

**三步修复**（`plugin/preload/analysis/flow.js`）：
1. **方向**：`scope='responseHeader'` 的隐私值不再当使用者（旧版使 `reuseSessionCount` 虚高、`firstUse` 被下发时刻提前，反而使生产侧更难命中）；
2. **消费侧**：接线 `privacy.parseCookieHeader`，按 cookie 项拆值入账本（`scope:'cookie'`）；
3. **生产侧**：**零 IO 响应头倒排**（值已在索引的 `privacyTags` 里，按 cookie 项精确匹配，`match='set-cookie'|'header'`）+ **`headerText` 子串兜底**（`match='header-text'`，与正文同一次 `readEntry+parseMessage` 产出，**不产生额外 IO**）+ dedupe。

**改前 → 改后（50 样本全量，数字均为跑出来的）**：

| 指标 | 改前基线 | 改后实测 | 增量来源 |
|---|---|---|---|
| A 族真值链 | 1078 条 → 进账本 **1（0.1%）** | **676（62.7%）** | 消费侧拆 Cookie 项 |
| A 族有生产者 | 1 | **676** | 零 IO 倒排 + header-text |
| B 族真值链 | 1093 条 → 进账本 **15（1.4%）**、有生产者 2 | **690（63.1%）**、有生产者 690 | 同上 |
| 生产者 = 真值方 | — | **676/676（精确率 100%）** | 未引入误判 |
| 方向污染（users 里的 responseHeader） | **398 / 11025** | **0 / 34348** | 步骤 1 |
| 逐样本有变化的文件 | — | **36 / 50**（其余 14 个本就无 cookie 链） | 见 `out-cookie-diff.md` |
| 生产者通路分布 | — | `set-cookie 703 · literal 1469 · header-text 782 · header 24` | 弱匹配已留痕 |

**未覆盖分诊（必须可归因，不允许“其他”）**：剩 402 条 = 使会话数 <2（不达 `minReuse=2`）**365** + 超 `maxTrackedValues=200` 被裁 **37** + **其他 0**。
默认参数：`{ minReuse:2, maxTrackedValues:200, maxResponseScans:1200, maxResponseBytes:512KB, withHeaderText:true }`。

**回归断言**（`tools/verify-package.js` 新增 4 条）：账本 `users` 里无 `responseHeader` / 存在 `set-cookie` 生产者 / `scopes` 含 `cookie` / `30-flows.md` 出现 `来源=set-cookie`。

**待拍板（不擅自改）**：被 `maxTrackedValues` 裁掉的 37 条全为凭证类值，是否把 `cookie` / `set-cookie` 来源在追踪排序里前置加权。

#### 1.12 流式/多帧正文实测（v0.5.5 基线，`tools/probe-stream-bodies.js`，50 样本 / 有效扫描 7402 会话）

起因：外部 AI 反馈 `beautify.js` 只覆盖 json/css/xml/html/js，`text/event-stream` 多帧正文被整块当 JSON 解析失败 → passthrough。**复核结论：定位属实，而且它看到的只是冰山一角。**

口径：两路检测，不单独信 Content-Type —— 标签路（索引里的 respContentType，零 IO）+ 内容路（非噪声会话且正文 ≤512KB 才读，**实扫 7654 / 可扫 7654，无预算裁剪**）；分类靠“出现 `data:/event:/id:/retry:` 行”与“顶层 JSON 值序列且值间纯空白”。
（上一版用“逐行能不能 parse”判多帧 JSON，把 1005 条 webpack chunk / bootstrap CSS 误判成多帧，实测直接错给一千多条 → 现改为硬判据：间隔必须纯空白。）

| 发现 | 实测数字 | 判定 |
|---|---|---|
| **A. SSE 事件流没结构化** | **19 条会话 / 1102.6KB / 5030 个事件 / 其中 5023 个事件的 data 是合法 JSON**；现有美化器 19/19 判 passthrough，19/19 整块 JSON 解析失败 | AI 的说法**成立**；例：`样本-11 sid26`（40 事件，`id:1/event:history/data:{...}`）正是它举的那条；最大一条 `样本-18 sid75` 508KB / 2044 事件 |
| SSE 的类型标注准确度 | 19/19 都靠标签路命中（全包 `text/event-stream` 声明 22 条），**错标 0 条** | 拆帧器按 Content-Type 分派就够，不必做内容探测（与 cookie 链那次不同） |
| 🔴 **B. chunked 分块框架没剥（新发现，比 A 更底层）** | 响应头带 `Transfer-Encoding: chunked` 的 **36 条，36/36 正文里仍能逐块走出合法 chunk 框架**（长度行+CRLF 共 2.9KB 污染），合计 1506.4KB；其中 34 条标的是 `application/json`；**0 条能整块 JSON 解析** | 全仓库 `chunked` / `transfer-encoding` **零匹配**（grep 确证）→ transfer-decoding 根本没实现。后果：这些会话的分析包正文/兼容层落盘带长度行，且 `fields.buildFieldView` 解不出字段 → 40-fields / 关键值面板对它们是空的 |
| C. 真“多份顶层 JSON 拼接” | 20 条 / 769.0KB，其中 **17 条其实就是上面的 chunked 未剥**，只剩 3 条是真拼接（如 业务-01 GraphQL 响应标成 `text/html`） | 拆帧器必须能处理“顶层多值”，不能只会 `JSON.parse` 整块 |

后果层面的区别（这是按代码路径的定性，不是实测数字）：生产者匹配走的是**字节子串包含**，chunk 长度行不影响 `flow.js` 的值命中（因此传递链不受损）；但**结构化字段层（KV 树 / 参数全集 / 关键值）完全依赖 JSON.parse**，这两类污染直接把它打掉。

待拍板：见 **D20**（本轮只登记；**v0.5.6 已拍板 ①+②+③ 并全部实施，改前基线→改后对拍见 1.13**）。

#### 1.13 chunked 解框 + 流式拆帧 + 美化多值的改前/改后对拍（v0.5.6，引擎 v0.2.2 → v0.2.3）

方法：先拿旧引擎跑基线快照 `tools/out-sse-base.json/.md`（`npm run probe:stream -- --tag base`），改代码后同一批样本重跑 `--tag after2`，再用 `--diff` 逐样本对拍。**不写预期值，只列跑出来的数。**

| 指标 | 改前（v0.2.2） | 改后（v0.2.3） | 口径 |
|---|---|---|---|
| 能解码并扫描的会话数 | 7402 | **7611** | +209 条正是下面那行“改前解压失败”的会话，以前连进统计都进不了 |
| 带 `Transfer-Encoding: chunked` 的响应 | 36（另有 209 条直接解压失败被跳过） | **245 全部可处理** | 36 + 209 = 245，两个数字完全对上 |
| 正文仍残留 chunk 框架 | **36 / 36**（1506.4KB，框架开销 2.9KB） | **0 / 245** | 按字节逐块走完一遍才能判，不看头 |
| 其中 `application/json` 整块可解析 | **0 条** | **34 条全可解**（抽样 30/30 断言） | verify.js 7.5 |
| 字段视图走 `parsed:false` 降级（只有宽松键名、无路径/类型） | **36 / 36**（共 466 个键名） | **0 条** | 上一轮说的“字段层归零”准确口径是：**降级不是空** |
| 解压失败（gzip/br 流开头混入长度行） | **209 条** | **0 条** | 这类会话改前在 90-anomalies / 未解码.bin 里，正文完全拿不到 |
| 真“顶层多份 JSON 拼接” | 20 条 | **4 条**（其中 1 条真错标） | 16 条是 chunked 伪多帧，剥框后回归单个正常 JSON |
| SSE 事件流会话 / 事件数 | 19 / 5030（未拆） | 19 / 5030（**已逐事件拆开**） | 现象层数字不变，变的是可用性 |
| 美化器判 passthrough 的候选会话 | 39 | **1** | 剩那 1 条是 `text/html` 错标的 GraphQL 拼接体，属兼容层不该重排 |
| MCP 工具数 | 4 | **5**（新增 `saz_stream`） | plugin.json 声明与 `registerTool` 实注册集合一致（断言已改为动态比对） |

样本级交叉验证（不只探针自己说）：
- `verify.js` 第 7 组（+17 断言）：构造用例（多块 + 块扩展 `;ext=1` + trailer + 残尾 + chunk 包 gzip 顺序）全过；`样本-15` 抽 30 条 chunked → 解框 30/30、残留 0、JSON 整块可解 30/30；`样本-11 sid26` 拆出 **40 事件 / 40 条 data 为 JSON**；`样本-18 sid75` **2587 事件**（上表 2044 是探针 512KB 截断下的数，detail 不限体积后为 2587）。
- `verify-package.js` 第 3 组（+13 断言）：`66-stream.md` 已产出并排进 `readingOrder`；sid26 正文含「事件流拆分」段；`样本-16` 162 个正文文件中 **18 个带解框说明**（例：剥掉 3 块 / 19B 开销），**开头残留长度行 0 个**；`manifest.counts` 带 `dechunkFailures/dechunkPartial/chunkedResponses/eventStreamResponses` 四项，`90-anomalies.md` 有“chunked 解不开”一节（失败不静默）。
- `verify-preload.js` 2e-2（+15 断言）：`saz_stream` 分页不重不漏、非流式会话返 `kind:'none'` + 说明（不把“没拆”做成“拆了但为空”）、返回值可完整 JSON 序列化；`saz_body` 对 chunked 会话回传 `transferEncoding` 与 `dechunk{applied,frames,overheadBytes}`。
- `verify-legacy.js` 仍 **18/18**：绝对不变量（落盘正文字节 == 归档解码明文 37 条）未被破坏；对华为云样本无 chunked 会话 → 无新差异；同时把“chunked 已解框”**登记进 `_导出清单.md` 的有意不一致清单**（原算法全文件零 `chunked` 关键字，属 C 层主动修 B11，不是静默差异）。

未做（并说明原因）：**不对 `data:` 里的 JSON 默认展开缩进** —— 按规范一个事件的 `data` 是多行 `data:` 用 `\n` 拼接的结果，把一份 JSON 拆成多行写回会改变重放时的字符串，属“更好看但改了数据”；需显式传 `expandSseData: true` 且 `note` 里标风险。JS 依旧有意不重排。


#### C 层 UI（可重复部分：`vue-tsc` 0 错 + `vite build` + `assemble.js` 自检）

渲染与交互的验证靠浏览器 + DEV stub（`src/devstub.ts`，仅 `import.meta.env.DEV`，生产包已证实不包含其数据）：
列表/三档过滤/详情懒加载/WS 帧取数/原始字节/关键值面板/流程与传递链/诊断面板/导出面板估算与两条导出路径均跑通。
过程中实测修掉一个真 bug：`resetFilter()` 整体替换 `state.filter` 导致 `watch` 引用失效，“重置后输入框不再触发过滤”（已改为就地赋值 + getter 形式 watch）。

#### 1.14 “内容优先于头”的修正与 chunked 产物对拍（v0.5.7，引擎 v0.2.3 → v0.2.4）

本轮不新建假设：上一轮汇报里列的 6 个缺口（A1–A7）全部先拿真实样本量一遍再动手。方法：
旧行为先用探针/临时脚本跑出具体会话与具体输出（包括“旧路径只能得到什么”），改完在同一批会话上跑同一组指标；
新增探针 `tools/probe-stream-cost.js` 专门量化内容改判的**覆盖面与成本**（主探针 `probe-stream-bodies.js` 的分类是内容级的，不反映引擎按头分派的行为，因此不能用它自证）。

**A1 伪 SSE（声明 event-stream、正文每行一份裸 JSON）**

| 指标 | 改前（只按 SSE 语法） | 改后（回退多值） |
|---|---|---|
| 全包声明 `text/event-stream` 的会话 | 21 | 21（不变） |
| 其中“解不出任何带 data 事件”的 | **3**（旧路径只交出 1 个空事件） | 0 |
| 回退救回 / 救不回 | — | **3 / 0** |
| 救回后的结构 | — | 每条 3 份顶层值，3/3 可 `JSON.parse`（键 `file_id/event/message/progress/extra`） |
| 分析包正文段 | `事件=1 带 data=0`（误导行） | `顶层多份 JSON 值拆分` + 逐份定位 |

样本：`样本-20` sid3561/3663/3731（699B / 4 行）。旧路径实测：`stats={blocks:1,events:1,withData:0,otherFields:3}` —— 三份 JSON 全堆在 `other[]` 里，**比不拆更难读**，所以这条不是优化而是修错。

**A2 错标 Content-Type 的真多值 + 假阳性/成本实测**

| 指标 | 数值 | 说明 |
|---|---|---|
| 扫描的文本非噪声会话 | 7785 | 50 个归档，排除噪声档/超 512KB/解压失败 |
| 整块不是单一 JSON 的候选 | 3125 | 放宽闸门后“理论上可能被误伤”的全集 |
| 硬判据命中 | **4** | 3 条 event-stream（A1）+ **1 条 `text/html`** |
| JS/CSS/HTML 假阳性 | **0** | 命中的 CT 分布：`{text/event-stream:3, text/html:1}` |
| 错标真多值命中 | **1** | `样本-01` sid1642（290.8KB / 9 份，9/9 可解析） |
| 旧闸门扫描次数 / 耗时 | 39 次 / 13.1ms | 对照组 |
| 新增扫描次数 / 耗时 | 5563 次 / **20.9ms** | 实验组多花的部分（7785 条会话合计） |

成本实测反过来决定了预门的宽度：先按“任意 JSON 值开头”（含数字/字符串/`true`）实现，跑出 **6271 次/29.7ms**（其中 1955 次被硬判据拒绝）而收益一条没多；收窄到只认 `{` / `[` 后降到 5563 次/20.9ms，命中仍为 4。已写成断言防回落：“标量拼接不触发扫描（成本实测换来的有意收紧，不是遗漏）”。

**A3 chunked 与 `解析SAZ.py` 真实历史产物的逐条对拍**（新增 `verify-legacy.js` 第 7 节）

前一轮的对拍样本（184 条 / 3756 条两个归档）**实测 chunked=0 且 event-stream=0**，所以 B11 的产物差异当时根本没被测到。本轮改用 `样本-15`（18 条 chunked）与磁盘上真实存在的 `样本-16_解析结果`：

| 指标 | 结果 | 意义 |
|---|---|---|
| 目录对齐 / 两侧都有正文文件 | 18 / 18 | 不是抽样，是全量 |
| **原算法产物以十六进制长度行开头** | **18/18** | 形如 `939\r\r\n{"code":…` → B11 在**对方侧**的实物证据，不再靠读代码推断 |
| 我们的产物无长度行 | 18/18 | 剥框已生效 |
| 绝对不变量：落盘字节 == `dechunk(归档原字节)` | **18/18 逐字节相等** | 数据未被动坏 |
| 原算法正文严格大于我们 | 18/18（共差 2654B） | 方向正确；我们记录的框架开销合计 1970B，残差 684B |
| 归一 `\r\r\n→\r\n` 后逐字节相等 | 11/18 | 剩下的 7 条不是 chunked 问题 |

这里有一个**必须记下来的方法论结论**：chunked 场景**禁止用“逐字节相等”对齐原算法**。实测发现 `解析SAZ.py` 用文本模式写盘，除了不剥框，还会把正文内部的 `\n` 改写成 `\r\n`（所以长度行变成 `\r\r\n`）；两种改写叠在一起，直接比字节必然失败。因此断言分三层：对方形态（带框）→ 我们形态（无框）→ 绝对不变量（我们对归档原字节），并把残差与归一命中率作为 INFO 输出而不是假装等式成立。

**A5/A6/A7 与工具面**

- A5：`maxStreamEventsInFile`/`maxWsFramesInFile`/`streamMaxEvents`/`streamMaxValues`/`streamMaxDataChars` 从 render 里的写死兼底提升为 `DEFAULTS` 真参数，透传链 `ctx → detail(streamOptions) → core/stream`，并补进第 8 节参数表与导出面板（面板只暴露人看得懂的那个：正文事件展开上限）。断言锁了两件事：上限确实控制逐条展开行数（5→5 行，50→50 行），且 **`事件=N` 的计数仍是全量**（否则就是静默缩数据）。
- A6：**没加第 6 个工具**。复核发现 `saz_query` 已支持 `contentType`（所以 SSE 会话早就能枚举），真正缺的只是传输层维度 → 新增 `transferEncoding[]`/`chunkedOnly`/`eventStreamOnly`。实测口径对齐：`chunkedOnly` 命中 18 == `summary.transferChunked.responses` 18；补集 209+18=总数 227；`eventStreamOnly` 命中 1 == `summary.stream.eventStreamResponses` 1。
- A7：UI「事件流」页一行一点展开单事件全文（直接复用返回体里已有的 `dataJson`/`data`，**不二次请求**）；`dataTruncated` 时显式提示“这里给的不是全文”。
- 美化层补漏：上轮报的“passthrough 39→1 剩 1 条”归因不完整——根因是 `beautify()` 按 Content-Type 分派，`text/html` 直接落到 passthrough 分支，**根本没走到多值逻辑**。现加按内容兜底（与引擎侧同一套 `worthSniffing` + `splitJsonValues` 硬判据）：重跑同一批样本 `--diff base after4` → passthrough **39 → 0**，且重排后份数不变（9 → 9）。
- 附带修一个测试工具自身的 bug：`probe-stream-bodies.js --diff base after4` 的位置参数被静默忽略（永远读 `--after` 默认值），导致一度把旧快照的 1 当成新结果报出去；现在两种写法都支持，缺标签直接退出（不静默拿错数据）。

**五条验收线的变化**（真实样本，非预期）：`verify.js` 60 → **74**（+14）、`verify-package.js` 56（本轮未动包层断言）、`verify-legacy.js` 18 → **24**（+6）、`verify-preload.js` 203 → **210**（+7）、`assemble.js` 20；`vue-tsc` 0 错；`npm run build` 写 8 个文件并逐文件哈希复核，复跑需写 0。

**仍未做（本轮主动排除，含理由）**：
- **A4（索引期体积口径）**：`respBodyBytes`/`respEntryPlainBytes` 仍含 chunk 框架（只有 detail 解框）。全包框架开销合计 2.9KB/1506KB，影响可忽略，而加一个新字段会扰动已有投影断言与 50-sessions 表头，性价比低。`rawBodyBuf` 保留含框原字节是有意设计（保真出口）。
- 真·SSE 里 `data` 内 JSON 的默认展开缩进（语义风险，需显式 `expandSseData`）；F20 protobuf 转储；M0 真机确认；M5 发布；D12 其余参数；`maxTrackedValues` 凭证值前置加权。

---

## 2. ZTools 平台特性与约束（逐条对文档核实）

文档站两个镜像（`ztoolscenter.github.io/ZTools-doc`、`ohmyztools.cc`）**内容版本不一致**：github.io 的 `plugin.json` 页含 `tools`(registerTool/MCP) 与 `providers` 声明，而 `ohmyztools.cc` 的 API 页完全不存在 `registerTool`。→ 以 github.io 为设计依据，`tools` 能力作为 P2 且必须实测。

### 2.1 与需求直接相关的 API（来自 `plugin-api.html`）

| 用途 | API | 备注 |
|---|---|---|
| 选文件 | `ztools.showOpenDialog(opts): string[] \| undefined` | 与 Electron `showOpenDialogSync` 一致，**取路径最稳妥的通路** |
| 拖放进界面 | `ztools.getPathForFile(file): string` | 基于 Electron `webUtils.getPathForFile`（现代 Electron 已禁 `File.path`） |
| 另存为 | `ztools.showSaveDialog(opts): string \| undefined` | 单条 body / 报告导出 |
| 打开结果 | `ztools.shellOpenPath(p)` / `shellShowItemInFolder(p)` | 导出后一键直达 |
| 复制 | `ztools.copyText / copyImage / copyFile` | 复制 cURL、URL、JSON |
| 搜索框 | `ztools.setSubInput(cb, placeholder, focus)` | **列表过滤/全文搜索的主交互入口** |
| 完成通知 | `ztools.showNotification(body)` | 批量导出结束提示 |
| 持久化 | `ztools.dbStorage.setItem/getItem/removeItem` | 配置 + 最近解析记录（键值，自动 JSON 化） |
| 大对象存储 | `ztools.db.put/get/allDocs/postAttachment` | PouchDB 风格，可存解析索引文档（**注意按插件名隔离**） |
| 视图高度 | `ztools.setExpendHeight(px)` | 列表展开时调高 |
| 退出 | `ztools.outPlugin(isKill?)` | 关闭当前会话 |
| 进入 | `ztools.onPluginEnter(param)` — `param: { payload, type, code }` | ⚠️ **`type` 枚举文档只写 `text/regex/over`，未写 `files/img`** |

**文档明确不存在的 API（不可依赖）**：`setProgressBar`（进度条）、tray/托盘、`setSize`、`setFeatureMode`、`getEnv/ENV`、`dbPath`、`pluginPath`、uTools 式的 `setDb/getDb/saveDb`。
→ 进度只能自绘 UI；插件自身目录需靠 `__dirname`（preload 内可用）推导。

### 2.2 触发方式（`plugin-json.html`）

`files` 指令：`{type:"files", label, fileType:"file", extensions:["saz"], match:"正则", minLength, maxLength}` —— "当用户**粘贴**文件或文件夹到 ZTools 时触发"，数量与扩展名可精确约束，多文件原生支持。

### 2.3 preload 与依赖规则（`preload-js.html` / `node-js.html`）—— 含硬约束

- preload 遵循 **CommonJS**，可用 `require('fs'/'path'/'os'/'child_process')`、`require('electron')`、以及第三方 npm 包；与 `plugin.json` 同目录或子目录才会被打包。
- preload 与 UI 通信方式：**给 `window` 挂自定义属性**（如 `window.sazApi = {...}`），前端直接调用；文档不使用 `module.exports` 供 UI。
- 🔴 **红线**：preload 代码及其引入的第三方模块**不得打包/压缩/混淆**，必须保证每行可读，**第三方模块源码需随包提交**。Node 依赖必须放在 preload 同级目录、**不得编译**。
- 构建产物：只把 `dist/` 作为插件应用提交，**切勿提交整个项目根**。ZTools 只识别 html/css/javascript。
- 本机运行时实测：Node v24.19.0（支持 zlib zstd），但 ZTools 是 Electron 应用，其内嵌 Node 版本待实测 → 见第 9 节 R1。

### 2.4 发布链路（`publish-and-update.html` / `first-plugin.html`）

- CLI：`@ztools-center/plugin-cli` → `ztools create / publish / pull-contributions`。
- 前置：存在 `plugin.json` + `git init` + ≥1 次 commit + **工作区干净**；GitHub Device Flow OAuth（含 **workflow scope**）。
- 机制：自动 fork `ZToolsCenter/ZTools-plugins` → 同步 upstream main → 探测 `plugins/<id>/` 决定 Add/Update → 复制文件到 `plugins/<id>/` → 普通 push（不 force）→ 开 **Draft** PR；后续发布在同分支 fast-forward 追加 commit。
- 🔴 **冲突点已确证（v0.5.8：读 plugin-cli 1.3.2 源码 + 实发一次）**：`copyPluginFiles()` 用 `copyDirRecursive` **整目录递归复制 `process.cwd()`**，忽略项只有硬编码的目录名（`.git node_modules dist build .next .turbo .cache coverage .vscode .idea .parcel-cache`）与文件名模式（`.DS_Store`、`*.log`、`.env*`、`npm/yarn-debug.log`），**完全不读 `.gitignore`**。所以"仓库里已排除"≠"不会进公开 PR"——本插件因此改为在 `publish/<name>/` 这棵只含应公开内容的树里发布（见 2.4.1）。第三方依赖确实会被 `node_modules` 这个目录名挡掉，故 2.3 要求的"依赖随包提交"只能放在非 `node_modules` 目录下（本插件运行时零依赖，未触发）。
- PR 自检清单 5 项（原文）：① `name/title/version/description/author` 已核对 ② 已移除调试日志、未使用文件、敏感信息（.env/token/密钥） ③ 本 PR diff 仅涉及 `plugins/<id>/` ④ 已在本地 ZTools 客户端实际加载并测试主功能 ⑤ 同意仓库开源协议。
- 合并前必做 3 件事：上传截图/演示 GIF、勾选 5 项 checkbox、把 Draft 切成 Ready for review。
- `CHANGELOG.md` 非强制，但 publish 会交互式抽取当前版本节注入 PR → **建议提供**（缺失会被交互打断）。
- ⚠️ `author` 出现在自检清单，却不在 `plugin-json.html` 的基础字段列表里 → 实测**接受该字段且插件正常加载**；抽查上游 4 个插件的 `author` 一律是**纯显示名（不带邮箱）**，本插件照此保持 `乐幻`（邮箱只用于 git 身份，且用 GitHub noreply 公开地址）。

#### 2.4.1 发布通路实测（v0.5.8，PR #638 全流程跑通）

**CLI 硬要求（每条都实际撞过）**：
| 要求 | 判据（源码位置） | 撞上的表现 |
|---|---|---|
| plugin.json 位置 | `./`、`./src-ztools/`、`./public/` 三选一 | 找不到直接终止 |
| CHANGELOG 标题 | 正则 `^##\s+<version>\s+-\s+(\d{4}-\d{2}-\d{2})\s*$`；日期不得晚于**本机今天**；节内须有非标题正文行 | Keep-a-Changelog 的 `## [0.2.4]` 被拒，必须写 `## 0.2.4 - 2026-10-04` |
| git 状态 | 是仓库 + ≥1 commit + `git status --porcelain` 为空 | 有未提交改动直接抛错 |
| logo | sha256 等于模板默认图标即拒 | 自制图通过（`5ce309bf17b9…`） |
| 认证 | 只读 `~/.config/ztools/cli-config.json` 里的 OAuth token；没有就走 Device Flow 等人在浏览器里输码 | 本轮从 `gh auth token` 播种该配置（token 不落任何日志），避免卡在交互上 |

**流程事实**：自动 fork（本轮新建 `账号-01/ZTools-plugins`）→ 首次 clone fork（中心仓库 git 对象约 346MB，走全局 git 代理）→ fork main 对齐 upstream → `git checkout -B plugin/<name> refs/remotes/upstream/main` → 整目录复制到 `plugins/<name>/` → 单个 commit → `push --force-with-lease` → 开 **Draft** PR；PR 标题固定 `Add/Update plugin <title> v<version>`，正文由 CHANGELOG 当前版本节 + 5 项自检清单渲染。
**重复 publish 的语义**：每次都基于最新 upstream/main **重建**发布分支并复用同一个 PR，且**正文会被重新生成** → 手工勾选的 checkbox 与补写的说明会被冲掉。结论：**先做完所有 publish，最后再改 PR 正文与截图**。

**两个坑（都会咬人）**：
1. `upstream.js` 里 `resolveSyncBase()` 用 `shellQuote()` 给 ref 加**单引号**再交给 `execSync`，Windows 的 cmd 不认单引号 → `git fetch origin 'plugin/x':...` 报 `couldn't find remote ref 'plugin/x'`。触发条件：**远端已存在发布分支 + 本地发布树的 `.git/ztools-upstream-sync.json` 不存在**（发布树被重建时必然出现）。规避：建树脚本不清 `.git`，并在状态缺失时按 CLI 自身语义补写（`status: synced`，基线 = 当前 upstream/main，且中心仓库尚无 `plugins/<name>/` → 无待同步）。
2. 公开提交的 author 取 plugin.json `author` 里的邮箱，缺失时与 committer 一起回落到 **fork 缓存仓库的 `git config user.email`（= 全局私人邮箱）**。规避：把 `GIT_CONFIG_GLOBAL` 指向"全局配置副本 + 末尾覆盖 `[user]`"的临时文件——代理、sslBackend、凭据助手全部保留，只换身份，**不改用户 git config**。

**CI 侧打包语义**（中心仓库 `scripts/build-plugins.js`）：有 `package.json` 就 `npm install`，有 `scripts.build` 才构建；打包源优先 `src-ztools/`（需同时含 plugin.json 与 dist）→ `plugin.json` 中 `main` 声明的构建目录 → `dist/` → 否则**整个插件目录**。本插件发布树不带 build 脚本，故打包源就是插件根目录，产物与本地 `release/saz-parser-v0.2.4.zip` 等价（28 条目 / 499,259 字节）。上游惯例是"发源码 + CI 构建"，本插件选择"发可直接安装的树"：审核者可原地拷进插件目录加载，代价是界面 UI 源码（`src/`）不随包分发（`preload/` 28 个文件仍是可读源码）。

### 2.5 从主程序源码与已安装插件挖出的事实（比文档权威，v0.3 新增）

方法：解析 `<ZTools 安装目录>\resources\app.asar`（15.6MB，**未混淆**，保留变量名与注释）+ 读 `~\.ztools\plugins\*.asar` 内的 `plugin.json`。

#### ① `tools` / MCP **确实已实现**（github.io 文档正确，ohmyztools.cc 是旧版）

主进程 `out/main/chunks/appMain-*.js` 内有完整的 `class PluginToolsAPI`：
- preload 侧 `ztools.registerTool(name, handler)` → 走同步 IPC `"plugin:tool-register"`（`event.returnValue = {success}`）登记到主进程；
- 主进程按 `webContents.id => Set<toolName>` 维护，并有 `waiters` 机制等待注册完成；
- **强校验 `plugin.json` 声明**：`工具 "${toolName}" 未在 plugin.json 中声明` 会直接抛错 → `tools` 声明是必需项，不能只注册不声明；
- 也校验 `工具 "${toolName}" 尚未通过 ztools.registerTool 注册` → 声明与注册必须同名成对；
- **插件未运行时会被后台预加载**：`ensurePluginToolReady()` → `getPluginWebContentsByPath()` 不存在则先拉起插件再等注册；
- 调用通路：`webContents.executeJavaScript("window.ztools.__invokeRegisteredTool(name, input)")`；
- 存在设置项开关：`MCP_DISABLED_PLUGINS_DB_KEY = "settings-mcp-disabled-plugins"` → 用户可按插件禁用。

→ **F15 可行性从"文档存疑"升级为"源码确证"**；但插件侧 `window.ztools.registerTool / __invokeRegisteredTool` 的注入点不在 `out/preload/index.js`（该文件无此二者），说明插件 webContents 用的是另一套注入脚本，**仍需在 M0 运行时验证签名**。

#### ② 文档未写、但实测存在于 `window.ztools` 的能力

| API | 签名/来源 | 对本插件的价值 |
|---|---|---|
| `checkFilePaths(paths)` → `Promise<Array<{path,isDirectory,exists}>>` | IPC `check-file-paths`（主进程 `fs.promises.stat` 实现） | **批量校验 .saz 路径是否存在/是否目录**，比手写 fs 判断更贴近宿主语义 |
| `getLastCopiedContent()` | IPC `get-last-copied-content`，返回项含 `files:[{path,name,isDirectory,isFile}]` | 🔑 **files 触发拿不到 payload 时的可靠兜底**：直接取"刚粘贴进搜索框的文件绝对路径" |
| `getPathForFile(file)` | `electron.webUtils.getPathForFile(file)` | 确证可用（主程序自己的拖拽就是这么做的） |
| `onFloatingBallFiles(cb)` | IPC `floating-ball-files` | 悬浮球投递文件的事件通路（扩展入口） |
| `queryMainPush` / `selectMainPush` / `setPluginMainPushEnabled` | IPC 同名通道 | 对应 `features[].mainPush`，主搜索框直出结果 |

#### ③ 真实 `plugin.json` 字段样本（官方 `everything` 本地搜索插件）

```json
{
  "name": "everything", "title": "本地搜索", "version": "2.7.3",
  "author": "uTools 团队", "homepage": "https://u.tools",
  "description": "基于 Everything 更便捷的本地文件搜索 + 文件预览",
  "main": "index.html", "preload": "preload/preload.js",
  "logo": "logo.png", "platform": ["win32"],
  "unpack": "@(Everything.*|*.exe)",
  "syncVersion": "2.7.2", "ai": true,
  "features": [
    { "code": "find", "explain": "...", "cmds": ["本地搜索", "find", "搜索"] },
    { "code": "oversearch", "explain": "本地文件搜索", "mainPush": true,
      "cmds": [ { "type": "over", "maxLength": 40, "exclude": "/[\\\\\\/\\t\\n]/", "label": "文件搜索" } ] }
  ]
}
```

文档未列但实际存在的字段：**`author`、`homepage`、`syncVersion`、`ai`、`unpack`、`features[].mainPush`**。

- 🔑 **`unpack` 是 electron-builder 的 asar 解包语法**（如 `"@(Everything.*|*.exe)"`）→ 证明**插件可以携带需要解包到磁盘的原生文件（含 exe/dll）**，本地已安装形态即 `xxx.asar` + `xxx.asar.unpacked`。这直接缓解了 R7（"是否禁自带二进制"）——至少官方插件自带 exe，但走的是 `unpack` 正规通路，而非"调外部 Python"。
- `preload` 可指向子目录（`preload/preload.js`），与文档"同目录或子目录"一致。
- `platform: ["win32"]` 单平台限制是真实用法。
- 主程序自身依赖 `adm-zip`（打包/解包插件用）→ 印证 ZIP 解析在 Node 生态里属常规操作。本机实测版本 **v0.5.16**，已用 `tools/vendor-adm-zip.js` 从 asar 取出到 `tools/.asar-dump/adm-zip/`，供构建时做“宿主同款库”交叉验证。

### 2.6 安装件形态契约（v0.5.1 实测确证）

**只能交压缩包**：“导入插件”的文件对话框写死了 `filters:[{name:'插件文件', extensions:['zpx','zip']}]`；目录形态只用于**开发态**绑定（`importDevPlugin` 要求所选文件 basename 必为 `plugin.json`）。

ZIP 分支的安装契约（`PluginInstallerAPI`，逐行读源码）：

| 步骤 | 源码行为 | 对我们的硬约束 |
|---|---|---|
| 读信息 | `new AdmZip(file).readAsText('plugin.json')`，取不到即报“无效的插件文件：缺少 plugin.json” | **`plugin.json` 必须在压缩包根**，不能多套一层目录（Windows 右键压缩最常犯的错） |
| 安装 | `extractAllTo(<tmp>/plugin, true)` 后再读 `<tmp>/plugin/plugin.json` | 条目名用 `/`；解出集合必须与源逐文件逐字节相等 |
| 校验 | `config.name` 预览与安装不一致即拒；`assertSafePluginArtifactPart(name/version)`；`validatePluginConfig` | name/version 无路径分隔符；`features[].code+cmds` 齐全；`tools.*` 必须小写 snake_case + `description` 非空 + `inputSchema` 为对象；声明 `tools` 时 `preload` 与 `logo` 必需 |
| 落位 | 安装到 `PLUGIN_DIR/<name>`，`storageKind='directory'` | 升级覆盖同目录，包名必须与 `plugin.json.name` 一致 |

另：`.zpx` = asar（`isValidZpx` 只查首 4 字节是否为 asar 魔数），宿主开发者面板会产 `.zpx`；本插件选 ZIP 通路（零依赖可复现、解包后目录可直接审计，不引入 asar 写入器）。

#### 已安装形态与自动部署（v0.5.2 实测）

看 `~\.ztools\plugins` 实物：市场插件是单文件 `<name>-<ver>-<hash>.asar`（如 `everything-2.7.3-3c61b65d.asar`），而**ZIP 导入的插件是目录 `<name>`**（实测 `saz-parser`，27 文件）。注册表（LMDB 的 `plugins` 键）记的就是这个 path，所以**直接往目录里写就是升级**，不必再走导入流程。

因此新增 `tools/deploy.js`，接在 `npm run build` 最后一步（也可 `npm run deploy` 单独跑）：

| 环节 | 做法 | 为什么 |
|---|---|---|
| 形态判定 | 目录 → 可替换；`<name>-*.asar` → 拒绝并说明原因；都没有 → 提示先导入 ZIP | asar 是 header+偏移的单文件，且注册表 path 带 hash，改不得 |
| 写入 | 只写**内容真的不同**的（逐文件 sha256 比对），且 `tmp + rename` 原子替换 | 宿主可能止在读取；幂等（实测第二次“需写 0”） |
| 删除 | 只删“上次本脚本部署过且本次源里没有”的，或首次时明显属产物类型的残留；**非产物类型的文件永不删** | 最小破坏：不能把用户放在目录里的东西扫掉 |
| 排除 | `.build-manifest.json`、`.deploy-manifest.json`、`*.zip`、`node_modules/` | 簿记与嵌套包不该进安装目录 |
| 校验 | 部署后重扫：逐文件哈希一致 + 目标不多不少 + `plugin.json` 的 main/preload/logo 都存在 | “写完了”不等于“写对了”；不过就 FAIL |
| 占用 | EBUSY/EPERM 重试 4 次；仍在跑则提示“关掉插件窗口再打开才吃新 preload” | preload 只在窗口创建时注入，这是硬限制 |

验收：`tools/verify-deploy.js` 20 条断言（形态判定 / 全量 / 增量只写 1 个 / 删除推断边界 / 校验器能抓坏部署），全部在临时目录里跑，不碰真实安装目录。

落地：`tools/package-zip.js`（零依赖 ZIP 写入器，deflate + store 回落 + 固定时间戳）已接到 `npm run build` 第 6 步，产物 `release/<name>-v<version>.zip`；自检包含“自家读取器逐条目比对 + Windows `Expand-Archive` 交叉解压 + **宿主同款 adm-zip 跑原调序列**”三重取证，任一项失败则构建直接判死。

### 2.7 无界面（真“不开插件页面”）的三条机制（v0.5.3 从 app.asar 确证）

用户实测反馈：“一键解析还是会打开插件界面”。查宿主源码后定位到根因：**开窗不是插件干的，是宿主的进入流程干的**，而宿主早就给了不展开界面的官方开关，只是文档里没写。

| # | 机制 | 源码位置与行为 | 适用边界 |
|---|---|---|---|
| 1 | **`features[].mainHide: true`** | `isFeatureMainHide()` 读静态 plugin.json 与 LMDB `dynamic-features` 两处；命中就 `setExpendHeight(0, false)` —— 视图照建、preload 照跑、enter 照派，**但高度为 0，看不到界面** | 覆盖“当前视图复用 / 缓存视图恢复 / 新建视图”全部路径 |
| 2 | **`shouldKeepMainWindowHidden`** | `shouldKeepMainWindowHiddenForLaunch(source, mainHide)` = `(source === 'global-shortcut' \|\| source === 'super-panel') && mainHide` | **只有这两个启动来源**才连主窗口都不弹。所以：把指令绑到**全局快捷键**或收进**超级面板** = 真·纯后台落盘；从搜索框选指令时主窗本来就开着（但插件区高度仍为 0） |
| 3 | **插件自报无界面模式**（我们采用） | 每条进入路径都会先 `getPluginMode(webContents, featureCode)`：主进程 `send('get-plugin-mode', {featureCode, callId})`，插件回 `plugin-mode-result-<callId>`；**1 秒不回就超时当普通界面**。返 `'none'` → 高度压 0 且**不派发 `onPluginEnter`**，改走 `call-plugin-method`；返 `'list'` → 结果列表模式 | 不返 `'none'` 时仍能靠 mainHide 撑住，两条互补 |

#### 无界面调用契约（`mode = 'none'` 时）

```
主进程 → webContents.send('call-plugin-method', { featureCode, action, callId })
插件  → ipcRenderer.send('plugin-method-result-' + callId, { success: true,  result })
                                                | { success: false, error: string }   // 30s 超时
```

关键细节（都是会踩的坑）：

- `action` = `api.getLaunchParam()`，与 enter payload 同源（`{type, payload, inputState}`），所以取路径逻辑可直接复用；
- **必须回包**。不回的话宿主满 30 秒才报 `Plugin method call timeout`，用户看到的是“点了没反应”；失败也要回 `{success:false,error}`；
- 大样本可能跑超 30 秒：产物照写，但宿主侧会报超时（已落盘 + 已通知，不丢结果）；
- 无界面通路**不能去调 `outPlugin`**：本来就没开窗，关窗会把 `pluginViews` 缓存弄没，反而拖慢下次；
- 坑：`restoreCurrentPluginViewHeightOnWindowShow()` 会在用户后续唤起主窗时把 mainHide 插件的高度从 0 **恢复成正常** —— 所以一键跑完得让 `currentPluginPath` 不残留（mode='none' 不进入展示态，天然满足）。

#### 本插件最终采用的组合（用户口径：两条候选 + mainHide + mode）

> 上一轮按“方案 B”把 `files(.saz)` 收敛成唯一一条，用户直接推翻：**“我复制 saz 文件或者路径时希望给出两个指令快捷，一个是一键，一个是 saz 分析；直接搜索 saz 只需要给出一个 saz 分析即可”**。以用户口径为准。

1. **文件/路径触发 = 两条候选**：`files(.saz)` 与路径 `regex` 各注册两条 —— `saz-quick`（一键解析，直接落盘）与 `saz-view`（SAZ 分析，打开界面），用户选哪条就怎么走；**关键词只给 1 条，取值与 `plugin.title` 全等**（`SAZ 抓包解析`），靠宿主“双向包含 + 拼音”覆盖 `saz`/`抓包`/`解析`/`zbjx` 全部叫法，同时抑制宿主自动插入的“插件标题行”（见 2.8）。
2. `saz-quick` 带 `mainHide: true` + 对 `get-plugin-mode` 返 `'none'` → 三层全盖住，真的不开界面；`saz-view` 恒答 `'main'`，永远不会被一键劫持。
3. **`get-plugin-mode` 是比 `payload.code` 可靠得多的 featureCode 来源**（它天然带 `featureCode`，而确证过的 enter payload 里没有 code）—— M0 那个“code 到底递不递到”的悬案就此绕开；`via` 留痕区分来源：`headless / mode-query / code`。
4. **`quickMode` 开关已整体删除**：mode 回答只能由 featureCode 决定。早期版本让设置项参与抢判（“路径触发也直接落盘”），结果是用户不可预期——而且宿主只给 1 秒应答，现场等设置 IPC 会超时降回有界面。同理，**设置页里任何开关都不得劫持 `get-plugin-mode`**（已写成断言）。
5. 验收：`tools/verify-preload.js` 第 9 节（含 9a2 宿主搜索索引复刻 + 9a3 flags 剥离对照组）+ 第 8 节，含**控制变量对照**：同一 payload，只换宿主问过的 featureCode，`saz-quick` 走一键、`saz-view` 仍开界面；另断言旧 code（`parse-saz`/`saz-home`/`parse-saz-path`）不再残留。

### 2.8 宿主搜索索引与关键词/别名规则（v0.5.5 从渲染端源码确证）

用户报：「搜 saz 能出来 4 个入口」，并提醒宿主本身就有**别名**与**忽略大小写**。不猜，直接读未混淆渲染端 `out/renderer/assets/index-C0OQ9AsP.js`（dump 工具：`tools/asar-dump.js`）：

| # | 行为 | 源码位置 | 对本插件的含义 |
|---|---|---|---|
| 1 | **每条 `cmds` 字符串 = 一行独立搜索结果**（行名就是该字符串） | `buildPluginCommandItems` 28403-28420 | 插件里堆同义词 = 直接叠加行数，不是“提高命中率” |
| 2 | 若**没有任何 cmd 的 name/label 与 `plugin.title ?? plugin.name` 全等**，宿主额外自动插一行“插件标题” | 28327-28359 | 这行就是用户看到的重复项来源；它的 `featureCode` = 第一个含 text cmd 的 feature |
| 3 | 文本匹配 = **忽略大小写的双向包含** + **全拼/首字母** | 28853-28857（谓词）/ Fuse 索引 28303-28317（keys：name/pinyin/pinyinAbbr/acronym/aliases） | `saz` 与 `SAZ` 完全等价 → 两条同义关键词必现两行 |
| 4 | `match` 型 cmd（files/regex/over/img/window）**不进文本索引**，name 取 `label` | `normalizeCmd` 27802-27807 + 28376-28401 | 粘贴文件/输入路径才会出现，所以“两条候选”与关键词行数互不干扰 |
| 5 | 🔴 **输入框通路剥掉 regex flags**：`preserveFlags:false`；粘贴通路保留 | `parseMatchPattern` 27676-27693（`flags = preserveFlags ? m[2] : ''`）+ 28660 vs 28690 | 我们的路径正则不能只靠 `/i`：`\.saz` 在输入 `X.SAZ` 时**会漏** → 已改成显式字符类 `\.[Ss][Aa][Zz]` |
| 6 | `files` 的 `extensions` 已做小写归一 | 27743-27748 | `.SAZ` 文件粘贴仍命中，不必担心 |

**用户侧配置入口（从内置 `setting` 插件产物取证，路径 `<ZTools 安装目录>\resources\app.asar.unpacked\internal-plugins\setting`）**：

- **自定义别名**：设置 → 所有指令（`AllCommandsSetting`）或 正则/文件类指令详情弹窗（`MatchCommandDetailDialog`）的菜单项 `{key:"custom-alias", label:"自定义别名"}`；快捷键页（`ShortcutsSetting`）有「添加/编辑指令别名」对话框（别名 + 图标），保存走 `window.ztools.internal.updateCommandAliases(...)`。
- **存储位置**：LMDB key `command-aliases`（`HOST_STORAGE_KEYS.commandAliases`），形如 `{ "saz-parser:saz-view:SAZ 抓包解析:text": [{alias, icon}] }`；id 算法见 `getCommandId` 27588-27603 = `pluginName:featureCode:cmdName:cmdType`。
  → **推论**：改了 plugin.json 里的关键词文案或 feature code，用户已配的别名会因 id 变化而失配（不报错，只是不再出现在搜索里）。
- **禁用单条指令**：同一菜单里的 `{key:"toggle", label:"禁用指令"}`（存 `disable-commands`，同 commandId 粒度）—— 任何多余行用户都能自己收掉。
- **权限门**：`internal:update-command-aliases` 走 `requireInternalApi`（`canUseInternalApi`，白名单由设置页 `customInternalApiPluginNames` 控制）→ **第三方插件不能替用户写别名**，只能引导他在宿主 UI 里设。
- 搜索相关的设置页只有“搜索框提示文字/紧凑顶部栏/壁纸”等，**没得选“否忽略大小写”** —— 因为忽略大小写是写死的匹配行为，不是开关。

**实测（将同一套宿主谓词跑在改前/改后配置上，`verify-preload.js` 9a2）**：

```
搜 saz：改前 4 行 ["SAZ 抓包解析(自动标题行)", "saz", "SAZ", "saz 解析"]
              → 改后 1 行 ["SAZ 抓包解析→saz-view"]
改后搜「抓包」=1 行 / 首字母 zbjx=1 行 / 全拼 zhuabao=1 行
```

数与用户报的“4 个入口”完全对上 —— 成因不是宿主抽风，而是插件多写了 5 个同义词 + 宿主自动插了一行标题。

---

## 3. 核心架构决策（3 条路线对比）

| | A. **TypeScript/JS 重写解析引擎**（推荐） | B. PyInstaller 打包 `saz.exe` 随插件分发 | C. 调用用户本机 Python |
|---|---|---|---|
| 一键启动 / 全平台 | ✅ 纯 JS，Win/macOS/Linux 同一份代码 | ❌ 需按平台分别出可执行文件 | ❌ 依赖用户 Python + 5 个 pip 包 |
| 懒加载/流式改造 | ✅ 与 UI 同一进程，天然流式 | ⚠️ 需 IPC/子进程 + 临时文件，启动开销 ~1s 级 | ⚠️ 同 B |
| 审核合规 | ✅ 可读 JS | 🔴 极可能触碰"禁止自带 exe / 禁止混淆"红线 | 🔴 无法自包含 |
| 包体积 | ~2–4 MB（含 vendor 的 zip/zstd/beautify 源码） | +30–80 MB | 0 |
| 324MB 大样本 | ✅ 流式，内存恒定 | ⚠️ 沿用现有内存模型则同崩 | 同 B |
| 3.2.0 客户端实测 | 无前置 | 需杀软白名单 | 不可控 |

**✅ 已定：路线 A** —— 算法全部用 JS 重写，Python 侧只作为**行为基准（golden reference）**用于对比验证。理由：B/C 与 ZTools"自包含 + 源码可读 + 跨平台一键"的发布特性正面冲突，且原算法的内存模型（B4）本来就必须重构才敢上线。

**✅ 已定：Vue 3 + TS + Vite 完整 UI**（不选 Preload Only）。
理由：核心体验是"列表过滤 + 单条懒加载查看 + 批量导出进度"，而平台无 `setProgressBar`、无 tray，无 UI 时只能靠 `showNotification` 与 `onMainPush`，承载不了这个交互（且文档未说明 Preload-Only 如何展示结果）。

**✅ 已定：UI 内并存两种工作模式**（D2）
- **分析模式**（默认）：索引 → 过滤/分组/搜索 → 懒加载查看 → 按需导出；
- **导出模式**：进入即执行"全量落盘"，输出与原 `解析SAZ.py` 同构的目录树（见 5.4 命名与 5.7 双路径），即忠实复刻现有工作流。
  可在 `dbStorage` 中把导出模式设为默认，并在 UI 提供「记住此选择」开关；`files` 触发时按该配置直接落地对应模式。
- 两条路径共用同一索引与命名规则，仅"是否格式化写盘"不同（见 5.4 命名与 5.5 双路径）。

---

## 4. 插件功能定义

### 4.0 功能分层：按"AI 分析素材流水线"重排（v0.3）

v0.2 把所有功能平铺为 F1–F16，隐含"人是最终读者"。本版改为三层，**B 族才是本插件的第一目的所在**：

| 层 | 职责 | 优先级 | 包含功能 |
|---|---|---|---|
| **A 数据保真层** | 不丢字节地取到所有会话明文 + 分析用元特征 | **P0** | F1 F2 F3 F17 F18 F19 F20 **F26** |
| **B AI 分析包层** | 把 A 层数据组装成可控 token、可分卷、可机器取数的素材 | **P0（核心）** | F21 F22 F23 F24 F15 |
| **C 人用交互层** | 浏览、筛选、兼容既有工作流 | P1 | F4 F5 F6 F7 F8 F9 F10 F11 F13 F14 F16 |

### 4.1 功能清单

| ID | 功能 | 优先级 | 说明（v0.3 变更） |
|---|---|---|---|
| F1 | `.saz` 输入：粘贴触发 / 选文件 / 拖放 / 绝对路径 | P0 | 四通路互备 |
| F2 | **秒级索引**：只读请求行/头部建内存索引 | P0 | 3756 条约 1–3 s |
| F3 | **懒加载正文**：按需流式读取 + 解码 | P0 | 33.6MB 单条不卡死 |
| **F17** | **分析用元特征索引**：JSON key 集合、urlencoded/multipart 字段名、鉴权头有无、URL 模板归一（去 query 折叠同接口）、接口出现次数、body 大小 | **P0（新增）** | AI 选题与去重的地图；原算法完全没有 |
| **F18** | **隐私字段值不作抹除处理**：隐私字段完整保留，只打"类型标签"（auth/cookie/token/device/sign）供检索 | **P0（新增）** | 直接回应第一目的：隐私值是研究对象，不是噪声 |
| **F19** | **统一 KV 树**：JSON / urlencoded / multipart / query 都归一为 key-value 结构（multipart 拆分，文件部分只留元信息占位，字段值完整保留） | **P0（新增）** | 取代原算法把 multipart 整块塞 .txt 的做法 |
| **F20** | **protobuf wire 转储**：field number + wire type + 可读值（+hex 旁注） | **P1 新增** | 实测 x-protobuf 24 条，原算法落 .bin → 对 AI 完全黑盒 |
| **F26** | **WebSocket 帧日志解析**（`raw/<sid>_w.txt`）：按字节精度解出每帧的方向 / ID / BitFlags / DoneRead·BeginSend·DoneSend 时间 / 声明帧长 / 原始偏移，再按 RFC 6455 解帧（FIN、opcode、掩码、7/16/64 位长度）；文本帧去掩码直出 UTF-8，二进制帧保留完整字节供下游 protobuf 处理 | **P0（新增，修 B10）** | 实测 34 会话 / 1,984 帧 / 1,007KB；索引期只快扫，完整解帧 25ms |
| **F27** | **一键解析（不开界面直接落盘）**：`files(.saz)` 与路径 `regex` 各注册**两条候选**（`saz-quick` 带 `mainHide: true` / `saz-view` 开界面），用户粘贴或输入路径时自己选；`saz-quick` 对宿主的 `get-plugin-mode` 返 `'none'` → 走无界面调用 `call-plugin-method` 直接 `api.quickParse()`，**不派发 onPluginEnter、不展开视图**；完成后进**宿主通知 + 解析历史 + `diag.modeChannel` 留痕** | **P0（用户新增需求）** | 效果与 `解析SAZ.py` 同位同名（默认 `beautifyLevel: json`，对方环境装了 jsbeautifier）；不注册成 MCP 工具：给 AI 取数可以，替人写盘不行（D17）。关键词只绑 `saz-view` 且**只留 1 个（与 title 全等）**：宿主搜索忽略大小写、做双向包含与拼音，多列同义词只会多行（见 2.8） |
| **F28** | **流式/多帧正文拆帧**（✅ v0.5.6 已实现；v0.5.7 补上“内容优先于头”）：`core/stream.js` 按空行分事件、抽 `id/event/data/retry`（多行 `data` 按规范用 `\n` 拼接、`:` 心跳单独计数、字段后单空格不当内容），并**逐事件对 data 做 JSON 结构化**；顶层多值 JSON（值间必须纯空白）同路处理。**两条必要的修正通路**：按 event-stream 解不出任何带 data 的事件时回退多值（伪 SSE / ndjson）；非流式类型靠预门 + 硬判据做内容探测（错标 CT）。接入四处：detail(`withStream`) / 分析包 `66-stream.md` + 会话正文「事件流拆分」段 / MCP `saz_stream(sid,from,count)` / UI「事件流」页（v0.2.4 可点开单事件看全文） | **P1（新增，已落地）** | 实测 19 会话 / 5030 事件 / 5023 个 data 为合法 JSON，改后 **19/19 已拆开**（1.13）；`样本-18 sid75` 完整正文 **2587 事件**；伪 SSE 3 条与错标 1 条已改判，美化 passthrough **39 → 0**（1.14）。先修 B11 再拆帧的顺序已遵守 |
| **B11** | **`Transfer-Encoding: chunked` 的分块框架未剥**（✅ v0.5.6 已修）：归档存的是原始流字节，旧引擎只做 Content-Encoding 解压、没做 transfer-decoding → 正文混着形如「471 + CRLF + JSON」的长度行。现 `decode.dechunk()` 按字节逐块剥框（支持块扩展、trailer、残尾标 `partial`），**框架不合法则整块退还**；`decodeBody` 改为先解框再解压（顺序按 RFC 9112） | **P0 缺陷（已修）** | 全包 **245 条**带此头：改前未剥 36/36（其中 34 条标 json → 0 条可整块解析，字段视图全走 `parsed:false` 降级）+ **209 条因压缩流开头混入长度行而直接解压失败（正文整条不可用）**；改后未剥 0、解压失败 0（1.13） |
| **F21** | **分析包（analysis package）生成**：分层目录 + `manifest.json`（见 4.4） | **P0 核心（原 F12 由 P2 提升）** | 本插件真正产出物 |
| **F22** | **四档详细度 L0/L1/L2/L3 + token 预算**：实时显示"当前选取 ≈ N token"，超预算按优先级降级并输出被裁清单 | **P0 核心（新增）** | 解决 97 万 token 不可消费问题 |
| **F23** | **业务流程分组**：以 SessionTimers 为主轴，按时序聚合成"注册流程/登录流程/刷新链"，并标注**跨会话参数传递链**（A 响应的 token 出现在 B 请求） | **P0 核心（新增）** | 最难手工做、最易自动化的部分；直接对应你的样本命名习惯 |
| **F24** | **可编程取数**：条件对象（domains/urlRegex/method/status/contentType/bodyContains/hasAuth/sidRange/flow）驱动选取 | **P0 核心（新增）** | 让 AI/脚本能自主拿数据，而不靠鼠标 |
| F15 | `tools`/MCP 声明（`saz.parse` / `saz.query` / `saz.body`） | **P1（原 P2 → 提升）** | **与第一目的最直接对齐的能力**：AI 自己调用解析；受文档版本冲突限制，M0 必须实测 |
| F4 | 会话浏览器：列表 + 详情（请求/响应头体 + 元数据） | P1（原 P0） | 手段而非目的 |
| F5 | 视图过滤与搜索 | P1（原 P0） | **语义修正：过滤只作用于视图，不影响数据层与分析包完整性**（见 4.3） |
| F6 | 按域名分组视图 | P1 | 与 F23 共用同一套归一化 |
| F7 | 批量导出目录树（同构复刻原 Python） | P1（原 P0） | 降为**兼容层**：保留你的既有工作流，但不是核心产出 |
| F8 | 复制为 cURL / URL / JSON | P1 | 人用为主，价值低于结构化导出 |
| F9 | 单请求导出 | P1 | `showSaveDialog` |
| F10 | 关键值提取面板（auth/cookie/token/sign 一览 + 定位到会话） | **P0（提级）** | 它就是 F17/F18 的面板视图，属于 AI 素材链而非人用装饰 |
| F11 | `_m.xml` 元数据：时间线/耗时/证书错误 | **P0（提级）** | F23 流程分组的主轴数据 |
| F13 | HAR 1.2 导出 | P2 | 对 AI 不友好（无摘要、JSON 巨大量），仅生态互通用 |
| F14 | 最近解析历史 + 配置持久化 | P1 | 上限 20 条 |
| F16 | 模式切换：分析模式 / 导出模式（同构复刻） | P1 | 随 F7 降为兼容层入口 |
| F25 | 脱敏**副本**导出（可选开关，默认关，与原值并存不互斥） | P1（新增） | 见 D9 修正 |

### 4.2 主用户旅程（v0.3：以"交付 AI 可用素材"为主线）

```
粘贴 样本-03
  → 阶段① 索引（≤3s）：只读头部 → 会话表 + F17 元特征（key 集合/鉴权标记/urlTemplate/计数）
  → 概览屏：会话数 / 域名数 / 接口数 / B 档 JS 数 / 未解码计数 / 估算总 token（≈97万）
  → 选流：L0 摘要→AI 先读全局→告知要看哪几个域/流程→用条件对象（4.5）回选 selection
  → 阶段② 生成分析包：按档（默认 L2，每卷 ≤100K token）流式解码 + 写包 + manifest.json + trimLog
  → 把 00-OVERVIEW.md + 对应卷/manifest 交给 AI；需要追一个具体会话时按 bodyRef 取 L3 全量
  →（兼容旧习惯）导出模式 → 与原解析SAZ.py 同构的目录树，隐私值同样原样落盘
```

> 对比 v0.2 旅程的关键差异：不再以"人点开某条看正文"为终点，而是以"AI 拿到一份体积可控、可回溯的素材包"为终点；UI 点击只是生成条件的一种入口。

### 4.3 视图三档分类规则（✅ v0.3 语义修正：过滤只作用于视图，永不影响数据层与分析包完整性）

🔴 **铁律**：视图过滤集 ⊂ 数据集。任何过滤仅是"默认不显示"；分析包与导出默认走全集，除非用户显式带条件（见 4.5）。

v0.2 把会话二分为"接口/非接口"并把 JS/CSS/HTML归入非接口，**与第一目的相斜** —— 实测 JS 类响应 1,586 条 > JSON 1,305 条，而登录/注册流程的签名与加密逻辑就埋在这些 JS 里。本版改为三档：

| 档 | 定义 | 默认视图 | 在分析包中 |
|---|---|---|---|
| **A 接口** | 请求/响应含 `json` / `x-www-form-urlencoded` / `multipart` / `protobuf` / graphql；**含帧日志的 WebSocket 会话（本轮新增）** | 显示 | L1+ 完整包含 |
| **B 逻辑素材**（新增档） | `*javascript` / `text/html` / `text/css` / `xml` | **折叠**（一键展开） | **永不排除**；L2 可选正文，L1 只列文件+摘要 |
| **C 负载噪声** | `image/*` `video/*` `audio/*` `font/*` `wasm`、CONNECT、**无帧日志的** 101 握手、静态后缀、埋点域名 | 隐藏 | 默认只留元信息，正文入 `90-bodies/`，可一键全量包含 |

🔴 **本轮分类口径修正（v0.4）**：v0.3 把 CONNECT/101 一并归 C 档噪声。实测发现 101 升级会话的 `_w.txt` 里装着 1,984 帧业务数据——升级握手本身是噪声，但**会话不是**。新规则：只要存在帧日志且帧数 > 0，该会话升为 A 档（实现见 `core/types.js` 的 `classifySession`）。

域名/路径黑名单仍为正则列表且**预置为空**（你原脚本里的 `域名-05` 作为文档示例，不预置）。

### 4.4 分析包（analysis package）规格 —— 本插件的核心产出

```
<saz名>_分析包/
├── 00-OVERVIEW.md        # L0 总览（≈3–8K token）：域名清单+接口数、鉴权链摘要、
│                         #   关键/可疑字段统计、未解码计数、按类型的 token 占比
├── 01-domains/<host>.md  # L1 骨架（分域）：每接口 method + 归一 URL + 请求/响应 key 列表
│                         #   + 状态码分布 + 出现次数（隐私值**默认列出完整值**，可选项折叠为"仅字段名+长度"）
├── 02-flow/<flow>.md     # F23 流程视图：按时序排列的会话链 + 跨会话参数传递标注
├── 10-sessions/<sid>.md  # L2/L3 明细：请求头/请求体/响应头/响应体全量原文（隐私值完整保留）
├── 90-bodies/            # 大 body / 二进制 / 未解码原件，由 manifest 指向
└── manifest.json         # 机器可读索引：sid,url,method,status,type,urlTemplate,keys,
                          #   authFields[{name,kind,length}],bodyRef,decoded,bytes,estTokens,timers
```

**四档详细度**（用户选档，引擎按 token 预算自动降级）：

| 档 | 内容 | 目标 token | 用途 |
|---|---|---|---|
| **L0** | 仅 OVERVIEW | ≤ 8K | 先让 AI"读懂全局"再决定看哪 |
| **L1** | + 域名/接口骨架 + key 列表 | ≤ 40K | 协议结构梳理、接口清单 |
| **L2** | + 选定接口/流程的完整报文 | 每卷 ≤ 100K，自动分卷 | 单流程深挖（**默认档**） |
| **L3** | 全量（含 L2 未选中的所有会话） | 千万级，仅按需 | 等价并超越原脚本，必须分卷 + 清单 |

**超预算降级顺序**（每步均在 `manifest.trimLog` 留痕、可回溯，绝不静默丢数据）：
1. 剔掉 C 档（噪声）正文，仅留元信息与字节指针；
2. B 档（JS/CSS/HTML）正文折叠为"引用 + 摘要"；
3. 同 `urlTemplate` 的重复接口折叠为 1 条代表 + N 次出现计数；
4. 大 body 截断（标记截断点与原始长度）；
5. 命中黑名单的会话移出主包，单独放 `91-excluded/`。

> 关键：降级只作用于**呈现形态**；`10-sessions/` 与 `90-bodies/` 始终可按 L3 全量生成。隐私值在任何档位**默认原样列出**（第一目的：它们就是分析对象）；折叠为"仅字段名+长度"是一个**可选项**，用于把包压到更小 token 预算的场景。

### 4.5 可编程取数（F24）与三入口同构

条件对象（JSON Schema，可存 `filter.json` / 由 UI 生成 / 作为 MCP 入参）：

```json
{ "domains": ["域名-01"], "urlRegex": "^/v[0-9]+/", "methods": ["POST"],
  "status": [200], "hasAuth": true, "contentType": ["application/json"],
  "transferEncoding": ["chunked"], "chunkedOnly": true, "eventStreamOnly": false,
  "bodyContains": ["access_token"], "flow": "注册", "sidRange": [1200, 1800],
  "level": "L2", "targetTokens": 100000 }
```

传输层三个条件（v0.2.4 新增）只看索引期已有的响应头，**零正文 IO**；`chunkedOnly:false` / `eventStreamOnly:false` 是补集而不是“关掉”。它们的存在是为了堵一个实际缺口：事件流与 chunked 会话的归档级枚举此前只能读 `66-stream.md`，而 `saz_stream` / `saz_ws` 都必须先知道 sid（实测：`chunkedOnly` 命中 18 == `summary.transferChunked.responses` 18，正反相加等于总数 227）。

三个入口（UI 高级筛选 / 配置文件 / MCP 工具入参）产出**完全一致的 selection**（同一段条件 → 同一批会话），保证"人点的"和"AI 取的"可互相复现 —— 这是把插件接入 AI 工作流的关键。

---

## 5. 技术设计

### 5.1 模块划分

```
saz-parser/                     # 项目根（开发态，不整体提交）
├── plugin.json                 # 提交到 plugins/<id>/
├── public/logo.png
├── src/
│   ├── main.ts / App.vue       # Vue UI（Vite 编译进 dist，允许压缩）
│   └── preload/
│       ├── preload.ts          # tsc → CommonJS，**不压缩、不混淆**
│       └── core/               # 解析引擎（可读 JS，随包提交）
│           ├── zip-reader.js   # yauzl 封装：中央目录 + 单 entry 流式/局部读
│           ├── pairing.js      # raw/*_[c|s|req|resp|client|server] 配对 + SessionID 数值排序
│           ├── message.js      # \r\n\r\n 分割、请求行/状态行解析、头表
│           ├── decode.js       # gzip/deflate/deflate-raw/br/zstd + 未解码标记
│           ├── types.js        # Content-Type → (是否接口 | 扩展名白名单 | 美化器)
│           ├── beautify.js     # JSON / JS / CSS / HTML / XML
│           ├── safe-name.js    # 文件名安全化（修 B2/B7）
│           └── session-meta.js # _m.xml → 时间线/耗时/证书错误
├── vendor/                     # 第三方源码（**避开 node_modules 被 publish 忽略的问题**）
│   ├── yauzl/  ├── fzstd/  └── js-beautify/
└── dist/                       # 构建产物 = 插件应用
```

数据流：`preload 挂载 window.sazApi` → `UI 调用（异步 + 事件回调进度）` → 解析全在 preload 侧（Node 能力），UI 只负责渲染。

### 5.2 两阶段 + 懒加载的内存模型（核心设计）

| 阶段 | 读取量 | 常驻内存 | 触发 |
|---|---|---|---|
| ① 索引 | 每 entry 前 ≤256KB（找 `\r\n\r\n` 即止） | 3756 条索引 ≈ 3–8 MB | 进入插件自动 |
| ② 正文 | 单 entry 流式，解码后按需保留前 1MB 明文 | ≤ 单条 P95（94KB）×1 | 点击某条 |
| ③ 导出 | 逐条流式读→解码→写盘，不缓存 | 恒定（分块 64KB） | 用户显式触发 |

- 依赖 `yauzl`（基于 fd 随机读，天然支持"只读某 entry 的头部"），**不用 adm-zip/jszip**（全量入内存，360MB 场景必炸）。
- 超大 entry（33.6MB）：流式分块 + `bodyPreviewLimit` 截断渲染，正文完整内容仅"另存为"。

### 5.3 解码器与降级策略（v0.3 按实测重写）

```
zstd: zlib.zstdDecompressSync（本机 Electron 41 已确认可用）
      → 特性检测失败时：标记 DECODE_FAILED + 保留压缩字节 + 包内告警（不静默写乱码）
br  : zlib.brotliDecompressSync（同样已确认存在）      → 同上兜底
gzip/deflate: zlib，deflate 先试 inflate 再试 raw（同原算法） → 同上兜底
```

✅ **不再 vendor `fzstd`**（v0.2 为兼容旧 Electron 而准备）。收益：去掉一个大体量第三方源码，包体积与审核可读性风险均下降。
⚠️ 保留一个低成本兼容方案作为 **P2 可选**：若后续发现有用户客户端 < Electron 39（无 zstd），再按 `D5` 讨论是否引回纯 JS 库，而不是现在预置。
任何"未解码"必须在索引与分析包 `00-OVERVIEW.md` 里以计数与 sid 清单形式暴露（原算法只 print 到 stdout，落盘后无人知晓）。

### 5.4 文件名与路径规则（修 B1/B2/B7）—— 导出模式以此为唯一命名规范

- URL 归一：若 `url_path` 以 `scheme://` 开头 → 直接用该 URL，**不再拼 Host**（修 B1）；相对形态才拼 Host。
- 目录名：`{seq:03d}_{METHOD}_{host}_{path安全化}`（把 `//`→`_`，与你第二个脚本的 `https___` 解析习惯保持兼容）。
- 扩展名：仅白名单 + 长度 ≤ 8 且 `^\.[a-z0-9]+$`；`image/`、`image/x.fb.keyframes` 这类归入 `.bin`（修 B2）。
- Windows 保护：拒绝保留名 `CON/PRN/AUX/NUL/COM1-9/LPT1-8`、去尾部点与空格、全路径预算 ≤ 240 字符（超则截断路径并保留 `#SID` 后缀）。
- 输出目录冲突：默认 **追加 `_解析结果_01/_02`** 或弹出确认；**绝不静默 rmtree**（修 B3）。

### 5.5 双导出路径（✅ 已定：导出时由用户勾选）

引擎对每条会话保留两份可用形态，导出面板提供勾选项：

| 勾选项 | 写盘内容 | 依赖 |
|---|---|---|
| **美化正文**（同原算法） | `响应体.json` 等为格式化后的文本 | preload 侧 `vendor/js-beautify` **未压缩可读源码**（R4 审核风险已知） |
| **原文正文**（默认关美化时） | 解压后原样字节/文本，不做格式化 | 无第三方依赖 |
| 两者并出 | `响应体.json` + `响应体.raw.json` | 体积翻倍，仅按需 |

- 分析模式的 UI 渲染**始终**使用编译进 `dist` 的高亮/格式化组件，与导出路径解耦（不受 preload 禁混淆约束影响）。
- JSON 美化两边都用 `JSON.stringify(obj, null, 2)`（原生，零依赖）；仅 JS/CSS/HTML/XML 需要第三方库，故 `vendor` 只为"美化正文"这一条路径存在。
- 该设计让"默认导出"完全不引入大体量第三方源码，只有用户显式勾选美化才会触及。

### 5.6 并发模型

原算法用 `ProcessPoolExecutor(min(cpu,16))`。JS 侧改为：
- 阶段①索引：串行读中央目录（I/O 主导，随机读 SSD 已足够快）；
- 阶段③批量导出：`worker_threads` 池，默认 `min(max(2, cpu-1), 4)`，每条任务自带 fd 定位读，避免主线程 UI 卡顿；
- 无 worker 时退化为主线程分片（每 50 条 `setImmediate` 让出）保证 UI 可响应取消。

### 5.7 持久化 schema

```js
// ztools.dbStorage
"saz.config"   : { onlyApi:true, beautify:true, fileNameLang:'zh', binaryDump:false,
                   maxBodyExportMB:100, bodyPreviewKB:1024, workers:4,
                   domainBlacklist:[], domainWhitelist:[] }
"saz.recent"   : [ { sazPath, title, sessionCount, apiCount, mtime, lastExportDir } ]  // 上限 20，LRU
```

---

## 6. `plugin.json` 草案

> 下列为 **v0.2 时期的草案**（保留作决策轨迹）；**定稿形态见 6.1**，已安装件就是它。

```json
{
  "name": "saz-parser",
  "title": "SAZ 抓包解析",
  "description": "把 Fiddler .saz 抓包归档转换为可供 AI 分析的结构化素材：秒级索引全部会话，自动解压 gzip/br/zstd，按 L0–L3 四档生成体积可控（可设 token 预算、自动分卷）的分析包，含接口清单、字段结构与鉴权链摘要；同时保留与原解析脚本同构的目录树导出。隐私字段默认完整保留，本地离线处理不联网。",
  "version": "0.1.0",
  "author": "<你的 GitHub 名 / 昵称>",
  "platform": ["win32", "darwin", "linux"],
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "features": [
    {
      "code": "parse-saz",
      "explain": "解析 Fiddler .saz 抓包文件",
      "cmds": [
        { "type": "files", "label": "解析 SAZ 抓包", "fileType": "file",
          "extensions": ["saz"], "minLength": 1, "maxLength": 1 }
      ]
    },
    {
      "code": "parse-saz-path",
      "explain": "按绝对路径解析 .saz",
      "cmds": [
        { "type": "regex", "label": "解析该路径的 SAZ",
          "match": "/(?:^|\\s)[\"']?[A-Za-z]:[\\\\/][^\"'\\r\\n]*\\.saz[\"']?/i",
          "minLength": 6 }
      ]
    },
    {
      "code": "saz-home",
      "explain": "打开 SAZ 解析器 / 历史记录",
      "cmds": ["saz", "SAZ", "抓包", "saz 解析"]
    }
  ]
}
```

- `maxLength` 先限 1（多 SAZ 会话切换放 P2）。
- 保留 `parse-saz-path` 与 `saz-home` 作为 **F1 的 fallback 通路**，以防 `files` 触发时 `payload` 结构与文档不符（2.1 已知风险）。
- `author` 字段：已写入并被宿主正常加载（插件能装能跑 = 未知字段不致致命，见 2.4 与行 401 的字段清单），但**插件列表里到底怎么展示作者名仍未在真机确认**（不把它当已验证结论）。D11 已定取值 `乐幻`。
- `title` 候选（→ D11）：`SAZ 抓包解析`（中性、易过审）、`SAZ 抓包 AI 分析包`（定位更准、差异性强），建议前者作为 title、后者写进 description 首句。

### 6.1 实定形态（v0.2.4；以 `plugin/plugin.json` 与已安装件为准）

草案里的 `parse-saz` / `parse-saz-path` / `saz-home` 已不存在，收敛为两个 feature：

| code | 定位 | cmds | 无界面 |
|---|---|---|---|
| `saz-quick` | 一键解析，直接落盘不开界面 | `files(.saz)` 一条 + 路径 `regex` 一条 | `mainHide: true` + mode 答 `'none'` |
| `saz-view` | SAZ 分析（看界面） | `files(.saz)` 一条 + 路径 `regex` 一条 + **1 个关键词** | 恒答 `'main'` |

两者 `files` 的 `maxLength` 仍为 1（多归档切换放 P2）；路径 `regex` 同时支持盘符绝对路径、UNC 与 Unix 路径，输入含引号/前后空白也能拾回；**扩展名写成 `[Ss][Aa][Zz]`**（防宿主剥 flags，见 2.8 行 5）。

**关键词只有 1 个，且取值与 `title` 全等（`SAZ 抓包解析`）**：① 宿主把每条关键词做成一行独立结果，堆同义词只会多行；② 搜索忽略大小写且做双向包含 + 拼音，所以一个词已覆盖 `saz`/`SAZ`/`抓包`/`解析`/`zbjx`；③ 与 title 全等还能**抑制宿主自动插入的“插件标题行”**。实测：搜 `saz` 从 **4 行 → 1 行**（见 2.8）。其他叫法请在宿主「设置 → 所有指令 → 自定义别名」里加。

**v0.2.3 相比 v0.2.2 的对外可见增量**（不改交互形态，只加取数口与产出文件）：
- MCP 工具 4 → **5**：新增 `saz_stream(sid, from, count, limitBytes)`；`saz_body` 的返回值里多了 `response.transferEncoding` 与 `decode.response.dechunk{applied,frames,overheadBytes,partial}`；
- 分析包新增 **`66-stream.md`**（按响应头列出事件流会话与 chunked 会话清单），会话正文文件新增「事件流拆分」段与「传输解码（已剥 N 块）」说明行；
- 索引 `summary` 新增 `transferChunked{responses,requests,responseSids}` 与 `stream{eventStreamResponses}`；会话行新增 `req/respTransferEncoding`；UI 顶栏新增两个 chip，详情新增「事件流」页。

**v0.2.4 相比 v0.2.3 的对外可见增量**（工具数不变，只加条件与行为修正）：
- `saz_query` 的条件对象新增 **`transferEncoding[]` / `chunkedOnly` / `eventStreamOnly`**（plugin.json 里的描述已写明枚举用法）；未新增工具，仍 **5 个**；
- 引擎行为：**内容优先于头**——伪 SSE（无 `data:`）回退成多值拆分（结果带 `fellBackFrom:'event-stream'`），错标 CT 的真多值按内容命中（结果带 `detectedBy:'content'`），两者都在 `note` 里写明改判理由，不静默；
- 分析包正文的「顶层多份 JSON 值拆分」段增加改判说明行；
- 导出面板新增“**正文事件展开上限**”输入框（`maxStreamEventsInFile`）；五个拆帧参数全部成为正式选项（见第 8 节）；
- UI「事件流」页：一行一点展开该事件完整 `data`（不二次请求），`dataTruncated` 时明确提示不是全文。

### 6.2 可选 `tools` 声明（F15；实定 5 个，下面为早期草图，**以 `plugin/plugin.json` 为准**）

若 github.io 版本的 `tools` 字段成立，则 AI 可直接调解析，比人工点击更贴合第一目的：

```json
"tools": {
  "saz_parse":  { "description": "索引指定路径的 .saz，返回会话清单与元特征",
                  "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } },
                                   "required": ["path"] } },
  "saz_query":  { "description": "按条件对象选取会话（domains/urlRegex/method/hasAuth/bodyContains…）",
                  "inputSchema": { "type": "object", "properties": { "filter": { "type": "object" },
                                                                     "level": { "type": "string" } } } },
  "saz_body":   { "description": "取指定 sid 的已解码请求/响应正文（完整保留，不脱敏）",
                  "inputSchema": { "type": "object", "properties": { "sid": { "type": "number" },
                                                                     "part": { "type": "string" } } } }
}
```

对应 preload 侧 `ztools.registerTool("saz_query", handler)`。⚠️ `ohmyztools.cc` 的 API 页无此能力，**M0 必须实测后再决定是否保留该字段**（不支持则退回条件对象文件 + UI 入口，功能不打折）。

---

## 7. 验收标准（v0.3：从"与原脚本一致"改为"AI 能用好"）

### 7.1 主验收：AI 消费效果（新增，取代 v0.2 的金标准地位）

以固定任务做对照组实验（同一份 SAZ、同一个分析任务，不给人工提示）：

| 对照组 | 输入形态 | 度量 |
|---|---|---|
| 基线 | 原解析SAZ.py 全量目录（≈97 万 token） | 能否完成任务、token 消耗、是否遗漏关键接口 |
| 实验组 | 插件分析包 L0+L1+选定 L2 | 同上 |

定量指标：
1. **关键接口召回率**：人工预先标注 5 个"必须找到的接口"（如登录、token 获取、签名生成），包内必须可直接定位；
2. **token 效率**：完成同一分析任务的总 token 消耗必须显著低于基线（目标 ≤ 基线的 1/5）；
3. **可回溯性**：任何被折叠/截断的内容均能从 `manifest.trimLog` 定位到原始 `bodyRef`；
4. **保真度**：脱敏开关关闭时，`Cookie` / `Authorization` / token 字段值与解码后明文**逐字节一致**（回归测试必须断言这一点，防止未来误加抹除）。

### 7.2 工程验收（保留）

1. **目录树对拍**：同一 SAZ 分别用 `解析SAZ.py` 与插件导出模式，做结构化 diff。预期"有意不一致"白名单：B1(CONNECT 命名)、B2(扩展名)、B7(保留名/长度)、B3(不覆盖同名目录)。白名单外的内容差异一律视为 bug。
2. **解码正确性**：gzip/br/zstd 各取样本条目，比对 Python 明文与 JS 明文的字节级一致性（尤其 zlib 对无尾 deflate 的 raw 回退路径）。
3. **压力基准**：`样本-01`（324MB / 3756 条），指标见第 8 节。

### 7.3 发布合规约束（与插件功能无关，不得混入功能设计）

以下仅为**仓库/PR 层面**的要求（PR 自检清单第 2 项），**不构成对插件解析/导出行为的任何限制**：
- 不将任何真实 `.saz` 样本或其解析结果提交进仓库；
- 演示截图 / GIF 使用 11KB / 136KB 小样本，并在截图阶段目视遮蔽长 token 串；
- 仓库内不内置真实 token/cookie。
- **发布树本身也得干净（v0.5.8 补强）**：判据只留一份（`tools/scan-doc-sensitive.js` 的 `RULES` + `BUNDLE`），`package-zip.js`（扫 zip 条目）与 `make-publish-tree.js`（扫发布树）都 require 它，避免"文档扫过、包没扫过"两套口径。文档判据本轮加严四类：业务名单独一类（`业务-NN` / 协议指纹 `协议-NN`）、归档名字符集排除 `:;,=`（否则压缩后的 JS `Re.bus=t.saz,null` 会误报）、URL 主机统一剥 `http(s)://` 前缀（否则 `https://host` 这类占位进不了豁免）、`Users\<user>` 占位豁免。**双向验证**：原稿命中 30 类、脱敏版 0 残留、发布树 30 个文本文件 0 命中。
- **演示素材由脚本产出（v0.5.8）**：`tools/capture-ui.js` 用本机 Chrome headless + CDP 只截 `npm run dev` 的假数据界面，并断言四项（含 DEV 角标 / 域名是 example.com / 不含业务名 / 不含本机绝对路径）；不再手工截真实归档。
- **发布后对拍（v0.5.8）**：`tools/verify-publish-remote.js` 用 git blob SHA 逐项比对公开仓库 `plugins/<name>/` 与本地发布树（36/36 全等、远端无多余文件），并断言公开提交的两个身份都不含私人邮箱。
- **发布产物自身也得干净（v0.2.4 新增机器拦截）**：`tools/package-zip.js` 逐条目扫包内文本文件（跳过 logo 等二进制），拦三类：真实归档/样本名、本机绝对路径、`Cookie/Authorization` 后跟 ≥20 位 base64 安全字符的真值形态。背景：实测扫出 **8 处混在注释里的真实样本名与本机路径**（分布在 6 个 preload 文件），已全部改为中性写法并把取证留在本文档（不随包发布）；首版判据用 `\S{12,}` 会把压缩后的 JS `hasCookie:!1` 误判成凭证，已收紧。此自检在 `npm run build` / `npm run package` 链路里，**红则出不了包**；扫当前产物结果为 27 个文本条目均干净。

> v0.2 第 7.4 条将"脱敏"写成了验证策略的一部分，容易被误读成"默认脱敏输出"，本版已按性质拆分。插件对用户使用时无任何默认脱敏行为。

---

## 8. 参数默认值与验收指标（请确认）

| 参数 | 建议默认值 | 依据 |
|---|---|---|
| 头部读取上限 | 256 KB | 实测中位 3.6KB 响应，头部远小于此；防超大 Cookie 头 |
| **分析包默认详细度** | **L2** | L0/L1 不足以定位具体报文，L3 对上下文不友好（1.6） |
| **单卷 token 预算** | **100,000** | 兼容主流 128K 窗口并留余量给提示与回答 |
| **隐私字段处理** | **完整保留**（默认）；脱敏仅生成副本 | 第一目的基线 1；隐私值是分析对象 |
| **L0/L1 隐私值呈现** | **默认列出完整值**；可选开关折叠为"仅字段名+长度" | 隐私值是分析对象；折叠仅用于压 token（✅ 用户已定） |
| C 档（噪声）正文是否落盘 | **分析包**：否（仅元信息 + `bodyRef` 指针），可一键切全量。**同构目录树/一键解析**：是（连图/字体/protobuf 也写文件） | “二进制”指 `image/video/font/wasm/protobuf/octet-stream` 这类不可读正文（实测约 380+ 条，仅 44–88 KB/样本）：剔它不为省 token，而是避开无意义文件；但兼容层/一键解析要复刻 py 行为，必须全落盘 |
| **一键解析默认美化级别** | **json**（可选 none / all） | 原 Python 环境装了 jsbeautifier 会重排 JSON，“效果与 py 类似”需带这个默认 |
| **降级留痕（trimLog）** | **强制开启，不可关** | 保证任何裁剪可回溯，避免"静默丢数据" |
| 正文预览截断 | 1 MB | 覆盖 P95=94KB 的 ~99% 场景 |
| **单会话正文里逐条展开的事件/值数** | **200**（`maxStreamEventsInFile`，v0.2.4 入表并可在导出面板调） | 实测最大事件流 2587 条（`样本-18 sid75`），全展开会吃掉整个正文卷预算；**计数仍是全量，只是不逐条展开** |
| 单会话正文里展开的 WS 帧数 | 120（`maxWsFramesInFile`） | 同上，F26 口径 |
| 拆帧上限 | 5000 事件 / 2000 份顶层值（`streamMaxEvents` / `streamMaxValues`） | 超出仍继续统计全量并标 `truncated`，不是静默截断 |
| 单事件 `data` 字符上限 | 200,000（`streamMaxDataChars`） | 超出截断并在条目上标 `dataTruncated`（UI 也会提示“这里给的不是全文”） |
| 单条导出体积上限 | 100 MB | 大于则跳过并在 manifest 中标记 |
| 导出 worker 数 | `min(max(2,cpu-1),4)` | 原算法 16 进程是为绕 GIL，JS 侧要保 UI 响应 |
| **输出目录默认值** | **归档（.saz）所在目录**下的子目录：分析包 `<名>_分析包`、兼容层 `<名>_解析结果`（✅ 用户已定） | 与 `解析SAZ.py:438 output_dir = os.path.join(saz_dir, f"{saz_name}_解析结果")` 同位置，旧工作流零切换成本；是**建子目录**而非直接平铺到归档旁（否则一次导出倒上百个会话目录）。默认值**算而不建**；用户手改后不被模式切换覆盖；相对路径直接拒（同 `open()` 口径） |
| 历史条目上限 | 20（LRU） | 与 dbStorage 体量匹配 |
| 全量（L3/导出模式）目标耗时 | 3756 条 ≤ 180 s，峰值 RSS ≤ 300 MB | 对标 Python 多进程 + 修正 B4 内存模型 |
| 索引目标耗时 | ≤ 3 s（首个可交互） | 支撑"秒级"定位 |
| **分析包生成耗时（L2）** | ≤ 30 s | 只解选定会话，应远快于全量 |
| 大文件下限能力 | 单条 33.6MB 可打开不卡死 | 实测最大值 |

---

## 9. 风险清单（P0 必须先实测的排第一）

| # | 风险 | 处置 |
|---|---|---|
| R1 | ~~内嵌 Node 无 zstd~~ | ✅ **已解除**：实测本机 ZTools 3.2.0 = **Electron 41.4.0 / Chromium 146 / ABI 145**，主二进制含 `zstdDecompressSync`+`brotliDecompressSync`。仅保留运行时特性检测（其他用户可能旧版） |
| R2 | ~~`files` 触发时 `payload` 结构未定义~~ | ✅ **已确证**（读 app.asar 源码，见 1.10）：`payload` 是数组，项为 `{isFile,isDirectory,name,path}`，**`path` 就是绝对路径**；`getLastCopiedContent()` 返回 `{type:'file', data:[...]}`（不是 `files`）→ 主路径直接可用，剪贴板回查降为兜底 |
| R3 | **publish 忽略 `node_modules`** 与 "Node 依赖须置于 preload 同级"的冲突 | 第三方源码放 `vendor/`（避开 `node_modules` 名）并随包提交；已确证插件实以 asar 分发（`~\.ztools\plugins\*.asar`）且官方插件用 `unpack` 字段带原生文件 → 先试发布验证文件集合 |
| R4 | preload 及第三方源码**禁止混淆** → 审核可读性 | `js-beautify` 源码较大（未压缩 ~1MB）；备选：美化延迟到 UI 渲染（见 D5） |
| R5 | 发布审核要求 PR 内无敏感信息，易被误读为"插件应默认脱敏" | 🔴 已澄清（7.3）：合规仅约束仓库与演示素材；**插件功能默认完整保留隐私值**，脱敏仅为可选副本。第 7.1.4 条回归断言防止后续误加抹除 |
| R6 | 无 `setProgressBar` API | 进度全部 UI 自绘（有 UI 即无障碍） |
| R7 | logo 像素规格、包体积上限 文档未量化；是否禁自带二进制 | 🟢 后半部分已解：官方 `everything` 插件用 `"unpack": "@(Everything.*|*.exe)"` 带可执行文件→**正规通路存在**；尺寸/体积上限仍需参照已合并插件 + 试发布 |
| R8 | ~~github.io 与 ohmyztools.cc 文档版本不一致（`tools`/MCP）~~ | ✅ **已定：`tools`/MCP 真实存在**（主进程 `PluginToolsAPI` 源码确证，见 2.5）。残留项：插件侧 `registerTool` 注入脚本不在 `out/preload/index.js`，需 M0 确认函数签名与 `inputSchema` 校验严格度 |
| R9 | 分析包"生成了但 AI 仍用不好"（形式合规、实际无效） | 靠 7.1 对照实验量化；`01-domains` / `02-flow` 的 Markdown 版式预留迭代空间，`manifest.json` 字段集合保持向后兼容 |
| R10 | 自动流程划分（F23）误合流程，导致关键接口被归错卷 | 流程分组结果**可人工改标**，且 L3/目录树仍按会话原始粒度输出，不依赖分组正确性 |

---

## 10. 里程碑

1. **M0 运行时补测（范围已因源码实测大幅缩小；代码侧已做到“不需要猜形状”）**：本地已确认可直接加载插件 —— 数据目录 `~\.ztools`，插件安装于 `~\.ztools\plugins\*.asar`，主进程支持选择 `plugin.json` 导入开发中的插件（源码实证：`basename !== "plugin.json"` 校验）。**仍需在真实窗口内确认三项，且都已内置取数口子（诊断面板可直接复制快照）**：
   ① `files` 触发时 `onPluginEnter.payload` 真实结构 → 已用有界递归 `collectSazPaths()` 先保证“不管什么形状都能取到路径”，并把原始 payload 逐条记进 `diag.hostEvents`；
   ② `ztools.registerTool` 签名与 `__invokeRegisteredTool` 是否存在 → 两条通路都写了，尝试结果与错误全部记进 `diag.toolRegistration`，并在纯 Node 里用假 host 全分支验过（1.9）；
   ③ `ztools publish` 实际提交的文件集合 → **已确证（v0.5.8）**：提交集合 = 发布树全量（本插件 36 文件），CLI 不看 `.gitignore`（见 2.4.1）；`tools/make-publish-tree.js` 打印清单与体积，`tools/verify-publish-remote.js` 与远端逐 blob 对拍。
2. **M1 A 层 · 数据保真引擎** ✅ **已完成（v0.4）**：`core/` 十一模块（zip 自解析、报文、解码、分类、隐私标签、字段、命名、配对、元数据、**帧日志 ws-log**、indexer 装配）已在两个真实样本上跑通 31 项断言（见 1.8）。与 Python 产物的 7.2 目录树对拍已于 v0.5 跑完（`tools/verify-legacy.js` 18/18，差异全部可归因 + 绝对不变量成立）。
3. **M2 B 层 · 分析包生成** ✅ **已完成（v0.5）**：F21 包结构 + F22 四档与 token 预算 + F23 流程分组与值账本 + F24 条件取数 + `manifest.json`/`trimLog`；**F26 的 WebSocket 帧已进 L1+（不当噪声剔除）**；43/43 断言含 324MB 施压与降级留痕（见 1.9）；F23 值账本的 cookie / 响应头链已在 50 样本上全量实测（见 1.11）。7.1 对照实验按 D17 交给你手工在外部 AI 里跑。
4. **M3 C 层 · UI 与人用能力** ✅ **已完成（v0.5）**：会话列表（分页）/ 三档过滤 / 详情懒加载（请求、响应、WS 帧、元数据、原始字节）/ 分组与端点 / 关键值看板 / 流程与传递链 / 诊断面板 / 导出面板（双模式 + 估算 + 进度事件）/ 历史（F4–F11、F14、F16、F25）。
5. **M4 工具接入** ✅ **已完成（v0.5，D18=b；v0.5.6 增至 5 个）**：`plugin.json.tools` 声明 5 个（`saz_parse` / `saz_query` / `saz_body` / `saz_ws` / `saz_stream`），preload 侧双通路注册 + 统一 `invokeTool` 入口 + 调用留痕；**F20 protobuf 转储未做**（子协议 协议-01 已记录在会话字段里，无 .proto 无法解码，列为 M6）。
6. **M5 发布** ✅ **已完成（v0.5.8）**：中心仓库 **PR #638**（标题 `Add plugin SAZ 抓包解析 v0.2.4`，fork `账号-01/ZTools-plugins` 分支 `plugin/saz-parser`），先 Draft、补完截图与自检后切 Ready for review。原先四项未闭环的处置：① 仓库已 `git init` 并补齐 `CHANGELOG.md`/`README.md`/`LICENSE`（README 按用户选定口径写**能力导向**：只声称能力与离线指标，不声称 AI 消费效果）；② 敏感注释 8 处已清，且本轮发布闸门又抓到并修掉**两处新泄露**（随包源码里的 WebSocket 子协议名指纹、脱敏文档里带空格的 `业务-01 注册` / `业务-02 登录` 写法），判据同步加严；③ `tools` 已被宿主注册（用户确认），PR 里据实写 5 个 MCP 工具；④ 7.1 对照实验仍按 D17 由用户手工，文案未做任何 AI 效果声明。发布产物：36 文件、与本地逐 blob 一致、公开提交身份为 noreply；CI 的 `Build PR Plugin Package` 状态 `action_required`（等维护者批准）。
7. **M6 增量**：HAR(F13)、多 SAZ、L3 全量分卷优化。
8. **文档进公开仓库** ✅ **已完成（v0.5.8）**：双文档制落地——原稿留在工作区并被 `.gitignore` 排除（真实归档名 / sid / 域名 / 本机路径是复现证据，不能丢），公开的是 `docs/SAZ解析插件-设计与开发文档.md`（由 `tools/desensitize-doc.js` 生成，别名 `样本-NN` / `域名-NN` / `业务-NN` / `协议-NN`，**数字与 sid 全部原样保留**，映射表条目 30）。**映射表 `.desens-map.json` 绝不入库**（公开它等于没脱敏）。该脱敏版已随发布树进 PR #638。

---

## 11. 决策结论与遗留确认项

图例：✅ 已拍板 · ◑ 已按推荐值写入正文（可推翻） · ⏳ 阻塞项，需你回复

| ID | 决策 | 结论 | 影响面 |
|---|---|---|---|
| **D1** | 技术路线 A/B/C（第 3 节） | ✅ **已定：A —— JS 重写引擎**，Python 仅作对拍基准 | 全局；避开自带 exe/混淆红线 |
| **D2** | 插件定位：①交互式分析器 ②忠实复刻原脚本 | ✅ **已定：两者都要** —— 分析模式为默认，导出模式同构复刻（F16，见第 3 节） | 决定双模式骨架 |
| **D3** | UI 形态 | ✅ **已定（随 D2 必然）：Vue3 + Vite 完整 UI** | 双模式与懒加载均需 UI 承载 |
| **D4** | 美化时机：a) 导出写盘美化 b) 仅 UI 美化 c) 导出时可选 | ✅ **已定：c —— 导出时由用户勾选**，引擎双路径实现（见 5.5）；UI 渲染始终用编译产物 | 默认导出不引入大体量第三方源码 |
| **D5** | zstd 处理 | ✅ **已定（实测推翻旧假设）**：直接用 `zlib.zstdDecompressSync`，**不预置 fzstd**；仅在特性检测失败时显式告警并保留压缩字节。旧客户端兼容方案（< Electron 39）列为 P2 再讨论 | 1,100 条响应可读；包体与审核风险下降 |
| **D6** | 默认过滤与分类 | ✅ **v0.3 修正**：由二分"接口/非接口"改为**三档**（A 接口 / **B 逻辑素材（JS·HTML·CSS）** / C 噪声）；**B 档永不从分析包排除**（实测 JS 1,586 > JSON 1,305，签名与加密逻辑常在 JS 内）；过滤只作用于视图（4.3 铁律）；域名黑名单仍预置为空 | 纠正 v0.2 偏离第一目的的默认隐藏 |
| **D7** | 导出目录结构是否与原 Python 完全同名同构 | ◑ **v0.3 定位下调**：保留为**兼容层**（F7/F16，P1），不再作为设计基线 —— 实测 97 万 token 的平铺目录对 AI 是负优化（1.6） | 你的旧工作流不断档 |
| **D8** | 首版功能边界 | ✅ 仍为**全量**，但 v0.3 重排了内涵：首版 = **A 层（数据保真）+ B 层（分析包，核心）+ C 层（人用交互）**；开发顺序改为 **A→B→C**（先保真、再成包、最后做界面） | 避免"UI 完工但分析包没影"的倒置 |
| **D9** | 隐私/敏感字段处理 | ✅ **已定（你的纠偏）：默认完整保留，绝不写死擦除**。脱敏仅作为**可选副本开关（默认关）**：开启时额外生成 `*-masked` 副本供分享，原值文件不受影响（F25）。任何档位/过滤均不得抹除数据层字节（4.3 铁律）；7.1.4 加回归断言 | 第一目的基线 1；隐私值是研究对象而非噪声 |
| **D10** | 多 SAZ 支持（一次粘贴多个 / 会话切换） | ◑ 首版 `maxLength:1`，转 P2 开放 | 复杂度 |
| **D13** | 分析包默认档位与预算 | ◑ 按推荐：**L2 + 每卷 100,000 token**（自动分卷） | 直接决定"能不能一次丢给 AI 就用" |
| **D14** | L0/L1 是否列隐私值 | ✅ **已定（你的指令）：默认列出完整隐私值**；同时提供选项 `valuesInSummary: full \| names-only \| masked`，后两档才折叠/打码 | 摘要层体积与可定位性由用户选 |
| **D15** | 跨会话参数传递链（F23）首版范围 | ◑ 按推荐：**首版只做简化版** —— 仅跟踪 `Authorization` / `Set-Cookie` / JSON key 名含 `token\|auth\|session\|nonce` 的值流动 | 误报可控，先验证价值 |
| **D16** | 若客户端不支持 `tools`/MCP | ◑ 按推荐：退回**条件对象文件 + UI 入口**（4.5），AI 通过读文件/目录取数；F15 降为增强项 | 不影响第一目的达成 |
| **D17** | 7.1 对照实验（喂 AI 验证分析包效果） | ✅ **已定：不在插件内做，也不由本插件发起模型调用**。验证改为你手工把分析包丢给自己常用的 AI；开发阶段我只做**离线指标**（token 统计、关键接口召回、字节保真断言） | 插件零模型依赖；验收质量靠离线指标 + 你人工反馈 |
| **D18** | 是否纳入 `tools`/MCP 声明（F15） | ✅ **已定：b —— 首版就纳入 MCP tools**。实现为 5 个工具：`saz_parse`（索引+概览，默认只返 200 行）、`saz_query`（F24 条件取数）、`saz_body`（正文，隐私值原样）、`saz_ws`（WebSocket 帧）、`saz_stream`（事件流 / 多帧正文逐条，F28，v0.5.6 新增）。均为“给数据”，插件自身不调任何模型（D17） | 已实现并在纯 Node 里验证派发与错误路径（1.9）；工具数断言已改为与 plugin.json 动态比对 |
| **D11** | 元信息：插件 `name`（建议 `saz-parser`）、`title`、`author` 显示名、起始 `version`、你的 **GitHub 账号是否已具备**（publish 需 Device Flow OAuth + fork 仓库权限） | ✅ **已定**：`author = 乐幻`（已写入 plugin.json）；GitHub **已登录 `gh` CLI** → 发布可用 `gh auth token` / `gh repo` 通路，不再依赖 Device Flow 手工确认；`name=saz-parser`、`version=0.2.4`（v0.5.4 交互定稿 + Cookie 链修复，v0.5.5 关键词收敛 + regex flags 修正，v0.5.6 chunked 解框 + 流式拆帧 + 第 5 个工具，v0.5.7 内容优先于头 + chunked 产物对拍） | 发布链路已跑通：PR #638（v0.5.8）。私人邮箱不进公开仓库，靠临时 `GIT_CONFIG_GLOBAL` 副本换身份 |
| **D19** | 一键解析的产物口径与触发形态（F27） | ✅ **已定**：产**同构目录树**而非分析包；落点 `<归档名>_解析结果`（归档旁）；`beautifyLevel=json`；全量会话含二进制；结果进宿主通知 + 解析历史 + 诊断留痕。**形态 = 用户口径（推翻早期“方案 B 唯一指令”）**：`files(.saz)` 与路径 `regex` 各给**两条候选**（`saz-quick` 一键落盘 / `saz-view` 开界面），关键词只绑 `saz-view`；`saz-quick` 配 `mainHide: true` + `get-plugin-mode` 返 `'none'`（真无界面，见 2.7），`saz-view` 恒答 `'main'`；**`quickMode` 开关已删除**（设置项不得劫持 mode）；**关键词 6→1（与 title 全等，抑制宿主自动标题行），实测搜 `saz` 由 4 行→ 1 行**（见 2.8）。判定来源三记：`headless / mode-query / code` | 已实现（203/203 全绿，含控制变量对照与宿主谓词复刻）；已自动部署到本机 **v0.2.3** |
| **D20** | 流式/多帧正文的结构化（由 1.12 实测新开的两个口） | ✅ **已定（用户一句话拍板：①+②+③ 全做）并已实施**：① `dechunk()` transfer-decoding（先解框再解压，框架不合法整块退还）；② `core/stream.js` 拆帧器 + `66-stream.md` + 正文事件段 + `saz_stream` 工具 + UI 事件流页；③ beautify 支持顶层多值与事件流（仅兼容层） | **实测对拍见 1.13**：未剥框 36→0、解压失败 209→0、伪多帧 20→4、事件 5030 全部结构化；已部署 **v0.2.3**；本轮遗留的 A1–A7 已在 **1.14** 补完（v0.2.4） |
| **D21** | 拆帧与美化的分派原则：按头还是按内容？（由 1.14 实测新开） | ✅ **已定并实施：内容优先于头，但必须过硬判据**。两处旧行为都是“看头下结论”：`core/stream` 闸门只对 event-stream/jsonish 动手，`beautify()` 对非覆盖类型直接 passthrough。现三条入口：头是 event-stream / 字段层整块解不开 / 首非空白字符为 `{` 或 `[` 且“值间纯空白且无残留”全部通过。预门宽度由**成本实测决定**（放宽到任意值开头：6271 次扫描 vs 收益 0 条） | 命中：伪 SSE 3 条 + 错标 1 条；假阳性 0（候选 3125）；美化 passthrough **39→0**；新增耗时 20.9ms/7785 条会话 |
| **D12** | 第 8 节参数默认值是否有要改的（尤其"二进制是否落盘 = 否"与"正文预览 1MB"） | ◑ 部分已定：**输出目录默认 = 归档所在目录**（本轮用户指令，已实现+实测）；其余 ⏳ 待确认，无异议则按第 8 节默认值执行 | 直接决定大样本体验 |

---

### 下一步

定位已回到正轨：**先做到数据不丢字节且带分析元特征（A 层），再产出体积可控的分析包（B 层），界面与兼容导出（C 层）随后**。

本版新增两项硬约束（你的指令）：
1. **插件不调用任何模型**（不用 `ztools.ai`/`allAiModels`），只做解析算法；验收改用离线指标 + 你人工反馈（D17）。
2. **隐私值默认列出**，折叠/脱敏均作为选项（D14/D9）。

M5 已发完（PR #638 等维护者审核并批准 workflow）。仍需你定的只剩 **D12**（第 8 节其余参数）与 1.11 分诊里的 `maxTrackedValues` 凭证值加权一项；D11 已定并随发布生效。

开发可直接启动：M0 剩余实测已缩到三项（见第 10 节），且本机已具备全部验证条件：`<ZTools 安装目录>\ZTools.exe`（Electron 41.4.0）运行中、数据目录 `C:\Users\<user>\.ztools`、插件导入目录 `~\.ztools\plugins`、开发日志 `~\.ztools\logs\main.log`。

