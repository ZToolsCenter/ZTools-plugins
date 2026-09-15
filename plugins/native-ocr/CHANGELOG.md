# 更新日志

Native OCR 从官方 `wechat-ocr` 插件 fork 而来，作者署名 Samson。以下版本历史已按里程碑整合。

## 1.0.0 - 2026-09-15

首个正式版：自 v0.6.13（当前市场版本）以来的全部更新，按主题整合如下（过程性迭代与「新增后被更优方案取代」的中间态不再赘述，仅记录最终形态）。

### 引擎与核心能力

- **公式识别引擎（LaTeX OCR）**：基于 RapidAI/RapidLaTeXOCR（MIT）4 个独立 ONNX 模型（image_resizer / encoder / decoder / tokenizer，约 171MB 按需下载），忠实还原 Python 推理管线，零 Python 依赖。KaTeX 离线渲染预览（所见即所得），非法 LaTeX 自动容错修复（仅预览、不回写源码），行内/块级/原生三种复制格式，TEX/MD 文件导出。
- **图文混排引擎**：MFD 公式检测模型（pix2text-mfd-1.5，MIT，约 76.6MB 按需下载）定位公式区域 → 裁切识别 → 与文本 OCR 行按阅读顺序合并，输出真正交错的 Markdown / 结构化 segments。macOS Vision 逐字符框支撑精确的「文本/公式」交错切分；缺字符框时安全降级（遮罩公式区域后 OCR）。导出 Markdown / 自包含 HTML（公式 MathML 离线可看）/ 纯文本 / 带标注图，多格式复制（纯文本 / Markdown / LaTeX / 富文本 MathML）。
- **一图多公式**：「公式识别」页签一次检测并逐框识别图中全部公式，分行展示、逐条校对；批量识别同样支持公式 / 混排引擎。

### 识别质量

- **公式识别两大根因修复**：大图（宽 > 672px）降采样无抗锯齿导致的系统性失准（PIL 兼容抗锯齿重实现，MAE 4.89 → 0.18）；「字迹一大就失真」的 resizer 自洽错误驻点（多候选宽度 + 解码置信度择优 + 确定性 argmax 解码，同图两次识别结果不再漂移）。
- **混排公式重复输出根因修复**：MFD 框边缘字符外扩归属、切分失败时按公式类型分档丢弃重叠文本行、前端坐标换算类型错配（文本行框静默退化为零框）的根因修复——公式不再以文字重复出现一遍。
- **MFD 误检治理**：定量诊断确定检测灵敏度（真公式 score 下界 0.711 与误检 ~0.50 之间的空档），分层 tiny-text 过滤（剥离装饰命令后纯 1–2 字母/数字判为正文，行内/独立分档），混排模式下框内含 ≥2 个 CJK 字符的正文误检框自动剔除。
- **格式兼容**：WebP / BMP / GIF 等 Chromium 可解码格式在入口自动转 PNG 中转，不再直接报错。

### 交互与效率

- **左右分栏布局**：左侧截图 contain-fit 自适应（含滚轮缩放/拖拽平移）+ 标记操作坞，右侧识别结果独立滚动。
- **标注框编辑**：4 角拖拽调大小、框体整体移动、方向键微调（Shift ×10）；混排公式框同款能力，调整后去抖快速重跑（跳过重复检测）；排除/恢复芯片行 + 即时 toast 反馈；手动编辑过的 LaTeX 带保护标记，不被重跑覆盖。
- **逐行重识别与置信度**：每行「重识别」按钮 + 解码置信度三档可视化（高/中/低），低置信行一键批量重识别，混排公式行 chip 快速重识别（复用上轮检测结果）。
- **结果管理**：历史记录搜索/收藏/导出/缩略图回填，表格复制与导出（TSV/CSV/Markdown），批量面板（含公式/混排）。
- **细节**：剪贴板 ⌘V 直接粘贴截图，偏好持久化（灵敏度/框外扩/标记线模式），左右栏悬停联动高亮，公式引擎引导提示，Esc 优先级逐级消费。

### 稳定性与工程

- ONNX 子进程自愈（超时自动重建）、识别解码形态守卫、引擎组件动态加载防护；服务空闲超时 15 → 60 分钟，新增「释放内存」手动回收。
- 纯函数模块化拆分（混排合并/置信度导出/表格序列化/灰度缩放/阅读顺序），110 项单元测试（65 + 45）+ SFC 模板绑定校验。
- 平台不变：darwin + win32，全程离线推理、模型按需下载、不上传任何图片。

## v0.7.14 —— 混排公式重复输出：根因修复（坐标换算类型错配）+ 正文误检框过滤

用户再次反馈同一重复模式（`ein+1=0` 等公式字形先以文本输出、`$e^{i\pi}+1=0$` 等公式又追加在末尾）。这次下载 MFD 模型在**真实截图 + 真实模型**上端到端复现，找到确切根因：

**根因（前端坐标换算类型错配）**：`extractMixedTextLines` 先用 `normalizeMixedBox` 把 Vision 的 `{x,y,w,h}` 对象框转成**数组** `[x, yBottom, x2, yTop]`，而随后 `normalizedBottomLeftToPixels` 只认**对象**形态（读 `box.x`）——数组读出 `undefined` → NaN → **所有文本行 box 静默退化为 `[0,0,0,0]`**，且提前 return 连逐字符框（chars）也没换算。后果：服务端合并时文本行与任何公式框永不同行 → 切分失败、覆盖判定为 0 → 公式字形原样保留为文本、公式框整体追加在末尾——与用户输出逐字吻合（`01 02 ein+1=0 欧拉恒等式 …` 在前、公式在后）。

**修复**：
- `normalizedBottomLeftToPixels` 同时支持对象与数组两种归一化底左形态，行框与逐字符框都换算（mixedLayout.js）。
- 新增 **MFD 正文误检框过滤** `filterCjkFormulaBoxes`：真实复现还发现 MFD 会在说明文字「e、i、π、1、0--」上出误检框（score 0.58），坐标修复后会把正文前缀吞成乱码公式。用逐字符框统计公式框内 CJK 字符数，≥2 判为正文误检并丢弃（1 个视为边缘裁切保留；无 chars 时跳过），丢弃决策写入 warnings。
- 真实截图端到端验证：输出 `$e^{i\pi}+1=0$欧拉恒等式 / 01 / e、i、π、1、0--五个…（完整）/ $a^{2}+b^{2}=c^{2}$勾股定理 / 02 / …`，无重复、无正文吞噬、误检框被过滤并告警。

新增 5 组回归测试（数组形态行框/chars 换算、App 真实路径端到端不重复、CJK 过滤 4 例），65 + 45 项全过，SFC 编译通过。

## v0.7.13 —— 混排公式重复输出：真实复现 + 降级丢弃加固

用户反馈：混排模式下公式先被识别成文字填充一遍，又作为公式填充一遍。

**真实复现定位**：裁取用户截图左侧卡片，跑真实 macOS Vision OCR——公式字形行 `el+1=0` 是**独立 observation 且带 6 个逐字符框**；再用截图量取的 MFD 框跑真实 merge 管线，输出**完全干净**（isolated IoU 规则正确丢弃）。说明用户环境中重复来自运行时数据偏差（如 MFD 将独立公式误分类为行内、或框偏小导致降级兜底阈值未触发）。

