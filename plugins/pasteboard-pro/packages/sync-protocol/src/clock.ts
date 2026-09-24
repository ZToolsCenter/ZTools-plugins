import type { HybridClock } from "@pasteboard-pro/core";

export function compareClock(a: HybridClock, b: HybridClock): -1 | 0 | 1 {
  if (a.wallMs < b.wallMs) {
    return -1;
  }
  if (a.wallMs > b.wallMs) {
    return 1;
  }

  if (a.counter < b.counter) {
    return -1;
  }
  if (a.counter > b.counter) {
    return 1;
  }

  if (a.deviceId < b.deviceId) {
    return -1;
  }
  if (a.deviceId > b.deviceId) {
    return 1;
  }

  return 0;
}

export function pickNewer<T>(
  left: T,
  leftClock: HybridClock,
  right: T,
  rightClock: HybridClock,
): T {
  const clockOrder = compareClock(leftClock, rightClock);

  if (clockOrder > 0) {
    return left;
  }
  if (clockOrder < 0) {
    return right;
  }

  // Generic values only use primitive/referential equality;
  // merge helpers own domain semantics.
  if (Object.is(left, right)) {
    return left;
  }

  throw new RangeError("Values conflict at an equal clock");
}
