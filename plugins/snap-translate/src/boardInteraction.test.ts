/**
 * 贴图交互契约：工具栏默认展开、箭头可收起、贴图边缘高亮。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const vue = readFileSync(
	path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"views/BoardView.vue",
	),
	"utf8",
);

describe("board toolbar interaction", () => {
	it("toolbar is expanded by default", () => {
		expect(vue).toMatch(/dockExpanded\s*=\s*ref\(true\)/);
	});

	it("arrow toggle collapses to a thin strip, keeping OCR buttons", () => {
		expect(vue).toContain("collapse-btn");
		expect(vue).toMatch(/dockExpanded\s*=\s*!dockExpanded/);
		expect(vue).toContain(':class="{ collapsed: !dockExpanded }"');
		expect(vue).toContain('v-if="dockExpanded"');
	});

	it("collapsed dock strips to a thin strip matching COLLAPSED_DOCK_H", () => {
		expect(vue).toMatch(/\.dock\.collapsed\s*\{[^}]*min-height:\s*26px/);
		expect(vue).toMatch(
			/dockExpanded\.value \? DEFAULT_DOCK_H : COLLAPSED_DOCK_H/,
		);
	});

	it("toggling never loses pin height (prev is 0 when collapsed; nullish guard)", () => {
		expect(vue).toMatch(/const d = next - \(prev \?\? DEFAULT_DOCK_H\)/);
	});

	it("a stroke width is selected by default", () => {
		expect(vue).toMatch(/const WIDTHS = \[2, 4, 8\] as const/);
		expect(vue).toMatch(/lineWidth = ref<number>\(WIDTHS\[0\]\)/);
	});

	it("doodle menu pops below the dock and is never clipped by the pin", () => {
		expect(vue).toMatch(/\.draw-panel\s*\{[^}]*top:\s*calc\(100% \+ 6px\)/s);
		expect(vue).toMatch(/\.stick\s*\{[^}]*overflow:\s*visible/);
		expect(vue).toMatch(/\.dock-main\s*\{[^}]*width:\s*max-content/);
	});

	it("move reports dragging so the preload never relocates mid-drag (Win setBounds inflates size)", () => {
		expect(vue).toContain("dragging: dragMode !== 'none'");
		expect(vue).toMatch(
			/function onWheel[\s\S]*?if \(dragMode !== 'none'\) return/,
		);
	});
	it("highlight border + shadow only frame the screenshot stage, not the dock below", () => {
		expect(vue).toMatch(
			/\.stage\s*\{[^}]*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.22\)/s,
		);
		expect(vue).toMatch(/\.stage\s*\{[^}]*box-shadow:/s);
		expect(vue).not.toMatch(/\.stick\s*\{[^}]*border:/s);
	});
	it("wheel respects the general setting: ctrl mode is gated, plain mode is not", () => {
  expect(vue).toMatch(/boardSettings\.value\.wheelZoom === 'ctrl' && !e\.ctrlKey && !e\.metaKey/);
  expect(vue).toMatch(/function onWheel[\s\S]*?e\.preventDefault\(\)/);
  expect(vue).not.toContain('@wheel.prevent="onWheel"');
  expect(vue).toContain('@wheel="onWheel"');
  });
	it("status chip sits on the screenshot, never below the dock where doodle lives", () => {
		expect(vue).toMatch(
			/class="stage"[\s\S]*?status-chip[\s\S]*?<div class="dock"/,
		);
		expect(vue).not.toMatch(
			/\.status-chip\s*\{[^}]*top:\s*calc\(100% \+ 6px\)/s,
		);
		expect(vue).toMatch(/\.status-chip\s*\{[^}]*pointer-events:\s*none/s);
	});
	it("ignore-mouse hit-test includes overflowing dock / doodle, not just the pin box", () => {
		expect(vue).toMatch(/querySelectorAll\(['"]\.dock-main, \.draw-panel/);
		expect(vue).toContain("addEventListener('mousemove', onOverlayMove)");
		expect(vue).toMatch(/pointInRects\(/);
	});
	it("stick receives wheel so overflowing chrome still zoom with Ctrl", () => {
		expect(vue).toMatch(/class="stick"[\s\S]*?@wheel="onWheel"/);
	});
	it("terminal updates clear statusText so the chip auto-hides after the tip", () => {
		expect(vue).toMatch(
			/u\.type === 'error'[\s\S]{0,120}statusText\.value = ''/,
		);
		expect(vue).toMatch(
			/u\.type === 'ocr' \|\| u\.type === 'translate' \|\| u\.type === 'ocr-translate'[\s\S]{0,120}statusText\.value = ''/,
		);
	});
it("keeps OCR lines for a separate translate button after recognition", () => {
    expect(vue).toMatch(/const lines = ref<\{ text: string \}\[\]>/);
    expect(vue).toMatch(/function sendTranslate[\s\S]*sourceLines: lines\.value\.map/);
    expect(vue).toMatch(/hasOverlay \? '原文' : '翻译'/);
  });

  it("does not put an X on the top-right of the pin", () => {
    expect(vue).not.toContain("corner-close");
  });

  it("covers original text in-place with percentage chips on the screenshot", () => {
    expect(vue).toContain('class="text-covers"');
    expect(vue).toContain("coverChipStyle");
    expect(vue).toContain("pin-overlay");
  });

  it("after covering, translate button becomes 原文 and restores without re-translating", () => {
    expect(vue).toMatch(/function clearOverlay[\s\S]*overlayLines\.value = \[\]/);
    expect(vue).toMatch(/function sendTranslate[\s\S]*if \(hasOverlay\.value\)[\s\S]*clearOverlay/);
    expect(vue).toContain("tip('已恢复原文')");
  });
});
