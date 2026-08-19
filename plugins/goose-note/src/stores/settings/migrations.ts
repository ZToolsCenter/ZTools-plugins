export function migrateSettingsPersistedState(
  persistedState: unknown,
): Record<string, unknown> {
  const state =
    persistedState && typeof persistedState === "object"
      ? { ...(persistedState as Record<string, unknown>) }
      : {};

  // migrate 只会处理已经存在的持久化记录：旧记录没有该字段时继续使用多标签。
  // 全新安装没有持久化记录，不会进入 migrate，直接采用初始值 true。
  if (typeof state.singleTabMode !== "boolean") {
    state.singleTabMode = false;
  }

  // 全宽已成为常规笔记的固定布局，不再保留可切换的持久化设置。
  delete state.globalEditorFullWidth;

  return state;
}
