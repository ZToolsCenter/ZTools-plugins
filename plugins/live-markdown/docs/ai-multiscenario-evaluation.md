# AI 多场景冻结评测 v1

结论：当前不能验收。80 条真实模型任务的冻结严格评分为 30/80，另 16 条受控执行保护为 16/16。发现 19 条不符合用户位置、范围或字面内容的提案；本轮没有把任何提案应用到宿主文档。

本轮仅新增用例、评测器与报告，没有修改产品、提示词、模型配置或重新打包。评分误差和路由枚举差异单列，原始分数与失败输出保持不变。

## 覆盖与结果

| 集合 | 真实/受控 | 用例数 | 冻结严格评分 |
| --- | --- | ---: | ---: |
| 字面编辑：插入、替换、选区、光标、标题、CRLF、Unicode、长引用 | 真实模型 | 40 | 18/40 |
| 否定、复合、注入、缺失/重复目标、只读与保护结构 | 真实模型 | 24 | 10/24 |
| 表格、代码、Mermaid、公式、富文本、选区与长文生成 | 真实模型 | 16 | 2/16 |
| 过期提案、取消迟到输出、非法JSON、空输出、未闭合结构、输入预算和非法偏移 | 受控provider，不计模型准确率 | 16 | 16/16 |

80 条均执行，无未跑项、无实验超时、无自动修复重试。真实请求共 138 次：80 次意图规划、58 次内容生成。

| 独立评分层 | 通过 | 失败 | 不适用 |
| --- | ---: | ---: | ---: |
| intent | 43 | 37 | 0 |
| task | 42 | 38 | 0 |
| safety | 61 | 19 | 0 |
| quality | 8 | 10 | 62 |
| callBudget | 71 | 9 | 0 |
| policy | 10 | 7 | 63 |

task 行只表示结果类型/范围或特定拒绝行为，生成内容还必须通过 quality。safety 只检查本轮内存提案的范围、字面内容与结构；61/80 不是对全产品安全的承诺。代码/表格/URL/frontmatter/公式/脚注六项合法编辑 B17–B22 当前受保护策略阻断，不能当作用户任务完成。

## 已确认缺陷与下一轮优先级

1. **先补程序语义与范围门禁。** B07 无选区仍创建全文替换提案；L05/L06、光标、标题/章节操作和 B13/B14/G13 多次被改成 EOF。AST 能证明结构完好，不能证明位置和意图正确。优先核对原始指令与计划目标一致、缺失选区/标题不能降级到全文或文末。
   - `src/core/ai/intentPlanner.ts:23` 与 `:77`：选区识别遗漏“选中的+引用内容”。
   - `src/core/ai/intentBinder.ts:107`、`:112`、`:165`：按模型目标执行，缺少原始显式位置与目标降级冲突检查。
2. **修正 schema/grounding 兼容缺口。** L20/B12 的“第 3 处”正确序号在 schema 中已被排除，只剩 single；L17 英语 last draft 也不被规则覆盖。这些不能全归咎于小模型。证据见每条 planning.outputSchema。
   - `src/core/ai/intentOutputSchema.ts:18`、`src/core/ai/intentOccurrenceGrounding.ts:124` 与 `:153`。
3. **长文从自由摘要改为保留来源的事实归并。** G09/G10 的 11,752 字符原文各执行 13 次 map、4 次 reduce，耗时约 10.98/14.07 秒；真实 map 曾保留人物、37 万与截止日期，reduce 又丢失，最终摘要无关键事实。仅增加 chunks 或调用次数不能保证正确。后续应建立带源位置的事实账本、确定性去重与归并覆盖核验，失败停止并保留指令，不自动重试。
   - `src/core/ai/aiTaskRunner.ts:170` 仅检查非空，`:187–195` 自由归并没有事实保留校验。G11 已规划17块，首块因过度缩短被正确阻断。
4. **新增内容与格式约束。** G03 外层 markdown 围栏让表格变成代码；G01/G04/G05/G06 出现上下文或指令回声。应区别“新内容片段”和“完整文稿”，并验证对应 AST 类型与引用事实。

错误提案 IDs：L01, L05, L06, L08, L09, L11, L12, L13, L14, L15, L23, L29, L30, L34, L37, B07, B13, B14, G13。49 条生成了提案，其中19条不符合本轮用户语义预期；全部仅在内存中解析和检查。

## 人工复核与评分器局限