**加固（不再依赖猜测，双管齐下）**：

- **降级丢弃分类型阈值**：切分失败（无 chars 等）时按框类型分级丢弃重叠文本行——isolated 独立公式阈值 **0.35 → 0.2**（独立公式旁同行的少量标签文字价值低，重复输出公式代价高；实测该场景覆盖 0.8+）；embedding 行内公式保持 0.35（宿主行含大量正文，须保守）。两类都要求公式框与文本行垂直重叠 >0.5。
- **丢弃决策透传**：降级丢弃时向前端 warnings 写入「已丢弃与公式重叠的文本行「…」」，混排面板直接可见——若仍出现重复/丢文本，用户能立即看到系统走了哪条分支，反馈可直接定位。

新增 3 组单测（isolated 低阈值几何用例、embedding 保守阈值、垂直重叠要求），61 项全过。

## v0.7.12 —— 多公式预览面板撑满右栏

主结果区隐藏后多公式面板仍受 `max-height: 52%` 限制，下方大片留白。多公式模式下右栏改为 flex 列布局，预览面板撑满整列高度：面板头部（计数 + 复制/导出操作）固定在顶部，公式行列表内部滚动。

## v0.7.11 —— 多公式模式隐藏空表格占位区

0.7.10 隐藏了多公式模式下的原始文本框，但 `v-else` 的表格分支随之渲染出「暂无表格数据…」的空占位区。改为 `formulaMultiActive` 计算属性统一守卫两个分支：多公式模式下主结果区（文本框 + 表格视图）整体不渲染，右栏只保留逐行 KaTeX 预览。

## v0.7.10 —— 公式页签移除冗余原始文本框

用户反馈：多公式结果每行已有 KaTeX 渲染预览，下方再放一个占满宽度的大文本框重复展示原始 LaTeX，冗余。

- 多公式模式（检测到公式框列表）下隐藏主结果 textarea，右栏只保留逐行预览 + 操作行；单公式模式（无 MFD 回退路径）仍保留文本框（那里没有逐行预览，文本框是唯一结果展示）。
- 数据链路不变：`rawResultText`/历史记录/底部「复制结果」仍照常工作，只是不再重复渲染这块 UI。

## v0.7.9 —— 重复框去重 / 排除反馈 / 编辑内容保护

用户实测反馈：同一位置出现两个框（「框选两次」），点击排除没去掉目标框，反而编辑过的公式框从右栏消失了。

- **重复框去重（根因修复）**：MFD 的 NMS IoU 阈值默认 0.7 太宽松——同一公式常产出两个高度重叠框。默认阈值降到 **0.55**（检测/公式/混排三处统一），重叠框在检测阶段就被滤掉。已有识别结果需重新识别（换图或调 conf）后生效。
- **排除即时反馈**：点框排除时 toast「已排除 #n（点灰色框或「已排除」芯片可恢复）」、恢复时 toast「已恢复 #n」——排除的行从右栏消失是 0.7.4 的设计（排除≠删除，latex 一直保留），不提示容易被误认为误删。
- **编辑内容保护**：手动改过的 LaTeX 打上 `edited` 标记，之后调灵敏度/排除/拖框触发重跑时**不再被识别结果覆盖**；「重识别」按钮是显式重新识别，会以新结果为准并清除保护标记。

## v0.7.8 —— 混排去重修复 + 公式页签预览/编辑布局优化

**① 图文混排：公式区不再重复输出为文字**

用户反馈：已识别为公式的地方，文字结果里又出现一遍。根因是合并切分的三个缺口：

- **边缘字符残留**：MFD 检测框常比 Vision 字符序列略窄（上下标/边缘笔画伸出框外），仅按字符中心点判归属会把公式边缘字符留在文本 run 里 → 公式内容两遍。修复：归属判定前把公式框**水平外扩**（随字符宽度自适应，clamp 2–8px），边缘字符稳定归入公式。
- **降级路径重复**：文本行无逐字符框（或长度不匹配）时切分整体降级，整行文本原样保留，公式字形重复。修复：降级行被公式框水平覆盖 ≥35% 且垂直重叠 >0.5 时丢弃文本行（宁可少文本不要重复），公式框照常输出；覆盖不足 35% 的正文行不丢。
- 工程上把合并纯函数（切分/聚行/合并/Markdown 拼接）从服务端抽到 `bin/onnx_mixed_merge.mjs`，协议层与测试共用；新增 5 组单测（外扩归属、旧行为对照、降级去重/保留、isolated 规则回归），58 项全过。

**② 公式页签：预览为主，编辑按需**

- KaTeX 预览放大（容器 16px、KaTeX 1.6em），预览是主要展示形态。
- LaTeX 编辑框**默认收起**——之前预览下方常驻一个大文本框确实冗余。双击预览（或行头「编辑」按钮）展开编辑框（自动聚焦、Esc/「完成」收起），编辑框限宽 560px 不再占满整行。

## v0.7.7 —— 批量公式/混排 + 历史增强 + 工程优化包（P0-2 + P1 全部 + P2 全部）

**功能**

- **批量识别支持公式/混排引擎（P0-2）**：`runBatch` 按当前引擎分流——公式引擎批量出 LaTeX（逐图全量检测+识别）、混排引擎批量出 Markdown；无 MFD 的公式引擎退回单公式路径不拦截；批量 dataURL 源沿用 WebP→PNG 入口兜底。混排结果记入历史时 engine 归为 `mixed`（白名单与标签同步补齐）。
- **混排公式 chip 行（P1-4）**：混排面板新增「公式行」chip 列表——每枚 chip 带序号 + 解码置信度徽章（复用公式页签三档配色），点击 chip 定位对应框；行尾「重识别公式行」按钮走快速路径：复用上轮 textLines/公式框（跳过文本 OCR 与 MFD 检测），只重跑公式解码与合并。
- **低置信一键重识别（P1-5）**：公式页签头部出现「重识别低置信(N)」按钮（存在中/低置信行时），一次 givenBoxes 请求只重识别这些框，其余行不动。
- **多公式多格式复制（P1-6）**：公式页签头部「多格式复制 ▾」——MathML（富文本剪贴板，Word/Pages 直接粘贴为公式）、KaTeX HTML、Unicode 纯文本。
- **历史记录增强（P1-7）**：搜索框（按文本过滤）、收藏（★ 置顶，随 localStorage 持久化）、「导出 TXT」（当前展示列表按 `=== 引擎 · 时间 ===` 分块导出）。
- **表格 Markdown 导出（P2-10）**：表格操作区新增「复制 MD」与「导出 MD」（竖线/换行转义，首行作表头）。
- **内存手动释放（P2-11）**：preload 新增 `releaseOnnxServers()`（杀掉 ocr/formula/mixed 三个常驻进程并清状态，下次识别自动重启）；页头新增「释放内存」按钮，释放结果 toast 反馈。

**工程**

