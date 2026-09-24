# ZTools Vibe Coding

ZVC 是一个通用 AI 助手插件，可用于日常对话、信息搜索、本地文件处理和命令执行。ZTools 插件开发是其中一项可按需开启的能力。

## 截图

![界面](screenshot.png)

## 当前能力

- 管理多个通用工作区；托管工作区默认保存在 ZTools 分配给插件的数据目录下。
- 按工作区组织会话，并为每个会话保存独立的聊天记录和任务清单。
- 使用 ZTools 统一管理的 AI 供应商和模型，支持 Function Calling、流式回复和思考内容。
- 展示工具参数、运行中输出、执行状态和最终结果，前台 Bash 可真正取消。
- 提供 Pi 风格的 `read`、`write`、`edit` 文件工具，以及 `grep`、`find`、`ls` 搜索工具。
- `grep` 和 `find` 分别使用固定版本的 ripgrep 和 fd；缺失时会从国内镜像下载，校验 SHA-256 后安装到插件数据目录的 `bin/` 子目录。
- 内置 Python Executor、File Operations、Search、Shell Executor、Task Manager、Time Service、Web Toolkit 和动态 Skill。

文件、搜索、Python 和 Shell 工具默认以当前工作区为执行目录；未绑定工作区时使用插件数据目录的 `workspace/` 子目录。工具是否需要确认由当前会话的“自动执行工具”开关决定，用户仍应检查命令和文件变更内容。

搜索二进制默认通过 `https://gh-proxy.com/https://github.com` 下载，镜像不可用时回退到 GitHub 官方地址。可通过 `ZVC_TOOL_MIRROR_URL` 覆盖镜像前缀。

## 开发

```bash
npm install
npm run dev
```

开发入口为 `http://127.0.0.1:15240/`，ZTools 应导入 `public/plugin.json`。

## 构建

```bash
npm run build
python3 public/skills/develop-ztools-plugin/scripts/validate_plugin.py .
```

可安装产物位于 `dist/`。
