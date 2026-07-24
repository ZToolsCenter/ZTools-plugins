// ============================================================
//  GAME CONSTANTS
// ============================================================
export const COLS = 10;
export const ROWS = 20;
export const BLOCK_SIZE = 30;


export type ThemeName = 'neon' | 'modern' | 'retro';
export type ControlMode = 'arrows' | 'wasd' | 'custom';

export const SHAPES = [
  [[1,1,1,1]],                                 // I
  [[1,1],[1,1]],                               // O
  [[0,1,0],[1,1,1]],                           // T
  [[0,1,1],[1,1,0]],                           // S
  [[1,1,0],[0,1,1]],                           // Z
  [[1,0,0],[1,1,1]],                           // L
  [[0,0,1],[1,1,1]],                           // J
] as const;

export type Shape = (typeof SHAPES)[number];

export interface PieceState {
  shape: number[][];
  color: string;
  colorIndex: number;
  x: number;
  y: number;
}

export type Board = (string | number)[][];

export interface KeyBindings {
  left: string;
  right: string;
  down: string;
  rotate: string;
  drop: string;
  pause: string;
  _isCustom?: boolean;
}

export const DEFAULT_BINDINGS: Record<Exclude<ControlMode, 'custom'>, KeyBindings> = {
  arrows: { left: 'ArrowLeft', right: 'ArrowRight', down: 'ArrowDown', rotate: 'ArrowUp', drop: ' ', pause: 'Escape' },
  wasd:   { left: 'a',        right: 'd',         down: 's',         rotate: 'w',         drop: ' ', pause: 'Escape' },
};