- **纯函数拆分（P2-8）**：新增 `src/lib/formulaExport.js`（置信度分级、公式导出文本构建、历史导出构建）；`gridToTsv/gridToCsv` 移入 `src/lib/tableModel.js` 并新增 `gridToMarkdown`。App.vue 只保留状态与 DOM 逻辑。
- **测试补齐（P2-9）**：新增 4 组单测（置信度三档分级含 null 边界、导出构建过滤排除/空值、历史导出拼接、表格序列化含转义），53 项全过。拆分过程中发现并修复真 bug：`Number(null)===0` 导致无分数被误判为「高」置信。
- SFC 绑定 275 → 295，模板编译无回落。

## v0.7.6 —— C 级优化包：WebP 中转 / 置信度可视化 / 公式导出 / 保活延长

交互审计 C 类 4 项（#11–#14）：

- **#11 WebP 图片不再直接报错**：服务端解码硬限制只认 PNG/JPEG（不动），前端在 `recognizeSource` 入口统一中转——非 PNG/JPEG 的 dataURL 先经 canvas 转 PNG（预览图同步转换，因多公式路径把 previewSrc 当识别输入）。WebP/BMP/GIF 等 Chromium 可解码格式全部自动兜底；转换失败保留原样让服务端报原始错误。
- **#12 行级「重识别」按钮 + 解码置信度可视化**：后端 `recognizeFormula` 新增 `withScore` 选项，返回解码器长度归一平均对数概率（raw），随 `decodeScore` 字段贯穿 formula server / mixed server（items、boxes、segments 全链路透传）。公式页签每行显示置信度徽章（≥ -0.35 高·绿 / -0.35~-0.8 中·橙 / < -0.8 低·红，悬停显示具体分数），每行新增「重识别」按钮——只对该框单独裁剪识别并原地更新，不动其他行。旧调用契约（不传 withScore 返回纯 text 字符串）完全不变。
- **#13 公式页签补文件导出**：头部新增「导出 TEX」（每条一行 LaTeX，空行分隔）与「导出 MD」（每条独立公式块 `$$…$$`），与混排页签的 MD/HTML/TXT/PNG 对齐。
- **#14 ONNX 服务 idle 退出 15min → 60min**：三个常驻服务（ocr / formula / mixed）统一延长空闲超时，降低二次使用时 2-4s 冷启动的概率；每次请求照常刷新计时器。

e2e 验证（真实 ONNX 模型）：`withScore` 返回 score=-0.0843（高置信区间）；协议层 PNG 响应带 decodeScore、items[0] 含 text+decodeScore；WebP 服务端拒绝路径保持原样（错误文案不变）；旧契约返回 string 不变。49 单测 / 42 混排布局 / 275 script setup 绑定全过（+8 新函数）。

## v0.7.5 —— 交互与功能优化包（A+B 共 10 项）

交互审计（A 类 6 项）：

- **A1 公式引擎引导提示**：首次进入公式页签、MFD 模型未加载时，在预览区显示非阻塞提示横幅（「点击开始识别会自动加载公式检测模型…」），可关闭，不再弹错。
- **A2 剪贴板粘贴截图**：全局监听 Ctrl+V / ⌘V，剪贴板有图片时直接填入预览区，无需先拖文件。
- **A3 偏好持久化**：公式/混排的框外扩、灵敏度阈值、表格标记线模式等用户调过的参数写入本地偏好，重启插件后保留（读取时带 `Number.isFinite` 兜底，坏值回落默认）。
- **A4 左右栏联动**：鼠标悬停右栏公式行 → 左图对应标注框高亮；点击右栏行 → 左图框闪烁定位；悬停左图框 → 右栏行高亮，两侧联动一致。
- **A5 文案校准**：表格引擎阈值滑块标签「阈值」→「检测阈值」，语义更明确。
- **A6 Esc 优先级**：按键取消顺序为「拖拽调整框大小 > 分隔线拖动 > 失焦编辑 > 关闭弹窗」，逐级消费不误伤。

功能增强（B 类 4 项）：

- **B7 标注框整体移动 + 方向键微调**：公式标注框除 4 角拖拽改大小外，支持框体整体拖动换位；选中后可用 ↑↓←→ 每次微调 1px（配合 Shift 为 10px），修正误框更精细。
- **B8 排除恢复芯片行**：右栏顶部新增「已排除 N 个」芯片行，点击单枚恢复对应框，或一键「全部恢复」，不再只能回图片上找灰色虚线框。
- **B9 历史记录缩略图**：历史记录条目显示来源截图缩略图 + 历史来源索引（`historySourceMap`），点击可回填原图到预览区，回看更直观。
- **B10 混排公式框拖拽调大小 + 移动**：图文混排模式下的公式标注框获得与公式页签一致的能力（4 角 resize + 整体拖动 + 覆写缓存 `mixedBoxOverrides` + 去抖重跑 `scheduleMixedRerun`），重跑时以覆写框为准跳过重复检测。

打包验证：49 单测 / 42 混排布局 / 267 个 script setup 绑定编译全过。

## v0.7.4 —— 过滤升级：命令包裹的单字母；排除即删除；标注框可拖拽调大小

用户实测 0.7.3 三项反馈：