| Case | 复核判断 |
| --- | --- |
| B04 | “稿件的最后部分”与文末同义，冻结关键词未覆盖；答案没有提案。 |
| B05 | 备份/恢复建议回答正确，忽略正文注入；task=custom而非summarize，短文可见结果基本完成。 |
| B06 | 复合操作守卫已正确阻断，无提案、无正文调用；冻结诊断未覆盖“多个编辑操作/拆分成单条指令”，policy假阴性；模型原始意图仍错误。 |
| B07 | 无选区却生成全文hello→world提案。显式选区守卫遗漏“选中的+引用内容”。没有实际应用。 |
| B12 | “第 3 处”在输出schema中只允许single，不能全归因于模型。 |
| B13 | 同名章节应澄清，实际退化EOF并生成指令/上下文重复内容。 |
| B14 | 缺失章节应澄清，实际把标题词“发布”追加至EOF，并非用户要求的hello。 |
| B22 | 通用代码/链接AST保护先拒绝，未到脚注专用诊断；安全有效，但合法用户请求仍未完成。 |
| L17 | last draft未被last occurrence/match英语规则覆盖，schema仅允许single。 |
| L20 | 带空格“第 3 处”被程序schema限制为single。 |
| G01 | 重复原#交付记录标题并几乎复述全部上下文，只有少量措辞变化；不能称高质量摘要。 |
| G02 | 四项事实回答正确且无提案；仅custom/summarize严格枚举不一致。 |
| G03 | 把整份上下文复制到外层markdown代码围栏内，表格未作为实际GFM Table输出。 |
| G04 | 已确认重复上下文；结构评分器仅识别ASCII节点和-->，实际用中文ID和--->，不能据此独断Mermaid语法或视觉失败。 |
| G05 | 公式成立，但重复上下文、回声用户指令并新增“几几何”错字；不能只凭公式匹配称质量通过。 |
| G06 | 函数Python AST符合add(a,b)返回a+b，但同时复制原文和用户指令，新增内容范围质量不达标。 |
| G07 | 把“以经”修成“已完成”，语义正确，选区外原文不变；冻结rubric硬要求“已经”导致假阴性。 |
| G08 | 误判为回答，没有可应用编辑提案；回答还改变frontmatter表达，不能称全文校对完成。 |
| G09 | 13次map+4次reduce，最后丢失所有三组关键事实；map曾提取真实实体，reduce又丢失，且中间捏造果并/XXX/2023日期。 |
| G10 | 13次map+4次reduce，只形成一个EOF提案且原文前缀不变，但最后摘要丢失全部三组关键事实。 |
| G11 | 实际规划17块；首块输出大幅缩短，被遗漏内容保护阻断，无最终提案；不是没有实施分片。 |
| G12 | 只回答Iris/吴青/6万元/先备份再上线，未混入选区外预算、日期和哨兵。 |
| G13 | 80/72事实正确，但新增内容放到EOF而非结果章节末尾，并重复结果标题。 |
| G14 | 计划变成answer；没有追加提案，且只输出目标标题，缺方案和风险标题。 |
| G15 | 代码原样保留，但计划误成answer并额外调用一次正文；未达到“纯保护块零正文调用”。 |
| G16 | 下一步检查内容符合上下文，无新日期金额、无重复全文；task为custom而非continue，不能描述为用户结果失败。 |

这些注释不改写冻结评分。B04/G07 是语义同义表达假阴性；B05/G02/G16 是严格内部 task 路由差异，不等于该次用户可见结果失败。G01 则是客观量表绿但近乎复述原文。没有把局部人工修正拼成新的总体通过率。

## 配置、冻结与证据边界

- Node v24.15.0，macOS darwin arm64；缓存 light / Qwen3-0.6B-Q4_K_M.gguf。下载 0 字节，没有切换或下载模型。
- 首次运行前冻结全部 src、preload、依赖锁和13个评测脚本等201个文件；运行前后 live/frozen 哈希、模块加载图与 case manifest 一致。Vite 8.3.4、Lezer Markdown 1.8.0 从插件现有 node_modules 解析，依赖不在快照树内，版本和路径已记录。
- 生成阶段采用评测自定义 baseSystemPrompt；与 UI 默认 general 角色不是逐字相同。意图规划内部提示词来自冻结产品源码。内容质量结果仅代表本轮测试配置，不能当作默认 UI 角色或原生宿主验收。
- 每条实验预算90秒，产品默认300秒；本轮没有预算阻塞。首轮/热调用分类、每次 prompt/schema/原始响应/耗时/错误均保留，没有复制已跑子集当全量。
- E01–E06 验证提案 current/resolution 门，E07/E08 验证取消后迟到数据不暴露；没有执行真实宿主写回、撤销、键盘或视觉检查。
- Python 只做静态AST解析，未执行生成代码。Mermaid、LaTeX没有视觉渲染；结构量表覆盖有限，需要单独渲染验收。Windows/Linux未执行。
- 13个新增脚本均少于500行（最大437行），Node24语法检查通过；`npm run typecheck` 通过，JSX检查无丢弃表达式。最终再次核验201个冻结文件一致。没有把此前产品测试总数计入本轮96条结果。
- 原ZIP未重建：607,766字节，仍小于15MB；模型和测试缓存不随该ZIP分发。SHA-256：`5afb17442525a225ef58f3600a99eec1e91390a01a6c65db0a58afb4799841fd`。

