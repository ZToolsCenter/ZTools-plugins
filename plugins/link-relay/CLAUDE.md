# CLAUDE.md

@AGENTS.md

`AGENTS.md` 是最高优先级协作规范，开始任何任务前必须先读取并遵守。
未覆盖的场景优先询问用户，不假设不猜测。

## 工具链专属约束

- **开发服务器**: `pnpm run dev` 启动的 Vite 服务器运行在 `http://localhost:5173`，ZTools 会自动加载开发版本
- **插件调试**: 通过 ZTools 插件头像图标 → "打开开发者工具" 进行前端调试
- **窗口控制**: 使用 `ztools.setExpendHeight()` 根据 IDE 数量动态调整窗口高度
- **构建输出**: 仅 `dist/` 目录需打包发布，不要修改其他目录
- **类型定义**: `src/types/ztools.d.ts` 必须保持与 `@ztools-center/ztools-api-types` 一致
