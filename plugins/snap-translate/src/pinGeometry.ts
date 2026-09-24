/**
 * 悬浮贴几何：move / zoom / resize。preload 与测试共用同一实现。
 * 所有函数纯计算，不碰 window / Electron。
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type WorkArea = { x: number; y: number; width: number; height: number };
export type DragMode = "none" | "move" | "resize";

/** 底栏在图外，不叠图。zoom/resize 保留这段高度。 */
export const DEFAULT_DOCK_H = 40;
/** 收起后的细条高度，与 BoardView .dock.collapsed 保持一致。 */
export const COLLAPSED_DOCK_H = 26;
/** 涂鸦子行展开时的底栏高度，避免工具被裁切。 */
export const DOODLE_DOCK_H = 80;
export const MIN_IMG_W = 80;
export const MIN_IMG_H = 48;

export function dockHeight(doodleOpen: boolean): number {
	return doodleOpen ? DOODLE_DOCK_H : DEFAULT_DOCK_H;
}

/** 从 Display 取带原点的矩形。size 没有 x/y，不能用。 */
export function displayRect(
	d:
		| {
				bounds?: WorkArea;
				workArea?: WorkArea;
				x?: number;
				y?: number;
				width?: number;
				height?: number;
		  }
		| null
		| undefined,
): WorkArea | null {
	if (!d) return null;
	const r = d.bounds || d.workArea;
	if (
		r &&
		r.width > 0 &&
		r.height > 0 &&
		Number.isFinite(r.x) &&
		Number.isFinite(r.y)
	) {
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	}
	if (
		Number.isFinite(d.x) &&
		Number.isFinite(d.y) &&
		(d.width || 0) > 0 &&
		(d.height || 0) > 0
	) {
		return {
			x: d.x as number,
			y: d.y as number,
			width: d.width as number,
			height: d.height as number,
		};
	}
	return null;
}

/** 多显示器 bounds 并集（可含负坐标）。忽略无原点的 size。 */
export function unionDisplays(
	rects: Array<WorkArea | null | undefined>,
): WorkArea {
	const ok = rects.filter(
		(r): r is WorkArea =>
			!!r &&
			r.width > 0 &&
			r.height > 0 &&
			Number.isFinite(r.x) &&
			Number.isFinite(r.y),
	);
	if (!ok.length) return { x: 0, y: 0, width: 1, height: 1 };
	let minX = ok[0].x;
	let minY = ok[0].y;
	let maxX = ok[0].x + ok[0].width;
	let maxY = ok[0].y + ok[0].height;
	for (let i = 1; i < ok.length; i++) {
		const r = ok[i];
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
	}
	return {
		x: Math.round(minX),
		y: Math.round(minY),
		width: Math.max(1, Math.round(maxX - minX)),
		height: Math.max(1, Math.round(maxY - minY)),
	};
}

/** 点落在哪块屏（屏坐标）。 */
export function displayContaining(
	point: { x: number; y: number },
	displays: WorkArea[],
): WorkArea | null {
	const hits = displays.filter(
		(d) =>
			point.x >= d.x &&
			point.x < d.x + d.width &&
			point.y >= d.y &&
			point.y < d.y + d.height,
	);
	if (!hits.length) return null;
	return hits[0];
}

/**
 * Win 会把一张横跨两屏的 BrowserWindow 裁回主屏，所以贴图层必须落在「当前这块屏」。
 * 若 pin 中心已到另一块屏，返回那块屏（调用方搬 overlay）。
 */
export function overlayRelocateTarget(
	pin: Rect,
	overlay: WorkArea,
	displays: WorkArea[],
): WorkArea | null {
	const cx = overlay.x + pin.x + pin.width / 2;
	const cy = overlay.y + pin.y + pin.height / 2;
	const next = displayContaining({ x: cx, y: cy }, displays);
	if (!next) return null;
	if (
		next.x === overlay.x &&
		next.y === overlay.y &&
		next.width === overlay.width &&
		next.height === overlay.height
	) {
		return null;
	}
	return next;
}

/** overlay 从 oldO 搬到 newO 后，pin 的层内坐标。 */
export function remapPinAfterOverlayMove(
	pin: Rect,
	oldO: WorkArea,
	newO: WorkArea,
): Rect {
	return {
		x: pin.x + oldO.x - newO.x,
		y: pin.y + oldO.y - newO.y,
		width: pin.width,
		height: pin.height,
	};
}

/**
 * 延迟 inject 的 pin 是否可以覆盖当前贴图位置。
 * 用户已经拖过 → 绝不能被打开时的初始坐标拉回原位。
 */
