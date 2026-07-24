const ORDER_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MAX_ORDER_KEY_LENGTH = 128;
const OPEN_UPPER_DIGIT = ORDER_ALPHABET.length;
const SUFFIX_MIDPOINT =
  ORDER_ALPHABET[Math.floor(ORDER_ALPHABET.length / 2)]!;

export type StableOrderEntry = {
  orderKey: string;
  id: string;
};

function validateOrderKey(key: string | undefined): void {
  if (key === undefined) {
    return;
  }

  if (key.length > MAX_ORDER_KEY_LENGTH) {
    throw new RangeError("Order key length requires rebalancing");
  }

  if (
    key.length === 0 ||
    [...key].some((character) => !ORDER_ALPHABET.includes(character))
  ) {
    throw new TypeError("Order keys must contain only base62 characters");
  }
}

function checkedGeneratedKey(key: string): string {
  if (key.length > MAX_ORDER_KEY_LENGTH) {
    throw new RangeError("Generated order key requires rebalancing");
  }

  return key;
}

function midpointBetweenValidated(before?: string, after?: string): string {
  if (before === undefined && after === undefined) {
    return SUFFIX_MIDPOINT;
  }

  let prefix = "";
  let index = 0;

  while (
    before !== undefined &&
    after !== undefined &&
    index < before.length &&
    index < after.length &&
    before[index] === after[index]
  ) {
    prefix += before[index]!;
    index += 1;
  }

  const lowerDigit =
    before !== undefined && index < before.length
      ? ORDER_ALPHABET.indexOf(before[index]!)
      : -1;
  const upperDigit =
    after !== undefined && index < after.length
      ? ORDER_ALPHABET.indexOf(after[index]!)
      : OPEN_UPPER_DIGIT;

  if (upperDigit - lowerDigit > 1) {
    const midpoint = Math.floor((lowerDigit + upperDigit) / 2);
    return prefix + ORDER_ALPHABET[midpoint]!;
  }

  if (lowerDigit >= 0 && before !== undefined) {
    const lowerCharacter = ORDER_ALPHABET[lowerDigit]!;
    const lowerSuffix =
      index + 1 < before.length ? before.slice(index + 1) : undefined;
    const lowerCandidate =
      prefix +
      lowerCharacter +
      midpointBetweenValidated(lowerSuffix, undefined);

    if (
      lowerCandidate.length > MAX_ORDER_KEY_LENGTH &&
      after !== undefined &&
      index + 1 < after.length
    ) {
      return after.slice(0, index + 1);
    }

    return lowerCandidate;
  }

  if (after !== undefined && index + 1 < after.length) {
    return after.slice(0, index + 1);
  }

  throw new RangeError(
    "No base62 order key exists in this prefix gap; rebalance is required",
  );
}

function compareLexical(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function compareStableOrder(
  left: StableOrderEntry,
  right: StableOrderEntry,
): number {
  const orderKeyComparison = compareLexical(left.orderKey, right.orderKey);
  return orderKeyComparison === 0
    ? compareLexical(left.id, right.id)
    : orderKeyComparison;
}

export function hasOrderKeyCollision(
  entries: readonly StableOrderEntry[],
): boolean {
  const seen = new Set<string>();

  for (const { orderKey } of entries) {
    if (seen.has(orderKey)) {
      return true;
    }
    seen.add(orderKey);
  }

  return false;
}

/**
 * Concurrent inserts with identical bounds can produce the same key.
 * Synchronization consumers must sort with compareStableOrder and schedule
 * rebalancing when hasOrderKeyCollision reports a collision.
 */
export function orderKeyBetween(before?: string, after?: string): string {
  validateOrderKey(before);
  validateOrderKey(after);

  if (before !== undefined && after !== undefined && before >= after) {
    throw new RangeError("The lower order key must sort before the upper key");
  }

  if (before === undefined && after === undefined) {
    return checkedGeneratedKey("a0");
  }

  return checkedGeneratedKey(midpointBetweenValidated(before, after));
}
