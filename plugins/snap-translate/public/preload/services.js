const fs = require("node:fs");
const path = require("node:path");
const {
	layoutStickyPin,
	displayRect,
	overlayRelocateTarget,
	remapPinAfterOverlayMove,
	pinForBoardInject,
	pinOriginFromCaptureBounds,
	sideWindowPlacement,
	DEFAULT_DOCK_H,
} = require("./pinGeometry.cjs");
const { attachProviders } = require("./providers.cjs");

// ──────────────────────────────────────────────────────────────────────────
// snap-translate preload：Node 能力 + 悬浮贴 / 侧边结果窗编排
// ──────────────────────────────────────────────────────────────────────────

let boardWin = null;
let sideWin = null;
let boardIpcBound = false;
let boardHandlers = null;
/** 保持宽高比（物理像素 / 当前 DIP 宽） */
let boardAspect = 1;
/** 贴图在屏幕上的矩形（给结果窗贴边用） */
let lastSetBounds = null;
/** 当前贴图层所在的那一块屏（Win 不能用一张窗盖两屏） */
let overlayBounds = null;
let displayList = [];
/** 结果窗最近一次设置的尺寸（Win 无边框窗 getBounds 会读肥，跟随时不回读） */
let sideSize = null;
/** 结果窗默认宽 / 高度上限 */
const SIDE_W = 320;
const SIDE_MAX_H = 420;

function bindBoardIpc() {
	if (boardIpcBound) return;
	boardIpcBound = true;
	try {
		const { ipcRenderer } = require("electron");
		ipcRenderer.on("snap-board", async (_event, data) => {
			const handlers = boardHandlers;
			if (!data) return;
			const action = data.action;
			try {
				if (action === "pin-rect") {
					if (data && data.width > 0 && data.height > 0) {
						lastSetBounds = {
							x: Number(data.x) || 0,
							y: Number(data.y) || 0,
							width: Number(data.width),
							height: Number(data.height),
						};
						// 拖动中绝不搬层：Win 透明窗 setBounds 会把尺寸读肥，拖一次大一圈。
						// 松手后再搬，贴图绝对位置不变。
						if (!data.dragging) {
							maybeRelocateOverlay();
							// 拖动中不实时贴边：Win 无边框窗高频 setBounds 会闪黑，松手后统一吸附一次。
							followSideWithBoard();
						}
					}
					return;
				}
				if (action === "relocate-overlay") {
					relocateOverlay(data);
					return;
				}
				if (action === "ignore-mouse") {
					setIgnoreMouse(!!data.ignore);
					return;
				}
				if (action === "getBounds") {
					return;
				}
				if (!handlers) return;
				if (action === "ocr" && typeof handlers.onOcr === "function") {
					await handlers.onOcr(data);
				} else if (
					action === "translate" &&
					typeof handlers.onTranslate === "function"
				) {
					await handlers.onTranslate(data);
				} else if (
					action === "ocr-translate" &&
					typeof handlers.onOcrTranslate === "function"
				) {
					await handlers.onOcrTranslate(data);
				} else if (
					action === "close" &&
					typeof handlers.onClose === "function"
				) {
					await handlers.onClose(data);
				} else if (action === "log" && typeof handlers.onLog === "function") {
					handlers.onLog(data);
				} else if (
					action === "copy-image" &&
					typeof handlers.onCopyImage === "function"
				) {
					await handlers.onCopyImage(data);
				} else if (
					action === "open-settings" &&
					typeof handlers.onOpenSettings === "function"
				) {
					await handlers.onOpenSettings(data);
				} else if (action === "save" && typeof handlers.onSave === "function") {
					await handlers.onSave(data);
				}
			} catch (err) {
				const msg = err && err.message ? String(err.message) : String(err);
				injectBoardUpdate({ type: "error", message: msg });
			}
		});
	} catch (e) {
		console.error("[snap-translate] bindBoardIpc failed", e);
	}
}

function raiseBoard() {
	if (!boardWin || boardWin.isDestroyed?.()) return;
	try {
		if (typeof boardWin.setAlwaysOnTop === "function")
			boardWin.setAlwaysOnTop(true);
		if (typeof boardWin.moveTop === "function") boardWin.moveTop();
	} catch (_) {
		/* ignore */
	}
}

