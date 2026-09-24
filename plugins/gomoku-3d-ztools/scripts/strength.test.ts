import {
  Board,
  Move,
  Player,
  BLACK,
  WHITE,
  createBoard,
  idx,
  checkWinFrom,
  isFull,
  opponent,
} from "../src/lib/gomoku/types";
import { getAIMove, type Difficulty } from "../src/lib/gomoku/ai";

/** Play one full game. blackDiff / whiteDiff select the tier for each color.
 *  Returns the winner (1=BLACK, 2=WHITE, 0=draw) and move count. */
function playGame(
  blackDiff: Difficulty,
  whiteDiff: Difficulty
): { winner: number; moves: number } {
  const board: Board = createBoard();
  let cur: Player = BLACK;
  let moves = 0;
  while (moves < 225) {
    const diff = cur === BLACK ? blackDiff : whiteDiff;
    const m = getAIMove(board, cur, diff);
    if (!m) return { winner: 0, moves }; // full board -> draw
    if (board[idx(m.x, m.y)] !== 0) throw new Error(`illegal move ${m.x},${m.y}`);
    board[idx(m.x, m.y)] = cur;
    if (checkWinFrom(board, m.x, m.y, cur)) return { winner: cur, moves };
    if (isFull(board)) return { winner: 0, moves };
    cur = opponent(cur);
    moves++;
  }
  return { winner: 0, moves };
}

const winnerLabel = (w: number): string =>
  w === 1 ? "BLACK" : w === 2 ? "WHITE" : "DRAW";

const MASTER: Difficulty = "master";
const others: Difficulty[] = ["easy", "medium", "hard"];
const EASY_RUNS = 9; // easy is stochastic; average over several games

interface Result {
  winner: number;
  moves: number;
  masterIsBlack: boolean;
  other: Difficulty;
  w: number; // master wins
  d: number; // draws
  l: number; // master losses
}

const results: Record<string, Result> = {};

let pass = 0;
let fail = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("  ok  -", msg);
  } else {
    fail++;
    console.log("FAIL  -", msg);
  }
}

console.log("=== Strength matrix: master vs tier, both colors ===");
for (const other of others) {
  for (const masterIsBlack of [true, false]) {
    const blackDiff: Difficulty = masterIsBlack ? MASTER : other;
    const whiteDiff: Difficulty = masterIsBlack ? other : MASTER;
    const tag = `master(${masterIsBlack ? "B" : "W"}) vs ${other}(${masterIsBlack ? "W" : "B"})`;

    const runs = other === "easy" ? EASY_RUNS : 1;
    let aggW = 0;
    let aggD = 0;
    let aggL = 0;
    let lastWinner = 0;
    let lastMoves = 0;
    for (let i = 0; i < runs; i++) {
      const r = playGame(blackDiff, whiteDiff);
      lastWinner = r.winner;
      lastMoves = r.moves;
      const masterWon = r.winner !== 0 && r.winner === (masterIsBlack ? BLACK : WHITE);
      if (r.winner === 0) aggD++;
      else if (masterWon) aggW++;
      else aggL++;
    }

    results[tag] = {
      winner: lastWinner,
      moves: lastMoves,
      masterIsBlack,
      other,
      w: aggW,
      d: aggD,
      l: aggL,
    };

    const detail = other === "easy" ? `(easy x${EASY_RUNS}: W${aggW}/D${aggD}/L${aggL})` : "";
    console.log(
      `  ${tag.padEnd(34)} -> ${winnerLabel(lastWinner).padEnd(6)} ${detail}`
    );
  }
}

console.log("\n=== Acceptance criteria ===");

// 1. master must NOT lose to easy/medium in ANY color direction.
for (const other of ["easy", "medium"] as Difficulty[]) {
  for (const dir of [true, false] as const) {
    const tag = `master(${dir ? "B" : "W"}) vs ${other}(${dir ? "W" : "B"})`;
    const r = results[tag];
    check(r.l === 0, `${tag}: master never loses to ${other} (W${r.w}/D${r.d}/L${r.l})`);
  }
}

// 2. master vs hard: never lose in either direction, and win at least one.
{
  const bTag = `master(B) vs hard(W)`;
  const wTag = `master(W) vs hard(B)`;
  const rb = results[bTag];
  const rw = results[wTag];
  check(rb.l === 0 && rw.l === 0, "master never loses to hard in either direction");
  const wonOne = rb.w > 0 || rw.w > 0;
  check(
    wonOne,
    `master beats hard in at least one color direction (B:W${rb.w}/D${rb.d}/L${rb.l}, W:W${rw.w}/D${rw.d}/L${rw.l})`
  );
}

// 3. master single-move time budget.
{
  const mid = createBoard();
  const seeds: [number, number, Player][] = [
    [7, 7, BLACK], [7, 8, WHITE], [8, 7, BLACK], [6, 8, WHITE],
    [8, 8, BLACK], [6, 7, WHITE], [9, 7, BLACK], [9, 8, WHITE], [5, 7, BLACK],
  ];
  for (const [x, y, p] of seeds) mid[idx(x, y)] = p;
  const t0 = performance.now();
  const m = getAIMove(mid, WHITE, "master");
  const dt = performance.now() - t0;
  check(!!m && dt < 1000, `master single move < 1s (took ${dt.toFixed(1)}ms)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
