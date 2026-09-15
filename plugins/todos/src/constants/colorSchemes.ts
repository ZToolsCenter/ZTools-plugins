import { ColorScheme } from '../types';

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'teal',
    name: '青绿',
    primary: '#0F766E',
    secondary: '#14B8A6',
    light: '#6EE7B7',
    dark: '#0D9488'
  },
  {
    id: 'blue',
    name: '海洋蓝',
    primary: '#0284C7',
    secondary: '#38BDF8',
    light: '#7DD3FC',
    dark: '#0369A1'
  },
  {
    id: 'purple',
    name: '薰衣草紫',
    primary: '#7C3AED',
    secondary: '#A78BFA',
    light: '#C4B5FD',
    dark: '#6D28D9'
  },
  {
    id: 'green',
    name: '森林绿',
    primary: '#16A34A',
    secondary: '#4ADE80',
    light: '#86EFAC',
    dark: '#15803D'
  },
  {
    id: 'red',
    name: '暖阳红',
    primary: '#DC2626',
    secondary: '#F87171',
    light: '#FCA5A5',
    dark: '#B91C1C'
  },
  {
    id: 'orange',
    name: '落日橙',
    primary: '#EA580C',
    secondary: '#FB923C',
    light: '#FDBA74',
    dark: '#C2410C'
  },
  {
    id: 'pink',
    name: '玫瑰粉',
    primary: '#DB2777',
    secondary: '#F472B6',
    light: '#F9A8D4',
    dark: '#BE185D'
  }
];

export const DEFAULT_WORKSPACE_CONFIGS = [
  { id: 'work', name: '工作', colorScheme: 'teal', order: 0 },
  { id: 'life', name: '生活', colorScheme: 'orange', order: 1 },
  { id: 'study', name: '学习', colorScheme: 'purple', order: 2 }
];
