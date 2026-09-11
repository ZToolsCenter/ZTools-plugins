export const BOARD_SIZE = 15;

/** 0 = empty, 1 = black (player), 2 = white (AI) */
export type Stone = 0 | 1 | 2;
export type Player = 1 | 2;

export interface Move {
  x: number;
  y: number;
}

export type GameStatus =
  | "playing"
  | "black_win"
  | "white_win"
  | "draw";

export const EMPTY: Stone = 0;
export const BLACK: Player = 1;
export const WHITE: Player = 2;

export function opponent(p: Player): Player {
  return (p === BLACK ? WHITE : BLACK) as Player;
}

/** Flat board: index = y * BOARD_SIZE + x */
export type Board = Stone[];

export function createBoard(): Board {
  return new Array<Stone>(BOARD_SIZE * BOARD_SIZE).fill(EMPTY);
}

export function idx(x: number, y: number): number {
  return y * BOARD_SIZE + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

export function getStone(board: Board, x: number, y: number): Stone {
  return board[idx(x, y)];
}

/** True if `move` is inside the board and currently empty. Reused by the
 *  engine and the UI layer to guard against illegal placements. */
export function validateMove(board: Board, move: Move): boolean {
  return inBounds(move.x, move.y) && board[idx(move.x, move.y)] === EMPTY;
}

export function cloneBoard(board: Board): Board {
  return board.slice();
}

const DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/**
 * Check whether placing `player` at (x, y) produces a win.
 * Call AFTER the stone has been written to the board.
 */
export function checkWinFrom(
  board: Board,
  x: number,
  y: number,
  player: Player
): boolean {
  for (const [dx, dy] of DIRS) {
    let count = 1;
    // forward
    let nx = x + dx;
    let ny = y + dy;
    while (inBounds(nx, ny) && board[idx(nx, ny)] === player) {
      count++;
      nx += dx;
      ny += dy;
    }
    // backward
    nx = x - dx;
    ny = y - dy;
    while (inBounds(nx, ny) && board[idx(nx, ny)] === player) {
      count++;
      nx -= dx;
      ny -= dy;
    }
    if (count >= 5) return true;
  }
  return false;
}

export function isFull(board: Board): boolean {
  return board.every((c) => c !== EMPTY);
}

/**
 * Return the consecutive run (>=5) that makes `player` win at (x, y).
 * Used to highlight the winning line. Returns [] if not a win.
 */
export function getWinningLine(
  board: Board,
  x: number,
  y: number,
  player: Player
): Move[] {
  for (const [dx, dy] of DIRS) {
    const cells: Move[] = [{ x, y }];
    let nx = x + dx;
    let ny = y + dy;
    while (inBounds(nx, ny) && board[idx(nx, ny)] === player) {
      cells.push({ x: nx, y: ny });
      nx += dx;
      ny += dy;
    }
    nx = x - dx;
    ny = y - dy;
    while (inBounds(nx, ny) && board[idx(nx, ny)] === player) {
      cells.unshift({ x: nx, y: ny });
      nx -= dx;
      ny -= dy;
    }
    if (cells.length >= 5) return cells;
  }
  return [];
}

/** All empty cells adjacent (within radius) to an existing stone. */
export function getCandidateMoves(
  board: Board,
  radius = 2
): Move[] {
  const seen = new Set<number>();
  const moves: Move[] = [];
  let hasStone = false;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[idx(x, y)] === EMPTY) continue;
      hasStone = true;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          if (board[idx(nx, ny)] !== EMPTY) continue;
          const key = idx(nx, ny);
          if (seen.has(key)) continue;
          seen.add(key);
          moves.push({ x: nx, y: ny });
        }
      }
    }
  }
  if (!hasStone) {
    const c = Math.floor(BOARD_SIZE / 2);
    return [{ x: c, y: c }];
  }
  return moves;
}
