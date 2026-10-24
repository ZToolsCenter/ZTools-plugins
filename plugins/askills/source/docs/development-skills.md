# 项目开发 Skills

本项目在 `.agents/skills/` 中安装以下 3 个开发辅助 skill，供后续 Rust / Tauri 开发按需读取。它们是**社区第三方内容，非 Rust、Tauri 或 OpenAI 官方 skill**；引用的官方文档才是版本和接口行为的核对依据。

安装日期：2026-10-18（Asia/Shanghai）。只安装选定目录，没有安装整个上游插件集合，也没有运行上游仓库中的脚本。

## 已安装内容

### rust-async-patterns

- 用途：Rust 异步任务、并发限制、取消、错误处理和 Tokio 相关模式。
- 入口：[SKILL.md](../.agents/skills/rust-async-patterns/SKILL.md)。
- 来源：[wshobson/agents](https://github.com/wshobson/agents)。
- 固定提交：`0874a27b17a22e2b7c2e2bcd725768e0803cad06`。
- 上游目录：`plugins/systems-programming/skills/rust-async-patterns`。
- 固定版本：[上游目录](https://github.com/wshobson/agents/tree/0874a27b17a22e2b7c2e2bcd725768e0803cad06/plugins/systems-programming/skills/rust-async-patterns)。
- 许可：MIT，Copyright (c) 2024 Seth Hobson；[保留的许可证](../third-party/skills/wshobson-agents.LICENSE)。
- 本地改动：正文与自带 `references/details.md` 保持上游内容；额外加入上游根目录 `LICENSE`。

### tauri-setup

- 用途：Tauri 2 初始化、工具链检查、目录约定与版本敏感配置核对。
- 入口：[SKILL.md](../.agents/skills/tauri-setup/SKILL.md)。
- 来源：[fxckcode/tauri-skills](https://github.com/fxckcode/tauri-skills)。
- 固定提交：`d3959ffae74a04ae0ae8e4ad577e72b66c5e02d4`。
- 上游目录：`skills/tauri-setup`。
- 固定版本：[上游目录](https://github.com/fxckcode/tauri-skills/tree/d3959ffae74a04ae0ae8e4ad577e72b66c5e02d4/skills/tauri-setup)。
- 许可：MIT，Copyright (c) 2026 fxckcode；[保留的许可证](../third-party/skills/fxckcode-tauri-skills.LICENSE)。
- 本地改动：加入上游根目录 `LICENSE`；把该提交的 `references/official-docs.md` 和 `references/version-sensitive.md` 放到 skill 内部的 `references/`；将正文唯一的 `../../references/version-sensitive.md` 引用改为 `references/version-sensitive.md`，使独立安装后的引用仍然有效。其余正文保持不变。

### tauri-security

- 用途：Tauri 2 capabilities、权限范围、CSP、IPC 和不可信内容边界。
- 入口：[SKILL.md](../.agents/skills/tauri-security/SKILL.md)。
- 来源：[fxckcode/tauri-skills](https://github.com/fxckcode/tauri-skills)。
- 固定提交：`d3959ffae74a04ae0ae8e4ad577e72b66c5e02d4`。
- 上游目录：`skills/tauri-security`。
- 固定版本：[上游目录](https://github.com/fxckcode/tauri-skills/tree/d3959ffae74a04ae0ae8e4ad577e72b66c5e02d4/skills/tauri-security)。
- 许可：MIT，Copyright (c) 2026 fxckcode；[保留的许可证](../third-party/skills/fxckcode-tauri-skills.LICENSE)。
- 本地改动：正文保持上游内容；额外加入上游根目录 `LICENSE`。

## 安装与复核方式

安装前通过 GitHub API 解析 `main` 的完整提交 SHA，并审阅选定的 `SKILL.md`、附带参考文件及上游根目录许可证。安装使用 Codex 内置 `skill-installer` 的 `scripts/install-skill-from-github.py`，显式传入完整 SHA、项目本地目标目录和下载方式。脚本先下载固定提交的仓库压缩包，再只复制选定的 skill 目录。

本次安装命令的可复现形式如下；`<skill-installer>` 表示当前环境内置 skill-installer 的目录，命令从项目根目录运行：

```powershell
python '<skill-installer>/scripts/install-skill-from-github.py' --repo wshobson/agents --path plugins/systems-programming/skills/rust-async-patterns --ref 0874a27b17a22e2b7c2e2bcd725768e0803cad06 --dest .agents/skills --method download
python '<skill-installer>/scripts/install-skill-from-github.py' --repo fxckcode/tauri-skills --path skills/tauri-setup skills/tauri-security --ref d3959ffae74a04ae0ae8e4ad577e72b66c5e02d4 --dest .agents/skills --method download
```

命令不会覆盖已有同名目录。上述命令之后，还需补入许可证、`tauri-setup` 的两个参考文件，并应用前述唯一相对路径修正，才能复现本仓库内容。所有补充文件均取自对应的固定提交。

[sources.json](../third-party/skills/sources.json) 记录来源、提交、日期、许可、本地修改、原始 `SKILL.md` 的 SHA-256 和最终安装文件的 SHA-256，供后续更新时核对。

## 使用与更新约定

- 这些文件是 Askills 开发时的辅助资料，不是 Askills 应用的内置技能仓库，也不代表云端来源已通过安全认证。
- 当前会话可直接读取入口文件；客户端自动发现新安装 skills 通常从下一轮对话生效。
- 按任务加载所需 skill，避免每次都注入所有参考文档。
- 教学示例不等于已编译或经过生产验证的实现。采用异步模式时，仍需核对所有权、任务生命周期、锁、取消及错误传播，并运行项目检查。
- 实际配置优先使用项目锁定的依赖、生成的 schema、CLI 帮助及当前官方文档；不因 skill 示例而扩大应用权限。
- 更新需先复核上游 diff 与许可证，再固定新的完整 SHA、同步本地适配和更新哈希清单；不自动跟随 `main`。
- Askills 自身的 MIT 许可不会替代这里保留的上游版权声明。