export function resolveInjectedPin(
	current: Rect,
	injected: { x: number; y: number; width: number; height: number } | null | undefined,
	userMoved: boolean,
): Rect {
	if (userMoved) return current;
	if (
		injected &&
		Number.isFinite(injected.width) &&
		Number.isFinite(injected.height) &&
		injected.width > 0 &&
		injected.height > 0
	) {
		return {
			x: injected.x,
			y: injected.y,
			width: injected.width,
			height: injected.height,
		};
	}
	return current;
}

/**
 * preload 向 Board 注入 pin 时用的层内坐标：
 * 有 lastSetBounds（含用户拖动后的 pin-rect）则优先用实时位置，否则用打开时的 initial。
 */
export function pinForBoardInject(
	initialPinLocal: { x: number; y: number; width: number; height: number },
	lastSetBounds: { x: number; y: number; width: number; height: number } | null | undefined,
	overlay: { x: number; y: number; width: number; height: number } | null | undefined,
): { x: number; y: number; width: number; height: number } {
	if (lastSetBounds && overlay && lastSetBounds.width > 0 && lastSetBounds.height > 0) {
		return {
			x: lastSetBounds.x - overlay.x,
			y: lastSetBounds.y - overlay.y,
			width: lastSetBounds.width,
			height: lastSetBounds.height,
		};
	}
	return {
		x: initialPinLocal.x,
		y: initialPinLocal.y,
		width: initialPinLocal.width,
		height: initialPinLocal.height,
	};
}

/**
 * 截图原处打开贴图：用 screenCapture 的 bounds（屏幕坐标）得到层内 pin 原点。
 * bounds 与 host 同坐标系时直接相减；若 bounds 更像物理像素则由调用方先转 DIP。
 */
export function pinOriginFromCaptureBounds(
	bounds: { x: number; y: number; width?: number; height?: number } | null | undefined,
	host: WorkArea,
	pinW: number,
	pinH: number,
	fallback: { x: number; y: number } | null | undefined,
): { x: number; y: number } {
	const clamp = (v: number, max: number) => Math.min(Math.max(0, Math.round(v)), Math.max(0, Math.round(max)))
	if (
		!bounds ||
		!Number.isFinite(bounds.x) ||
		!Number.isFinite(bounds.y) ||
		!host ||
		!(host.width > 0) ||
		!(host.height > 0)
	) {
		const fb = fallback
		return {
			x: clamp(fb?.x ?? (host?.width ?? 0) / 2 - pinW / 2, (host?.width ?? 0) - pinW),
			y: clamp(fb?.y ?? (host?.height ?? 0) / 2 - pinH / 2, (host?.height ?? 0) - pinH),
		};
	}
	return {
		x: clamp(bounds.x - host.x, host.width - pinW),
		y: clamp(bounds.y - host.y, host.height - pinH),
	}
}

/** 点是否落在任一矩形内（含边界）。ignore-mouse 要把溢出的底栏/涂鸦算进去。 */
export function pointInRects(
	x: number,
	y: number,
	rects: Array<Rect | null | undefined>,
): boolean {
	for (const r of rects) {
		if (!r || !(r.width > 0) || !(r.height > 0)) continue;
		if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
			return true;
	}
	return false;
}

/** 结果弹窗吸附贴图：右 → 左 → 下，始终留在 work 内（下会挡住底栏）。
 * 右侧/左侧优先与截图图片的右下角对齐（扣除底栏高度），避免结果窗压到悬浮贴菜单。 */
export function sideWindowPlacement(
	board: Rect,
	work: WorkArea,
	sideW: number,
	sideH: number,
	dockH = 0,
): { x: number; y: number } {
	const gap = 12;
	const imageBottom = board.y + Math.max(0, board.height - dockH);
	const clampX = (v: number) =>
		Math.max(work.x, Math.min(v, work.x + work.width - sideW));
	const clampY = (v: number) =>
		Math.max(work.y, Math.min(v, work.y + work.height - sideH));
	if (board.x + board.width + gap + sideW <= work.x + work.width) {
		return { x: clampX(board.x + board.width + gap), y: clampY(imageBottom - sideH) };
	}
	if (board.x - gap - sideW >= work.x) {
		return { x: clampX(board.x - gap - sideW), y: clampY(imageBottom - sideH) };
	}
	if (board.y + board.height + gap + sideH <= work.y + work.height) {
		return { x: clampX(board.x), y: clampY(board.y + board.height + gap) };
	}
	return { x: clampX(board.x - gap - sideW), y: clampY(imageBottom - sideH) };
}

