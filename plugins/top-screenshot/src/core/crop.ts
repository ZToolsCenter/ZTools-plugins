import type { Rect } from './geometry';

export function selectionToSourcePixels(selection: Rect, scaleFactor: number): Rect {
  return {
    x: Math.round(selection.x * scaleFactor),
    y: Math.round(selection.y * scaleFactor),
    width: Math.round(selection.width * scaleFactor),
    height: Math.round(selection.height * scaleFactor),
  };
}

export async function cropImageDataUrl(sourceDataUrl: string, selection: Rect, scaleFactor: number): Promise<string> {
  const image = await loadImage(sourceDataUrl);
  const sourcePixels = selectionToSourcePixels(selection, scaleFactor);
  const canvas = document.createElement('canvas');
  canvas.width = sourcePixels.width;
  canvas.height = sourcePixels.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is not available.');
  }

  context.drawImage(
    image,
    sourcePixels.x,
    sourcePixels.y,
    sourcePixels.width,
    sourcePixels.height,
    0,
    0,
    sourcePixels.width,
    sourcePixels.height,
  );
  return canvas.toDataURL('image/png');
}

function loadImage(sourceDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load screenshot image.'));
    image.src = sourceDataUrl;
  });
}
