/**
 * 驱动 shipped pinGeometry：move / zoom / exclusive resize。
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	applyMove,
	applyMoveFromOrigin,
	applyZoom,
	applyResize,
	exclusiveDragMode,
	snapshotDragOrigin,
	layoutStickyPin,
	fitStickyPinSize,
	unionDisplays,
	displayRect,
	dockHeight,
	overlayRelocateTarget,
	remapPinAfterOverlayMove,
	pointInRects,
	sideWindowPlacement,
	DEFAULT_DOCK_H,
} from "./pinGeometry";

const requireCjs = createRequire(import.meta.url);
const cjs = requireCjs(
	path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"../public/preload/pinGeometry.cjs",
	),
);

const WORK = { x: 0, y: 0, width: 1920, height: 1080 };
const PIN = { x: 100, y: 80, width: 400, height: 300 + DEFAULT_DOCK_H };

describe("applyMove", () => {
	it("changes position but never width/height", () => {
		const next = applyMove(PIN, 40, -20, WORK);
		expect(next.width).toBe(PIN.width);
		expect(next.height).toBe(PIN.height);
		expect(next.x).toBe(140);
		expect(next.y).toBe(60);
	});

	it("CJS preload helper matches TS (shipped preload path)", () => {
		const a = applyMove(PIN, 10, 10, WORK);
		const b = cjs.applyMove(PIN, 10, 10, WORK);
		expect(b).toEqual(a);
	});

	it("rounds to integer DIP", () => {
		const next = applyMove(
			{ x: 10.4, y: 20.6, width: 400, height: 300 },
			0.2,
			0.2,
			WORK,
		);
		expect(Number.isInteger(next.x)).toBe(true);
		expect(Number.isInteger(next.y)).toBe(true);
		expect(next.width).toBe(400);
		expect(next.height).toBe(300);
	});
});

describe("snapshotDragOrigin + applyMoveFromOrigin", () => {
	it("ignores inflated live width/height from getBounds (Win DPI)", () => {
		const lastSet = { x: 100, y: 80, width: 400, height: 352 };
		const liveInflated = { x: 100, y: 80, width: 412, height: 360 };
		const origin = snapshotDragOrigin(liveInflated, lastSet);
		expect(origin.width).toBe(400);
		expect(origin.height).toBe(352);
		const moved = applyMoveFromOrigin(origin, 30, 10, WORK);
		expect(moved.width).toBe(400);
		expect(moved.height).toBe(352);
		expect(moved.x).toBe(130);
		expect(moved.y).toBe(90);
	});

	it("CJS snapshot matches TS", () => {
		const live = { x: 1, y: 2, width: 999, height: 888 };
		const last = { x: 1, y: 2, width: 400, height: 300 };
		expect(cjs.snapshotDragOrigin(live, last)).toEqual(
			snapshotDragOrigin(live, last),
		);
	});

	it("repeated moves from origin never grow size even if live bounds inflate", () => {
		const lastSet = { x: 100, y: 80, width: 400, height: 352 };
		let live = { ...lastSet, width: 410, height: 360 };
		for (let i = 1; i <= 20; i++) {
			const origin = snapshotDragOrigin(live, lastSet);
			const next = applyMoveFromOrigin(origin, i * 5, i * 3, WORK);
			expect(next.width).toBe(400);
			expect(next.height).toBe(352);
			live = { ...next, width: next.width + 8, height: next.height + 6 };
		}
	});
});

describe("fitStickyPinSize", () => {
	const HOST = { width: 1920, height: 1080 };

	it("caps a full-screen screenshot to a compact sticky size (was 75% of screen)", () => {
		const f = fitStickyPinSize(2560, 1440, HOST, { dockH: DEFAULT_DOCK_H });
		expect(f.imgW).toBeLessThanOrEqual(600);
		expect(f.imgH).toBeLessThanOrEqual(420 - DEFAULT_DOCK_H);
		expect(f.imgW).toBeLessThan(HOST.width * 0.75);
	});

	it("keeps a small screenshot at native pixel size", () => {
		const f = fitStickyPinSize(300, 200, HOST);
		expect(f.imgW).toBe(300);
		expect(f.imgH).toBe(200);
	});

	it("CJS fitStickyPinSize matches TS", () => {
		const opts = { dockH: DEFAULT_DOCK_H };
		expect(cjs.fitStickyPinSize(2560, 1440, HOST, opts)).toEqual(
			fitStickyPinSize(2560, 1440, HOST, opts),
		);
	});
});
describe("layoutStickyPin", () => {
	it("window size is image plus outside dock, no extra chrome", () => {
		const pin = layoutStickyPin(320, 180);
		expect(pin.width).toBe(320);
		expect(pin.height).toBe(180 + DEFAULT_DOCK_H);
		expect(pin.imgW).toBe(320);
		expect(pin.imgH).toBe(180);
		expect(pin.dockH).toBe(DEFAULT_DOCK_H);
	});

	it("does not pad a small screenshot with black margins", () => {
		const pin = layoutStickyPin(96, 64);
		expect(pin.width).toBe(96);
		expect(pin.height).toBe(64 + DEFAULT_DOCK_H);
	});

	it("CJS layoutStickyPin matches TS", () => {
		expect(cjs.layoutStickyPin(200, 100)).toEqual(layoutStickyPin(200, 100));
	});
});

describe("unionDisplays", () => {
	it("covers a second monitor to the right", () => {
		const u = unionDisplays([
			{ x: 0, y: 0, width: 1920, height: 1080 },
			{ x: 1920, y: 0, width: 1920, height: 1080 },
		]);
		expect(u).toEqual({ x: 0, y: 0, width: 3840, height: 1080 });
	});

	it("covers a second monitor above with negative y", () => {
		const u = unionDisplays([
			{ x: 0, y: 0, width: 1920, height: 1080 },
			{ x: 0, y: -1080, width: 1920, height: 1080 },
		]);
		expect(u).toEqual({ x: 0, y: -1080, width: 1920, height: 2160 });
	});

	it("ignores size-only rects that lack origin so they cannot collapse the union", () => {
		const u = unionDisplays([
			{ x: 0, y: 0, width: 1920, height: 1080 },
			{
				x: Number.NaN,
				y: Number.NaN,
				width: 1920,
				height: 1080,
			} as unknown as { x: number; y: number; width: number; height: number },
		]);
		expect(u).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
	});
});

describe("displayRect", () => {
	it("prefers bounds over size so a second screen keeps its origin", () => {
		const r = displayRect({
			bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
			size: { width: 1920, height: 1080 },
		} as any);
		expect(r).toEqual({ x: 1920, y: 0, width: 1920, height: 1080 });
	});
});

describe("overlayRelocateTarget — second screen is usable", () => {
	const primary = { x: 0, y: 0, width: 1920, height: 1080 };
	const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
	const displays = [primary, secondary];

	it("stays on primary while pin center is still on primary", () => {
		const pin = { x: 100, y: 80, width: 400, height: 300 };
		expect(overlayRelocateTarget(pin, primary, displays)).toBeNull();
	});

	it("requests the right-hand screen once pin center crosses x=1920", () => {
		const pin = { x: 1800, y: 200, width: 400, height: 300 };
		const next = overlayRelocateTarget(pin, primary, displays);
		expect(next).toEqual(secondary);
	});

	it("remaps pin so it stays under the cursor after overlay jumps", () => {
		const pin = { x: 1800, y: 200, width: 400, height: 300 };
		const remapped = remapPinAfterOverlayMove(pin, primary, secondary);
		expect(remapped).toEqual({
			x: 1800 - 1920,
			y: 200,
			width: 400,
			height: 300,
		});
		expect(remapped.x + secondary.x).toBe(pin.x + primary.x);
	});
});

describe("dockHeight", () => {
	it("grows when doodle tools are open so they are not clipped", () => {
		expect(dockHeight(false)).toBe(DEFAULT_DOCK_H);
		expect(dockHeight(true)).toBeGreaterThan(DEFAULT_DOCK_H);
	});
});

describe("applyZoom", () => {
	it("scales by factor and keeps image aspect", () => {
		const aspect = PIN.width / (PIN.height - DEFAULT_DOCK_H);
		const next = applyZoom(PIN, 2, WORK, { dockH: DEFAULT_DOCK_H, aspect });
		const imgH = next.height - DEFAULT_DOCK_H;
		expect(next.width / imgH).toBeCloseTo(aspect, 2);
		expect(next.width).toBeGreaterThan(PIN.width);
		expect(imgH).toBeGreaterThan(PIN.height - DEFAULT_DOCK_H);
	});

	it("CJS zoom matches TS", () => {
		const opts = { dockH: DEFAULT_DOCK_H, aspect: 400 / 300 };
		expect(cjs.applyZoom(PIN, 1.5, WORK, opts)).toEqual(
			applyZoom(PIN, 1.5, WORK, opts),
		);
	});
});

describe("exclusive resize vs move", () => {
	it("keeps move while a resize tries to start", () => {
		expect(exclusiveDragMode("move", "resize")).toBe("move");
	});
	it("keeps resize while a move tries to start", () => {
		expect(exclusiveDragMode("resize", "move")).toBe("resize");
	});
	it("CJS exclusiveDragMode matches", () => {
		expect(cjs.exclusiveDragMode("move", "resize")).toBe("move");
	});
	it("resize changes size; a following move of the result does not", () => {
		const resized = applyResize(PIN, { edge: "se", dx: 80, dy: 40 }, WORK, {
			dockH: DEFAULT_DOCK_H,
			aspect: 400 / 300,
		});
		expect(resized.width).not.toBe(PIN.width);
		const moved = applyMove(resized, 30, 30, WORK);
		expect(moved.width).toBe(resized.width);
		expect(moved.height).toBe(resized.height);
	});
});

describe("pointInRects", () => {
	it("counts overflowing doodle below the pin as a hit (ignore-mouse must not punch through)", () => {
		const pin = { x: 100, y: 80, width: 200, height: 160 };
		const doodle = { x: 40, y: 244, width: 320, height: 40 };
		expect(pointInRects(180, 100, [pin, doodle])).toBe(true);
		expect(pointInRects(50, 260, [pin, doodle])).toBe(true);
		expect(pointInRects(50, 400, [pin, doodle])).toBe(false);
	});

	it("CJS pointInRects matches TS", () => {
		const rects = [{ x: 0, y: 0, width: 10, height: 10 }];
		expect(cjs.pointInRects(5, 5, rects)).toEqual(pointInRects(5, 5, rects));
	});
});

describe("sideWindowPlacement", () => {
	const WORK = { x: 0, y: 0, width: 1920, height: 1080 };
	const SIDE = { w: 360, h: 520 };
	const board = { x: 200, y: 150, width: 400, height: 300 };

	it("snaps to the right when it fits, bottom-aligned to the screenshot image", () => {
		const p = sideWindowPlacement(board, WORK, SIDE.w, SIDE.h);
		expect(p).toEqual({ x: 200 + 400 + 12, y: 0 });
	});
    it("aligns result bottom-left with screenshot bottom-right when board includes dock", () => {
        const boardWithDock = { x: 200, y: 500, width: 400, height: 300 + DEFAULT_DOCK_H };
        const p = sideWindowPlacement(boardWithDock, WORK, SIDE.w, 200, DEFAULT_DOCK_H);
        expect(p).toEqual({ x: 200 + 400 + 12, y: 500 + 300 - 200 });
    });

	it("snaps to the left when right overflows, bottom-aligned to the screenshot image", () => {
		const nearRight = { x: 1500, y: 150, width: 400, height: 300 };
		const p = sideWindowPlacement(nearRight, WORK, SIDE.w, SIDE.h);
		expect(p).toEqual({ x: 1500 - 12 - 360, y: 0 });
	});

	it("snaps below only when both sides overflow", () => {
		const fullWidth = { x: 0, y: 100, width: 1920, height: 200 };
		const p = sideWindowPlacement(fullWidth, WORK, SIDE.w, SIDE.h);
		expect(p).toEqual({ x: 0, y: 100 + 200 + 12 });
	});

	it("snaps to the left as last resort, clamped inside work", () => {
		const corner = { x: 1800, y: 900, width: 400, height: 300 };
		const p = sideWindowPlacement(corner, WORK, SIDE.w, SIDE.h);
		expect(p.x).toBeLessThan(corner.x);
		expect(p.y + SIDE.h).toBeLessThanOrEqual(WORK.height);
	});

	it("follows the board when it moves (same side, new offset)", () => {
		const moved = { x: 300, y: 200, width: 400, height: 300 };
		const p = sideWindowPlacement(moved, WORK, SIDE.w, SIDE.h);
		expect(p).toEqual({ x: 300 + 400 + 12, y: 0 });
	});

	it("CJS placement matches TS", () => {
		expect(cjs.sideWindowPlacement(board, WORK, SIDE.w, SIDE.h)).toEqual(
			sideWindowPlacement(board, WORK, SIDE.w, SIDE.h),
		);
	});
});
