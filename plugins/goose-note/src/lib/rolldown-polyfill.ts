/**
 * Rolldown (Vite 8) tree-shaking bug workaround.
 *
 * Transform.prototype.changedRange is called by BlockNote through Transaction
 * (which extends Transform), but Rolldown's tree-shaking fails to trace the
 * inheritance chain and removes the method. This polyfill restores it at runtime
 * by detecting the missing method and patching it onto the Transaction prototype.
 */
import { Transaction } from "prosemirror-state";

type ChangedRangeResult = { from: number; to: number } | null;

function changedRange(this: Transaction): ChangedRangeResult {
  let from = 1e9;
  let to = -1e9;
  for (let i = 0; i < this.mapping.maps.length; i++) {
    const map = this.mapping.maps[i];
    if (i) {
      from = map.map(from, 1);
      to = map.map(to, -1);
    }
    map.forEach((_f: number, _t: number, fromB: number, toB: number) => {
      from = Math.min(from, fromB);
      to = Math.max(to, toB);
    });
  }
  return from === 1e9 ? null : { from, to };
}

export function applyRolldownPolyfills() {
  if (!(Transaction.prototype as any).changedRange) {
    (Transaction.prototype as any).changedRange = changedRange;
  }
}
