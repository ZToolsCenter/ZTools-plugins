import {
  Board,
  Move,
  Player,
  GameStatus,
  BLACK,
  BOARD_SIZE,
  createBoard,
} from "./types";
import type { GameState, HistoryEntry } from "./engine";

/** One derived move of the finished/ongoing game, 1-based `index`. */
export interface ReplayMove {
  index: number;
  x: number;
  y: number;
  player: Player;
  /** "黑" | "白" — colour label, side (玩家/电脑) is mapped by the UI. */
  label: string;
}

/**
 * Frozen copy of the fields replay needs. Taken once on enterReplay so the
 * replay view is immune to any live-game changes while it is open.
 */
export interface ReplaySnapshot {
  history: HistoryEntry[];
  board: Board;
  moveCount: number;
  status: GameStatus;
  winner: Player | null;
  winLine: Move[] | null;
}

/** Structural subset shared by GameState and ReplaySnapshot. */
export type ReplaySource = Pick<GameState, "board" | "moveCount" | "history">;

export function snapshotGame(game: GameState): ReplaySnapshot {
  return {
    history: game.history.slice(),
    board: game.board.slice(),
    moveCount: game.moveCount,
    status: game.status,
    winner: game.winner,
    winLine: game.winLine ? game.winLine.map((m) => ({ ...m })) : null,
  };
}

/**
 * Derive the ordered move list (length = moveCount) from the history.
 * `history[k]` is the snapshot taken BEFORE move k+1, i.e. it contains k
 * stones; move j's coordinate is the single cell that differs between the
 * board before move j and the board after move j.
 */
export function deriveMoves(game: ReplaySource): ReplayMove[] {
  const N = game.moveCount;
  const moves: ReplayMove[] = [];
  for (let j = 1; j <= N; j++) {
    const prev = j - 1 === 0 ? createBoard() : game.history[j - 1].board;
    const cur = j < N ? game.history[j].board : game.board;
    let x = -1;
    let y = -1;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] !== prev[i]) {
        x = i % BOARD_SIZE;
        y = Math.floor(i / BOARD_SIZE);
        break;
      }
    }
    const player = game.history[j - 1].currentPlayer;
    moves.push({ index: j, x, y, player, label: player === BLACK ? "黑" : "白" });
  }
  return moves;
}

/**
 * Board after `step` moves (step ∈ [0, N]). Uses the recorded history
 * directly — no move-by-move re-simulation.
 */
export function boardAtStep(game: ReplaySource, step: number): Board {
  if (step <= 0) return createBoard();
  if (step >= game.moveCount) return game.board;
  return game.history[step].board;
}