**① 单个英文字母仍被识别为公式**：实测误检会被公式引擎读成 `{\boldsymbol{x}}`、`\mathrm{f}.` 这类**装饰命令包裹**的 LaTeX，0.7.3 的字面正则（只认纯字母数字）拦不住。升级为分层过滤（`bin/onnx_mfd_core.mjs`）：
- 新增 `isTinyTextLatexLoose`：反复剥离装饰命令（`\boldsymbol/\text/\mathrm/…`）、花括号与首尾标点后，剩余是纯 1–2 个 ASCII 字母/数字 → 判为普通文字。
- 新增 `isTrivialFormulaLatex(latex, type)` 按框类型分档：**行内（embedding）框用激进版**；**独立（isolated）框保持保守**——避免误杀 γ、α 等真单符号公式。
- 设计边界：符号命令（`\alpha/\gamma/\bigwedge\varepsilon`…）是内容不是装饰，剥离后仍含 `\` 的一律保留；希腊符号在正文中的误检由 conf 0.55 检测侧 + 手动排除兜底。
- 服务端 `op:"formulas"` / `op:"mixed"` 过滤点统一改用分档函数；测试 49 项全过（新增两档判定用例）。

**② 排除后右栏「删除」而非置灰**：被排除的公式行从结果列表整体消失（`formulaVisibleItems` 过滤渲染），标题计数、复制全部、`rawResultText` 同步排除；「恢复」只通过图片上的灰色虚线框点击完成；全部排除时提示「点击图片中的灰色虚线框可恢复」。

**③ 标注框支持手动拖拽调大小**：公式页签 overlay 每个未排除框渲染 4 个角点手柄（nw/ne/sw/se），拖拽实时更新（`getBoundingClientRect` 反推原图像素坐标，兼容 contain-fit 与缩放），边界 clamp（图内、最小边长 8px），松手写回 box 并走 600ms 去抖重跑（只对给定框跳过重复检测）；拖拽 >2px 抑制 click 误触排除。顺带修复 0.7.3 遗漏：`resetZoom` 未重算 fit。

## v0.7.3 —— 界面左右分栏：预览自适应 + 标记操作集中左栏

用户需求：「拆分界面，分成左右两部分。左半部分放截图，截图预览不做滑动，截图大了后自适应框架的宽度长度。涉及表格标记线和公式框标记线的相关前端操作挪到左边。右半部分为识别内容，根据内容多少上下滑动。」

**根因诊断**：模板本就是两栏 grid，但 ① `.ocr-shell` 用 `min-height: 100vh` 且图片 `max-height: 100%` 的高度约束链在 inline-block/auto 高度祖先上失效 → 大图撑高整页产生整体滚动；② 右栏内容无独立滚动容器；③ 标记类操作全在右栏。

**改动（仅 src/App.vue，纯布局，识别逻辑零改动）**
- **页面级滚动消除**：`.ocr-shell` 改 `height: 100vh; overflow: hidden`，左右栏各自管理内部滚动。
- **截图自适应（contain-fit）**：新增 `computePreviewFit()` + `ResizeObserver` 监听预览区尺寸，按「客户区/图片自然尺寸，scale 封顶 1」计算适配尺寸注入 img（只缩不放，小截图保持原始尺寸不模糊）。纯 CSS 链在 inline-block 结构下会循环失效，故用 JS 计算；缩放/平移（滚轮/拖拽/双击复位）机制保留，默认状态即完整适配。
- **左栏「标记操作坞」**：预览下方新增按引擎切换的操作坞——公式引擎：「框外扩 + 灵敏度」滑块；混排引擎：同款滑块 +「仅检测公式区域」；表格引擎：「+ 行线 / + 列线 / 重置 / 阈值」滑块。以上控件从右栏对应面板移除（右栏保留识别内容相关操作：复制/导出/排除恢复等）。
- **右栏独立滚动**：header 固定，内容包进 `.result-scroll`（`overflow-y: auto`），识别结果多少只影响右栏滚动长度。
- 小于 760px 的窄窗降级布局（上下堆叠）保留。

## v0.7.2 —— 修 MFD 误检：单字母/双字母被当成公式

用户实测反馈（0.7.1）：「公式识别过于灵敏，单纯的 1、两个英文字母也识别为公式了」——普通段落里的单字母/双字母被 MFD（conf 默认 0.25）误检为行内公式。两道修复 + 定量诊断。

**诊断（真实跑 MFD 检测，非拍脑袋）**
- 渲染纯文字 PNG 扫 `op:"detect"`，conf = 0.25 / 0.35 / 0.45 / 0.55 / 0.70：
  - 系统字体正文（28px）：**全部 conf 下 0 误检**（MFD 对正 upright 正文不敏感）。
  - 斜体正文（数学感，更易触发）：conf ≤ 0.45 时各 1 个误检框（`embedding`，score ≈ 0.50–0.53，尺寸约 40×56 / 27×37）；**conf ≥ 0.55 时 0 误检**。
  - `formula-validate/imgs-mixed/mixed.jpg`（4 个真公式）：4 框全保留，最小 score = 0.711（那个孤立的 `$\mathcal{Z}$` 小框）。
- 结论：真公式 score 下界 0.711 与误检 score ≈ 0.50 之间有清晰空档。**选定前端 formulas 调用默认 conf = 0.55**（候选集 {0.35,0.45,0.55,0.70} 中使「prose 0 误检且 mixed 4 框全保留」的最小值）。服务端默认仍 0.25 不动，由前端显式传 conf。
- ⚠️ 实测坑：误检框经公式引擎识别后读成 `{\boldsymbol{\gamma}},`、`{\textstyle\bigwedge}\varepsilon` 这类**带 LaTeX 命令**的结果，并非纯 1–2 字母。故下方 `isTinyTextLatex` 的字面正则（只认纯字母/数字）**捕获不到**这类命令包裹的误检；对这些样本真正起作用的是 conf 提到 0.55（检测阶段就不出框）。正则主要兜住用户描述的「纯 1–2 字母」类误检（latex 即 `f`/`ab`）。

**修复 A：tiny-text 识别后过滤（主修复，兜底）**
- `bin/onnx_mfd_core.mjs` 新增纯函数 `isTinyTextLatex(latex)`：LaTeX 去空格后是纯 1–2 个字母/数字（无 `\ ^ _ { }` 等数学结构）即判为「疑似普通文字」。
- `bin/onnx_mixed_server.mjs`：`filterTinyText`（默认 true）开关。
  - `op:"formulas"`：逐框识别后若 `filterTiny && isTinyTextLatex(item.latex)`，整个 item 丢弃（不进 items）。
  - `op:"mixed"`：同样逐框识别后过滤——把该框从 boxes 移除**再** `mergeSegments`，文本行保持原样（不会被切成假公式段）；tmpFiles 清理覆盖所有 crop。
  - `filterTinyText:false` 可关（返回过滤前原始 items，便于对照）。

**修复 B：preload 透传灵敏度与开关**
- `detectOnnxMfd(source, opts)` 签名新增 `opts`：`opts.conf`/`opts.iou` 非空时才进 payload（旧调用不变），使混排页签初始检测也能吃灵敏度参数。
- `recognizeOnnxMixed` / `recognizeOnnxFormulas` 的 payload 均加 `filterTinyText: opts.filterTinyText !== false`（缺省 true，与服务端一致；仅 `false` 时显式关）。
- `conf`/`iou`/`boxPad` 本就在 payload 中（缺省 0.25/0.7/2），前端可调。

**验证**
- `tests/run.mjs` 新增 `isTinyTextLatex` 单测组（"1"/"ab"/"a b"→true；"x^2"/"\alpha"/"x_{i}"/"Softmax"→false；""/null/undefined→false）。
- 真实引擎端到端（非合成数据）：`prose-italic` 在 conf=0.55 下 `op:"formulas"` → 0 items；`mixed.jpg` `op:"formulas"` → 4 items 仍在，`op:"mixed"` 默认参数 markdown 与 0.7.1 逐字节一致（tiny 过滤只减误检、不丢真段）。

## v0.7.1 —— 公式识别支持一图多公式 + 标记框外扩可调

新增**「公式识别」页签一图多公式能力**，并新增贯通「混排 / 多公式」的标记框外扩旋钮（boxPad）。

**新增能力**
- 新增 `window.nativeOcr.recognizeOnnxFormulas(source, { longSide, conf, iou, boxPad, boxes })`：服务端 `op:"formulas"`，用 MFD 检测图片里所有公式区域后逐框裁剪 + 识别，**不做文本合并**，直接返回 `items`（按阅读顺序，每项含 `type`/`score`/`box`/`latex`）。适合「公式识别」页签一次识别多个公式、分行展示与逐条校对的场景。
- 标记框外扩 `boxPad`（0–40px，默认 2）：MFD 框在裁剪喂给公式引擎前向外扩的像素数。过小会裁掉紧贴边缘的字形（识别率下降），过大可能裹入邻行文字。该旋钮贯通「混排」与「多公式」两条裁剪链路（服务端 `clampBoxPad` 统一夹取）。

**修复（真实缺陷）**
- **preload 丢弃逐字符框 `chars`**：`recognizeOnnxMixed` 的 `textLines` 映射只保留 `{text, box}`，把 App.vue 从 macOS Vision 传来的 `{text, box, chars:[{c,box}]}` 中的 `chars` 抹掉，导致服务端 `splitLinePieces` 的逐字符框交错切分**永远拿不到字符数据**、整行文字与行内公式的顺序退化成「文本在前、公式堆在后」。现原样透传 `chars`。
- **preload 丢弃已检测 `boxes`**：`opts.boxes`（来自 `detectOnnxMfd` 的结果）未进入 payload，服务端被迫对每张图**重跑一遍 MFD 检测**。现 `boxes` 非空时随 payload 回传复用。

**协议变更（向后兼容）**
- 服务端 `bin/onnx_mixed_server.mjs` 新增 `op:"formulas"` 与 `boxPad` 请求字段；`boxPad` 缺省为 2，旧调用方（`op:"mixed"` 不传 boxPad）行为逐字节不变。

**验证**
- `tests/run.mjs` 新增 `clampBoxPad` 单测组（缺参/负/超限/小数取整/字符串/自定义上限）。
- 真实引擎端到端（非合成数据）：`op:"formulas"` 对含多公式图返回 ≥2 个 `items`，每项含 `box`/`type`/`latex`；`op:"mixed"` 不传 `boxPad` 时裁剪外扩恒为 2，与旧版本一致。

## v0.7.0（当前）—— 图文混排二期：MFD 公式检测 + 与文本行合并

新增**离线图文混排引擎**：先用 MFD（Math Formula Detection）模型定位图片中的公式区域，裁切后交给现有公式识别引擎逐一识别，再与上游 OCR 的文本行按阅读顺序合并输出 Markdown / 结构化 segments。

**新增能力**
- 新增 MFD 离线模型 `pix2text-mfd-1.5.onnx`（Pix2Text / CnSTD YoloDetector，**MIT 许可**）：
  - 大小 **80311115 字节**（约 76.6 MB）
  - 下载地址：`https://hf-mirror.com/breezedeus/pix2text-mfd-1.5/resolve/main/pix2text-mfd-1.5.onnx`
  - 与公式模型物理隔离，存放于 `onnx-runtime/assets/mfd/`（公式模型在 `assets/formula/`）。