function injectBoardUpdate(payload) {
	if (!boardWin || boardWin.isDestroyed?.()) return;
	try {
		const code =
			"window.__boardUpdate && window.__boardUpdate(" +
			JSON.stringify(payload) +
			");";
		boardWin.webContents.executeJavaScript(code);
	} catch (_) {
		/* ignore */
	}
	raiseBoard();
}

function injectSideResult(payload) {
	if (!sideWin || sideWin.isDestroyed?.()) return;
	try {
		const code =
			"window.__loadSnapResult && window.__loadSnapResult(" +
			JSON.stringify(payload) +
			");";
		sideWin.webContents.executeJavaScript(code);
	} catch (_) {
		/* ignore */
	}
}

function decodePngSize(dataUri) {
	try {
		const m = /^data:image\/png;base64,(.+)$/i.exec(dataUri);
		if (!m) return null;
		const head = Buffer.from(m[1].slice(0, 48), "base64");
		if (head.length < 24) return null;
		const width = head.readUInt32BE(16);
		const height = head.readUInt32BE(20);
		if (!width || !height) return null;
		return { width, height };
	} catch (_) {
		return null;
	}
}

function getBoardBounds() {
	if (lastSetBounds && lastSetBounds.width > 0) return lastSetBounds;
	if (!boardWin || boardWin.isDestroyed?.()) return null;
	try {
		return boardWin.getBounds();
	} catch (_) {
		return null;
	}
}

function setIgnoreMouse(ignore) {
	if (!boardWin || boardWin.isDestroyed?.()) return;
	try {
		if (typeof boardWin.setIgnoreMouseEvents === "function") {
			boardWin.setIgnoreMouseEvents(!!ignore, { forward: true });
		}
	} catch (_) {
		/* ignore */
	}
}
/** 结果窗应放在悬浮贴所在屏幕，避免用主屏坐标导致副屏上超出窗口/黑屏。 */
function getSideWorkArea() {
	const bb = getBoardBounds();
	const anchor = bb || overlayBounds;
	try {
		const all =
			typeof window.ztools.getAllDisplays === "function"
				? window.ztools.getAllDisplays()
				: [window.ztools.getPrimaryDisplay()];
		if (anchor) {
			const cx = anchor.x + anchor.width / 2;
			const cy = anchor.y + anchor.height / 2;
			const hit = (all || []).find((d) => {
				const rect = d.workArea || d.bounds;
				return (
					rect &&
					cx >= rect.x &&
					cx < rect.x + rect.width &&
					cy >= rect.y &&
					cy < rect.y + rect.height
				);
			});
			if (hit) {
				if (hit.workArea) return hit.workArea;
				const r = displayRect(hit) || hit.bounds;
				if (r) return r;
			}
		}
	} catch (_) {
		/* fallthrough */
	}
	if (overlayBounds) return overlayBounds;
	return window.ztools.getPrimaryDisplay().workArea;
}

/** 贴图移动时，结果弹窗吸附跟随（若已打开）。 */
function followSideWithBoard() {
	if (!sideWin || sideWin.isDestroyed?.() || !lastSetBounds) return;
	try {
		const work = getSideWorkArea();
		const w = Math.round(sideSize?.width || SIDE_W);
		const h = Math.round(
			sideSize?.height || Math.min(SIDE_MAX_H, work.height - 40),
		);
		const p = sideWindowPlacement(lastSetBounds, work, w, h, DEFAULT_DOCK_H);
		// Win 无边框窗 setPosition 会把尺寸读肥（Electron #9477）：连尺寸一起 setBounds
		if (typeof sideWin.setBounds === "function") {
			sideWin.setBounds({
				x: Math.round(p.x),
				y: Math.round(p.y),
				width: w,
				height: h,
			});
		} else {
			sideWin.setPosition(Math.round(p.x), Math.round(p.y));
		}
		raiseBoard();
	} catch (_) {
		/* ignore */
	}
}

function listDisplays() {
	try {
		const all =
			typeof window.ztools.getAllDisplays === "function"
				? window.ztools.getAllDisplays()
				: [window.ztools.getPrimaryDisplay()];
		const rects = (all || []).map(displayRect).filter(Boolean);
		if (rects.length) return rects;
	} catch (_) {
		/* fallthrough */
	}
	const d = window.ztools.getPrimaryDisplay();
	return [displayRect(d) || d.bounds || d.workArea];
}

