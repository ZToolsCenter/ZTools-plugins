# 上游来源

来自 https://github.com/lyswhut/lx-music-desktop ，基线 `323e4bac`，版本 2.12.6，Apache-2.0。`src/`、`package.json`、`tsconfig.json` 和 LICENSE 由该 Git 对象完整导出，作为只读上游基线，不依赖旁边的桌面版工作目录。

适配集中在本项目 `src/ztools`、`src-ztools/preload/runtime` 和构建脚本。运行服务逐模块去除 TS 类型并输出可读 CJS，保留注释，不 bundle/minify。脚本明确替换数据库、mainIpc、AppEvent 使用的主应用设置工具，将 `global.lx` 引用改为独立 runtime/context.cjs，避免原 renderer 初始化 window.lx 时覆盖服务状态。
