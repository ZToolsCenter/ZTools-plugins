# Live Markdown B12 补充测试

日期：2026-10-23。范围：当前本地 B12 的浏览器交互、真实本地模型链路和产物身份。没有修改产品代码或重打包，用户当前 Welcome 与历史未改动。

## 本轮结果

- 11 个既有 Chromium E2E：**59/59 通过**，0 失败、0 跳过。覆盖 AI 入口、首次使用、追加与替换、Diff、错误后继续编辑、源码／预览切换、代码高亮、文档信息、脚注、目录、上下键及软换行。这些 AI 响应使用 mock，不能当成真实模型证据。
- 另行通过浏览器界面调用真实 Qwen3 0.6B、1.7B 本地服务，验证下列操作。每次确认前原文完全不变，通过项确认后仅修改目标位置，一次撤销恢复原文 SHA-256。
- ZTools 原生窗口连接仍超时，原生宿主未验收。Windows/Linux 实机不在本轮可执行环境内。

| 指令／场景 | 0.6B | 1.7B | 实际模型调用 |
| --- | --- | --- | --- |
| 复杂原文末尾新增 Python `multiply(a, b)` 代码块 | Diff、确认追加、一次撤销通过 | 同左 | 每项 1 次真实内容推理，无意图规划调用 |
| H16 有据行动续写 | 仅追加、三项来源主题、确认和撤销通过 | 同左 | 每项 1 次真实有据行动选择；程序渲染检查步骤 |
| `底部hello改成helloworld`，正文另有 hello | 仅替换最后一处，确认和撤销通过 | 同左 | 0 次模型调用 |
| `底部加个hello， world`，独立纠正补测 | 精确保留标点和空格，确认和撤销通过 | 同左 | 每项 1 次意图规划，0 次正文生成 |

代码没有执行；只检查了指定函数、返回表达式、围栏、插入位置和源文保留。有据续写使用受约束的行动类型、来源 ID 和固定检查模板，不代表任意自由建议或长文生成质量已通过。

## 两项测试断言纠正

首轮实际执行 8 个场景，记录保持 **6 通过、2 失败**。失败的两项是测试误要求 `底部加个hello， world` 的总模型调用为零；实际各有 1 次意图规划，返回正确的 literal EOF 计划，没有正文生成。测试在确认前停止，所以旧记录不能证明这两项的确认和撤销，也没有回写为通过。

已确认的方案要求自然语言最多一次意图规划、固定文字零正文生成，而不是所有自然语言都零次总模型调用，见 [方案](./ai-harness-optimization-plan.md) 和 [实施记录](./ai-harness-optimization-results.md)。当前程序已明确操作、文末位置和完整字面文本，但没有明确行内／独立段落布局，因此会规划一次；字面文本绑定后直接构造补丁。`加个`、逗号和空格没有使主路由丢失文本。

随后只补测该指令，每模型新发送一次；新轮 **2/2 通过**。源码由 386 增至 400 个 UTF-16 单元，增加精确的 `\n\nhello， world`，一次撤销恢复原哈希。新轮新增 2 次真实规划调用，与首轮 6 次调用分开记录；不是自动修复或模型重试，也未重复运行首轮其余 6 项。

## 证据

- [59 项浏览器回归摘要](../.cache/acceptance/native-followup/20261023T180652Z/summary.md)及[原始日志](../.cache/acceptance/native-followup/20261023T180652Z/e2e-browser.log)。11 张既有截图均备份、恢复并核对哈希；本轮截图另存，主 Agent 已独立查看 Diff、代码高亮、文档信息、脚注和目录截图。
- [首轮真实模型 UI 记录](../.cache/acceptance/ai-browser-real-followup-v1/20261023T181042Z/run.json)，SHA-256：`d7c7f26fc9d7353b2cde87d9674cb112a0ae76c9edc2ee23c6a03997f8e4000b`。
- [独立补测记录](../.cache/acceptance/ai-browser-real-followup-v1/append-policy-correction/20261023T182000Z/run.json)，SHA-256：`dd82a9b83e474b6ec2282a609e195c8e9ca2d6be084c0dc1a622a6b36883ff0c`；[纠正说明](../.cache/acceptance/ai-browser-real-followup-v1/append-policy-correction/20261023T182000Z/correction.md)保留原失败、规范依据和各轮边界。
- [原生连接尝试](../.cache/acceptance/native-followup/20261023T180723Z/native-connection.json)：两次原生连接均报 `-10005 timeoutReached`，没有执行插件操作，未恢复历史。

真实推理通过测试专用 Playwright 桥接调用实际 preload 服务，宿主存储、状态和页面初始化仍为注入的测试环境；没有挂载 Electron preload。已记录原始 UI 请求、实际 provider 请求体、流数据及原始响应，UI 与 provider 的模型 ID 一致，未修改请求内容。主 Agent 独立核对了调用、源文／撤销哈希及补测的精确追加哈希；流桥接无记录错误。原生 IPC、流式渲染时序和实际 ZTools 生命周期仍未验证。

两个隔离模型的文件、活动选择和资源元数据哈希均保持不变。没有下载、部署、自动重试或执行生成代码。

## 产物与尚未解决的边界

[本地产物身份核验](../.cache/acceptance/ai-common-failures/scoped-followup-v1/B12/artifacts/independent-package-identity-20261023T180705Z.json)确认：213 个产品源码／配置文件匹配 B12；ZIP 的 48 项路径和内容与 dist 一致。测试后主 Agent 再次核对产品源码与 ZIP 未变化。

- ZIP：735,841 字节；解压：2,336,480 字节，均低于 15,000,000 字节。
- ZIP SHA-256：`f76c865057abdf2c6be5c25df6eeddc1ee7fc82c71c6c8a89cbda2140d4c371d`。
- 本轮没有修复或重测先前 0.6B 的 clamp 逻辑错误；方法问答／部分澄清分类的已知边界也仍保留，见 [B12 限定优化报告](./ai-harness-scoped-followup.md)。本轮通过的场景不能覆盖这些未完成项。
