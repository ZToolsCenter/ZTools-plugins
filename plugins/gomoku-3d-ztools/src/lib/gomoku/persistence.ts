import type { Difficulty } from "./ai";
import type { GameState, HistoryEntry } from "./engine";
import {
  BLACK,
  BOARD_SIZE,
  WHITE,
  type Board,
  type GameStatus,
  type Move,
  type Player,
} from "./types";
import { createGame } from "./engine";
import { readPersistent, writePersistent } from "@/lib/pluginHost";

const GAME_KEY = "current-game";
const DIFFICULTY_KEY = "difficulty";
const HUMAN_COLOR_KEY = "human-color";
const ELAPSED_KEY = "elapsed-ms";
const STATUS_VALUES = new Set<GameStatus>(["playing", "black_win", "white_win", "draw"]);
const DIFFICULTY_VALUES = new Set<Difficulty>(["easy", "medium", "hard", "master"]);

/**
 * 校验棋盘数组。
 * @param value 待校验数据。
 * @returns 数据是否为合法的 15×15 棋盘。
 */
function isBoard(value: unknown): value is Board {
  return (
    Array.isArray(value) &&
    value.length === BOARD_SIZE * BOARD_SIZE &&
    value.every((stone) => stone === 0 || stone === BLACK || stone === WHITE)
  );
}

/**
 * 校验棋盘坐标。
 * @param value 待校验数据。
 * @returns 数据是否为合法坐标或空值。
 */
function isMoveOrNull(value: unknown): value is Move | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const move = value as Move;
  return (
    Number.isInteger(move.x) &&
    Number.isInteger(move.y) &&
    move.x >= 0 &&
    move.x < BOARD_SIZE &&
    move.y >= 0 &&
    move.y < BOARD_SIZE
  );
}

/**
 * 校验历史快照。
 * @param value 待校验数据。
 * @returns 数据是否为合法历史快照。
 */
function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as HistoryEntry;
  return (
    isBoard(entry.board) &&
    (entry.currentPlayer === BLACK || entry.currentPlayer === WHITE) &&
    isMoveOrNull(entry.lastMove) &&
    (entry.winLine === null || (Array.isArray(entry.winLine) && entry.winLine.every(isMoveOrNull))) &&
    STATUS_VALUES.has(entry.status) &&
    (entry.winner === null || entry.winner === BLACK || entry.winner === WHITE) &&
    Number.isInteger(entry.moveCount) &&
    entry.moveCount >= 0 &&
    entry.moveCount <= BOARD_SIZE * BOARD_SIZE
  );
}

/**
 * 校验完整对局快照。
 * @param value 待校验数据。
 * @returns 数据是否为合法对局。
 */
function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const game = value as GameState;
  const occupied = isBoard(game.board) ? game.board.filter((stone) => stone !== 0).length : -1;
  return (
    isBoard(game.board) &&
    (game.currentPlayer === BLACK || game.currentPlayer === WHITE) &&
    STATUS_VALUES.has(game.status) &&
    isMoveOrNull(game.lastMove) &&
    (game.winLine === null || (Array.isArray(game.winLine) && game.winLine.every(isMoveOrNull))) &&
    (game.winner === null || game.winner === BLACK || game.winner === WHITE) &&
    Number.isInteger(game.moveCount) &&
    game.moveCount === occupied &&
    Array.isArray(game.history) &&
    game.history.length === game.moveCount &&
    game.history.every(isHistoryEntry)
  );
}

/**
 * 读取已保存对局，损坏数据自动回退到新棋局。
 * @returns 可安全恢复的对局状态。
 */
export function loadGame(): GameState {
  const value = readPersistent<unknown>(GAME_KEY, null);
  return isGameState(value) ? value : createGame();
}

/**
 * 保存当前对局。
 * @param game 当前完整对局。
 * @returns 无返回值。
 */
export function saveGame(game: GameState): void {
  writePersistent(GAME_KEY, game);
}

/**
 * 读取 AI 难度。
 * @returns 有效的 AI 难度。
 */
export function loadDifficulty(): Difficulty {
  const value = readPersistent<unknown>(DIFFICULTY_KEY, "medium");
  return DIFFICULTY_VALUES.has(value as Difficulty) ? (value as Difficulty) : "medium";
}

/**
 * 保存 AI 难度。
 * @param difficulty AI 难度。
 * @returns 无返回值。
 */
export function saveDifficulty(difficulty: Difficulty): void {
  writePersistent(DIFFICULTY_KEY, difficulty);
}

/**
 * 读取玩家执子颜色。
 * @returns 黑棋或白棋。
 */
export function loadHumanColor(): Player {
  const value = readPersistent<unknown>(HUMAN_COLOR_KEY, BLACK);
  return value === WHITE ? WHITE : BLACK;
}

/**
 * 保存玩家执子颜色。
 * @param player 玩家颜色。
 * @returns 无返回值。
 */
export function saveHumanColor(player: Player): void {
  writePersistent(HUMAN_COLOR_KEY, player);
}

/**
 * 读取当前对局计时。
 * @returns 限制在合理范围内的毫秒数。
 */
export function loadElapsedMs(): number {
  const value = readPersistent<unknown>(ELAPSED_KEY, 0);
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, 7 * 24 * 60 * 60 * 1000)
    : 0;
}

/**
 * 保存当前对局计时。
 * @param elapsedMs 已用毫秒数。
 * @returns 无返回值。
 */
export function saveElapsedMs(elapsedMs: number): void {
  writePersistent(ELAPSED_KEY, Math.max(0, Math.floor(elapsedMs)));
}
