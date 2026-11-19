# 百度翻译（ZTools 插件）

基于百度翻译开放平台通用翻译 API 的 ZTools 翻译插件。只接百度翻译，无其他厂商。

## 功能

- 输入自动翻译（600ms 防抖），Enter 立即翻译，Shift+Enter 换行
- 智能方向：输入中文 → 译成英文；输入英文/日语/韩语等 → 译成中文（也可手动指定语言）
- 左右分栏：左侧原文，右侧结果
- 单词查询显示词典卡片：多词性含义、音标、词形变化（复数/过去式等）、考试标签、英英释义与例句；变形词自动查原形补全
- 译文逐段/整体复制，最近 50 条历史可回看
- 在 ZTools 主输入框输入文字回车进插件，自动带入并翻译

## 密钥配置与安全

1. 到[百度翻译开放平台](https://fanyi-api.baidu.com/)注册并开通通用翻译（标准版免费，单次 q ≤ 6000 字节）；
2. 在插件「⚙ 设置」中填入 **APPID** 与 **密钥（Secret Key）**，保存。

安全设计（密钥不离开本机）：

- 密钥经 **AES-256-GCM** 加密后存入宿主 dbStorage；
- 加密用主密钥是首次保存时随机生成的 32 字节值，落盘在宿主 `userData/baidu-translate.key`，与密文分离存放；
- **secretKey 只进不出**：preload 对渲染层只暴露 `{ appId, hasSecret }`，签名（MD5）与 HTTPS 请求全部在 preload（Node 侧）完成；
- 插件不向百度翻译 API 之外的任何地址发送数据。

「清除密钥」会同时删除密文与主密钥文件。

词典卡片需在开放平台控制台免费开通「词典资源」后才会返回数据，未开通时仅显示译文。

## 开发

```bash
npm install
npm run dev     # 浏览器调试（无 preload，自动走 mock：假翻译 + localStorage 存密钥）
npm run build   # 产物输出到 src-ztools/dist
```

目录：

```
src/                  渲染层（Vue 3 + TS）
  App.vue             翻译主视图
  components/SettingsPanel.vue  密钥设置
  api.ts              宿主/preload 封装 + 浏览器 mock
  baidu.ts            语言表、错误码映射
src-ztools/
  plugin.json         插件清单（feature: baidu-translate，关键词：百度翻译/翻译/fy…）
  preload/services.js 密钥加密存取 + 百度 API 请求（Node 侧）
  logo.png
scripts/make-logo.cjs logo 生成脚本（零依赖 PNG 绘制）
```

## 常见错误码

报错卡片会给出中文提示，对应百度 `error_code`：52003 APPID 无效、54001 签名错误（核对密钥）、54003/54005 频率受限、54004 余额不足、58001 语言方向不支持、58003 超过 6000 字节。

## 作者

yhx