function maybeRelocateOverlay() {
	if (!boardWin || boardWin.isDestroyed?.() || !lastSetBounds || !overlayBounds)
		return;
	const pinLocal = {
		x: lastSetBounds.x - overlayBounds.x,
		y: lastSetBounds.y - overlayBounds.y,
		width: lastSetBounds.width,
		height: lastSetBounds.height,
	};
	const next = overlayRelocateTarget(pinLocal, overlayBounds, displayList);
	if (!next) return;
	relocateOverlay(next);
}

function relocateOverlay(next) {
	if (!boardWin || boardWin.isDestroyed?.() || !overlayBounds || !next) return;
	const pinLocal = lastSetBounds
		? {
				x: lastSetBounds.x - overlayBounds.x,
				y: lastSetBounds.y - overlayBounds.y,
				width: lastSetBounds.width,
				height: lastSetBounds.height,
			}
		: { x: 80, y: 80, width: 400, height: 320 };
	const remapped = remapPinAfterOverlayMove(pinLocal, overlayBounds, next);
	const px = Math.max(0, Math.min(remapped.x, next.width - remapped.width));
	const py = Math.max(0, Math.min(remapped.y, next.height - remapped.height));
	overlayBounds = {
		x: next.x,
		y: next.y,
		width: next.width,
		height: next.height,
	};
	lastSetBounds = {
		x: next.x + px,
		y: next.y + py,
		width: remapped.width,
		height: remapped.height,
	};
	try {
		boardWin.setBounds(
			{ x: next.x, y: next.y, width: next.width, height: next.height },
			false,
		);
	} catch (_) {
		try {
			boardWin.setBounds({
				x: next.x,
				y: next.y,
				width: next.width,
				height: next.height,
			});
		} catch (e2) {
			/* ignore */
		}
	}
	injectBoardUpdate({
		type: "overlay",
		overlay: overlayBounds,
		pin: { x: px, y: py, width: remapped.width, height: remapped.height },
	});
}

