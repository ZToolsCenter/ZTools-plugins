import type { DisplaySnapshot } from './storage';
import type { BrowserWindowOptions, DesktopCaptureSource, ZToolsApi, ZToolsDisplay } from '../types/ztools';

export function getZTools(): ZToolsApi | null {
  return window.ztools ?? null;
}

export function requireZTools(): ZToolsApi {
  const api = getZTools();

  if (!api) {
    throw new Error('ZTools API is not available in this window.');
  }

  return api;
}

export function findSourceForDisplay(display: ZToolsDisplay, sources: DesktopCaptureSource[]): DesktopCaptureSource | null {
  const displayId = String(display.id);
  return sources.find((source) => source.display_id === displayId) ?? sources.find((source) => source.id.split(':').includes(displayId)) ?? null;
}

export function mapDisplaysToSnapshots(displays: ZToolsDisplay[], sources: DesktopCaptureSource[]): DisplaySnapshot[] {
  return displays.flatMap((display) => {
    const source = findSourceForDisplay(display, sources);

    if (!source) {
      return [];
    }

    return [
      {
        displayId: String(display.id),
        bounds: display.bounds,
        imageDataUrl: source.thumbnail.toDataURL(),
        scaleFactor: display.scaleFactor ?? 1,
      },
    ];
  });
}

export async function getDisplaySnapshots(api: ZToolsApi): Promise<DisplaySnapshot[]> {
  const displays = api.getAllDisplays();

  if (displays.length === 0) {
    return [];
  }

  const maxWidth = Math.max(...displays.map((display) => Math.ceil(display.bounds.width * (display.scaleFactor ?? 1))));
  const maxHeight = Math.max(...displays.map((display) => Math.ceil(display.bounds.height * (display.scaleFactor ?? 1))));
  const sources = await api.desktopCaptureSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
  });

  return mapDisplaysToSnapshots(displays, sources);
}

export function createPluginWindow(api: ZToolsApi, url: string, options: BrowserWindowOptions, onReady?: () => void) {
  const win = api.createBrowserWindow(url, options, () => {
    win?.setAlwaysOnTop?.(true, 'floating');
    win?.focus?.();
    onReady?.();
  });

  return win;
}
