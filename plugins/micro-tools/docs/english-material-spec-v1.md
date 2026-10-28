# 科研英语素材规范 v1

2026-10-27。适用于 ZTools、网页版、素材社区以及后续 AI 建库。面向今后的素材，不再增加旧字段分支；已有课程 ID、词本 ID 和学习记录不因本次列表调整而改变。

## 一、统一概念

| 名称 | 定义 | 是否是一种内容格式 |
| --- | --- | --- |
| 可用素材 | 已能在本机学习的所有课程：内置、下载、社区、自建 | 否，是同一个列表 |
| 内置素材 / 下载素材 / 自建素材 | 素材的获得途径 | 否，不决定内容字段 |
| 可选素材包 | 尚未加入本机的下载条目，提供 URL、数量、校验值 | 否，是分发目录 |
| 课程 | `sentences`，用于听写、拼句、打字、口语 | 是 |
| 单词包 | `words`，用于单词本与单词练习 | 是 |
| 社区投稿 | `manifest` 发布信息 + 一份课程或单词包 `content` | 是分发外层，内容不另起一套规范 |

“自建素材库”只负责创建与导入；保存后的课程统一在“内置素材库 → 可用素材”搜索、学习、管理。单词包仍进入“我的单词本”。筛选“来源”由本机来源记录生成，不能由上传者自行声明为“官方”。

## 二、公共属性

用户创建时填写 **素材名称、领域、难度、标签**。类型自动识别，不再让用户选择“类型”。

| 属性 | 类型 / 约束 | 含义 |
| --- | --- | --- |
| `format` | `research-english-course-v1` 或 `research-english-wordbook-v1` | 内容格式及主版本；程序填写 |
| `title` | 非空字符串；课程 ≤160、词本 ≤100 字符 | 素材名称 |
| `domain` | 非空字符串，≤80 字符 | 领域，允许自定义。已知领域存 `environment` / `methods` / `communication` / `reading` / `other`，界面显示中文；其他领域原样存储 |
| `level` | `★`、`★★`、`★★★`、`★★★★`、`★★★★★` 或 `null` | 1–5 星。未评级用 `null`，不虚构难度；新社区投稿必须补选星级。新素材不再使用 B2、博士面试等难度文字 |
| `tags` | 字符串数组，0–6 项；每项1–30字符、去重 | 标签；没有则 `[]` |
| `description` | 字符串，≤1200 字符 | 简介；本地可为空，社区发布必填 |
| `source` | 对象 | 原始内容出处，见下文；与“内置/自建/社区”来源筛选无关 |

`source.title` 是原文名称，`source.url` 是不含账号密码的 HTTPS 链接。课程上限分别为300、2000字符；`source.kind` ≤80字符，仅描述论文、网页、讲稿等来源载体，可由程序填写。它既不是 `course/wordbook`，也不是本机素材来源。

单词包可在 `source` 中附加 `note`、`file`、`sha256` 说明公开词表的来源；不填本机私有文件路径。课程 `source` 保留 `title/url/kind`。出版作者、许可和授权说明统一放在社区 `manifest`，不混入句子或学习状态。

领域编码用于稳定识别，颜色是展示规则，不写进 JSON；自定义领域颜色按领域文本确定。`count` 从实际数组长度计算，不允许用户手填一个与内容不符的数字。

## 三、两种内容

### 课程

`sentences` 为1–120条。每条：

| 字段 | 含义与上限 |
| --- | --- |
| `en` | 英文练习句，必填，≤1000字符 |
| `zh` | 中文释义，≤1000字符 |
| `note` | 表达说明，≤2000字符 |
| `quote` | 真实原文依据，≤2000字符；原创素材可以为空 |
| `question` | 口语追问，≤500字符 |
| `chunks` | 句法块数组，最多20个；`role/en/zh` |
| `vocabulary` | 词汇数组，最多30个；`term/ipa/meaning` |
| `phonetics` | 逐词音标数组，最多150个；`word/ipa` |

没有的文本写空字符串，没有的数组写 `[]`。`source_id` 仅用于 AI 会话内的原文映射，保存前应解析为真实 `quote`。本地课程可选 HTTPS `image:{url,alt}`；当前社区只发布文本，上传时去除图片，不接收音频。

AI 建题的教学要求另加一层校验：每句最多22个英文词，句法块按顺序完整覆盖句子，每块1–6词；原文依据不能编造。**这些是生成质量要求，不是素材元数据。** 本地课程1–120句；社区新投稿20–120句，其中至少20个不同的英文句子。最小示例只用于展示结构，不满足社区投稿句数门槛。

