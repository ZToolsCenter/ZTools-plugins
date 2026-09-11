import {
  Board,
  Player,
  Move,
  GameStatus,
  Stone,
  BLACK,
  opponent,
  createBoard,
  idx,
  checkWinFrom,
  isFull,
  getWinningLine,
  validateMove,
} from "./types";

/** Immutable snapshot taken *before* a move is applied. Used to support undo. */
export interface HistoryEntry {
  board: Board;
  currentPlayer: Player;
  lastMove: Move | null;
  winLine: Move[] | null;
  status: GameStatus;
  winner: Player | null;
  moveCount: number;
}

/** The complete, immutable game state. All transitions go through pure helpers
 *  in this module so the React layer can stay a thin view over the engine. */
export interface GameState {
  board: Board;
  currentPlayer: Player;
  status: GameStatus;
  lastMove: Move | null;
  winLine: Move[] | null;
  winner: Player | null;
  moveCount: number;
  history: HistoryEntry[];
}

/** A fresh game: empty board, BLACK to move, no history. */
export function createGame(): GameState {
  return {
    board: createBoard(),
    currentPlayer: BLACK,
    status: "playing",
    lastMove: null,
    winLine: null,
    winner: null,
    moveCount: 0,
    history: [],
  };
}

/**
 * Apply `player`'s move. Pure + immutable: returns a brand-new state and never
 * mutates the input. Boundary defense — any of these makes us return the input
 * state unchanged (no throw): not your turn, game already over, out of bounds,
 * or the cell is occupied.
 */
export function placeStone(
  state: GameState,
  move: Move,
  player: Player
): GameState {
  if (state.status !== "playing") return state;
  if (player !== state.currentPlayer) return state;
  if (!validateMove(state.board, move)) return state;

  const snapshot: HistoryEntry = {
    board: state.board.slice(),
    currentPlayer: state.currentPlayer,
    lastMove: state.lastMove,
    winLine: state.winLine,
    status: state.status,
    winner: state.winner,
    moveCount: state.moveCount,
  };

  const board = state.board.slice();
  board[idx(move.x, move.y)] = player as Stone;

  const next: GameState = {
    ...state,
    board,
    lastMove: move,
    moveCount: state.moveCount + 1,
    history: [...state.history, snapshot],
  };

  if (checkWinFrom(board, move.x, move.y, player)) {
    next.status = player === BLACK ? "black_win" : "white_win";
    next.winner = player;
    next.winLine = getWinningLine(board, move.x, move.y, player);
    return next;
  }
  if (isFull(board)) {
    next.status = "draw";
    return next;
  }
  next.currentPlayer = opponent(player);
  return next;
}

/** Whether an undo is currently possible. */
export function canUndo(state: GameState): boolean {
  return state.history.length > 0 && state.status === "playing";
}

/**
 * Revert a full round (the AI's reply + the human's move), returning to the
 * state just before the human last moved — i.e. it's the human's turn again.
 * If only one move is on the board we revert that single move. When the game
 * is over or there is nothing to revert we return the state unchanged.
 */
export function undo(state: GameState): GameState {
  if (state.history.length === 0 || state.status !== "playing") return state;
  const h = state.history.slice();
  const restoreIdx = h.length >= 2 ? h.length - 2 : 0;
  const restored = h[restoreIdx];
  const newHistory = h.slice(0, restoreIdx);
  return { ...restored, history: newHistory };
}
