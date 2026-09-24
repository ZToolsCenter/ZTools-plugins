/**
 * CommonJS 镜像：与 src/pinGeometry.ts 同一算法，供 preload require。
 * 测试走 TS 模块；preload 走本文件。两者签名必须保持一致。
 */
function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}
function clampRect(r, work) {
	const width = Math.round(Math.min(r.width, work.width));
	const height = Math.round(Math.min(r.height, work.height));
	const x = Math.round(clamp(r.x, work.x, work.x + work.width - width));
	const y = Math.round(clamp(r.y, work.y, work.y + work.height - height));
	return { x, y, width, height };
}

function snapshotDragOrigin(live, lastSet) {
	return {
		x: live.x,
		y: live.y,
		width:
			lastSet && lastSet.width > 0 ? lastSet.width : Math.round(live.width),
		height:
			lastSet && lastSet.height > 0 ? lastSet.height : Math.round(live.height),
	};
}

function applyMoveFromOrigin(origin, dx, dy, work) {
	return applyMove(origin, dx, dy, work);
}

const DEFAULT_DOCK_H = 40;
const COLLAPSED_DOCK_H = 26;
const DOODLE_DOCK_H = 80;
const MIN_IMG_W = 80;
const MIN_IMG_H = 48;

function dockHeight(doodleOpen) {
	return doodleOpen ? DOODLE_DOCK_H : DEFAULT_DOCK_H;
}

function displayRect(d) {
	if (!d) return null;
	const r = d.bounds || d.workArea;
	if (r && r.width > 0 && r.height > 0 && isFinite(r.x) && isFinite(r.y)) {
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	}
	if (isFinite(d.x) && isFinite(d.y) && d.width > 0 && d.height > 0) {
		return { x: d.x, y: d.y, width: d.width, height: d.height };
	}
	return null;
}

function unionDisplays(rects) {
	const ok = (rects || []).filter(
		(r) => r && r.width > 0 && r.height > 0 && isFinite(r.x) && isFinite(r.y),
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

function layoutStickyPin(imgW, imgH, opts) {
	opts = opts || {};
	const dockH = Math.max(0, opts.dockH == null ? DEFAULT_DOCK_H : opts.dockH);
	const w = Math.max(1, Math.round(imgW));
	const h = Math.max(1, Math.round(imgH));
	return { imgW: w, imgH: h, dockH, width: w, height: h + dockH };
}

function fitStickyPinSize(imgW, imgH, host, opts) {
	opts = opts || {};
	const dockH = Math.max(0, opts.dockH == null ? DEFAULT_DOCK_H : opts.dockH);
	const maxW = Math.min(host.width * 0.5, 600);
	const maxH = Math.max(1, Math.min(host.height * 0.5, 420) - dockH);
	const scale = Math.min(1, maxW / Math.max(imgW, 1), maxH / Math.max(imgH, 1));
	return { imgW: imgW * scale, imgH: imgH * scale };
}
function applyMove(bounds, dx, dy, work) {
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

function applyZoom(bounds, factor, work, opts) {
	opts = opts || {};
	if (!(factor > 0) || factor === 1) {
		return {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
		};
	}
	const dockH = Math.max(0, opts.dockH == null ? DEFAULT_DOCK_H : opts.dockH);
	const curImgH = Math.max(1, bounds.height - dockH);
	const aspect =
		opts.aspect && opts.aspect > 0.05 ? opts.aspect : bounds.width / curImgH;

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

function applyResize(bounds, input, work, opts) {
	opts = opts || {};
	const dockH = Math.max(0, opts.dockH == null ? DEFAULT_DOCK_H : opts.dockH);
	const edge = String(input.edge || "se");
	const dx = Number(input.dx) || 0;
	const dy = Number(input.dy) || 0;
	const aspect =
		opts.aspect && opts.aspect > 0.05
			? opts.aspect
			: bounds.width / Math.max(bounds.height - dockH, 1);

	let x = bounds.x;
	let y = bounds.y;
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

function exclusiveDragMode(current, incoming) {
	if (incoming === "none") return "none";
	if (current === "none") return incoming;
	if (current === "move" && incoming === "resize") return "move";
	if (current === "resize" && incoming === "move") return "resize";
	return incoming;
}

function displayContaining(point, displays) {
	for (let i = 0; i < displays.length; i++) {
		const d = displays[i];
		if (
			point.x >= d.x &&
			point.x < d.x + d.width &&
			point.y >= d.y &&
			point.y < d.y + d.height
		) {
			return d;
		}
	}
	return null;
}

function overlayRelocateTarget(pin, overlay, displays) {
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

function remapPinAfterOverlayMove(pin, oldO, newO) {
	return {
		x: pin.x + oldO.x - newO.x,
		y: pin.y + oldO.y - newO.y,
		width: pin.width,
		height: pin.height,
	};
}

function resolveInjectedPin(current, injected, userMoved) {
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

function pinForBoardInject(initialPinLocal, lastSetBounds, overlay) {
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

function pinOriginFromCaptureBounds(bounds, host, pinW, pinH, fallback) {
	const clamp = (v, max) => Math.min(Math.max(0, Math.round(v)), Math.max(0, Math.round(max)));
	if (
		!bounds ||
		!Number.isFinite(bounds.x) ||
		!Number.isFinite(bounds.y) ||
		!host ||
		!(host.width > 0) ||
		!(host.height > 0)
	) {
		const fb = fallback;
		return {
			x: clamp(fb?.x ?? (host?.width ?? 0) / 2 - pinW / 2, (host?.width ?? 0) - pinW),
			y: clamp(fb?.y ?? (host?.height ?? 0) / 2 - pinH / 2, (host?.height ?? 0) - pinH),
		};
	}
	return {
		x: clamp(bounds.x - host.x, host.width - pinW),
		y: clamp(bounds.y - host.y, host.height - pinH),
	};
}

function pointInRects(x, y, rects) {
	for (let i = 0; i < (rects || []).length; i++) {
		const r = rects[i];
		if (!r || !(r.width > 0) || !(r.height > 0)) continue;
		if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
			return true;
	}
	return false;
}

function sideWindowPlacement(board, work, sideW, sideH, dockH) {
	if (dockH == null) dockH = 0;
	const gap = 12;
	const imageBottom = board.y + Math.max(0, board.height - dockH);
	const clampX = (v) =>
		Math.max(work.x, Math.min(v, work.x + work.width - sideW));
	const clampY = (v) =>
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

module.exports = {
	DEFAULT_DOCK_H,
	COLLAPSED_DOCK_H,
	DOODLE_DOCK_H,
	MIN_IMG_W,
	MIN_IMG_H,
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
	resolveInjectedPin,
	pinForBoardInject,
	pinOriginFromCaptureBounds,
	pointInRects,
	sideWindowPlacement,
};