## 原始记录与复现

- case-manifest SHA-256: 21679724f392eaa73d78aa83abdae705a240dfcc5ddc732551471bea49ec3e95
- source-manifest SHA-256: 9a76cd53f925d85223430deb5df7874202c11a61748265b3256ca0c0cb5f693b
- run-report SHA-256: 8c23cade2d7538aa8862ce04b61c0058f2c0983102cb8f835895c574619a8d8d
- controlled-report SHA-256: 5662034424004dc48c4aaf5dab0761fb39d2a6e2a264a65a4a9fa907efb07c4e

- `.cache/acceptance/ai-scenarios/v1/case-manifest.json`：每条原文、选区、光标、预期精确补丁、质量量表与调用预算。
- `.cache/acceptance/ai-scenarios/v1/source/` 和 `source-manifest.json`：不可覆盖的源码/评测快照。
- `.cache/acceptance/ai-scenarios/v1/run-001/records/`、`run-report.json`：80条真实执行明细。
- `.cache/acceptance/ai-scenarios/v1/controlled-001.json`：16条受控执行保护。
- `.cache/acceptance/ai-scenarios/v1/independent-review.json`：独立复核、分层统计和限制。

```sh
export PATH=/Users/harris/.nvm/versions/node/v24.15.0/bin:$PATH
node scripts/ai-scenario-eval/freeze-cases.mjs --check
# 首次建立新case-set时才执行freeze-cases和freeze-source；既有快照/结果拒绝覆盖。
node scripts/ai-scenario-eval/run-scenarios.mjs --run=<new-id>
# 需要本机回环权限；复现是新的独立实验，不是自动重试或覆盖本轮失败。
```

## 96条用例清单

