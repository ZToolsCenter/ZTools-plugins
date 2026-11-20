# fast-data

> ZTools 快速处理数据插件。

## 功能

- 使用 `fast` 或 `快速处理数据` 打开插件。
- 在输入框粘贴文本或调整规则后，立即生成处理结果。
- 支持换行符、逗号、引号、去空、大小写、普通替换、正则替换、去重、前后拼接等常用操作。
- 每个按钮分组内保持单选，再次点击已选按钮会取消选择。
- 替换区填写查找和替换内容后自动计算，点击 `.*` 可切换为正则替换。
- 前后拼接区填写前缀或后缀后自动计算，不需要额外点击拼接按钮。
- 点击底部 `处理数据` 将当前输出复制到剪贴板。
- 点击底部 `重置设置` 清空输入、输出和参数。

## 开发

```bash
npm install
npm run dev
```

ZTools 开发模式入口配置在 `public/plugin.json` 的 `development.main` 中。

## 构建

```bash
npm run build
```

构建产物输出到 `dist/`。

## 结构

```text
public/plugin.json          # ZTools 插件配置
src/App.vue                 # ZTools feature 路由
src/Fast/index.vue          # 快速处理数据界面
src/Fast/transformers.ts    # 纯文本处理函数
```
