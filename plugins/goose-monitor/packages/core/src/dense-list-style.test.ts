import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const main = readFileSync(resolve(import.meta.dir, "main.ts"), "utf8");
const css = readFileSync(resolve(import.meta.dir, "../styles/app.css"), "utf8");

describe("高密度列表与键盘焦点", () => {
  test("主行与 Helper 行使用紧凑高度", () => {
    expect(main).toContain('padding: "0 6px 0 12px", height: "38px"');
    expect(main).toContain('padding: "0 6px 0 12px", height: "24px"');
    expect(main).not.toContain('padding: "0 12px", height: "44px"');
  });

  test("指标列紧凑右对齐，释放空间归名称列", () => {
    expect(main).toContain('justifyContent: "flex-end"');
    expect(main).toContain('const procWrap = h("div", { className: "num", style: { textAlign: "right" } });');
    expect(main).toContain('ref.procWrap.style.textAlign = "right"');
    expect(main).toContain('padding: "0 6px 0 12px", height: "24px", flex: "none"');
  });

  test("选中状态使用方案 A（轻底 + 左线），且 hover 不盖过 selected", () => {
    // 不再用 inline 强制 transparent/none 抹掉选中样式
    expect(main).not.toContain('ref.row.style.background = "transparent"');
    expect(main).not.toContain('ref.row.style.boxShadow = "none"');
    // 主行与 wrap 打 data-sel，CSS 负责可见选中态
    expect(main).toContain('ref.row.setAttribute("data-sel", "1")');
    expect(main).toContain('ref.wrap.setAttribute("data-sel", "1")');
    expect(main).toContain('className: "pk-app-group"');
    expect(css).toContain("var(--bg-row-sel)");
    expect(css).toContain("var(--bg-row-hover)");
    // 方案 A：整行轻底 + 2px 左线；不用圆角卡片伪元素
    expect(css).toContain("inset 2px 0 0 var(--accent)");
    expect(css).not.toContain(".pk-app-group[data-sel]::before");
    expect(css).not.toContain("inset 0 0 0 1px var(--border-1)");
    // selected 与 selected:hover 同规则，保证 hover 不盖过 selected
    expect(css).toContain(".pk-process-row[data-sel],\n.pk-process-row[data-sel]:hover");
    // 名称不加粗，避免选中切换时字重跳动
    expect(css).not.toContain(".pk-process-row[data-sel] .t-sm {\n  font-weight: 600;");
    expect(css).not.toContain(".pk-process-row:focus-within {\n  box-shadow:");
  });

  test("端口浅蓝色常显由设置控制，PID 仅开启后常显", () => {
    expect(css).toContain("color: var(--port)");
    expect(css).toContain('.win[data-show-pid="1"] .pk-row-pid');
    expect(css).toContain('.win[data-show-ports="0"] .pk-row-ports');
    expect(css).not.toContain(".pk-process-row:hover .pk-row-pid");
    expect(css).toContain(".pk-row-caret:focus-visible");
    expect(main).toContain("pk-row-caret");
    expect(main).toContain("pk-row-ports");
    expect(main).toContain("formatListenPorts");
    expect(main).not.toContain("killCommand");
  });

  test("列表接收键盘时不显示整框焦点线", () => {
    const globalFocus = css.indexOf("button:focus-visible, input:focus-visible, [tabindex]:focus-visible");
    const listFocus = css.indexOf(".scroll[tabindex]:focus-visible");
    expect(globalFocus).toBeGreaterThanOrEqual(0);
    expect(listFocus).toBeGreaterThan(globalFocus);
    expect(css.slice(listFocus, listFocus + 100)).toContain("outline: none");
  });

  test("加载态用骨架屏而非「加载中」文案", () => {
    expect(main).toContain("showSkeleton");
    expect(main).toContain("pk-skeleton");
    expect(main).not.toContain("正在读取进程");
    expect(css).toContain("pkSkeletonPulse");
    expect(css).toContain("prefers-reduced-motion");
  });
});
