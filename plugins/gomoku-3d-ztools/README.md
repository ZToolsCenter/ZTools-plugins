# 五子棋 3D · ZTools 插件

这是 [`crper/gomoku-3d`](https://github.com/crper/gomoku-3d) 的 ZTools 插件移植版，基于上游提交 `fa6e266e4e9135aebb80e1487de88a6438380cf7`。

## 功能

- 15×15 五子棋，2D/3D 双视图
- 简单、中等、困难、大师四档本地 AI
- 落子、悬停、获胜与 AI 思考动效
- 一整回合悔棋
- 棋局回放与速度调节
- SGF、JSON、TXT 棋谱导出
- 战绩、连胜和成就
- 中英文界面与 Web Audio 合成音效
- ZTools 宿主存储、进入/退出生命周期和原生保存对话框适配

## 开发

```bash
npm install
npm run dev
npm test
npm run build
npm run validate:plugin
npm run test:e2e
```

可安装插件目录为 `src-ztools/`，生产页面位于 `src-ztools/dist/`。

## 许可与来源

本项目保留上游 MIT 许可证，详见 `LICENSE` 与 `NOTICE`。上游原始说明保存在 `README.upstream.md` 和 `README.upstream.zh.md`。
