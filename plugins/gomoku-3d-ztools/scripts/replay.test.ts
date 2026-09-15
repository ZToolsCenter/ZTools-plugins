import { BLACK, WHITE, idx, createBoard } from "../src/lib/gomoku/types";
import * as engine from "../src/lib/gomoku/engine";
import { deriveMoves, boardAtStep, snapshotGame } from "../src/lib/gomoku/replay";
import {
  buildMeta,
  toSGF,
  toJSON,
  toTXT,
  sanitizeFileName,
  defaultFileName,
  resultToChinese,
} from "../src/lib/gomoku/export";

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// 1. deriveMoves / boardAtStep over a known 3-move game
//    black(7,7) -> white(8,8) -> black(7,6)
// ---------------------------------------------------------------------------
let game = engine.createGame();
game = engine.placeStone(game, { x: 7, y: 7 }, BLACK);
game = engine.placeStone(game, { x: 8, y: 8 }, WHITE);
game = engine.placeStone(game, { x: 7, y: 6 }, BLACK);

{
  assert(game.moveCount === 3 && game.history.length === 3, "setup: 3 moves, 3 history entries");

  const moves = deriveMoves(game);
  assert(moves.length === 3, "deriveMoves returns 3 moves");
  assert(
    moves[0].index === 1 && moves[0].x === 7 && moves[0].y === 7 && moves[0].player === BLACK && moves[0].label === "黑",
    "move 1 = black (7,7)"
  );
  assert(
    moves[1].index === 2 && moves[1].x === 8 && moves[1].y === 8 && moves[1].player === WHITE && moves[1].label === "白",
    "move 2 = white (8,8)"
  );
  assert(
    moves[2].index === 3 && moves[2].x === 7 && moves[2].y === 6 && moves[2].player === BLACK && moves[2].label === "黑",
    "move 3 = black (7,6)"
  );

  const b0 = boardAtStep(game, 0);
  assert(b0.every((c) => c === 0), "boardAtStep(0) is an empty board");
  assert(b0.length === createBoard().length, "boardAtStep(0) has 225 cells");

  const b1 = boardAtStep(game, 1);
  const b1Stones = b1.reduce<number>((n, c) => n + (c !== 0 ? 1 : 0), 0);
  assert(b1Stones === 1 && b1[idx(7, 7)] === BLACK, "boardAtStep(1) contains only black (7,7)");

  const b2 = boardAtStep(game, 2);
  assert(
    b2[idx(7, 7)] === BLACK && b2[idx(8, 8)] === WHITE && b2[idx(7, 6)] === 0,
    "boardAtStep(2) has moves 1-2 but not move 3"
  );

  const b3 = boardAtStep(game, 3);
  assert(b3 === game.board, "boardAtStep(N) is the final board");

  // snapshot equivalence + freeze semantics
  const snap = snapshotGame(game);
  const snapMoves = deriveMoves(snap);
  assert(
    JSON.stringify(snapMoves) === JSON.stringify(moves),
    "deriveMoves(snapshot) === deriveMoves(game)"
  );
  const afterSnap = engine.placeStone(game, { x: 9, y: 9 }, WHITE);
  assert(afterSnap.moveCount === 4 && snap.moveCount === 3, "snapshot is immune to later live moves");
}

