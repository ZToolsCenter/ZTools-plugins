/**
 * 速记小窗入口（独立 browser 窗口加载 quicknote.html → 本文件）。
 *
 * 复用主窗的 bootstrap，但以 lean 模式启动（host fs + 设置/字体 + 保存守卫），
 * 跳过主应用专属的重活（加载全部笔记/迁移/恢复/AI 记录），加速小窗冷启动。
 * 仅把渲染根换成 <QuickNoteApp/>。小窗是「草稿便签」：内容落 useQuickNote.drafts（1–5 槽位各自持久化），
 * 不对应真实笔记，不自动进入笔记本；内容保留在独立草稿槽位中。
 */
import { bootstrap } from "./main";
import { useQuickNote } from "./stores/useQuickNote";
import { QuickNoteApp } from "./pages/quick-note/QuickNoteApp";
import "./pages/quick-note/quicknote.css";
import "./pages/quick-note/quicknote-save-status.css";

void bootstrap(() => <QuickNoteApp />, {
  lean: true,
  // useQuickNote 持久化了 drafts / activeSlot / pinned / 窗口尺寸，需在渲染前 rehydrate，
  // 否则草稿 page 拿不到已有草稿内容。放进 bootstrap 的错误边界流程，失败时不再白屏。
  beforeInit: () => useQuickNote.persist.rehydrate(),
});
