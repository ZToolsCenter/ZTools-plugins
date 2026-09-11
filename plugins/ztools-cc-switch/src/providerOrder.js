export function moveProviderToTarget(orderedIds, sourceId, targetId) {
  const ids = [...orderedIds]
  const sourceIndex = ids.indexOf(sourceId)
  const targetIndex = ids.indexOf(targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return ids

  const [moved] = ids.splice(sourceIndex, 1)
  // 使用目标在拖拽前的位置：拖到哪张卡，就占据那张卡原来的排序位。
  ids.splice(targetIndex, 0, moved)
  return ids
}