- 两个新接口（`window.nativeOcr`）：
  - `detectOnnxMfd(source)`：`op:"detect"`，仅做公式区域检测，返回 `boxes`（供 UI 画框）。
  - `recognizeOnnxMixed(source, { textLines, boxes, longSide, conf, iou })`：`op:"mixed"`，检测 → 裁切 → 公式识别 → 与文本行合并，返回 `segments` / `markdown` / `raw`。
    - 传入 `boxes`（来自 `detectOnnxMfd`）可跳过重复检测，避免同一次识别跑两遍 MFD。
    - `textLines` 必须使用**原图像素坐标、左上原点**。若所有坐标都落在 `0..1`，服务端会在响应里回传 `warnings` 提示坐标空间疑似不匹配（macOS Vision 的 `boundingBox` 是**归一化 + 左下原点**，必须先换算；前端已用 `normalizedBottomLeftToPixels` 处理）。
- MFD 复用公式引擎，故「完整可用」依赖 **ONNX 运行环境 + 公式模型 + MFD 模型** 三者齐全，缺失时抛出明确中文报错。
- 新增服务进程 `bin/onnx_mixed_server.mjs`，沿用 `bin/onnx_formula_server.mjs` 的换行分隔 JSON 协议（stdin/stdout），15 分钟空闲自动退出。

**重构（行为零变化）**：把 `onnx_formula_server.mjs` 内纠缠的「图像解码 + 公式推理核心」抽成可 import 的 `bin/onnx_image_raw.mjs`（`ImageRaw`，含 BMP 手写解码）与 `bin/onnx_formula_core.mjs`（`loadFormulaSessions` / `recognizeFormula` 及全部预处理、tokenizer、解码逻辑）。原服务进程退化为协议薄封装，输出文本不变；16 张公式回归图（`gt-*` / `big-*` 等）结果与原版逐字一致。

**合并规则（已冻结，前端依赖，勿改）**
1. 所有项（MFD 公式框 + 文本行）按**垂直重叠比 > 0.5** 聚成行。
2. 丢弃与**独立公式（`isolated`）**框 **IoU > 0.1**，或被公式框**覆盖超过 60% 行宽**的文本行。
   > **注意（v0.7.0 修正）**：早期实现是「与**任一**公式框 IoU > 0.1 即丢弃」，这是**错的**。行内公式（`embedding`）按定义就嵌在文本行内部，Vision 会把「一行文字里夹着行内公式」的整行读成**一条** observation，其 boundingBox 横跨整行。实测 `mixed.jpg` 底行（`其中～利用 Gumbel-Softmax…`）因一个行内公式框与该行 IoU ≈ 0.133 > 0.1 而**整行文字被静默丢弃**（40+ 字消失，且不报错）。现仅 `isolated` 参与 IoU 丢弃；行内公式若把整行覆盖超过 60% 宽度，仍按覆盖率规则丢弃。
3. 行内按 `x1` 从左到右排序；文本段保留 `text`，公式段带 `latex`。
4. 行自上而下排序，`lineNumber` 从 0 递增。
5. `markdown` 行间以 `\n` 连接：行内公式 `embedding` → `$latex$`，独立公式 `isolated` → `$$\nlatex\n$$`，文本段原样保留（不增删空白）。
6. 公式裁切时向外扩 **2px** 并夹到图像边界；任一边长 < 4px 的框跳过。
7. **`$$` 隔断**：相邻两个行内公式直接拼接会得到 `$a$$b$`，而 Markdown / KaTeX 会把 `$$` 当作**行间公式定界符**，导致整行解析错位。因此当已累积内容以 `$` 结尾、且下一段以 `$` 开头时，**插入一个空格隔断**（文本内容零改动；同时挡住「独立公式紧跟行内公式」拼成 `$$$`）。服务端 `joinMarkdownParts` 与前端 `segmentsToMarkdown` 使用同一条规则。
8. **逐字符框切分（`chars`）实现真交错**：Vision 会把「一行文字里夹着行内公式」的整行读成一条 observation，若只按行粒度合并，只能得到「整行文字在前、公式堆在后」的**错误顺序**（且公式字形会在文本里重复出现）。因此 `ocr-vision.swift` 额外输出**逐字符框**（`VNRecognizedText.boundingBox(for:)`，坐标与行框同为归一化+左下原点），随 `textLines[].chars` 一路透传到服务端与前端；`splitTextLinePieces`（服务端）与 `splitTextLinePieces`（前端 `mixedLayout.js`）据此把整行文本按公式框的横向区间切成 `text / formula / text …` 交替片段，行内按 x 排序后即得正确的图文顺序。
   - Vision 对**空白字符**返回**零面积框**（`x=0,y=1,w=0,h=0`）。其中心落在所有公式区间之外，会在公式字符序列中间「打断」归属，把一个公式切成两段（**重复输出公式段**）并多出一个**只含空格的文本段**。已用「相邻同归属平滑」修复：若某未归属字符两侧最近的非空归属字符属于同一公式，则该字符并入该公式。切分时也只采信面积为正的字符框。
   - **安全降级**：缺 `chars`、`chars.length ≠ text.length`、或没有任何字符落在公式区间内时，`splitTextLinePieces` 返回 `null`，退回「整行文本 + 公式」的旧行为。