// ---------------------------------------------------------------------------
// 2. buildMeta + toSGF exact string
// ---------------------------------------------------------------------------
{
  const meta = buildMeta(game, BLACK);
  assert(meta.blackName === "玩家" && meta.whiteName === "电脑", "meta: human black -> PB=玩家 PW=电脑");
  assert(meta.result === "?", "meta: ongoing game -> RE ?");
  assert(meta.boardSize === 15 && meta.moveCount === 3, "meta: boardSize 15, moveCount 3");
  assert(meta.date === localDate(), "meta: local date YYYY-MM-DD");

  const moves = deriveMoves(game);
  const sgf = toSGF(moves, meta);
  const expected = `(;GM[4]FF[4]CA[UTF-8]SZ[15]AP[Gomoku3D:1.0]DT[${localDate()}]PB[玩家]PW[电脑]RE[?];B[hh];W[ii];B[hg])`;
  assert(sgf === expected, "toSGF exact match: " + sgf);

  // reversed colors: human plays white
  const metaW = buildMeta(game, WHITE);
  assert(metaW.blackName === "电脑" && metaW.whiteName === "玩家", "meta: human white -> PB=电脑 PW=玩家");

  // finished game result mapping
  const asBlackWin = { ...game, status: "black_win" as const };
  const asWhiteWin = { ...game, status: "white_win" as const };
  const asDraw = { ...game, status: "draw" as const };
  assert(buildMeta(asBlackWin, BLACK).result === "B+W", "RE: black_win -> B+W");
  assert(buildMeta(asWhiteWin, BLACK).result === "W+W", "RE: white_win -> W+W");
  assert(buildMeta(asDraw, BLACK).result === "0", "RE: draw -> 0");
  assert(resultToChinese("B+W") === "黑胜" && resultToChinese("?") === "未结束", "result Chinese mapping");
}

// ---------------------------------------------------------------------------
// 3. toJSON / toTXT
// ---------------------------------------------------------------------------
{
  const moves = deriveMoves(game);
  const meta = buildMeta(game, BLACK);

  const parsed = JSON.parse(toJSON(moves, meta)) as {
    meta: { boardSize: number; blackName: string; result: string; moveCount: number };
    moves: { index: number; x: number; y: number; player: number; label: string }[];
  };
  assert(parsed.moves.length === 3, "toJSON: parses back with 3 moves");
  assert(parsed.moves[0].index === 1 && parsed.moves[0].player === 1, "toJSON: index starts at 1, player 1=black");
  assert(parsed.meta.boardSize === 15 && parsed.meta.blackName === "玩家", "toJSON: meta fields present");

  const txt = toTXT(moves, meta);
  const lines = txt.trimEnd().split("\n");
  assert(lines.length === 4, "toTXT: header + 3 move lines");
  assert(lines[0].includes("五子棋棋谱") && lines[0].includes("结果：未结束"), "toTXT: header line");
  assert(lines[1] === "1. 黑 (7,7)" && lines[2] === "2. 白 (8,8)" && lines[3] === "3. 黑 (7,6)", "toTXT: move lines format");
}

// ---------------------------------------------------------------------------
// 4. sanitizeFileName / defaultFileName
// ---------------------------------------------------------------------------
{
  assert(sanitizeFileName('a/b:c*') === "a-b-c-", 'sanitizeFileName("a/b:c*") === "a-b-c-"');
  assert(sanitizeFileName('x?"<>|\\y') === "x------y", "sanitizeFileName strips all illegal chars");
  assert(sanitizeFileName("") === "", "sanitizeFileName keeps empty string empty");

  const name = defaultFileName();
  assert(name.startsWith("gomoku-"), "defaultFileName starts with gomoku-");
  assert(/\d{8}-\d{6}$/.test(name), "defaultFileName ends with YYYYMMDD-HHMMSS");
}

// ---------------------------------------------------------------------------
// 5. edge: single-move game and empty game
// ---------------------------------------------------------------------------
{
  let g1 = engine.createGame();
  g1 = engine.placeStone(g1, { x: 0, y: 14 }, BLACK);
  const m = deriveMoves(g1);
  assert(m.length === 1 && m[0].x === 0 && m[0].y === 14, "single move derived at corner (0,14)");
  const meta = buildMeta(g1, BLACK);
  const sgf = toSGF(m, meta);
  assert(sgf.includes(";B[ao])"), "SGF coord (0,14) -> ao (x first, then y)");

  const g0 = engine.createGame();
  assert(deriveMoves(g0).length === 0, "empty game derives zero moves");
  assert(boardAtStep(g0, 0).every((c) => c === 0), "empty game boardAtStep(0) empty");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
