export function hasExactRecordIdSet(actualIds, expectedIds) {
  if (!Array.isArray(actualIds) || !Array.isArray(expectedIds) || actualIds.length !== expectedIds.length) return false;
  const actual = new Set(actualIds);
  const expected = new Set(expectedIds);
  return actual.size === actualIds.length && expected.size === expectedIds.length &&
    actual.size === expected.size && [...expected].every(id => actual.has(id));
}

export function hasExactCaseOrder(actualIds, expectedIds) {
  return Array.isArray(actualIds) && Array.isArray(expectedIds) && JSON.stringify(actualIds) === JSON.stringify(expectedIds);
}