### 单词包

`words` 为1–20000个词条，每条只发布 `term`（≤120字符）、`meaning`（≤2000字符）、`usphone/ukphone`（各≤200字符）。词条按 NFKC 规范化后不区分大小写去重。音标可为空；本地收藏词可暂缺释义，社区投稿要求每词有释义。

不发布词条内部 ID、`mastered`、计时、打字顺序、收藏上下文或练习成绩。

## 四、社区外层与下载目录

投稿文件保持：

```json
{"format":"research-english-community-v1","manifest":{},"content":{}}
```

已收录目录中的未评级素材允许保留 `null`，新投稿表单及投稿导出要求1–5星；目录打包与新投稿使用不同的准入门槛。

`manifest` 字段：

- `schemaVersion:1`、`id`（稳定包名）、`version`（三段语义版本）、`type`（程序推断的 `course/wordbook`）。
- `title/description/domain/level/tags`：必须与 `content` 对应字段一致。投稿表单是编辑源，导出时一次性写入两处；不允许各自独立维护不同值。
- `author`、`license`、`sourceNote`、`updatedAt`：作者、许可、来源/授权说明、日期。仅社区分发必填，不要求本地私人练习填写。
- `license`：`CC-BY-4.0`、`CC-BY-SA-4.0`、`CC0-1.0`；`LicenseRef-ReviewRequired` 仅可作为未发布草稿。

原始课程/词本 JSON 是学习内容；社区投稿外层才是完整的分发与授权记录。普通素材导出不代表获得公开发布授权；需要保留发布信息时保存社区投稿外层。

下载目录是从同一份素材生成的索引：公共属性 + `count/url/sha256`；社区索引再带发布属性、字节数、投稿文件地址。词本的 `contentHash` 仅用于词条内容去重；配套 `audio` 仅属于可选下载资源，不属于文本素材。

正式分发后，修改文件内容须升包 `version` 并重新生成 URL 和 SHA256。本轮按项目所有者要求，在对外推广前直接统一现有 v1 素材属性，保留旧 ID 和进度，不增加旧属性兼容分支。源码修改及本地构建不等于发布。

## 五、身份与学习记录

- 本机 `id` 是学习记录关联键；已有 ID 和 `english-progress:<id>` / `english-wordbook-progress:<id>` 不重命名、不重算、不清空。
- `manifest.id` 是公开素材包标识；`manifest.version` 是包版本；文件 `sha256` 是下载完整性校验。三者不能拿来替代本机 ID。
- 新课程以规范化内容哈希生成 ID。内置分发目录额外记录 `lessonId`（原本机 ID）、`contentId`（当前规范化内容哈希 ID）、`sentenceHash`（练习内容哈希），用于本轮元数据整理后继续沿用旧 ID；该映射仅信任随软件分发的目录，不能通过外部 JSON 任意指定本机 ID。
- 仅调整元数据且句子不变时，重新导入保留 ID 和学习记录；句子内容变化则生成新版本 ID，原记录保留。课程目录构建会据 `sentenceHash` 区分两者。
- `builtin/library/downloaded/catalog/customCopy/createdAt` 是本机管理字段，不属于可分享内容。移动界面列表只改变展示位置，不把自建课改写为内置课。
- 完整备份独立使用 `research-english-backup-v1`，可含课程 ID 和学习记录；不能当成社区投稿素材。

## 六、实现与维护

只保留读取已有资料所需的现有处理。新契约的规范输出由 `EnglishCore.exportCourse/exportWordbook` 生成；`clean` 用于既有内部内容，不用它直接导出分享文件。

可机读的规范和示例见 `materials/english-material-v1.schema.json`、`materials/course-example.json`、`materials/wordbook-example.json`。Schema 定义内容层；投稿许可、句数门槛、计数/哈希、manifest与content一致性由各边界额外校验。

`micro-tools/features/english/english-core.js` 为共享契约源，网页版从同一源码构建；社区副本和规范用 `node scripts/sync-english-contracts.cjs` 同步，`--check` 检查漂移。

社区后端新投稿的字段白名单与公共字段一致性校验见 `asa-english-community/supabase/migrations/202610270001_material_contract_v1.sql`。部署社区前先应用该迁移；迁移只替换校验函数，不更新既有行、ID 或进度。本轮未连接或修改线上数据库。