/** 贴窗 = 图 + 图外底栏，不加最小边距。 */
export function layoutStickyPin(
	imgW: number,
	imgH: number,
	opts?: { dockH?: number },
): {
	imgW: number;
	imgH: number;
	dockH: number;
	width: number;
	height: number;
} {
	const dockH = Math.max(0, opts?.dockH ?? DEFAULT_DOCK_H);
	const w = Math.max(1, Math.round(imgW));
	const h = Math.max(1, Math.round(imgH));
	return { imgW: w, imgH: h, dockH, width: w, height: h + dockH };
}

/**
 * 贴图尺寸适配（备用）：打开悬浮贴时已改为保持截图原始 DIP 大小，不再自动缩小。
 * 仅在需要「限制到半屏」的场景使用；默认滚轮可自由缩放。
 */
export function fitStickyPinSize(
	imgW: number,
	imgH: number,
	host: { width: number; height: number },
	opts?: { dockH?: number },
): { imgW: number; imgH: number } {
	const dockH = Math.max(0, opts?.dockH ?? DEFAULT_DOCK_H);
	const maxW = Math.min(host.width * 0.5, 600);
	const maxH = Math.max(1, Math.min(host.height * 0.5, 420) - dockH);
	const scale = Math.min(1, maxW / Math.max(imgW, 1), maxH / Math.max(imgH, 1));
	return { imgW: imgW * scale, imgH: imgH * scale };
}
function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

function clampRect(r: Rect, work: WorkArea): Rect {
	// DIP 必须是整数。Windows 上 setBounds 吃到小数会进位，拖一次大一圈。
	const width = Math.round(Math.min(r.width, work.width));
	const height = Math.round(Math.min(r.height, work.height));
	const x = Math.round(clamp(r.x, work.x, work.x + work.width - width));
	const y = Math.round(clamp(r.y, work.y, work.y + work.height - height));
	return { x, y, width, height };
}

/**
 * 拖动起点快照：位置用当前窗，宽高用上次 setBounds 的值。
 * 禁止每帧 getBounds().width — 透明无边框窗在 Win 上会读出比写入更大的尺寸。
 */
export function snapshotDragOrigin(
	live: Rect,
	lastSet: Rect | null | undefined,
): Rect {
	return {
		x: live.x,
		y: live.y,
		width:
			lastSet && lastSet.width > 0 ? lastSet.width : Math.round(live.width),
		height:
			lastSet && lastSet.height > 0 ? lastSet.height : Math.round(live.height),
	};
}

/** 相对 pointerdown 的累计位移（不要每帧 getBounds + 增量）。 */
export function applyMoveFromOrigin(
	origin: Rect,
	dx: number,
	dy: number,
	work: WorkArea,
): Rect {
	return applyMove(origin, dx, dy, work);
}

/**
 * 体部拖动：只改位置，宽高原样返回。
 */
export function applyMove(
	bounds: Rect,
	dx: number,
	dy: number,
	work: WorkArea,
): Rect {
	return clampRect(
		{
			x: bounds.x + dx,
			y: bounds.y + dy,
			width: bounds.width,
			height: bounds.height,
		},
		work,
	);
}

/**
 * 滚轮缩放：以中心为锚，保持宽高比，保留底部 dock 高度。
 */
export function applyZoom(
	bounds: Rect,
	factor: number,
	work: WorkArea,
	opts?: { dockH?: number; aspect?: number },
): Rect {
	if (!(factor > 0) || factor === 1) {
		return { ...bounds };
	}
	const dockH = Math.max(0, opts?.dockH ?? DEFAULT_DOCK_H);
	const curImgH = Math.max(1, bounds.height - dockH);
	const aspect =
		opts?.aspect && opts.aspect > 0.05 ? opts.aspect : bounds.width / curImgH;

	let imgW = Math.max(MIN_IMG_W, bounds.width * factor);
	let imgH = Math.max(MIN_IMG_H, imgW / aspect);
	let width = Math.round(imgW);
	let height = Math.round(imgH) + dockH;
	imgW = width;
	imgH = height - dockH;

	if (width > work.width) {
		width = work.width;
		imgW = width;
		imgH = Math.max(MIN_IMG_H, Math.round(imgW / aspect));
		height = imgH + dockH;
	}
	if (height > work.height) {
		height = work.height;
		imgH = Math.max(MIN_IMG_H, height - dockH);
		imgW = Math.max(MIN_IMG_W, Math.round(imgH * aspect));
		width = imgW;
		height = imgH + dockH;
	}

	const x = Math.round(bounds.x + (bounds.width - width) / 2);
	const y = Math.round(bounds.y + (bounds.height - height) / 2);
	return clampRect({ x, y, width, height }, work);
}

