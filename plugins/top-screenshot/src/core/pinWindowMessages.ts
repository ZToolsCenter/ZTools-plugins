import type { Rect } from './geometry';

export const PIN_WINDOW_BOUNDS_CHANNEL = 'top-screenshot-pin-bounds';
export const PIN_WINDOW_CLOSED_CHANNEL = 'top-screenshot-pin-closed';

export type PinWindowBoundsMessage = {
  id: string;
  bounds: Rect;
};

export type PinWindowClosedMessage = {
  id: string;
};

export function isPinWindowBoundsMessage(value: unknown): value is PinWindowBoundsMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<PinWindowBoundsMessage>;
  return typeof message.id === 'string' && isRect(message.bounds);
}

export function isPinWindowClosedMessage(value: unknown): value is PinWindowClosedMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<PinWindowClosedMessage>;
  return typeof message.id === 'string';
}

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const rect = value as Partial<Rect>;
  return typeof rect.x === 'number' && typeof rect.y === 'number' && typeof rect.width === 'number' && typeof rect.height === 'number';
}
