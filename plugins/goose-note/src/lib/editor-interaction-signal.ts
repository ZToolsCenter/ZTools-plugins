let _lastInteractionAt = 0;

export function markUserInteraction(): void {
  _lastInteractionAt = Date.now();
}

/** windowMs 毫秒内是否有过用户交互（默认 2000ms） */
export function wasRecentlyInteracting(windowMs = 2000): boolean {
  return Date.now() - _lastInteractionAt < windowMs;
}
