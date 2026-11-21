export interface ReadonlyTriviaSegment {
  readonly viewFrom: number;
  readonly viewTo: number;
  readonly placeholder?: string;
}

const TERMINAL_MARKS = /^[.!?。！？…]+$/u;
const FACT_ANCHOR = /(?:[A-Za-z0-9]+(?:[._:/+-][A-Za-z0-9]+)*|[+\-]?\d+(?:[.,:/-]\d+)*(?:[%％]|[A-Za-zµμ°][A-Za-z0-9µμ°²³]*)?)$/u;

function uniqueSuffix(value: string, anchor: string): boolean {
  return Boolean(anchor) && value.endsWith(anchor) && value.indexOf(anchor) === value.lastIndexOf(anchor);
}

/** Restores only a source-owned terminal mark omitted after the same final opaque or numeric fact anchor. */
export function restoreSourceTerminalMark(
  sourceView: string,
  modelView: string,
  readonlySegments: readonly ReadonlyTriviaSegment[]
): string {
  const marks = sourceView.match(/[.!?。！？…]+$/u)?.[0];
  if (!marks || !TERMINAL_MARKS.test(marks) || /[.!?。！？…]$/u.test(modelView)) return modelView;

  const markFrom = sourceView.length - marks.length;
  const markSegment = readonlySegments.find(segment =>
    segment.placeholder === undefined && segment.viewFrom <= markFrom && segment.viewTo === sourceView.length);
  if (!markSegment || sourceView.slice(markFrom, markSegment.viewTo) !== marks) return modelView;

  const anchorSegment = readonlySegments.find(segment => segment.viewTo === markFrom && segment.placeholder !== undefined);
  const opaqueAnchor = anchorSegment?.placeholder;
  const readonlyPrefix = sourceView.slice(markSegment.viewFrom, markFrom);
  const factAnchor = readonlyPrefix.match(FACT_ANCHOR)?.[0];
  const anchor = opaqueAnchor ?? (factAnchor && /\d/u.test(factAnchor) ? factAnchor : undefined);
  if (!anchor || !uniqueSuffix(sourceView.slice(0, markFrom), anchor) || !uniqueSuffix(modelView, anchor)) return modelView;

  return modelView + marks;
}
