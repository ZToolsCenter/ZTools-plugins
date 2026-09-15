# text-case-converter

智能大小写转换。支持智能转大小写、转大写、转小写、大小写反转、首字母大写、小驼峰命名、大驼峰命名、蛇形命名、尖叫蛇形命名。

## 功能

| 功能    | 触发关键字                      | 选中有效文本时 |
| ----- | -------------------------- | ------- |
| 智能大小写 | `大小写` / `智能大小写` / `case`   | 「智能大小写」 |
| 转大写   | `转大写` / `uppercase`        | 「转大写」   |
| 转小写   | `转小写` / `lowercase`        | 「转小写」   |
| 大小写反转 | `大小写反转` / `invert case`    | 「大小写反转」 |
| 首字母大写 | `首字母大写` / `title case`     | 「首字母大写」 |
| 小驼峰   | `小驼峰` / `camelCase`        | 「小驼峰」   |
| 大驼峰   | `大驼峰` / `PascalCase`       | 「大驼峰」   |
| 蛇形命名  | `蛇形命名` / `snake_case`      | 「蛇形命名」  |
| 尖叫蛇形  | `尖叫蛇形` / `SCREAMING_SNAKE` | 「尖叫蛇形」  |

**智能大小写**（只统计英文字母）：大写多于小写则整段转小写，否则转大写。

**命名风格**：先按符号切开（保留符号），再智能分词后套用目标风格。蛇形/尖叫蛇形允许中文作为命名一段（`xxx_中文_xxx`）；其余命名风格将中文视为分隔符。

**输出**：

- 选中文本触发 → 粘贴回选区后退出
- 关键字触发 → 写回剪贴板后退出
- 无效或异常 → 系统通知提示后退出

## 示例

- 以插件名称为例：

| 指令    | 输入示例                | 输出示例                |
| ----- | ------------------- | ------------------- |
| 智能大小写 | `TextCaseConverter` | 按大小写计数转全大或全小        |
| 转大写   | `textCaseConverter` | `TEXTCASECONVERTER` |
| 转小写   | `TextCaseConverter` | `textcaseconverter` |
| 大小写反转 | `TextCase`          | `tEXTcASE`          |
| 首字母大写 | `textCaseConverter`   | `Text Case Converter` |
| 小驼峰   | `Text Case Converter` | `textCaseConverter`   |
| 大驼峰   | `text_case_converter` | `TextCaseConverter`   |
| 蛇形命名  | `textCaseConverter`   | `text_case_converter` |
| 尖叫蛇形  | `textCaseConverter`   | `TEXT_CASE_CONVERTER` |
| 蛇形+中文 | `text转换Converter`     | `text_转换_converter`   |

> 可在 **插件详情-指令列表** 设置 **全局快捷键** 或 **禁用无用指令**

## 开发

```bash
pnpm install
pnpm run build   # tsc → 生成 public/*.png → 组装 dist/
pnpm run test
pnpm run icons
pnpm run dev
```

本地调试请加载 `dist/`。图标由构建生成，仓库不提交 `public/`

## 构建产物（CI zip 根）

```
dist/
├── plugin.json
├── preload.js
├── case-convert.js
├── naming.js
└── public/
    ├── logo.png
    ├── smart.png
    ├── upper.png
    ├── lower.png
    ├── invert.png
    ├── title.png
    ├── camel.png
    ├── pascal.png
    ├── snake.png
    └── screaming.png
```

## 相关文档

- [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html)
- [preload-js](https://ztoolscenter.github.io/ZTools-doc/preload-js.html)
- [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html)
- [插件 API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)
