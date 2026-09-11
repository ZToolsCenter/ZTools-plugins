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
} from "../src/lib/gomoku/types";
import * as engine from "../src/lib/gomoku/engine";
import { getAIMove } from "../src/lib/gomoku/ai";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("  ok  -", msg);
  } else {
    fail++;
    console.log("FAIL  -", msg);
  }
}

// ---------------------------------------------------------------------------
// 1. placeStone boundary defenses (no throws, returns input unchanged)
// ---------------------------------------------------------------------------
{
  const g = engine.createGame();
  assert(g.status === "playing" && g.currentPlayer === BLACK && g.history.length === 0, "createGame: empty board, BLACK to move");

  // out of bounds
  const oob = engine.placeStone(g, { x: -1, y: 0 }, BLACK);
  assert(oob === g, "out-of-bounds move returns the same state (no throw)");
  assert(oob.board[idx(7, 7)] === 0, "out-of-bounds move did not write a stone");

  // not the current player's turn
  const wrong = engine.placeStone(g, { x: 7, y: 7 }, WHITE);
  assert(wrong === g, "wrong-player move returns the same state");

  // normal move then repeat on the same cell
  let g2 = engine.placeStone(g, { x: 7, y: 7 }, BLACK);
  assert(g2.board[idx(7, 7)] === BLACK && g2.currentPlayer === WHITE, "valid move writes stone and passes turn");
  const repeat = engine.placeStone(g2, { x: 7, y: 7 }, WHITE);
  assert(repeat === g2, "repeat move on occupied cell returns the same state");

  // game over guard
  const over = { ...g2, status: "black_win" as const };
  const afterOver = engine.placeStone(over, { x: 0, y: 0 }, WHITE);
  assert(afterOver === over, "move after game over is ignored");
}

// ---------------------------------------------------------------------------
// 2. undo round-trip (one full round -> empty board)
// ---------------------------------------------------------------------------
{
  let g = engine.createGame();
  g = engine.placeStone(g, { x: 7, y: 7 }, BLACK); // human
  g = engine.placeStone(g, { x: 8, y: 8 }, WHITE); // AI reply
  assert(g.history.length === 2, "two moves recorded two history entries");
  assert(engine.canUndo(g), "canUndo true after a full round");

  g = engine.undo(g); // revert the whole round
  assert(g.moveCount === 0, "undo reverts a full round back to 0 moves");
  assert(g.history.length === 0, "undo clears history");
  assert(g.currentPlayer === BLACK, "undo returns to the human's turn (BLACK)");
  assert(g.board.every((c) => c === 0), "undo leaves an empty board");
  assert(!engine.canUndo(g), "canUndo false on empty board");

  // undo on a finished game is a no-op
  const finished = { ...engine.createGame(), status: "draw" as const };
  assert(engine.undo(finished) === finished, "undo on finished game is a no-op");
}

// ---------------------------------------------------------------------------
// 3. master getAIMove returns a legal move + a game terminates (no stall)
// ---------------------------------------------------------------------------
{
  // empty board -> center
  const empty = createBoard();
  const m0 = getAIMove(empty, WHITE, "master");
  assert(!!m0 && m0.x === 7 && m0.y === 7, "master: empty board -> center (7,7)");

  // a forced block: BLACK has an open four, master (WHITE) must block an end
  const b = createBoard();
  for (let x = 3; x <= 6; x++) b[idx(x, 7)] = BLACK;
  const mBlock = getAIMove(b, WHITE, "master");
  const blocks =
    !!mBlock &&
    b[idx(mBlock.x, mBlock.y)] === 0 &&
    ((mBlock.y === 7 && (mBlock.x === 2 || mBlock.x === 7)));
  assert(blocks, "master blocks BLACK's open four at an open end");

  // mid-game timing + legality
  const mid = createBoard();
  const seeds: [number, number, Player][] = [
    [7, 7, BLACK], [7, 8, WHITE], [8, 7, BLACK], [6, 8, WHITE],
    [8, 8, BLACK], [6, 7, WHITE], [9, 7, BLACK],
  ];
  for (const [x, y, p] of seeds) mid[idx(x, y)] = p;
  const t0 = performance.now();
  const mMid = getAIMove(mid, WHITE, "master");
  const dt = performance.now() - t0;
  assert(!!mMid && mid[idx(mMid.x, mMid.y)] === 0, "master returns a legal (empty) move on mid-game board");
  assert(dt < 1000, `master move under 1s (took ${dt.toFixed(1)}ms)`);

  // full master vs master game must terminate without illegal moves
  const playMasterGame = () => {
    const board: Board = createBoard();
    let cur: Player = BLACK;
    let moves = 0;
    while (moves < 225) {
      const m = getAIMove(board, cur, "master");
      if (!m) break; // draw (full board)
      if (board[idx(m.x, m.y)] !== 0) throw new Error("master returned an occupied cell");
      board[idx(m.x, m.y)] = cur;
      if (checkWinFrom(board, m.x, m.y, cur)) return { winner: cur, moves };
      if (isFull(board)) return { winner: 0 as Player, moves };
      cur = cur === BLACK ? WHITE : BLACK;
      moves++;
    }
    throw new Error("master game did not terminate (possible stall)");
  };
  const r = playMasterGame();
  assert(true, `master vs master terminated: winner=${r.winner} in ${r.moves} moves`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
