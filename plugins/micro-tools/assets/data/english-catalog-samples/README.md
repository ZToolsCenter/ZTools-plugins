# 科研英语素材目录

这里是随软件提供的 3 组原创示例素材，每组 4 句，可以在素材中心选择加入题库。它们无需联网，也不代表远程网站已上线。所有示例均是通用科研表达，不代表用户本人取得的研究结果。

## 在 GitHub 提供自己的素材

1. 将 `catalog.json` 和课程 JSON 放在同一个公开仓库目录。
2. 把 `catalog.json` 的 **Raw 原始文件 HTTPS 地址** 填入科研英语设置的素材目录地址。也可以使用提供静态 JSON 的其他公开 HTTPS 网站。
3. 点击素材中心的刷新按钮读取目录，再按需下载课程。
4. 发布新素材时更新目录；编辑课程后重新计算对应 `sha256`，或移除该可选字段。不要把 GitHub 网页地址、私有访问令牌或 HTML 页面填入目录设置。

## 目录格式

```json
{
  "version": 1,
  "courses": [
    {
      "id": "paper-reading",
      "title": "论文阅读与讨论",
      "domain": "论文阅读",
      "level": "★★★",
      "tags": [],
      "count": 4,
      "description": "课程说明",
      "url": "paper-reading.json",
      "sha256": "课程文件字节的64位SHA256，可省略"
    }
  ]
}
```

- `version` 固定为 `1`；`courses` 最多 200 项。
- `id` 在目录内唯一，使用字母、数字、下划线、短横线。
- `title` 最长 160 字符；`domain` 可自定义，最长 80 字符；`level` 为 1–5 个 `★` 或 `null`（未评级），`tags` 为标签数组。
- `count` 必须与课程真实句数相同，范围为 1–120。
- `url` 可以是相对于目录的路径，也可以是公开 HTTPS 地址。若目录 URL 会重定向，建议使用最终原始内容地址或课程绝对地址。
- `sha256` 可省略；填写后必须与课程文件一致。macOS 可以执行 `shasum -a 256 paper-reading.json` 计算。
- 单个目录或课程文件最大 2 MB；请求超时为 20 秒。最多跟随 3 次 HTTPS 重定向，拒绝账号密码、常见密钥查询参数、本机及内网地址。
- 刷新失败保留上次成功的目录。更改目录地址会清空旧目录缓存，已下载的课程保持不变。
- 软件读取 JSON 数据，不会运行远程脚本或自动下载目录中的所有课程。

## 课程格式

课程使用 [统一素材规范](../../../docs/english-material-spec-v1.md) 的结构。最简形式如下；可参考同目录的完整示例补充语法、音标和追问。

```json
{
  "format": "research-english-course-v1",
  "title": "我的课程",
  "domain": "我的领域",
  "level": "★★★",
      "tags": [],
  "description": "一句话课程说明",
  "source": {"title": "来源说明", "kind": "原创表达", "url": ""},
  "sentences": [
    {
      "en": "Let me start with the main question of our study.",
      "zh": "我先介绍一下我们研究的核心问题。",
      "note": "Let me start with 引出报告的第一部分。",
      "quote": "",
      "question": "What is the main question of your research?",
      "chunks": [{"role": "开场", "en": "Let me start with", "zh": "让我先介绍"}],
      "vocabulary": [{"term": "question", "ipa": "ˈkwestʃən", "meaning": "问题"}]
    }
  ]
}
```

建议练习句控制在 8–16 个英文词，每句围绕一个完整意思；拆分长句时保留限定条件、否定和研究对象。每个语法块按短语拆分。论文改写必须填写真实来源，并保留能核对的原文依据；原创教学例句可将 `quote` 留空。
