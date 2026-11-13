// ponytail: Frankfurter blended rates keep 5 significant figures below 1.
// Their plain-decimal example 0.00000054341 has 11 fraction digits.
// The latest table fetched on 2026-11-11 topped out at 9, so the cap stays 11.
export const MAX_FRACTION_DIGITS = 11;
const SCALE = 17;
const POW = 10n ** BigInt(SCALE);

export const COMMON_ORDER = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CNY", "HKD", "TWD", "SGD",
  "CHF", "NZD", "KRW", "THB", "MYR", "INR", "PHP", "IDR", "VND", "MXN",
  "BRL", "ZAR", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY", "AED",
  "SAR", "ILS",
];

export type Board = { base: string; amount: string; codes: string[] };

export function canonicalAmount(raw: string): string | null {
  const text = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [ints, frac] = text.split(".");
  const whole = ints.replace(/^0+/, "") || "0";
  if (frac == null) return whole;
  const tail = frac.replace(/0+$/, "");
  return tail ? `${whole}.${tail}` : whole;
}

export function parseScaled(raw: string): bigint | null {
  const text = canonicalAmount(raw);
  if (text == null) return null;
  const [ints, frac = ""] = text.split(".");
  const head = frac.slice(0, SCALE).padEnd(SCALE, "0");
  let value = BigInt(ints + head);
  if (frac.length > SCALE && frac[SCALE] >= "5") value += 1n;
  return value;
}

function scaledToCanonical(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(SCALE + 1, "0");
  const whole = digits.slice(0, -SCALE).replace(/^0+/, "") || "0";
  const frac = digits.slice(-SCALE).replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

function mulDiv(amount: bigint, quote: bigint, base: bigint): bigint | null {
  if (base === 0n) return null;
  const product = amount * quote;
  let value = product / base;
  const rest = product % base;
  if (rest * 2n >= base) value += 1n;
  return value;
}

export function convertAmount(
  amount: string,
  base: string,
  quote: string,
  rates: Record<string, string>,
): string | null {
  const canonical = canonicalAmount(amount);
  if (canonical == null) return null;
  if (base === quote) return canonical;
  const baseRate = rates[base];
  const quoteRate = rates[quote];
  if (!baseRate || !quoteRate) return null;
  const amountScaled = parseScaled(canonical);
  const baseScaled = parseScaled(baseRate);
  const quoteScaled = parseScaled(quoteRate);
  if (amountScaled == null || baseScaled == null || quoteScaled == null) return null;
  const value = mulDiv(amountScaled, quoteScaled, baseScaled);
  if (value == null) return null;
  return scaledToCanonical(value);
}

export function formatAmount(raw: string, digits: number): string | null {
  const scaled = parseScaled(raw);
  if (scaled == null) return null;
  const places = Math.min(MAX_FRACTION_DIGITS, Math.max(0, digits));
  const factor = 10n ** BigInt(places);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  let rounded = (abs * factor + POW / 2n) / POW;
  const whole = rounded / factor;
  const frac = rounded % factor;
  let text = whole.toString();
  if (places > 0) text += `.${frac.toString().padStart(places, "0")}`;
  return negative ? `-${text}` : text;
}

export function formatGrouped(raw: string, digits: number): string | null {
  const plain = formatAmount(raw, digits);
  if (plain == null) return null;
  const negative = plain.startsWith("-");
  const body = negative ? plain.slice(1) : plain;
  const [whole, frac] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = frac != null ? `${grouped}.${frac}` : grouped;
  return negative ? `-${text}` : text;
}

export function formatPercent(prev: string, next: string): string | null {
  const prevScaled = parseScaled(prev);
  const nextScaled = parseScaled(next);
  if (prevScaled == null || nextScaled == null || prevScaled === 0n) return null;
  const diff = nextScaled - prevScaled;
  const negative = diff < 0n;
  const divisor = prevScaled < 0n ? -prevScaled : prevScaled;
  const ticks = ((negative ? -diff : diff) * 1_000_000n + divisor / 2n) / divisor;
  const whole = ticks / 10000n;
  const frac = ticks % 10000n;
  return `${negative ? "-" : "+"}${whole.toString()}.${frac.toString().padStart(4, "0")}%`;
}

export function commitRowAmount(board: Board, code: string, raw: string): Board | null {
  const amount = canonicalAmount(raw);
  if (amount == null) return null;
  const codes = board.codes.includes(code) ? board.codes : board.codes.concat(code);
  if (code === board.base) return { base: board.base, amount, codes };
  return { base: code, amount, codes };
}

export function reselectCurrency(
  board: Board,
  code: string,
  rates: Record<string, string>,
): Board | null {
  if (!board.codes.includes(code)) return null;
  if (code === board.base) return board;
  const amount = convertAmount(board.amount, board.base, code, rates);
  if (amount == null) return null;
  return { base: code, amount, codes: board.codes };
}

export function appendMissing(codes: string[], adding: string[]): string[] {
  const have = new Set(codes);
  return codes.concat(adding.filter((code) => !have.has(code)));
}

export function sortCodes(codes: string[]): string[] {
  return codes.slice().sort((a, b) => {
    const ia = COMMON_ORDER.indexOf(a);
    const ib = COMMON_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
