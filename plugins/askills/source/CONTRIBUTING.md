# 参与开发

本项目已实现技能库、项目部署和 GitHub 来源的开发预览。
开始功能开发前，请阅读 [实现方案](docs/architecture.md) 的当前实现记录和后续里程碑。

## 开发方式

- 使用 Node.js 24、pnpm（版本在 `package.json` 中锁定）和 Rust stable。
- `pnpm install --frozen-lockfile` 安装前端依赖；`pnpm tauri dev` 启动桌面开发。
- 本项目为个人项目，日常开发直接在 `main` 提交并推送，无需创建分支或 PR。
- 按功能或模块推进：完成一个模块、运行对应测试、通过后独立提交；不要把多个迭代的文件积攒成一个大提交。每个提交保持可编译，并记录验证范围。
- 自动化和 AI Agent 遵循同一流程；只有用户明确要求时才使用独立分支或 PR。
- 前端以中文为主，页面按功能组织；引入多语言时统一抽取文案。Rust 业务与 Tauri 命令层分离。
- 本地用户路径、凭据、下载缓存和运行数据库不得提交。
- 第三方 skills 更新须保留许可证、固定 commit，并更新来源及哈希记录。

## 提交前检查

```sh
pnpm format:check
pnpm check
pnpm build
pnpm test:ui
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
pnpm tauri build --debug --no-bundle -- --locked
```

当功能涉及文件安装、删除、链接、网络下载或数据库迁移时，补充临时目录集成测试和失败恢复测试。
避免与实现逐行重复的测试。浏览器 fixture、真实文件系统、原生 UI、真实 Agent 验证应分别说明。

提交说明与工作记录应包含实际行为变化、验证结果与未覆盖的平台。新增依赖按实际需要引入。
