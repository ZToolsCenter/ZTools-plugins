/**
 * 任务颜色工具
 * 根据任务ID生成一致的随机颜色
 */

const taskColors = [
  '#7DD3FC', // sky
  '#FDE68A', // yellow
  '#C4B5FD', // violet
  '#FCA5A5', // red
  '#93C5FD', // blue
  '#86EFAC', // green
  '#F9A8D4', // pink
  '#FDBA74', // orange
  '#A5B4FC', // indigo
  '#6EE7B7', // emerald
  '#FDA4AF', // rose
  '#D8B4FE', // purple
  '#5EEAD4', // teal
  '#FCD34D', // amber
  '#7DD3FC', // sky
  '#86EFAC', // green
];

/**
 * 根据任务ID生成一致的颜色
 * @param taskId 任务ID
 * @returns HEX颜色值
 */
export function getTaskColor(taskId: string): string {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = taskId.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % taskColors.length;
  return taskColors[index];
}

/**
 * 根据任务ID生成带透明度的颜色
 * @param taskId 任务ID
 * @param opacity 透明度 (0-1)
 * @returns rgba颜色值
 */
export function getTaskColorWithOpacity(taskId: string, opacity: number): string {
  const hex = getTaskColor(taskId);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
