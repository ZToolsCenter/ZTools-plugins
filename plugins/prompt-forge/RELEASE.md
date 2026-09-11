# 发布流程（Release Checklist）

> 每次发布新版本时，按以下步骤执行。本清单可复用，务必逐项确认。

---

## 一、发布前检查

### 1. 同步分支
发布前必须与远程同步，避免丢失他人提交：

```powershell
git fetch origin
git status
```

- 若分支已分叉（diverged），先 rebase：
  ```powershell
  git pull --rebase origin prompt-forge
  ```
- 注意检查与远程提交是否有重叠改动，有冲突需手动解决。

### 2. 确认改动已提交
```powershell
git status
```
工作树应干净（`nothing to commit, working tree clean`）。

---

## 二、版本号升级（3 个文件必须同步）

遵循语义化版本（SemVer）：
- `major.minor.patch`
- 新增功能 → minor（如 1.1.0 → 1.2.0）
- Bug 修复 / 小优化 → patch（如 1.2.0 → 1.2.1）
- 破坏性变更 → major

| 文件 | 用途 | 说明 |
|---|---|---|
| `package.json` | 项目版本 | `"version": "x.y.z"` |
| `plugin.json`（根目录） | 开发模式 manifest | `"version": "x.y.z"` |
| `public/plugin.json` | **打包进 .zpx 的 manifest** | vite 会把 `public/` 原样复制到 `dist/`，这是真正随包发布的版本号 |

> ⚠️ 三处版本号必须一致，遗漏会导致发布包与实际版本不符。

---

## 三、更新 CHANGELOG.md

1. 将顶部 `[Unreleased] - 日期` 改为正式版本号：`[x.y.z] - YYYY-MM-DD`
2. 按分类（Features / Performance / Design / Bug Fixes / Refactor）确认记录完整
3. 若本次还合并了远程提交，一并补充其变更

---

## 四、构建

```powershell
npm run build
```

等价于 `vue-tsc && vite build`，包含 TypeScript 类型检查 + 打包，产物输出到 `dist/`。

构建成功后 `dist/` 应包含：
```
dist/
├── index.html
├── plugin.json        # 从 public/plugin.json 复制（路径已修正）
├── logo.png
├── logo.svg
├── preload/
│   ├── services.js
│   └── package.json
└── assets/
    ├── index-*.css
    └── index-*.js
```

---

## 五、打包 .zpx

`.zpx` 是 zip 格式，压缩 `dist/` 目录**内容**（zip 根目录应直接包含 `plugin.json`、`index.html` 等）：

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory("dist", "prompt-forge-vX.Y.Z.zpx")
```

> ⚠️ 注意：
> - `.zpx` 是发布产物，历史上已从 git 移除，**不要提交进仓库**（`dist/` 也在 `.gitignore` 中）。
> - 若目标文件已存在，会报错，先删除旧文件或换版本号。

---

## 六、本地测试

1. 将生成的 `prompt-forge-vX.Y.Z.zpx` 安装到 ZTools
2. 验证核心功能：
   - 空间页搜索 / 复制 / 变量填写
   - 快速保存（`pfs` 指令）
   - 版本管理 / 版本差异对比
   - 快捷键面板（`?` 键）
   - 组合拼接、回收站、导入导出
3. 确认 `plugin.json` 中 `main` / `preload` / `logo` 路径正确

---

## 七、提交 + 打 tag + 推送

```powershell
git add -A
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin prompt-forge --tags
```

> 若使用 `git commit -m` 含中文，PowerShell 可能乱码，改用 `git commit -F` 从 UTF-8 文件读取消息。

---

## 八、上传插件市场

#### 首次发布

首次执行 `ztools publish` 时，CLI 会自动完成：

1. **GitHub OAuth 认证** - 通过 Device Flow 引导你在浏览器授权一次（含 `workflow` scope），token 保存在 `~/.config/ztools/cli-config.json`
2. **Fork 中心仓库** - 自动在你账号下 fork `ZToolsCenter/ZTools-plugins`（已存在则复用）
3. **同步 fork main** - 调用 GitHub merge-upstream API 把 fork 的 main 拉齐到上游，避免后续分支基于落后的 main 导致冲突
4. **判定 Add / Update** - 检查上游 `plugins/<你的插件 ID>/` 目录是否存在，决定 PR 标题用 `Add` 还是 `Update`
5. **复制工作目录文件** - 把当前目录内容复制到 fork 的 `plugins/<插件 ID>/`（自动忽略 `node_modules`、`dist`、`.env*` 等）
6. **生成 commit + 推送分支** - 在 fork 的 `plugin/<插件 ID>` 分支上做**一个** commit 并普通 push（不 force）
7. **创建 Draft Pull Request** - 自动开 PR 到中心仓库，默认 draft 状态

#### 后续发布（增量更新）

每次 `ztools publish` 都是**增量追加**：

- 远端分支保留旧 commit，只 fast-forward 追加一个新 commit
- 同一个 PR 自动复用，链接不变
- 不会 force-push，旧的 review 评论上下文不会丢失

> 例：你本地累计 5 个 commit 发布出去后，远端 PR 上是 1 个 "Add plugin Foo v0.1.0" commit；又改了 3 个 commit 再发布，远端就 fast-forward 多 1 个 "Update plugin Foo v0.1.1" commit，旧的不动。

更详细的发布与协作机制（CHANGELOG 自动注入、智能 commit 标题、`pull-contributions` 拉回审核者改动等）请参考 [发布与协作流程](https://ztoolscenter.github.io/ZTools-doc/publish-and-update.html)。

---

## 快速参考

| 步骤 | 命令 / 文件 |
|---|---|
| 同步分支 | `git pull --rebase origin prompt-forge` |
| 版本号 | `package.json` + `plugin.json` + `public/plugin.json` |
| 变更记录 | `CHANGELOG.md` |
| 构建 | `npm run build` |
| 打包 | `.NET ZipFile::CreateFromDirectory("dist", "...zpx")` |
| 提交 | `git commit` + `git tag vX.Y.Z` + `git push` |

---

## 相关文档

- `README.md` — 功能说明
- `ROADMAP.md` — 已实现 / 待实现功能路线图
- `CHANGELOG.md` — 版本变更记录