window.services = {
	readFileAsDataURL(file) {
		const buf = fs.readFileSync(file);
		const ext = path.extname(file).toLowerCase().replace(/^\./, "");
		const mimeMap = {
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif",
			bmp: "image/bmp",
			webp: "image/webp",
			svg: "image/svg+xml",
		};
		const mime = mimeMap[ext] || "image/png";
		return "data:" + mime + ";base64," + buf.toString("base64");
	},

	pluginLogoPath() {
		return path.join(__dirname, "..", "logo.png");
	},

	pluginLogoDataUrl() {
		try {
			const buf = fs.readFileSync(path.join(__dirname, "..", "logo.png"));
			return "data:image/png;base64," + buf.toString("base64");
		} catch (_) {
			return "";
		}
	},

	/** 把 data URI 图片写到用户选择的路径（至少 PNG）。 */
	saveImageFile(dataUrl, destPath) {
		const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || "");
		if (!m) throw new Error("invalid image data URL");
		const buf = Buffer.from(m[2], "base64");
		if (!buf.length) throw new Error("empty image");
		fs.writeFileSync(destPath, buf);
		return destPath;
	},

	pluginLogoNativeImage() {
		try {
			const { nativeImage } = require("electron");
			return nativeImage.createFromPath(path.join(__dirname, "..", "logo.png"));
		} catch (_) {
			return null;
		}
	},

	setBoardHandlers(handlers) {
		boardHandlers = handlers || null;
		bindBoardIpc();
	},

	injectBoardUpdate,
	getBoardBounds,

	/**
	 * 截图后直接打开：纯图片无边框悬浮贴（可边缘缩放 / 拖动 / 涂鸦）。
	 */
	openStickyBoard(payload) {
		bindBoardIpc();
		const image = payload && payload.image;
		if (!image) return false;
		/** 宿主 screenCapture 第二参：截图区域（文档写明 bounds {x,y,width,height}）。 */
		const captureBounds = payload && payload.captureBounds;

		const display = window.ztools.getPrimaryDisplay();
		displayList = listDisplays();
		let host = displayRect(display) || display.bounds || display.workArea;
		// 优先按截图区域所在屏选 overlay，而不是跟着光标
		if (captureBounds && Number.isFinite(captureBounds.x) && Number.isFinite(captureBounds.y)) {
			const cx = captureBounds.x + (Number(captureBounds.width) || 0) / 2;
			const cy = captureBounds.y + (Number(captureBounds.height) || 0) / 2;
			const hit = displayList.find(
				(d) =>
					cx >= d.x &&
					cx < d.x + d.width &&
					cy >= d.y &&
					cy < d.y + d.height,
			);
			if (hit) host = hit;
		} else {
			try {
				if (typeof window.ztools.getCursorScreenPoint === "function") {
					const pt = window.ztools.getCursorScreenPoint();
					const hit = displayList.find(
						(d) =>
							pt.x >= d.x &&
							pt.x < d.x + d.width &&
							pt.y >= d.y &&
							pt.y < d.y + d.height,
					);
					if (hit) host = hit;
				}
			} catch (_) {
				/* 落在主屏 */
			}
		}
		const scaleFactor = display.scaleFactor || 1;
		const imgSize = decodePngSize(image);

		const DOCK_H = DEFAULT_DOCK_H;
		// 贴图与截图同大小（物理像素 ÷ DPI = DIP），打开时不自动缩小；大小只靠滚轮调节
		let imgW = 400;
		let imgH = 280;
		if (imgSize) {
			imgW = Math.max(1, Math.round(imgSize.width / scaleFactor));
			imgH = Math.max(1, Math.round(imgSize.height / scaleFactor));
		}
		const pin = layoutStickyPin(imgW, imgH, { dockH: DOCK_H });
		imgW = pin.imgW;
		imgH = pin.imgH;
		boardAspect = imgW / Math.max(imgH, 1);

		// bounds 可能是物理像素：与截图物理宽接近则转 DIP，保证贴在截图原处
		let boundsDip = captureBounds;
		if (
			captureBounds &&
			imgSize &&
			Number.isFinite(captureBounds.width) &&
			scaleFactor > 1 &&
			Math.abs(captureBounds.width - imgSize.width) <= Math.max(2, imgSize.width * 0.03) &&
			Math.abs(captureBounds.width - pin.width) > Math.max(2, pin.width * 0.03)
		) {
			try {
				if (typeof window.ztools.screenToDipPoint === "function") {
					const a = window.ztools.screenToDipPoint({
						x: captureBounds.x,
						y: captureBounds.y,
					});
					const b = window.ztools.screenToDipPoint({
						x: captureBounds.x + captureBounds.width,
						y: captureBounds.y + (captureBounds.height || 0),
					});
					if (a && b && Number.isFinite(a.x) && Number.isFinite(b.x)) {
						boundsDip = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
					}
				}
			} catch (_) {
				/* keep captureBounds */
			}
		}

		const origin = pinOriginFromCaptureBounds(
			boundsDip,
			host,
			pin.width,
			pin.height,
			// 无 bounds 时退回屏幕中心（稳定），不跟光标乱跳
			{
				x: (host.width - pin.width) / 2,
				y: (host.height - pin.height) / 2,
			},
		);
		const pinX = origin.x;
		const pinY = origin.y;

		const inject = () => {
			if (!boardWin || boardWin.isDestroyed?.()) return;
			try {
				// 用户已拖动时用 lastSetBounds，避免 400/900ms 兜底 inject 把贴图拉回打开位置
				const pinLocal = pinForBoardInject(
					{ x: pinX, y: pinY, width: pin.width, height: pin.height },
					lastSetBounds,
					overlayBounds,
				);
				const code =
					"window.__loadSnapBoard && window.__loadSnapBoard(" +
					JSON.stringify({
						image,
						isDark: !!(payload && payload.isDark),
						logo: (payload && payload.logo) || "",
						title: (payload && payload.title) || "悬浮贴",
						pin: {
							x: pinLocal.x,
							y: pinLocal.y,
							width: pinLocal.width,
							height: pinLocal.height,
							dockH: DOCK_H,
						},
						overlay: {
							x: host.x,
							y: host.y,
							width: host.width,
							height: host.height,
						},
					}) +
					");";
				boardWin.webContents.executeJavaScript(code);
			} catch (_) {
				/* ignore */
			}
		};

		try {
			if (boardWin && !boardWin.isDestroyed?.()) {
				try {
					boardWin.close();
				} catch (_) {}
			}

			overlayBounds = {
				x: host.x,
				y: host.y,
				width: host.width,
				height: host.height,
			};
			lastSetBounds = {
				x: host.x + pinX,
				y: host.y + pinY,
				width: pin.width,
				height: pin.height,
			};

			boardWin = window.ztools.createBrowserWindow(
				"board.html",
				{
					width: host.width,
					height: host.height,
					x: host.x,
					y: host.y,
					resizable: false,
					maximizable: false,
					fullscreenable: false,
					frame: false,
					alwaysOnTop: true,
					skipTaskbar: true,
					transparent: true,
					backgroundColor: "#00000000",
					hasShadow: false,
					thickFrame: false,
					title: "悬浮贴",
					icon: this.pluginLogoNativeImage() || this.pluginLogoPath(),
					minWidth: 1,
					minHeight: 1,
					webPreferences: { zoomFactor: 1 },
				},
				() => {
					inject();
					try {
						if (boardWin && typeof boardWin.setAlwaysOnTop === "function") {
							boardWin.setAlwaysOnTop(true);
						}
						if (boardWin && typeof boardWin.moveTop === "function")
							boardWin.moveTop();
					} catch (_) {
						/* ignore */
					}
				},
			);
			setTimeout(inject, 400);
			setTimeout(inject, 900);
			setTimeout(() => {
				try {
					if (boardWin && !boardWin.isDestroyed?.()) {
						if (typeof boardWin.setAlwaysOnTop === "function")
							boardWin.setAlwaysOnTop(true);
						if (typeof boardWin.moveTop === "function") boardWin.moveTop();
					}
				} catch (_) {
					/* ignore */
				}
			}, 500);
			return true;
		} catch (e) {
			console.error("[snap-translate] openStickyBoard failed", e);
			return false;
		}
	},

	closeStickyBoard() {
		if (boardWin && !boardWin.isDestroyed?.()) {
			try {
				boardWin.close();
			} catch (_) {}
		}
		boardWin = null;
		lastSetBounds = null;
		overlayBounds = null;
	},

	/**
	 * 在悬浮贴旁弹出简洁结果框。
	 * OCR 单栏较窄；翻译左右两栏加宽。
	 * @param {object} payload SnapResultPayload
	 */
	openSideResult(payload) {
		const work = getSideWorkArea();
		const bb = getBoardBounds();
		const split = !!(payload && payload.translateOk);
		const boxW = split ? 560 : 380;
		const boxH = Math.min(split ? 340 : 340, work.height - 40);
		sideSize = { width: boxW, height: boxH };

		let x = work.x + work.width - boxW - 16;
		let y = work.y + 40;
		if (bb) {
			const p = sideWindowPlacement(bb, work, boxW, boxH, DEFAULT_DOCK_H);
			x = p.x;
			y = p.y;
		}

		const inject = () => injectSideResult(payload);

		try {
			if (sideWin && !sideWin.isDestroyed?.()) {
				try {
					sideWin.close();
				} catch (_) {}
			}
			sideWin = window.ztools.createBrowserWindow(
				"result.html",
				{
					width: boxW,
					height: boxH,
					x: Math.round(x),
					y: Math.round(y),
					resizable: true,
					frame: false,
					alwaysOnTop: true,
					skipTaskbar: true,
					title: "识别结果",
					icon: this.pluginLogoNativeImage() || this.pluginLogoPath(),
					minWidth: 280,
					minHeight: 240,
					webPreferences: { zoomFactor: 1 },
				},
				() => {
					inject();
					raiseBoard();
				},
			);
			setTimeout(inject, 400);
			setTimeout(inject, 900);
			setTimeout(raiseBoard, 50);
			setTimeout(raiseBoard, 500);
			return true;
		} catch (e) {
			console.error("[snap-translate] openSideResult failed", e);
			return false;
		}
	},

	closeSideResult() {
		if (sideWin && !sideWin.isDestroyed?.()) {
			try {
				sideWin.close();
			} catch (_) {}
		}
		sideWin = null;
	},
};

attachProviders(window.services);
