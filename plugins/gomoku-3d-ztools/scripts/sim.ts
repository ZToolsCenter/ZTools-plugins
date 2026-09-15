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
import { getAIMove } from "../src/lib/gomoku/ai";

function playGame(a: Player, b: Player, da: "easy" | "medium" | "hard" | "master", db: "easy" | "medium" | "hard" | "master") {
  const board = createBoard();
  let cur: Player = BLACK;
  let moves = 0;
  while (moves < 225) {
    const diff = cur === a ? da : db;
    const m = getAIMove(board, cur, diff);
    if (!m) throw new Error(`getAIMove returned null at move ${moves} for player ${cur} (not a draw yet?)`);
    if (board[idx(m.x, m.y)] !== 0) throw new Error(`AI returned an occupied cell ${m.x},${m.y}`);
    board[idx(m.x, m.y)] = cur;
    if (checkWinFrom(board, m.x, m.y, cur)) {
      return { winner: cur, moves };
    }
    if (isFull(board)) return { winner: 0 as Player, moves };
    cur = (cur === BLACK ? WHITE : BLACK) as Player;
    moves++;
  }
  throw new Error("game did not terminate within 225 moves (possible stall/loop)");
}

const combos: [("easy" | "medium" | "hard" | "master"), ("easy" | "medium" | "hard" | "master")][] = [
  ["easy", "easy"],
  ["medium", "medium"],
  ["hard", "hard"],
  ["hard", "easy"],
  ["easy", "hard"],
  ["medium", "hard"],
  // master tier — must terminate and play legally under the time budget
  ["master", "easy"],
  ["master", "medium"],
  ["master", "hard"],
  ["master", "master"],
];
let ok = 0;
for (const [da, db] of combos) {
  for (let i = 0; i < 5; i++) {
    const r = playGame(BLACK, WHITE, da, db);
    console.log(`AI(${da}) vs AI(${db}) #${i + 1}: winner=${r.winner} in ${r.moves} moves`);
    ok++;
  }
}
console.log(`\n${ok} full games completed with no stalls and no illegal moves.`);
