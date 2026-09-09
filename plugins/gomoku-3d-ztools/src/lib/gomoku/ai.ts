import {
  Board,
  Move,
  Player,
  opponent,
  idx,
  inBounds,
  getCandidateMoves,
  checkWinFrom,
} from "./types";

export type Difficulty = "easy" | "medium" | "hard" | "master";

const FIVE = 10_000_000;
const OPEN_FOUR = 1_000_000;
const FOUR = 100_000;
const OPEN_THREE = 10_000;
const THREE = 1_000;
const OPEN_TWO = 100;
const TWO = 10;

/**
 * Ordered by descending score. Score = first pattern (highest) found inside
 * the 9-cell line window. Line chars: '1' = our stone, '2' = opponent/edge
 * (blocks), '0' = empty.
 */
const PATTERNS: ReadonlyArray<{ p: string; s: number }> = [
  { p: "11111", s: FIVE },
  { p: "011110", s: OPEN_FOUR },
  { p: "11011", s: FOUR },
  { p: "10111", s: FOUR },
  { p: "11101", s: FOUR },
  { p: "011112", s: FOUR },
  { p: "211110", s: FOUR },
  { p: "11110", s: FOUR },
  { p: "01111", s: FOUR },
  { p: "010110", s: OPEN_THREE },
  { p: "011010", s: OPEN_THREE },
  { p: "011100", s: OPEN_THREE },
  { p: "001110", s: OPEN_THREE },
  { p: "11100", s: THREE },
  { p: "00111", s: THREE },
  { p: "11010", s: THREE },
  { p: "01011", s: THREE },
  { p: "10110", s: THREE },
  { p: "01101", s: THREE },
  { p: "11001", s: THREE },
  { p: "10011", s: THREE },
  { p: "10101", s: THREE },
  { p: "011000", s: OPEN_TWO },
  { p: "000110", s: OPEN_TWO },
  { p: "001100", s: OPEN_TWO },
  { p: "010100", s: OPEN_TWO },
  { p: "001010", s: OPEN_TWO },
  { p: "11000", s: TWO },
  { p: "00011", s: TWO },
  { p: "10100", s: TWO },
  { p: "00101", s: TWO },
  { p: "10010", s: TWO },
  { p: "01010", s: TWO },
];

function bestPatternInLine(line: string): number {
  for (const { p, s } of PATTERNS) {
    if (line.includes(p)) return s;
  }
  return 0;
}

const DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** Score of the shape formed by placing `player` at (x, y). */
export function evaluatePoint(
  board: Board,
  x: number,
  y: number,
  player: Player
): number {
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let line = "";
    for (let i = -4; i <= 4; i++) {
      if (i === 0) {
        line += "1";
        continue;
      }
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (!inBounds(nx, ny)) {
        line += "2";
      } else {
        const s = board[idx(nx, ny)];
        if (s === player) line += "1";
        else if (s === 0) line += "0";
        else line += "2";
      }
    }
    total += bestPatternInLine(line);
  }
  return total;
}

function wouldWin(board: Board, m: Move, player: Player): boolean {
  board[idx(m.x, m.y)] = player;
  const win = checkWinFrom(board, m.x, m.y, player);
  board[idx(m.x, m.y)] = 0;
  return win;
}

function moveScore(
  board: Board,
  m: Move,
  player: Player,
  defWeight: number
): number {
  const offense = evaluatePoint(board, m.x, m.y, player);
  const defense = evaluatePoint(board, m.x, m.y, opponent(player));
  return offense + defWeight * defense;
}

