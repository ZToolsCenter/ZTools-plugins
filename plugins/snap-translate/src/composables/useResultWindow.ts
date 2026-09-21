/**
 * 结果窗口编排：createBrowserWindow 开无边框窗 + executeJavaScript 注入数据。
 *
 * 纯文字结果窗：不再按截图尺寸排版（图不展示），固定舒适尺寸。
 *   - 注入走 window.__loadSnapResult(payload)，创建回调 + 800ms 幂等兜底双保险
 *     （部分宿主实现 callback 不可靠）。
 */

/** 结果面板固定宽度（DIP）。 */
const RESULT_PANE_W = 420;

/** 把数据注入子窗口（幂等：子窗口重复 load 同一 payload 无副作用）。 */
function injectData(win: any, payload: SnapResultPayload): void {
	try {
		const code =
			"window.__loadSnapResult && window.__loadSnapResult(" +
			JSON.stringify(payload) +
			");";
		win.webContents.executeJavaScript(code);
	} catch (_) {
		/* ignore：兜底注入会再试 */
	}
}

/**
 * 打开结果窗口并注入 payload。成功返回 true。
 * 调用方在此之后自行 outPlugin 退出主窗口。
 */
export function openResultWindow(payload: SnapResultPayload): boolean {
	const display = window.ztools.getPrimaryDisplay();
	const workArea = display.workArea;
	const screenWDip = workArea.width;
	const screenHDip = workArea.height;
	const scaleFactor = display.scaleFactor || 1;

	// 纯文字结果：固定舒适宽度，高度占工作区 ~70%
	const winW = Math.min(
		Math.round((RESULT_PANE_W * 1.15) / scaleFactor),
		screenWDip,
	);
	const winH = Math.min(Math.round(screenHDip * 0.7), screenHDip);

	try {
		const win = window.ztools.createBrowserWindow(
			"result.html",
			{
				width: Math.max(winW, 360),
				height: winH,
				x: workArea.x + Math.floor((screenWDip - winW) / 2),
				y: workArea.y + Math.floor((screenHDip - winH) / 2),
				resizable: true,
				frame: false, // 无边框：标题栏与关闭按钮在子窗口内自绘
				title: "截图翻译结果",
				icon:
					window.services.pluginLogoNativeImage() ||
					window.services.pluginLogoPath(),
				minWidth: 340,
				minHeight: 320,
				maxWidth: screenWDip,
				maxHeight: screenHDip,
				webPreferences: {
					zoomFactor: 1,
				},
			},
			() => injectData(win, payload),
		);
		// 兜底：部分实现 callback 不可靠，延后再注入一次（幂等）
		window.setTimeout(() => injectData(win, payload), 800);
		return true;
	} catch (_) {
		return false;
	}
}
