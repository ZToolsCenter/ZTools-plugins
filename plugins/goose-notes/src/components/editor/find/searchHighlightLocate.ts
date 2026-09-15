import type { BlockNoteEditor } from "@blocknote/core";
import { clearFind, setFindQuery } from "@/components/editor/find/findInPagePlugin";

/**
 * 全局搜索「跳转即定位」。
 *
 * 搜索结果只带 query 字符串、不带 blockId，所以这里用 query 在当前页重新定位：
 * 1. 找到第一个匹配文本所在的 DOM。
 * 2. 把它所有「收起的折叠祖先」展开（DOM 兜底——BlockNote 折叠开合是 localStorage/DOM
 *    状态，没有编程展开的官方 API，详见 plans 报告的方案 B）。
 * 3. 等折叠展开触发的重渲染落定后，复用页内查找的 setFindQuery 做高亮 + 滚动到匹配。
 * 4. 高亮几秒后自动淡出。
 *
 * 表格：匹配落在单元格里时，setFindQuery 的 scrollIntoView 天然会滚动到该表格 DOM，
 * 无需单独处理（不强求精确到单元格，见报告里你定的口径）。
 */

const HIGHLIGHT_FADE_DELAY = 2600;
const FADE_DURATION = 600;

// BlockNote 内部折叠 DOM 约定（无 semver 保证，升级需复核）。实测结构：
//   bn-block(折叠标题)
//   ├─ ...内部... > .bn-toggle-wrapper[data-show-children]  ← 折叠开关在标题块「内部」
//   └─ .bn-block-group  ← 被折叠的子块在这里（不是 wrapper 的 DOM 后代！）
// 所以匹配块向上 .closest('[data-show-children]') 找不到折叠祖先；正确做法是沿祖先
// 链找每个 blockContainer，看它内部「直属」的 toggle wrapper 是否收起。
const BLOCK_CONTAINER_SELECTOR = '[data-node-type="blockContainer"]';
const TOGGLE_WRAPPER_SELECTOR = ".bn-toggle-wrapper[data-show-children]";
const TOGGLE_BUTTON_SELECTOR = ".bn-toggle-button";

let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function getView(editor: BlockNoteEditor<any, any, any>) {
  return (editor.prosemirrorView as import("prosemirror-view").EditorView | undefined) ?? null;
}

/** 在编辑器 DOM 里找到 query 第一次出现处所在的元素（用于展开折叠祖先）。 */
function findFirstMatchElement(
  root: HTMLElement,
  query: string,
): HTMLElement | null {
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node.textContent;
    if (text && text.toLowerCase().includes(needle)) {
      return (node.parentElement as HTMLElement) ?? null;
    }
    node = walker.nextNode();
  }
  return null;
}

/**
 * 从匹配元素向上，把所有处于收起状态的折叠祖先点开。
 * 返回是否有任何祖先被展开（用于决定是否需要等一帧再滚动）。
 */
function expandCollapsedAncestors(matchEl: HTMLElement): boolean {
  let expandedAny = false;
  // 沿祖先链逐个 blockContainer 向上：若某个祖先块是「收起的折叠块」，点开它。
  let container: HTMLElement | null = matchEl.closest(BLOCK_CONTAINER_SELECTOR);
  while (container) {
    const wrapper = container.querySelector(TOGGLE_WRAPPER_SELECTOR);
    // 确认这个 wrapper 属于 container 本身（而非它某个更深的折叠子块）
    if (
      wrapper instanceof HTMLElement &&
      wrapper.closest(BLOCK_CONTAINER_SELECTOR) === container &&
      wrapper.getAttribute("data-show-children") === "false"
    ) {
      const button = wrapper.querySelector(TOGGLE_BUTTON_SELECTOR);
      if (button instanceof HTMLElement) button.click();
      expandedAny = true;
    }
    // 跳到上一层 blockContainer
    container = container.parentElement?.closest(BLOCK_CONTAINER_SELECTOR) ?? null;
  }
  return expandedAny;
}

