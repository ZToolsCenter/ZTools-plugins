# 编码助手(ZTools 插件)

参考 uTools 编码小助手的**页面式**形态:一个界面五个 tab(Base64 / URL / Unicode /
UUID / 时间戳),输入即转换,结果直接在页面上展示,每条结果带「复制」按钮。

## 自动识别(核心用法)

直接在 ZTools 主输入框粘贴内容,按形状出现对应候选,回车进入插件后**自动切到对应
tab、带入内容并直接展示转换结果**:

| 粘贴内容形状 | 触发候选 | 进入后 |
|---|---|---|
| Base64 串 | Base64 解码 | 解码结果排在最上方(≥8 位,排除纯数字与全小写单词;兼容 URL-safe) |
| 含 `%XX` 的串 | URL 解码 | 解码结果 + 两种再编码 |
| 含 `\uXXXX` 的串 | Unicode 解码 | 还原的中文排最上方 |
| 10/13/16/19 位纯数字 | 时间戳转日期 | 12 种格式 |
| `yyyy-MM-dd[ HH:mm[:ss]]` | 日期转时间戳 | 12 种格式 |

## 关键字入口(编码方向)

`base64` / `url编码` / `unicode` / `uuid` / `ts` 等关键字进入后切到对应 tab,手动输入:

- **Base64 / URL / Unicode**:输入即双向转换(120ms 防抖),编码/解码结果同屏展示。
- **UUID**:进入即生成;数量 1 给 4 种格式(标准/无横线/大写/大写无横线),2-100 批量生成,可一键复制全部。
- **时间戳**:空输入=当前时间;「现在」按钮一键回到当前时间,12 种格式各带复制。

## 文件说明

| 文件 | 作用 |
|---|---|
| `plugin.json` | 插件声明(UI 插件,main=index.html;regex 自动识别指令) |
| `index.html` | 页面(tab + 输入 + 结果块;onPluginEnter 自动切 tab 带入 payload;setExpendHeight 撑开高度) |
| `codec.js` | Base64/URL/Unicode/UUID 纯逻辑(浏览器/Node 双端) |
| `time.js` | 时间解析/格式化(自 ztools/timestamp 复用,双端导出) |
| `logo.png` | 插件图标 |

## 测试

```bash
node /Users/liziqiang/workspace/tmp/ztools-encode-test/test.js
```

UI 冒烟:本地起 HTTP 服务后浏览器打开 index.html(无 ztools API 自动降级,可独立使用)。
