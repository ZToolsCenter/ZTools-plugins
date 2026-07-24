import type { CollectedColor } from '../types';
import { dbStorage } from './platform';

const STORAGE_KEY = 'color-collected';

/**
 * 获取收藏的颜色列表
 */
export function getCollectedColors(): CollectedColor[] {
  try {
    return dbStorage.getItem(STORAGE_KEY) || [];
  } catch {
    return [];
  }
}

/**
 * 保存收藏的颜色列表
 */
export function saveCollectedColors(colors: CollectedColor[]): void {
  try {
    dbStorage.setItem(STORAGE_KEY, colors);
  } catch (error) {
    console.error('Failed to save collected colors:', error);
  }
}

/**
 * 添加收藏颜色
 */
export function addColoredColor(color: string, name?: string): CollectedColor {
  const colors = getCollectedColors();
  const newColor: CollectedColor = {
    id: Date.now().toString(),
    name: name || color,
    color,
    createdAt: Date.now()
  };
  
  colors.unshift(newColor);
  saveCollectedColors(colors);
  
  return newColor;
}

/**
 * 删除收藏颜色
 */
export function removeCollectedColor(id: string): void {
  const colors = getCollectedColors();
  const filtered = colors.filter(c => c.id !== id);
  saveCollectedColors(filtered);
}

/**
 * 更新收藏颜色名称
 */
export function updateColoredColorName(id: string, name: string): void {
  const colors = getCollectedColors();
  const updated = colors.map(c => 
    c.id === id ? { ...c, name } : c
  );
  saveCollectedColors(updated);
}
