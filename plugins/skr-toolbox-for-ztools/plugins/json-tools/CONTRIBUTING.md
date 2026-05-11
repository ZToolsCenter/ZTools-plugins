# 贡献指南

感谢您考虑为 JSON Tools Next 做出贡献！这个项目的发展离不开社区的支持和参与。

## 开发环境设置

1. Fork 本仓库
2. Clone 您的 fork 到本地机器
3. 安装依赖：
   ```bash
   pnpm install
   ```
4. 创建新分支：
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 提交规范

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范进行提交消息格式化，并结合 [semantic-release](https://github.com/semantic-release/semantic-release) 进行自动版本管理和发布。

### 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型（type）

- `feat:` 新功能（触发 minor 版本更新）
- `fix:` 修复bug（触发 patch 版本更新）
- `docs:` 文档更新（不触发版本更新）
- `style:` 代码风格变更（不影响代码功能，不触发版本更新）
- `refactor:` 代码重构（不触发版本更新）
- `perf:` 性能优化（触发 patch 版本更新）
- `test:` 测试相关（不触发版本更新）
- `build:` 构建系统或外部依赖变更（不触发版本更新）
- `ci:` CI配置变更（不触发版本更新）
- `chore:` 其他变更（不触发版本更新）
- `revert:` 撤销之前的提交（触发 patch 版本更新）

### 范围（scope）

范围是可选的，用于指明更改影响的部分，例如：`feat(editor): 添加新功能`

### 主题（subject）

- 简短描述变更内容
- 使用现在时态（"添加功能"而非"添加了功能"）
- 首字母不要大写
- 末尾不要加句号

### 正文（body）

正文是可选的，用于提供更详细的变更说明。

### 页脚（footer） 

页脚是可选的，用于引用相关的Issue或破坏性变更说明。

- 引用Issue：`Fixes #123`
- 破坏性变更：以`BREAKING CHANGE:`开头，描述变更内容、理由和迁移说明

### 示例

```
feat(editor): 添加JSON格式化快捷键

添加Ctrl+Shift+F快捷键用于格式化JSON

Fixes #42
```

破坏性变更示例：

```
feat(api): 修改数据导出接口

BREAKING CHANGE: 数据导出API现在需要认证令牌。
迁移方法：在请求头中添加Authorization字段。
```

### 版本管理规则

使用上述提交规范时，semantic-release 会自动：

1. 分析提交消息确定版本变更类型：
   - `BREAKING CHANGE:` 开头的提交触发主版本更新 (1.0.0 -> 2.0.0)
   - `feat:` 类型提交触发次版本更新 (1.0.0 -> 1.1.0)
   - `fix:` 或 `perf:` 类型提交触发补丁版本更新 (1.0.0 -> 1.0.1)
2. 生成/更新CHANGELOG.md
3. 创建新的git标签
4. 发布GitHub Release

## Pull Request 流程

1. 确保您的代码与项目编码风格一致
2. 更新文档以反映任何更改
3. 提交前运行测试确保通过
4. 提交 Pull Request 到 `main` 分支
5. PR 描述中清晰说明您的更改内容和目的

## 功能请求

如果您有功能建议，请创建一个 Issue 并使用 "feature request" 标签。请尽可能详细地描述您的想法，如有可能附上样例或设计草图。

## Bug 报告

报告 bug 时，请包括：

- 问题简短描述
- 复现步骤
- 预期行为与实际行为
- 屏幕截图（如适用）
- 环境信息（浏览器、操作系统等）

## 代码审查

所有提交都需要经过代码审查。请耐心等待并对审查意见保持开放态度。

## 许可证

通过贡献代码，您同意您的贡献将在 [MIT 许可证](LICENSE) 下授权。

感谢您对 JSON Tools Next 的贡献！
