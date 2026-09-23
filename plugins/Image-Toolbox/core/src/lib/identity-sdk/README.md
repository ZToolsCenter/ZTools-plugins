# @moruteaven/identity-sdk

统一身份 SDK（第三方 vendored，**不要修改里面的文件**）。

## 来源

本目录是 `@moruteaven/identity-sdk` 的**原样拷贝**，来源为阿里云私有 npm 源：

- 包名：`@moruteaven/identity-sdk`
- Registry：`https://packages.aliyun.com/631c7575050e9c4a07a99328/npm/teaven-identity/`
- 控制台：https://packages.aliyun.com/npm/Teaven-Identity/artifacts?artifactOrg=%40moruteaven&artifactName=identity-sdk
- 当前 vendored 版本：**0.3.3**
- vendoring 日期：2026-09-13
- License：MIT

**以后升级 Teaven Identity SDK，一律从这个源取包，不要改用其他来源或手改副本。**

## 为什么是 vendored 而不是 npm 依赖

uTools 禁止加载网络资源（`AGENTS.md` §8.3），且本项目无打包工具，第三方库
必须以本地文件形式引入。因此 SDK 以源码副本形式随仓库提交，构建时直接复制进 dist。

带来的好处是可以按需裁剪：本目录保留了 Taro / uni-app 适配器
（`adapters/`），但当前客户端只使用 `TeavenIdentityClient` 和 `createWebStorage`。

## 与项目代码风格的关系

本目录保持上游原样（**双引号**、无分号风格），**不遵循**项目 ESLint 的单引号
规则。这是刻意的：保持原样才能和上游做逐字节比对，降低升级时的合并风险。

## 升级步骤

1. 从上述私有源拉取新版本包：

   ```powershell
   npm pack @moruteaven/identity-sdk@<版本> --registry https://packages.aliyun.com/631c7575050e9c4a07a99328/npm/teaven-identity/
   ```

   > 该源需要认证。Token 配置在**用户级** `~/.npmrc`（不在仓库内）。
   > CI 环境需通过 secret 注入，不要提交到仓库。

2. 解压后，用 `package/` 下的内容**整体替换**本目录（除本 README 外）。

3. 更新本文件顶部的「当前 vendored 版本」和「vendoring 日期」。

4. 同步更新 `AGENTS.md` §2 目录结构中如涉及的文件清单。

5. 运行 `.\build.ps1` 确认构建通过。

6. 若 SDK 的导入接口有变化（`export` 名称增减），需同步检查
   `core/src/identity/IdentityClient.js`。

## 校验

升级时可对照包的 `integrity` 哈希确认拷贝完整。0.3.3 的哈希为：

```
sha512-tsbow/Vw8PKXly4sdv5Hl5Ch+eN+hZPWYKJbasMb0BHKD52ETtyoiyPZnRT1HPqbtPMVsHSkVlJ83Ebm1RujjQ==
```

> 注：该哈希来自开发期残留的 `node_modules/.package-lock.json`，仅作参考锚点。
> 实际升级时以从私有源重新拉取的文件为准。
