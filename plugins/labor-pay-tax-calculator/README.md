# 劳务报酬计算器

按中国劳务报酬预扣率计算税后金额，并可用税后金额反推税前金额。

## 功能

- 税前 → 税后：输入劳务报酬金额，返回税后到手金额与预扣个税。
- 税后 → 税前：输入期望到手金额，反推应发税前金额与预扣个税。
- 指令直达：粘贴纯数字自动按税前计算；粘贴「金额 税后/后税/到手」或「税后 金额」自动按税后反推。
- 打开时输入框为空，不预置示例金额；提供 4000 / 8000 / 1 万 / 2 万 / 5 万 快捷填入。
- 宽窗口（≥ 660px）自动切换为左右两栏，窄窗口回落单栏；跟随系统深浅色。

计算依据（国家税务总局公告 2018 年第 56 号·预扣率表二）：

1. 应纳税所得额：单次收入 ≤ 4000 元时减 800 元；> 4000 元时按收入的 80% 计入。
2. 预扣率与速算扣除数（按应纳税所得额判定档位）：
   - 不超过 20000 元：20%，速算扣除 0；
   - 20000 元至 50000 元：30%，速算扣除 2000；
   - 超过 50000 元：40%，速算扣除 7000。
3. 预扣税额 = 应纳税所得额 × 预扣率 − 速算扣除数。

## 开发

```bash
npm install
npm run dev
```

开发服务器默认在 `http://127.0.0.1:5173/`（`vite.config.js` 未指定端口）。
如需在客户端里热加载调试，可临时给 `src-ztools/plugin.json` 加回
`"development": { "main": "http://127.0.0.1:5173" }`，**发布前必须删除该字段**。

## 构建

```bash
npm run build     # vue-tsc 类型检查 + vite 构建，产物输出到 src-ztools/dist
npm run test:e2e  # 可选：Playwright 端到端测试（需本机已安装 ZTools）
```

`src-ztools/` 就是可安装的插件目录，包含 `plugin.json`、`logo.png`、
`preload/services.js` 与构建后的 `dist/`。清单 `main` 指向 `dist/index.html`，
因此 `dist/` 只承载页面构建结果，不重复存放清单、Logo 或 preload。

## 发布到插件中心

上架走 GitHub PR，官方 CLI 自动完成 fork、复制到
`plugins/labor-pay-tax-calculator/`、开 Draft PR：

```bash
npm i -g @ztools-center/plugin-cli
git init && git add -A && git commit -m "feat: 劳务报酬计算器 v1.0.1"
ztools publish
```

PR 创建后还需手工上传截图、勾选自检清单、点 Ready for review。
中心仓库 CI 会执行 `npm install && npm run build` 从源码重建，
并以 `src-ztools/` 作为打包源生成安装包，不接受本地预打包产物。

## Logo 生成

`assets/logo.svg` 是本插件自绘的图标源文件，通过 `scripts/build-logo.mjs`
用 Playwright 渲染成 `src-ztools/logo.png`（透明背景、RGBA、128×128 显示尺寸）。

```bash
npx playwright install chromium
node scripts/build-logo.mjs
```