function greedy(
  board: Board,
  candidates: Move[],
  player: Player,
  defWeight: number
): Move {
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const m of candidates) {
    const s = moveScore(board, m, player, defWeight);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

function search2Ply(
  board: Board,
  candidates: Move[],
  player: Player,
  defWeight: number,
  K: number
): Move {
  const opp = opponent(player);
  const scored = candidates
    .map((m) => ({ m, s: moveScore(board, m, player, defWeight) }))
    .sort((a, b) => b.s - a.s);
  const top = scored.slice(0, K).map((e) => e.m);

  let best = top[0];
  let bestScore = -Infinity;
  for (const m of top) {
    board[idx(m.x, m.y)] = player;
    // opponent's best reply
    let oppBest = -Infinity;
    const oppMoves = getCandidateMoves(board);
    for (const om of oppMoves) {
      const s = moveScore(board, om, opp, defWeight);
      if (s > oppBest) oppBest = s;
    }
    const score = moveScore(board, m, player, defWeight) - 0.8 * oppBest;
    board[idx(m.x, m.y)] = 0;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

interface DifficultyConfig {
  defWeight: number;
  searchDepth: number;
  candidateK: number;
  randomness: number;
  threatForcing: boolean;
  forkAware: boolean;
}

/** Difficulty-driven tuning table. The "must win / must block" rules in
 *  `getAIMove` are always applied regardless of `threatForcing`. */
const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: { defWeight: 0.5, searchDepth: 0, candidateK: 4, randomness: 0.7, threatForcing: false, forkAware: false },
  medium: { defWeight: 1.0, searchDepth: 1, candidateK: 8, randomness: 0.1, threatForcing: false, forkAware: false },
  hard: { defWeight: 1.0, searchDepth: 2, candidateK: 14, randomness: 0.02, threatForcing: true, forkAware: false },
  master: { defWeight: 1.05, searchDepth: 4, candidateK: 20, randomness: 0, threatForcing: true, forkAware: true },
};

/* ----------------------------------------------------------------------------
 * Fork awareness (master only): localized, dimension-aligned double-threat
 * recognition. We count the *immediate winning threats* a posted move grants
 * (empty points that would complete five), on the same scale as `moveScore`,
 * instead of adding flat hundred-thousand-level global constants. This keeps the
 * evaluation on one coherent scale and makes the look-ahead strictly dominate.
 * ------------------------------------------------------------------------- */

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const WIN = 1_000_000_000;

// Leaf-evaluation weights, on the `moveScore` scale. Steep gaps make building a
// four / open-four dominate small shape noise, so the search prefers forcing
// lines — a dimension-aligned alternative to the old global fork constants.
const T_WIN = 10_000_000; // immediate winning threat
const T_OPEN_FOUR = 1_000_000;
const T_FOUR = 100_000;
const T_OPEN_THREE = 10_000;
const T_THREE = 1_000;
const T_TWO = 100;

/**
 * Threat potential of `player` on the current board: weighted shape value summed
 * over every candidate point (what `player` could build there). Counts fours,
 * open-threes and forks, giving the search a real positional sense instead of a
 * single best-move heuristic.
 */
function evalSide(board: Board, player: Player): number {
  let win = 0;
  let openFour = 0;
  let four = 0;
  let openThree = 0;
  let three = 0;
  let two = 0;
  for (const m of getCandidateMoves(board)) {
    const e = evaluatePoint(board, m.x, m.y, player);
    if (e >= FIVE) win++;
    else if (e >= OPEN_FOUR) openFour++;
    else if (e >= FOUR) four++;
    else if (e >= OPEN_THREE) openThree++;
    else if (e >= THREE) three++;
    else if (e >= OPEN_TWO) two++;
  }
  return (
    win * T_WIN +
    openFour * T_OPEN_FOUR +
    four * T_FOUR +
    openThree * T_OPEN_THREE +
    three * T_THREE +
    two * T_TWO
  );
}

/** Leaf heuristic from the perspective of the side to move. */
function evaluateBoard(board: Board, player: Player, defWeight: number): number {
  return evalSide(board, player) - defWeight * evalSide(board, opponent(player));
}

/**
 * Alpha-beta negamax with beam pruning. Returns the value of the position from
 * the perspective of `player` (the side to move at this node). A win is returned
 * as `WIN`; a full board is a draw (0). `K` caps how many candidate moves are
 * expanded at each node so the search stays within the time budget.
 */
function negamax(
  board: Board,
  player: Player,
  defWeight: number,
  depth: number,
  K: number,
  alpha: number,
  beta: number
): number {
  if (depth === 0) return evaluateBoard(board, player, defWeight);
  const cands = getCandidateMoves(board);
  if (cands.length === 0) return 0; // full board -> draw
  const ranked = cands
    .map((m) => ({ m, s: moveScore(board, m, player, defWeight) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, K);
  let best = -Infinity;
  for (const { m } of ranked) {
    board[idx(m.x, m.y)] = player;
    let val: number;
    if (checkWinFrom(board, m.x, m.y, player)) {
      val = WIN;
    } else {
      val = -negamax(board, opponent(player), defWeight, depth - 1, K, -beta, -alpha);
    }
    board[idx(m.x, m.y)] = 0;
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // prune
  }
  return best;
}

/**
 * Master search: top-K root candidates (by pattern score), bounded by an ~800ms
 * time budget, evaluated with an alpha-beta minimax that is strictly deeper than
 * the hard tier's 2-ply look-ahead, using a threat-counting leaf evaluation.
 *
 * Always returns a legal move; never null (callers guarantee non-empty input).
 */
function searchMaster(
  board: Board,
  candidates: Move[],
  player: Player,
  defWeight: number,
  K: number
): Move {
  const opp = opponent(player);
  const t0 = now();
  const TIME_BUDGET = 800;
  const DEPTH = 4; // plies after the root move -> a 5-ply search (hard is 2-ply)
  const DEEP_K = 3; // beam width inside the tree
  const ROOT_K = Math.min(K, 8);

  const scored = candidates
    .map((m) => ({ m, s: moveScore(board, m, player, defWeight) }))
    .sort((a, b) => b.s - a.s);
  const top = scored.slice(0, ROOT_K);

  let best = top[0].m;
  let bestScore = -Infinity;
  for (const { m } of top) {
    if (now() - t0 > TIME_BUDGET) break;
    board[idx(m.x, m.y)] = player;
    let val: number;
    if (checkWinFrom(board, m.x, m.y, player)) {
      val = WIN;
    } else {
      val = -negamax(board, opp, defWeight, DEPTH, DEEP_K, -Infinity, Infinity);
    }
    board[idx(m.x, m.y)] = 0;
    if (val > bestScore) {
      bestScore = val;
      best = m;
    }
  }
  return best;
}

/**
 * Choose the AI's move for `player`. Guarantees: take an immediate win, and
 * block the opponent's immediate win (the "must" rules, kept for every tier).
 * Then search by difficulty. Returns `null` only when no candidate exists
 * (a full board → caller should declare a draw).
 */
export function getAIMove(
  board: Board,
  player: Player,
  difficulty: Difficulty
): Move | null {
  const candidates = getCandidateMoves(board);
  if (candidates.length === 0) return null;

  const opp = opponent(player);

  // 1. Take an immediate win.
  for (const m of candidates) {
    if (wouldWin(board, m, player)) return m;
  }
  // 2. Block the opponent's immediate win.
  for (const m of candidates) {
    if (wouldWin(board, m, opp)) return m;
  }

  const cfg = DIFFICULTY_CONFIG[difficulty];

  if (difficulty === "easy") {
    const ranked = candidates
      .map((m) => ({ m, s: moveScore(board, m, player, cfg.defWeight) }))
      .sort((a, b) => b.s - a.s);
    const top = ranked.slice(0, cfg.candidateK);
    // Often a careless blunder among all cells; otherwise among the top few.
    if (Math.random() < cfg.randomness) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return top[Math.floor(Math.random() * top.length)].m;
  }

  if (difficulty === "medium") {
    return greedy(board, candidates, player, cfg.defWeight);
  }

  if (difficulty === "hard") {
    return search2Ply(board, candidates, player, cfg.defWeight, cfg.candidateK);
  }

  // master: fork-aware, time-bounded 3-ply minimax (strictly stronger than hard).
  return searchMaster(board, candidates, player, cfg.defWeight, cfg.candidateK);
}
