/*
 * 列表变了之后，当前行该怎么落。
 *
 * 规则只有两条，但边界不少，所以抽出来单独放 —— 脱离浏览器就能测。
 *
 *   1. **范围变了**（切分类 / 清空搜索 / Esc 退一步）→ 无条件落回第一条。
 *      注意是"无条件"：切分类时旧选中项**可能还在新列表里**。最典型的是
 *      文件 → 全部，全部是超集，旧那条当然还活着，于是选中赖在原地不动。
 *      文本/图像/文件 之间互切时旧项一般都跨不过去，反而看不出问题，
 *      所以这个 bug 只在切回「全部」时露头。
 *
 *   2. **只是数据刷新**（宿主机推来新剪贴内容）→ 尽量原地不动，用户正看着哪条就还在哪条；
 *      那条真没了（被删、被清空）才落回第一条。别人复制东西不该把你的光标踢走。
 */

export interface Selection {
  /** 当前行（高亮那条），也是 Enter 粘贴的那条 */
  active: string
}

/**
 * 算出新的当前行。
 *
 * @param keys     新列表的键，顺序就是显示顺序
 * @param prev     上一次的当前行
 * @param forceTop 这次是不是「范围变了」（true → 无条件落回第一条）
 */
export function resolveSelection(
  keys: readonly string[],
  prev: Selection,
  forceTop = false
): Selection {
  const atTop: Selection = { active: keys[0] ?? '' }

  if (forceTop) return atTop
  /*
   * 「旧那条还在不在」用一次线性查找就够，命中即止 ——
   * 原来是先 `new Set(keys)` 再 has()：列表 1000 条就要插 1000 次 + 建一个 Set 对象，
   * 而 forceTop 那条路径（切分类 / 清空搜索 / Esc 退一步）连查都不用查，整份 Set 白建。
   */
  return keys.includes(prev.active) ? { active: prev.active } : atTop
}
