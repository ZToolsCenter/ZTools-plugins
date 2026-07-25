export function assignmentItemIds(
  selectedIds: readonly string[],
  clickedItemId: string,
): string[] {
  return selectedIds.includes(clickedItemId)
    ? [...new Set(selectedIds)]
    : [clickedItemId];
}