/**
 * 安排高亮淡出：到点后先给高亮元素加淡出 class（CSS 过渡），过渡结束再清除 decoration。
 * 这样视觉上是「亮一会儿 → 平滑淡出 → 消失」，而非突然不见。
 */
function scheduleFade(editor: BlockNoteEditor<any, any, any>) {
  if (fadeTimer) clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    fadeTimer = null;
    const view = getView(editor);
    const root = view?.dom as HTMLElement | undefined;
    const marks = root?.querySelectorAll<HTMLElement>(".goose-find-match");
    if (marks && marks.length > 0) {
      marks.forEach((m) => m.classList.add("goose-find-match--fading"));
      setTimeout(() => {
        try {
          clearFind(editor);
        } catch {
          /* 编辑器可能已卸载，忽略 */
        }
      }, FADE_DURATION);
    } else {
      try {
        clearFind(editor);
      } catch {
        /* ignore */
      }
    }
  }, HIGHLIGHT_FADE_DELAY);
}

/**
 * 执行一次搜索定位高亮。应在目标页面的编辑器已挂载、内容已 ready 后调用。
 */
export function locateAndHighlight(
  editor: BlockNoteEditor<any, any, any>,
  query: string,
) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const view = getView(editor);
  if (!view) return;

  const root = view.dom as HTMLElement;
  const matchEl = findFirstMatchElement(root, trimmed);
  const expanded = matchEl ? expandCollapsedAncestors(matchEl) : false;

  const run = () => {
    // setFindQuery：全文匹配 → ProseMirror decoration 高亮 →（内部也会尝试滚动一次）
    setFindQuery(editor, trimmed, false);
    // 实测：切页时 replaceBlocks 重建文档会长时间阻塞主线程，且其后内容持续 reflow，
    // 单次滚动（无论 smooth 还是瞬时）会被后续重排顶回顶部 —— scrollTop 始终归 0。
    // 对策：在一段时间窗口内「多次重试瞬时滚动」，直到目标真正进入视口附近并稳定。
    settleScroll(editor);
    scheduleFade(editor);
  };

  if (expanded) {
    // 展开折叠会重渲染，等下一帧 DOM 稳定后再滚动，否则会滚到错误位置
    requestAnimationFrame(() => requestAnimationFrame(run));
  } else {
    run();
  }
}

/**
 * 对抗切页后的持续 reflow：在约 600ms 内多次把高亮元素滚进视口中央（瞬时滚动），
 * 直到它稳定落在可视区为止。单次滚动会被随后的内容重排顶回顶部，重试才能咬住目标。
 */
function settleScroll(editor: BlockNoteEditor<any, any, any>) {
  const deadline = 600; // ms
  const interval = 60;
  let elapsed = 0;

  const tick = () => {
    const v = getView(editor);
    const dom = v?.dom as HTMLElement | undefined;
    const target =
      dom?.querySelector<HTMLElement>(".goose-find-match--current") ??
      dom?.querySelector<HTMLElement>(".goose-find-match") ??
      null;

    if (target) {
      const scroller = getScrollParent(target);
      if (scroller) {
        const tr = target.getBoundingClientRect();
        const sr = scroller.getBoundingClientRect();
        const inView = tr.top >= sr.top && tr.bottom <= sr.bottom;
        if (!inView) {
          // 直接算目标 scrollTop，让高亮元素居中（瞬时，不用 smooth）
          const next =
            scroller.scrollTop + (tr.top - sr.top) - sr.height / 2 + tr.height / 2;
          scroller.scrollTop = Math.max(0, next);
        } else if (elapsed >= interval) {
          // 已在视口内且不是第一帧 → 认为稳定，停止
          return;
        }
      }
    }

    elapsed += interval;
    if (elapsed < deadline) setTimeout(tick, interval);
  };

  setTimeout(tick, 0);
}

/** 向上找最近的可垂直滚动祖先（scrollHeight 超出 clientHeight 且 overflow 允许滚动）。 */
function getScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