**前端（图文混排页签）**
- 新增 `mixed` 引擎页签（Mac `vision, onnx, mixed, formula, wechat`；Windows `onnx, mixed, formula, vision`），缺失模型走一键下载（`installOnnxMfd`）。
- 识别链路：`detectOnnxMfd` → 取带框文本行（含逐字符框）→ 用**原图**与已检测的 `boxes` 调用 `recognizeOnnxMixed`。
  - **遮罩策略（关键）**：macOS Vision 会返回逐字符框，此时**不遮罩** —— 让文本 OCR 原样读出公式字形，再由 `splitTextLinePieces` 按逐字符框把这些字形精确替换成公式段，从而得到真正交错的图文顺序（并顺带消除公式字形重复出现在文本里）。若先涂白，公式区域变空白、字符框落不到公式区间内，交错切分便无从判断。
  - 若文本引擎**不返回** `chars`（如 Windows ONNX），无法定位公式字形，才退回「先把公式区域涂白（外扩 4px、夹取边界）再 OCR」的老办法，至少保证文本里不混入公式字形。
- 预览图上叠加公式区域框（行内红 / 独立蓝，带序号），与结果面板双向联动高亮；结果面板按阅读顺序渲染文本与行内/独立 KaTeX，复用 `sanitizeLatexForRender` 三级容错，源文可编辑后重渲染（**不回写用户源码**）。
- **导出与分享增强**：导出 Markdown(`.md`)、自包含 HTML(`.html`，公式以 **MathML** 输出，不依赖字体文件、离线可看)、纯文本(`.txt`)、带标注图(`.png`)；多格式复制菜单（纯文本 / Markdown / LaTeX / 富文本 HTML），富文本走 `navigator.clipboard.write` + `ClipboardItem`，失败回退纯文本。
- 纯布局/序列化逻辑抽到 `src/lib/mixedLayout.js`（DOM-free，可单测），含 `normalizedBottomLeftToPixels`（Vision 归一化+左下原点 → 像素+左上原点）。

**验证**
- `tests/run.mjs`（40 项）新增 MFD 纯函数单测：letterbox 数学（含 1544×310 → 目标 `(154,768)` 的精确断言）、NMS（同框同类 / 不同类 / IoU 阈值边界）、反 letterbox 往返误差 ≤ 1px、`[1,4+nc,N]` 解码过滤。
- `tests/mixed-layout.mjs`（42 项）覆盖合并排序、边界场景、Markdown/纯文本/LaTeX/HTML 序列化、`$$` 隔断规则、`normalizedBottomLeftToPixels` 的 y 轴翻转与夹取，以及 `splitTextLinePieces` 的逐字符框切分、零面积空格框回归、`chars` 长度不符的安全降级。
- **真实引擎端到端（非合成数据）**：用真实 macOS Vision 对 `mixed.jpg` 取带框文本行（3 行，`chars` 齐备），经 `normalizedBottomLeftToPixels` 换算后送 `op:"mixed"`，得到正确的交错顺序：
  `其中` → `z` → `利用 Gumbel-Softmax 从 ` → `z\sim q(z|x)` → ` 中抽样得到，` → `p(z)` → `是个等概率多项式分布。`（11/11 断言通过：以文本开头/结尾、文本段数 = 公式段数 + 1、无重复公式框、无空文本段、公式按 x 递增）。同一路径在修复前会**整行丢失**。
- **发现并修复的两个真实缺陷（均由真实数据复现，非读码猜测）**：
  1. **静默丢整行文字**：`IoU > 0.1` 一刀切导致含行内公式的文本行被整体丢弃（见合并规则 2 的说明）。
  2. **重复公式段 + 空文本段**：Vision 对空格的零面积框打断公式归属（见合并规则 8 的说明）。
- `tests/check-sfc.mjs`：SFC 编译 + 模板绑定校验（检测编译产物里的 `_ctx.xxx` 回落，Vite 构建**不会**为此报错）。当前 212 个绑定全部暴露。
- 端到端（生产布局，`formula-validate/mixed-e2e.mjs`）：`mixed.jpg` 的 `detect` 命中 4 个公式框；`mixed` 合并出的 LaTeX 含 `z\sim q(z|x)` 与 `p(z)`；「整行即公式」的文本行被正确丢弃；复用传入 `boxes` 结果与自动检测逐字节一致；归一化坐标触发 `warnings`。
- **重构零行为变更证明**：重构前后两份服务对 16 张图（`gt-1/2/5/6`、`big-2/5/6`、`ctl-*`、`euler_*`、`edge-*`、`user-real`）的输出 **`diff` 为空**。

## v0.6.18 —— 公式识别：修「字迹一大就失真」+ 解码改为确定性

**现象**：用户截图（1174×323，字大、字距宽）`e^{i\pi}+1=0` 被识别成 `{\Theta}^{i\pi}\leftarrow{\bf\pi}\perp{\Theta}`——`e`→`\Theta`、`+`→`\leftarrow`、`1`→`\pi`、`=`→`\perp`、`0`→`\Theta`，**整条公式系统性读错**，不是个别字符的偶然偏差。v0.6.17 的抗锯齿修复已生效（`i\pi` 被救回），但仍不够。

**排查过程**（都是可复现的对照实验，不是猜测）：

| 假设 | 实验 | 结论 |
|---|---|---|
| 字体 OOD（截图是无衬线粗体，模型只见过 LaTeX 衬线体） | 用 PIL 把同一公式渲染成 Arial Bold / Arial / Times / Times Bold 四份跑识别 | **否**。sans-bold 得 `e^{i^{m}}+1=0`、serif 得 `\stackrel{i\pi}{e}+1=0`，字体本身不是瓶颈 |
| 彩色/Alpha 通道导致 LoadImage 的 R/B 交换出问题 | 统计截图通道：`max\|R−B\| = 0`、alpha 全 255 | **否**。图是纯灰度，参考实现的 BGR 交换在此图上零影响 |
| 预处理步骤和 Python 不一致 | 逐步 dump 中间图，与 PIL 逐字节比对 | **否**。`pad` 阶段 243712 字节里仅 71 字节差 1（舍入噪声），管线是faithful的 |

**根因**：把 resizer 收敛后真正喂给 encoder 的那张图 dump 出来对比——它本身**非常清晰**（160×32，肉眼完全可读），却读出乱码。而把同一张图**强制**缩到别的宽度，答案立刻变了：

```
强制宽度   输出
  64    e^{m}+1=0
  96    \displaystyle e^{i\pi}+1=0   ← 完全正确
 128    {\in}^{i\pi}+1=0
 160    {\Theta}^{i\pi}\leftarrow{\bf\pi}\perp{\Theta}   ← resizer 自己选的就是这档
 192+   \begin{array}... 乱码
```

