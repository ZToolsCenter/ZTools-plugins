# addon

Neon addon，用于向 Node.js / ZTools preload 暴露 Everything IPC 能力。

底层使用 Rust crate [`everything-ipc`](https://crates.io/crates/everything-ipc)。

## 导出

```js
const { everything } = require("./index.node");
```

类型定义维护在 `index.d.ts`。修改 addon 导出结构时，需要同步更新该类型文件。

`everything` 包含：

- `isRunning()`
- `isDbLoaded()`
- `getVersion()`
- `query(search, maxResults?, sortMode?, matchPath?)`

顶层还导出：

- `inspectTextFile(file, maxBytes?)`
- `readTextPreview(file, maxBytes?, direction?)`
- `printDirectoryTree(directory, options?)`
- `printArchiveTree(file, options?)`

`printDirectoryTree()` / `printArchiveTree()` 默认打印 2 层，第一层最多 50 项，第二层最多 20 项，超出时使用 `...` 表示。压缩包树当前支持 `.zip`、`.tar`、`.tar.gz`、`.tgz`。

`query()` 的 `matchPath` 参数未传入时默认 `false`。前端偏好设置默认开启“同时搜索路径”，开启后会传入 `true` 并使用 Everything 的 `SearchFlags::MatchPath`，让普通关键字同时匹配路径和文件名。

`query()` 返回：

```js
{
  total: number,
  items: [
    {
      name,
      path,
      fullPath,
      highlightedName,
      highlightedPath,
      extension,
      size,
      modifiedAt
    }
  ]
}
```

## 类型

`package.json` 已声明：

```json
{
  "types": "index.d.ts"
}
```

`public/preload/services.js` 通过 JSDoc 引用这里的类型，以便 preload 使用 addon 时获得类型提示。

## 构建

```bash
npm run build-release
```

addon 始终使用 release 构建。根项目的 `npm run dev` / `npm run build` 会自动编译 release addon 并复制 `index.node` 到 `public/addon.node`。

## 简单验证

```bash
npm run test:everything -- --query "*.exe" --max-results 3
```

该脚本会调用根项目 `scripts/test-everything-addon.cjs`，打印导出方法、Everything 状态、版本信息和查询结果。