/**
 * 边缘缩放：保持图片比例；dock 高度固定加在图片下方。
 */
export function applyResize(
	bounds: Rect,
	input: { edge: string; dx: number; dy: number },
	work: WorkArea,
	opts?: { dockH?: number; aspect?: number },
): Rect {
	const dockH = Math.max(0, opts?.dockH ?? DEFAULT_DOCK_H);
	const edge = String(input.edge || "se");
	const dx = Number(input.dx) || 0;
	const dy = Number(input.dy) || 0;
	const aspect =
		opts?.aspect && opts.aspect > 0.05
			? opts.aspect
			: bounds.width / Math.max(bounds.height - dockH, 1);

	let { x, y } = bounds;
	let imgW = bounds.width;

	if (edge.includes("e")) imgW = Math.max(MIN_IMG_W, bounds.width + dx);
	if (edge.includes("w")) {
		const nw = Math.max(MIN_IMG_W, bounds.width - dx);
		x += bounds.width - nw;
		imgW = nw;
	}
	if (
		(edge === "n" || edge === "s") &&
		!edge.includes("e") &&
		!edge.includes("w")
	) {
		const curImgH = Math.max(MIN_IMG_H, bounds.height - dockH);
		const newImgH = Math.max(
			MIN_IMG_H,
			edge === "s" ? curImgH + dy : curImgH - dy,
		);
		imgW = Math.max(MIN_IMG_W, Math.round(newImgH * aspect));
	}

	let imgH = Math.max(MIN_IMG_H, Math.round(imgW / aspect));
	let height = imgH + dockH;
	if (edge.includes("n")) {
		y = bounds.y + bounds.height - height;
	}

	imgW = Math.min(imgW, work.width);
	height = Math.min(height, work.height);
	imgH = height - dockH;
	if (imgH < MIN_IMG_H) {
		imgH = MIN_IMG_H;
		height = imgH + dockH;
		imgW = Math.round(imgH * aspect);
	}

	return clampRect({ x, y, width: imgW, height }, work);
}

/**
 * 手势互斥：move 进行中忽略 resize；resize 进行中忽略 move。
 */
export function exclusiveDragMode(
	current: DragMode,
	incoming: DragMode,
): DragMode {
	if (incoming === "none") return "none";
	if (current === "none") return incoming;
	if (current === "move" && incoming === "resize") return "move";
	if (current === "resize" && incoming === "move") return "resize";
	return incoming;
}

/** 把 data URI 解码为原始字节（copy/save 共用）。 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
	const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl || "");
	if (!m) throw new Error("invalid image data URL");
	const b64 = m[1];
	const atobFn = typeof atob === "function" ? atob : undefined;
	if (atobFn) {
		const bin = atobFn(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	// Node test env without atob: decode via Buffer if present
	const Buf = (
		globalThis as unknown as {
			Buffer?: { from: (s: string, enc: string) => Uint8Array };
		}
	).Buffer;
	if (Buf) return new Uint8Array(Buf.from(b64, "base64"));
	throw new Error("no base64 decoder");
}

export function dataUrlExt(dataUrl: string): string {
	const m = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(dataUrl || "");
	if (!m) return "png";
	const t = m[1].toLowerCase();
	if (t === "jpeg") return "jpg";
	if (t === "svg+xml") return "svg";
	return t;
}

/** OCR/翻译结果窗 payload 构造（侧边结果窗真实入口）。 */
export function buildOcrResultPayload(input: {
	image: string;
	lines: { text: string; translated?: string }[];
	translateOk?: boolean;
	translateError?: string;
	targetLang?: string;
	detectedFrom?: string;
	isDark?: boolean;
	logo?: string;
	diagnostics?: string[];
	ocrProvider?: string;
	translateProvider?: string;
}): SnapResultPayload {
	return {
		image: input.image,
		lines: (input.lines || []).map((l) => ({
			text: String(l.text ?? ""),
			translated: String(l.translated ?? ""),
		})),
		targetLang: input.targetLang || "",
		detectedFrom: input.detectedFrom,
		isDark: !!input.isDark,
		logo: input.logo,
		translateOk: !!input.translateOk,
		translateError: input.translateError,
		diagnostics: input.diagnostics,
		ocrProvider: input.ocrProvider,
		translateProvider: input.translateProvider,
	};
}