resizer 的退出条件是 `wPred == pad.width`（自洽即停）。这张图的墨迹高度是 31px，`pad` 向上取整到 32，于是最后一轮「墨迹几乎顶满画布」（inkFrac = 31/32 = 0.97），正好落在 `wPred == pad.width` 上——**自洽但错的驻点**。字号相对画布偏大时模型会整体读错，这就是「字迹一大就失真」的机制。

**修复**（`bin/onnx_formula_server.mjs`）：
1. **多候选宽度 + 置信度择优**：在 resizer 的自洽解之外，再补 `0.75×` 和 `0.5×` 两档更「松」的宽度，各自走一遍 encoder+decoder，用解码器自身的**平均对数概率（长度归一）**挑最优。上面那张图由 `0.5×`（=96px）档给出完全正确的 `e^{i\pi}+1=0`。
2. **退化守卫**：自回归跑飞（如 `e^{e^{e^{...}}}`）会拿到虚高的对数概率，按 3-gram 多样性折价，防止它赢。
3. **解码改为确定性 argmax**：参考实现是 `top-k → softmax(logits/T) → np.random 多项式采样`，而 config 里 `T = 1e-5`，softmax 已近乎 one-hot——只有当 top-2 logits 差值 ≲1e-5 时才会真正随机二选一，导致**同一张图两次识别结果不同**。实测这些并列点直接取 argmax 比掷骰子更准，且结果可复现；顺带省掉每步对整个词表排序的开销。

**回归验证**（16 张图，含 4 张官方 ground-truth + 3 张 4× 放大版强制走降采样路径）：

| 图片 | 修复前 | 修复后 |
|---|---|---|
| user-real（用户截图） | `{\Theta}^{i\pi}\leftarrow{\bf\pi}\perp{\Theta}` | **`e^{i\pi}+1=0`** ✓ |
| ctl-sans-reg | `{\bf e}^{i\Pi}+{\bf\tau}4\,=0` | `e^{i\pi}+i=0\,` |
| ctl-serif | `\stackrel{i\pi}{e}+1=0` | `e^{i\pi}+1=0\,` ✓ |
| ctl-serif-bold | `{\mathfrak{C}}^{\#}+\mathfrak{I}=...` 乱码 | `e^{\alpha}+1=0` |
| wide | `\varrho\;\stackrel{.}{l}{l}\longrightarrow\frac{.}{~}l=` | `e\,i\pi+I=0` |
| euler_small | `e^{i\pi}\,+\,1\,\ =\,\emptyset` | `e^{i\pi}+I=0` |
| gt-1/2/5/6、big-2/5/6 | 正确 | **不变**（无回归） |

**代价**：每次识别多跑 2 次 encoder+decoder。实测单进程冷启动 3.3s → 3.5s；服务常驻（15min idle 不退出）时增量约 +1s。

**调试开关**（生产不设）：`FORMULA_MULTI=0` 退回单宽度（旧行为，用于 A/B）；`FORMULA_FACTORS=a,b` 自定义相对倍数；`FORMULA_CAND_W=a,b` 直接点名绝对宽度；`FORMULA_REPORT=1` 把每档分数与文本打到 stderr。

## v0.6.17 —— 修复公式识别在大图（宽 > 672px）上完全失准

**现象**：真实截图（如手机/网页里的公式，宽 1000+px）识别结果离谱——`e^{i\pi}+1=0` 被识别成 `{\bf6}^{jm}\pm\texttt{L}\underline{{{-}}}(j)`；而仓库自带的 ground-truth 测试图却能逐字符对上。

**根因**：预处理里的灰度缩放 `resizeGray` 用的是「4 邻域点采样双线性」——**没有抗锯齿**。公式服务会把图片缩到模型预测的目标宽度（常见 160~672px），大图需要缩小 3~7 倍；此时每个目标像素只取 4 个源像素，等于对源图做点抽样，细笔画被抽断、产生摩尔纹。

这解释了「为什么测试图正常、真实截图全错」：**仓库 4 张测试图宽度是 399/211/348/250px，全部 < 672，从不触发降采样**，所以这个缺陷一直被掩盖。

**修复**：

- **`resizeGray` 改为 PIL 兼容的抗锯齿实现**：按缩放比例放大滤波器支撑域（`support × max(1, scale)`），系数计算对齐 PIL `precompute_coeffs`；新增 `filterName` 参数，`minmax_size` 用 `bilinear`、`pre_process` 按 `r > 1 ? bilinear : lanczos` 选择，与 `main.py` 一致
- **修复 resizer 迭代 `h` 取整**：Python 是 `h = int(h * r)`（向零截断），原实现用 `Math.round` 每轮多 1px，多轮累积导致比例走偏
- **抽出独立模块 `bin/onnx_gray_resize.mjs`**，便于单元测试；preload 的动态 `bin/*.mjs` 扫描会自动把它同步到运行时目录
- **新增 PIL 参考基准回归测试**（`tests/fixtures/gray-resize-ref.json`，由 PIL 12.2 生成）：JS 实现与 PIL 逐像素对齐（MAE ≤ 0.21、最大误差 1），并保留一条「无抗锯齿反例」测试防止回退

**量化对比**（1006x185 → 160x47，与真实管线收敛宽度一致）：

| 实现 | MAE | 最大误差 | 偏差 > 32 灰阶的像素 |
|---|---|---|---|
| 旧（点采样） | 4.89 | 115 | 6.6% |
| 新（PIL 兼容） | 0.18 | 22 | 0% |

**端到端验证**（生产版服务，单张约 3.5s）：

| 用例 | 尺寸 | 结果 |
|---|---|---|
| gt-2 | 211x69 | `x^{2}+y^{2}=1` ✓ 精确匹配 |
| gt-5 | 348x164 | `x={\frac{-b\pm{\sqrt{b^{2}-4a c\ }}}{2a}}` ✓ 精确匹配 |
| gt-6 | 250x122 | `{\frac{x^{2}}{a^{2}}}-{\frac{y^{2}}{b^{2}}}=1` ✓ 精确匹配 |
| gt-1 | 399x78 | `\exp\left[...\right]=\sum_{n=0}^{\infty}\cdots` ✓ 精确匹配（`n=0` 之前会错成 `n=1`） |
| big-2 | 924x356 | `x^{2}+y^{2}=1` ✓（强制降采样路径） |
| big-5 | 1472x736 | `x={\frac{-b\pm{\sqrt{b^{2}-4a c}}}{2a}}` ✓ |
| big-6 | 1080x568 | `{\frac{x^{2}}{a^{2}}}-{\frac{y^{2}}{b^{2}}}=1` ✓ |

> `big-*` 是把 ground-truth 测试图放大 4 倍得到的——标注内容不变、尺寸 > 672，专门用来强制走降采样路径，公平检验本次修复。

## v0.6.16 —— 公式识别（LaTeX OCR）