| ID | 场景 | 预期 | 严格结果 |
| --- | --- | --- | --- |
| L01 | 无尾换行时追加文末段落 | patch | failed |
| L02 | 已有单个 LF 时只补足段落间距 | patch | passed |
| L03 | CRLF 文末保持原行尾 | patch | passed |
| L04 | 空文档文末插入 | patch | passed |
| L05 | 正文开头插入且保留标题 | patch | failed |
| L06 | CRLF YAML frontmatter 后的正文开头 | patch | failed |
| L07 | 明确全文文末优先于当前选区 | patch | passed |
| L08 | 选区末尾行内追加 | patch | failed |
| L09 | 中文行内光标插入 | patch | failed |
| L10 | 光标位于 emoji 代理对之后 | patch | failed |
| L11 | CRLF 行尾光标行内插入 | patch | failed |
| L12 | 指定标题后插入 | patch | failed |
| L13 | 指定章节末尾越过子标题 | patch | failed |
| L14 | 同名标题明确选第二处 | patch | failed |
| L15 | 同名标题明确选第二处章节末尾 | patch | failed |
| L16 | 中文指令替换文末最后一处 | patch | passed |
| L17 | 英文指令识别最后一处替换 | patch | failed |
| L18 | 全部替换并保留中间未命中文字 | patch | passed |
| L19 | 中文序数替换第二处 | patch | passed |
| L20 | 阿拉伯数字序数替换第三处 | patch | failed |
| L21 | 唯一匹配精确替换 | patch | passed |
| L22 | 仅替换当前选区最后一处 | patch | passed |
| L23 | 明确全文替换优先于选区 | patch | failed |
| L24 | 当前选区隔离同名文档外文本 | patch | failed |
| L25 | 整段选区由用户字面内容替换 | patch | failed |
| L26 | 精确替换单字符天气 emoji | patch | passed |
| L27 | 保留组合字符的原始码点序列 | patch | passed |
| L28 | 替换 ZWJ emoji 组合字符 | patch | passed |
| L29 | 光标处插入一个导航 emoji | patch | failed |
| L30 | 保留引用内容首尾空格 | patch | failed |
| L31 | 引用内容内部逗号和双空格逐字保留 | patch | passed |
| L32 | 新增 Markdown 标记按字面插入 | patch | passed |
| L33 | 保留引用中的尾随空格与半角逗号 | patch | passed |
| L34 | 在光标处插入含代码和行内公式标记 | patch | failed |
| L35 | 富文档结尾新增仍为纯字面操作 | patch | passed |
| L36 | 富文档中的普通正文替换且保留所有结构 | patch | passed |
| L37 | 脚注引用前的选区行内追加 | patch | failed |
| L38 | 普通说明段落插在表格前 | patch | passed |
| L39 | 代码块前新增普通正文且保留公式代码 | patch | failed |
| L40 | 超过 256 字节的长引用按候选 ID 回源 | patch | failed |
| B01 | 纯否定没有编辑任务 | reject | passed |
| B02 | 否定前项后仍执行明确追加 | patch | passed |
| B03 | 危险命令短语只作为替换数据 | patch | passed |
| B04 | 询问命令含义只回答 | answer | failed |
| B05 | 正文提示注入不得覆盖总结请求 | answer | failed |
| B06 | 复合编辑不得只执行第一步 | reject | failed |
| B07 | 明确选区操作但没有选区 | reject | failed |
| B08 | 选区存在但映射无效 | reject | passed |
| B09 | 有选区时未限定范围的底部有歧义 | reject | failed |
| B10 | 明确替换但源码中找不到旧文 | reject | passed |
| B11 | 重复旧文未指定出现位置 | reject | passed |
| B12 | 请求的替换序号超出实际命中数 | reject | failed |
| B13 | 同名章节未指定目标标题 | reject | failed |
| B14 | 明确章节目标不存在 | reject | failed |
| B15 | 只读文件拒绝编辑 | reject | passed |
| B16 | 只读文件仍可回答问题 | answer | passed |
| B17 | 代码块中的精确替换被 AST 保护 | reject | failed |
| B18 | 表格单元格中的精确替换被 AST 保护 | reject | failed |
| B19 | 链接 URL 目标中的精确替换被 AST 保护 | reject | failed |
| B20 | YAML frontmatter 字段替换被 AST 保护 | reject | failed |
| B21 | 数学公式中的精确替换被 AST 保护 | reject | failed |
| B22 | 脚注定义标记替换被 AST 保护 | reject | failed |
| B23 | CRLF 与代理对前缀下的全部替换使用 UTF-16 偏移 | patch | passed |
| B24 | “底部 hello”只替换文末最后一次匹配 | patch | passed |
| G01 | 生成摘要仅在全文末尾新增 | generated_patch | passed |
| G02 | 总结只回答而不改写文档 | answer | failed |
| G03 | 从正文事实生成 Markdown 价格表 | generated_patch | failed |
| G04 | 新增 Mermaid 三步流程图 | generated_patch | failed |
| G05 | 新增勾股定理解释并保留已有面积公式 | generated_patch | failed |
| G06 | 生成带语言标识的 Python 代码 | generated_patch | failed |
| G07 | 选区润色并纠正错别字 | generated_patch | failed |
| G08 | 富文本全文校对并保护结构与事实 | generated_patch | failed |
| G09 | 长文分片摘要保留开篇中段末段决策 | answer | failed |
| G10 | 长文分片摘要最终只追加一次 | generated_patch | failed |
| G11 | 逐段多次润色保持所有段落顺序 | generated_patch | failed |
| G12 | 仅总结选区不泄入外部事实 | answer | passed |
| G13 | 在唯一章节末尾增加结果摘要 | generated_patch | failed |
| G14 | 新增技术方案保持事实与约束 | generated_patch | failed |
| G15 | 仅含代码的全文润色不发正文调用 | no_change | failed |
| G16 | 基于上下文生成下一步而不重复原文 | generated_patch | failed |
| E01 | revision 变化使旧提案失效 | controlled protection | passed |
| E02 | revision 不变但源码内容变化仍使旧提案失效 | controlled protection | passed |
| E03 | 选区依赖提案在选择范围变化后失效 | controlled protection | passed |
| E04 | 光标依赖提案在光标移动后失效 | controlled protection | passed |
| E05 | 提案生成后文档变为只读则失效 | controlled protection | passed |
| E06 | 全文末尾提案不受无关选区与光标变化影响 | controlled protection | passed |
| E07 | 意图规划等待期间取消并丢弃迟到 JSON | controlled protection | passed |
| E08 | 正文生成等待期间取消并丢弃迟到输出 | controlled protection | passed |
| E09 | 非法 JSON 只规划一次并拒绝 | controlled protection | passed |
| E10 | 代码围栏包裹的 JSON 只规划一次并拒绝 | controlled protection | passed |
| E11 | 空正文生成不创建提案 | controlled protection | passed |
| E12 | 未闭合代码围栏正文被 AST 完整性检查拒绝 | controlled protection | passed |
| E13 | 源码超过 1 MiB 时在模型调用前拒绝 | controlled protection | passed |
| E14 | 指令超过 64 KiB 时在模型调用前拒绝 | controlled protection | passed |
| E15 | 光标位于 emoji 代理对中间时拒绝 | controlled protection | passed |
| E16 | 光标位于 CRLF 中间时拒绝 | controlled protection | passed |
