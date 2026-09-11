/**
 * 未保存离开确认（纯逻辑）。
 */

/** dirty 为 true 时需要确认离开 */
export function shouldConfirmLeave(dirty: boolean): boolean {
  return dirty;
}

/** 离开确认文案 */
export const confirmLeaveMessage = "有未保存的修改，确定离开？";