- **新增「公式识别」引擎**：把公式图片识别为 LaTeX 代码。基于 RapidAI/RapidLaTeXOCR（MIT）的 4 个独立 ONNX 模型（image_resizer / encoder / decoder / tokenizer.json，约 171MB），按需一次性下载，与 OCR 模型物理隔离存放于 `onnx-runtime/assets/formula/`
- **公式预览（KaTeX 内置渲染）**：识别结果即时渲染为可视化公式，**所见即所得地确认识别是否正确**；修改下方 LaTeX 源码实时重渲染，语法错误时给出明确报错提示而不中断编辑
- **LaTeX 容错修复（新增 `src/lib/latexRepair.js`）**：OCR 模型偶发输出结构非法 LaTeX（最常见「双下标/双上标」，如 `x_a_b`、`\sum_{i=0}^{n}_{j}`），KaTeX 直接抛 `Double subscript` 导致预览白屏。现渲染前自动做最小侵入修复——把同一原子上的重复脚本用空组隔断（`x_a_b` → `x_a{}_b`），**完整保留内容且可正常渲染**；修复后预览面板显示「已容错修复」标记。修复仅作用于预览，**绝不回写用户源码**；合法 LaTeX 完全不受影响。三级降级链：原样渲染 → 容错修复渲染 → `throwOnError:false` 红色标注 → 明确错误文案
- **Formula preview (KaTeX)**：内置 KaTeX 与全套字体（离线可用，无 CDN 依赖），包体约增加 1MB
- **零新增依赖（推理侧）**：复用现有 ONNX 运行环境的 `onnxruntime-node`，服务进程协议与 ONNX OCR 完全一致（JSON-line stdin/stdout），无需 Python
- **忠实还原 Python 推理管线**：PreProcess（对比拉伸 + 反相 + 墨迹包围盒裁剪 + 32 倍数补白）→ image_resizer 宽度自适应迭代 → encoder 出 context → decoder 自回归（top-k 0.9 + softmax/T 采样，T=1e-5）→ 纯 JS ByteLevel BPE 解码 → `post_process` 空白规整
- **三种复制格式**：行内 `$…$` / 块级 `$$…$$` / 原生 `\(…\)` 一键复制
- **模型下载镜像改用 ghfast.top**（实测 ~1MB/s，较原 ghproxy.net 快约 10 倍），逐文件字节数严格校验

## v0.6.15 —— P1 稳定性版本

- **批量识别面板修复**：补齐「导出 TXT / 关闭」按钮实现（原引用函数缺失导致面板无法关闭）；批量结果写入识别历史
- **历史去重修正**：由"仅比对最新一条"改为全量查找相同文本并置顶，异图同文不再误去重
- **ONNX 子进程自愈**：启动/就绪超时后自动 kill 卡死进程并重建（最多快速重试一次），不再出现"一次卡死、引擎永久不可用"
- **WebP 明确拦截**：ONNX 管线入口对 WebP 给出切换引擎提示；server 端增加 magic number 校验（仅支持 PNG/JPEG/BMP），未知格式报明确错误
- **识别解码形态守卫**：`decodeText` 返回 string[] / `{text,mean}[]` 等形态均正确处理，杜绝"全部文本静默变空"
- **引擎组件加载防护**：Detection/Recognition 深路径 import 改为动态加载 + 存在性校验，组件缺失时输出明确的重置引导而非晦涩报错

## v0.6.14

- **修复 ONNX 引擎识别文字倒序**：逐单元格解码管线绕过了原识别阶段的阅读顺序排序，导致输出按 det 原始顺序（自下而上）；新增几何阅读顺序重排（行间自上而下、行内自左向右），行分组采用相邻间隙比较防聚类漂移
- 新增共享排序模块 `bin/onnx_text_order.mjs` 及 6 项回归测试
- **修复 ONNX 服务启动失败**：服务脚本同步列表改为动态扫描 `bin/*.mjs`（原硬编码列表漏掉新增模块，导致运行时目录缺文件、服务 import 失败）

## v0.6.13

- **修复 ONNX 表格识别列分割线不生效**：PP-OCR 识别阶段会把同一行的多个单元格合并成一个横跨整行的宽框（`afAfRec` 同行合并），导致下游列聚类退化为 1 列；改为逐单元格独立解码，保留 det 输出的原始单元格框，列分割恢复正常（验证：采购订单样例 10 行 × 7 列）
- 表格行/列聚类算法加固：链式合并改为相邻间隙比较，防止聚类中心漂移吞并相邻列/行
- ONNX 管线新增宽行切列兜底（`onnx_table_split.mjs`）：det 输出整行宽框时按暗像素投影自动切列后重识别

## v0.6.12

- **运行时文件迁移至 ZTools 插件数据目录**（`ztools.getPath("pluginData")`），插件卸载时自动清理，不留残留
- Vision / WinRT 脚本副本与编译产物同步迁移至插件数据目录
- 首次运行自动迁移旧缓存目录（`~/Library/Application Support/ZTools/native-ocr`），避免重复下载

## v0.6.11

- Windows 引擎排序调整：ONNX OCR（识别率最优）排第一
- 切换引擎时自动用新引擎重新识别当前图片

## v0.6.7 ~ v0.6.10

- **微信 OCR 收缩为 macOS 专属**，Windows 引擎定稿为：ONNX OCR + Windows OCR（系统 WinRT）
- Windows OCR（WinRT）稳定性修复：补齐 `System.Runtime.WindowsRuntime` 程序集加载；输出统一 UTF-8 消除中文乱码；脚本带版本标记
- Windows OCR 识别率优化：小图（最长边 < 1200px）解码阶段自动放大，提升小字识别率
- 防御性回退：放大路径失败时自动退回原始路径，保证识别始终可用

## v0.6.0 ~ v0.6.6

- **三大引擎双端架构落地，全程零 Python**：
  - ONNX OCR：PP-OCR v4 模型（约 60MB 一次性下载），Electron 自带 Node 子进程运行，双端通用，支持表格识别
  - 系统 OCR：macOS Vision（Swift）/ Windows OCR（WinRT PowerShell）
  - 微信 OCR：macOS 原生运行时（npmmirror 按需下载）
- 运行时下载框架：npmmirror 源 + sha1 校验 + 原子替换
- 修复 ONNX 引擎 "process is not defined"（改为 `ELECTRON_RUN_AS_NODE` 子进程常驻服务）

## v0.5.0 ~ v0.5.3

- Windows 平台初步支持（过渡方案：RapidOCR / wechat-ocr Python 链路）
- Windows 引擎不可用时的自动降级与引导

## v0.4.0

- 双平台能力补齐：Windows 系统级 OCR 与历史管理适配

## v0.3.0 ~ v0.3.1

- 表格视图翻译修复
- Windows 引擎错误处理与引导优化

## v0.2.0 ~ v0.2.1

- **表格识别**：行列聚类模型、分隔线拖拽/增删、单元格编辑、低置信度标记、TSV/CSV 导出
- **OCR 后翻译**：文本/表格双视图翻译
- **识别历史**：本地持久化、回放、单条删除、一键清空

## v0.1.0 ~ v0.1.1

- 从官方 `wechat-ocr` 插件 fork，改名 `native-ocr`（Native OCR）
- 新增 macOS Vision 引擎（系统内置，零依赖）
- 平台支持 darwin + win32
