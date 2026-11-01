# RTF 离线内容投影与保真边界

v0.24根证据：[root capsule](EVIDENCE_INDEX.md#v024)。


版本：v0.24；日期：2026-10-27。v0.19行为与收据保留为历史基线；本轮RTF投影在定向Worker/storage测试及有限静态review中通过，边界仍不等于完整G0或生产验收。v0.23冻结快照见[归档文档](EVIDENCE_INDEX.md#v024)与[归档根证据](EVIDENCE_INDEX.md#v024)。模块用于G0有界内容检查，不改变RTF原始字节，也不是预览器或生产监听接线。完整目标仍见[技术方案](TECHNICAL_PLAN.md)。

## 接口与职责

- `content-rtf-tokenizer.ts`：原始 bytes 的单帧词法/结构校验；text、hex 和 binary 保留原有边界。
- `content-rtf-charset.ts`：按明确 document/font code page 解码，不读取系统 ACP。
- `content-rtf-controls.ts`：已知格式属性、文本符号、目的地和静态字段规则。
- `content-rtf-projections.ts`：有总预算的正文、备用文本和隐藏文字投影。
- `content-rtf-projector.ts`：组作用域、font table、Unicode/fallback、目的地与链接投影；返回 textValues/linkValues 和两个 completeness 标志。
- `content-rtf-annotations.ts`、`content-rtf-links.ts`：v0.24 annotation记录关联与线性URL候选枚举。
- 既有 `content-scan-worker.ts`：规则匹配、固定响应和实际 Worker 生命周期；codec 明确为 rich-text/rtf，不接受伪造 UTF-8 encoding、termination 或 HTML container。

原始 RTF 始终作为原件，文本仅供检查；不得拿投影替换原件后标 exact。RTF framing 通过不等于正文或链接检查通过。已知任何命中仍阻断整次 copy；无法完整检查的表示标 not-scanned，不进入规则开启时的准入集。其他已通过表示可构成 partial 快照；规则关闭时仍按既有标准格式 allowlist 处理，并保留 not-scanned。

## 文本与编码

按组保存/恢复 `uc`、字体、隐藏状态及编码上下文。连续 raw/hex bytes 先按同一编码 run 合并，避免拆断 DBCS 字符；格式标签和普通组不能切断同一正文中的敏感词。font table 跟踪 `fN/fcharsetN/cpgN`，显式 cpg 优先，`plain` 复位字体。不支持的字体编码和未声明的被引用字体不能猜测。

明确解码集合：1250—1258、874、932、936、949、950、10000、65001。Symbol、未知 charset、1361、437/850 等没有批准解码器时不完整；代码页表示文档/helper 上下文，不证明 producer 身份或来源编码。实际 Windows reader 与应用语义仍需实机矩阵。

`u` 支持 signed 16-bit 和当前 AppKit 实际输出的 unsigned 16-bit 值，范围 -32768—65535；转为同一 UTF-16 unit，不改原件。拒绝最终 NUL、替代符及不成对 surrogate 的完整检查声明。root 用 AppKit NSAttributedString 生成固定公开文字，独立复核了 `u35797` 与 Cocoa controls；[生成证据](EVIDENCE_INDEX.md#v019)不读取系统 clipboard。

同时保留 Unicode 和 legacy fallback 两种正文投影；`uc` 按组恢复，fallback 的明示 bytes/hex/symbol 参与备用文字检查。fallback 中无法共享解释的控制状态变化或 binary 令检查不完整。遇组边界停止 fallback，不把下一组内容吞掉。

`upr/ud` 的旧/新 reader 正文分别拼接，且每个分支另有完整审计投影。即使 legacy 分支内含 Unicode 文字，也不能被分支选择逻辑丢掉。隐藏文字同时保留全量及可见拼接；metadata 目的地独立检查，不把 font/author 信息插进正文而打断词语。

v0.19历史基线：脚注、批注、页眉/页脚目的地按当时实现恢复默认字体、清除继承的显式codepage/hidden状态；non-default inherited `uc` 及 `atnauthor`/`atnid`/`atndate` 关联未建模，保持incomplete。v0.24已验证扩展见本文末尾；此句仍只记录v0.19历史限制。

## 字段、未知内容与资源

静态 HYPERLINK 字段检查 instruction、result、目标和相关开关文字；result 仍接在正文里，避免 prefix + field result + suffix 漏扫。链接按既有有界 percent 投影检查，不打开目标。DATE、DDE、INCLUDE、字段结构不全及不能静态确定的字段均不完整。

已知 info/author/generator/font/color/bookmark 等 metadata 不因不可见而跳过。未知控制字、未知 starred destination、style 引用、object、pict、binary、外部/动态载荷以及未完成的语义一律不声称已扫完；已提取文本或 raw bytes 的确定命中仍保持 blocked。没有图片 OCR、附件正文、对象解包或网络访问。

## 冻结预算

| 项目 | 当前上限 |
| --- | --- |
| raw RTF | Worker 10 MiB；native Windows 仍 2 MiB、macOS 仍 10 MiB |
| 组深 / 组数 | 128 / 20,000 |
| token / control word | 200,000 / 32 ASCII letters |
| control 数字 | 最多 10 位，signed int32；各语义再限范围 |
| font / projection stream | 1,024 / 10,000 |
| 聚合投影 | 10 Mi UTF-16 code units，所有分歧分支、隐藏/可见及 URL 派生值合计 |
| URL candidates | 每投影最多 20,000，枚举时限额 |

共享输出在出现实际语义分歧时才复制；分歧复制的 prefix 也计预算。超限不截断后报 passed。Worker deadline、退出与 stdout/stderr 完整关闭仍由既有 scanner 管理；以上是应用预算，不宣称 OS 硬内存隔离。

## 验证与未完成项

v0.19历史Worker黑盒覆盖格式切分、Unicode/备用文字、CJK/多代码页、font cpg、隐藏/metadata、HYPERLINK、UPR分支、无效/未知结构及whole-copy/partial policy。原始AppKit 342-byte fixture由root clang与独立worker Swift分别生成对照；不等同general clipboard、installed preload或Word/Excel回贴验收。v0.24测试结果见本文末尾；旧fixture仍不等同general clipboard、installed preload或Word/Excel回贴验收。

当前版本的具体计数和收据见 [实施状态](IMPLEMENTATION_STATUS.md) 与 [验收矩阵](ACCEPTANCE.md)。Windows 105 native cases仍 NOT-RUN；生产 listener、trusted source/current-policy、storage、publish、sync 接线及完整 RTF/P1 应用矩阵未完成，G0—G4保持开放。

依据：[Microsoft RTF Syntax](https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140284(v=office.10))、[Microsoft RTF plain-text extraction](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxrtfex/205e1abf-b794-4fd0-b1e4-5210882233ab)、[Microsoft RTF1.9.1规范引用](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxrtfex/3402a589-2578-4a15-99ce-04a91545f327)。Unicode/fallback/字体细节另按 Microsoft Technical Support 原著的 [RTF1.5文档镜像](https://www.biblioscape.com/rtf15_spec.htm)核对；镜像不代表当前系统或目标应用已验收。


## v0.24 annotation与URL投影扩展（局部验证通过）

### `uc` 与特殊目的地

显式外层 `\uc0`/`\uc2` 作为组状态继承给子组，退出子组恢复进入时的值。footnote、annotation、header、footer在进入时复位默认font、codepage与hidden状态，但保留继承的 `uc`；`\plain` 复位font、显式codepage与hidden状态，不复位 `uc`。本轮Worker回归已覆盖该继承/恢复行为。

### Annotation记录

当前record关联 `\atnid` author ID、`\atnauthor`、可选 `\atntime`、`\chatn` 和annotation body；`\atndate` 与 `\atnparent` 可选。atndate限1–10位ASCII十进制，author/parent ID各限256 UTF-16 units。多个完整comment可共用author ID；该值不是comment的唯一ID。同一comment序列内重复helper字段、helper/body跨错record、跨段落或非法嵌套均为incomplete。

回归还覆盖CP936正文的`\uc2` fallback与UTF-8正文的`\uc3` fallback：modern投影含“你X”，legacy fallback含“测X”，对“你X”的规则命中会阻断整次copy。曾尝试的width-skip分支在静态分析时撤回；没有pre-fix执行收据，因此不把它记作运行时red test。

parent解析面向有界的完整record集合，允许forward reference。对每个parent引用排除当前record后，只有一个record具有匹配author ID时才绑定；无候选、唯一候选仅为当前record、多个候选或最终关联图有环均incomplete。author ID重复本身不构成自环；两个同作者comment可以各自完整，引用若因此不能唯一绑定则保守不完整。

`\yr`、`\mo`、`\dy`、`\hr`、`\min`、`\sec`各自可省略；出现时只允许一次且须按固定顺序、取值范围和确定的日历规则验证。范围为year 0–32767、month 1–12、day 1–31、hour 0–23、minute/second 0–59；日历有效性按固定规则检查。`atndate`限制为受控十进制metadata，不推断系统时间或来源身份。

### URL扫描与剩余边界

URL候选使用线性枚举，保留既有候选语义及每投影20,000上限；枚举本身不打开、联网或规范化目标，候选继续进入原有最多两层percent投影。孤立1 MiB无冒号regex matcher在2秒受控期限触发SIGKILL且确认退出；这只是matcher诊断，不能推断Worker、preload或生产性能：[baseline收据](EVIDENCE_INDEX.md#v024)。

`\atnref`、annotation bookmark/icon、pict/object/bin、未知styles与动态字段继续incomplete/not-scanned；tracker上限为4096条annotation record、ID 256 UTF-16 units、每个metadata part 4096 units与累计1 Mi UTF-16解码文本metadata units（生成的时间字段参数另计入整体投影预算）；原始输入/组/token/投影/URL预算不变。命中仍阻断整次copy，RTF原件不改写。本轮两个RTF目标测试文件53/53通过；独立source review有限范围APPROVE，不代表Word renderer或完整anchor语义验收。Node706/5最终日志、Electron706/5（使用通过的initial日志副本）及17/17 package smokes见[实施状态](IMPLEMENTATION_STATUS.md)。Windows105项、生产listener/host/current-policy、回贴应用及完整G0—G4门禁仍开放。依据Microsoft RTF 1.9.1归档规范中组状态、`uc`和annotation语法说明：[官方规范PDF](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf)。
