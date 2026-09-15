这个目录是 Vite 构建 stub，不是构建产物。

不要改名为 `build`。全局 gitignore 的 `build/` 会让 `ztools publish` 漏传，商店 Linux CI 会报 `Could not load src/lib/build/node-fs-stub.ts`。
