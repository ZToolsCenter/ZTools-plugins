/**
 * 反馈环：贴图首次移动后不得被延迟 inject 拉回原点。
 * 驱动 pinGeometry 纯函数 + BoardView/services 接线契约。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	resolveInjectedPin,
	pinForBoardInject,
	pinOriginFromCaptureBounds,
} from "./pinGeometry";

const dir = path.dirname(fileURLToPath(import.meta.url));
const boardView = readFileSync(path.join(dir, "views/BoardView.vue"), "utf8");
const snapHub = readFileSync(path.join(dir, "views/SnapHub.vue"), "utf8");
const snapBoard = readFileSync(path.join(dir, "views/SnapBoard.vue"), "utf8");
const services = readFileSync(
	path.join(dir, "../public/preload/services.js"),
	"utf8",
);

const OPEN_PIN = { x: 80, y: 80, width: 400, height: 320 };
const MOVED_PIN = { x: 220, y: 160, width: 400, height: 320 };
const OVERLAY = { x: 0, y: 0, width: 1920, height: 1080 };

describe("first-move must not snap back to origin", () => {
	it("resolveInjectedPin keeps user-moved pin when delayed inject sends opening pin", () => {
		const next = resolveInjectedPin(MOVED_PIN, OPEN_PIN, true);
		expect(next.x).toBe(MOVED_PIN.x);
		expect(next.y).toBe(MOVED_PIN.y);
	});

	it("resolveInjectedPin still applies inject before any user move", () => {
		const next = resolveInjectedPin(OPEN_PIN, MOVED_PIN, false);
		expect(next.x).toBe(MOVED_PIN.x);
		expect(next.y).toBe(MOVED_PIN.y);
	});

	it("pinForBoardInject uses live lastSetBounds after first move, not opening pin", () => {
		// preload 打开时记 lastSetBounds；用户拖到 220,160 后 pin-rect 更新 lastSetBounds
		const lastSet = {
			x: OVERLAY.x + MOVED_PIN.x,
			y: OVERLAY.y + MOVED_PIN.y,
			width: MOVED_PIN.width,
			height: MOVED_PIN.height,
		};
		const injectPin = pinForBoardInject(OPEN_PIN, lastSet, OVERLAY);
		expect(injectPin.x).toBe(MOVED_PIN.x);
		expect(injectPin.y).toBe(MOVED_PIN.y);
	});

	it("BoardView load does not blindly overwrite pin after userMoved", () => {
		expect(boardView).toMatch(/userMoved/);
		expect(boardView).toMatch(/resolveInjectedPin/);
		expect(boardView).not.toMatch(
			/if \(data\.pin && data\.pin\.width > 0 && data\.pin\.height > 0\) \{\s*pin\.value = \{/,
		);
	});

	it("services delayed inject does not re-send the opening pin once lastSetBounds moved", () => {
		expect(services).toMatch(/pinForBoardInject/);
		// 不应再写死 inject 时的初始 pinX/pinY 作为唯一来源
		expect(services).not.toMatch(/pin:\s*\{\s*x:\s*pinX,\s*y:\s*pinY,/);
	});

	it("openStickyBoard keeps screenshot size; does not auto-shrink via fitStickyPinSize", () => {
		// 贴图应与截图同大小（DIP），缩放只靠滚轮
		expect(services).not.toMatch(/fitStickyPinSize/);
		expect(services).toMatch(/imgSize\.width \/ scaleFactor/);
		expect(services).toMatch(/imgSize\.height \/ scaleFactor/);
		expect(services).toMatch(/滚轮/);
	});

	it("pin opens at capture bounds (screenshot origin), not cursor", () => {
		expect(services).toMatch(/captureBounds/);
		expect(services).toMatch(/pinOriginFromCaptureBounds/);
		expect(snapHub).toMatch(/captureBounds/);
		expect(snapBoard).toMatch(/captureBounds/);
	});

	it("pinOriginFromCaptureBounds maps screen capture rect to overlay-local pin", () => {
		const host = { x: 100, y: 50, width: 1920, height: 1080 };
		const bounds = { x: 400, y: 200, width: 320, height: 240 };
		const origin = pinOriginFromCaptureBounds(bounds, host, 320, 240 + 40, {
			x: 0,
			y: 0,
		});
		expect(origin.x).toBe(300);
		expect(origin.y).toBe(150);
	});
});
