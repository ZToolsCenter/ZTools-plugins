import { Player, BLACK, BOARD_SIZE } from "./types";
import type { GameState } from "./engine";
import type { ReplayMove } from "./replay";

export type ExportFormat = "sgf" | "json" | "txt";

export interface ExportMeta {
  blackName: string;
  whiteName: string;
  /** SGF-style result: "B+W" | "W+W" | "0" (draw) | "?" (unfinished). */
  result: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  boardSize: number;
  moveCount: number;
}

/**
 * SGF game type. GM[4] = Gomoku+Renju per the SGF FF[4] spec. GM[1] (Go) is
 * also recognised by many Go tools if broader compatibility is ever needed.
 */
const SGF_GM = 4;

const EXT: Record<ExportFormat, string> = {
  sgf: ".sgf",
  json: ".json",
  txt: ".txt",
};

const MIME: Record<ExportFormat, string> = {
  sgf: "application/x-go-sgf",
  json: "application/json",
  txt: "text/plain",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildMeta(game: GameState, humanColor: Player): ExportMeta {
  const result =
    game.status === "black_win"
      ? "B+W"
      : game.status === "white_win"
      ? "W+W"
      : game.status === "draw"
      ? "0"
      : "?";
  const d = new Date();
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const humanIsBlack = humanColor === BLACK;
  return {
    blackName: humanIsBlack ? "玩家" : "电脑",
    whiteName: humanIsBlack ? "电脑" : "玩家",
    result,
    date,
    boardSize: BOARD_SIZE,
    moveCount: game.moveCount,
  };
}

export function resultToChinese(result: string): string {
  switch (result) {
    case "B+W":
      return "黑胜";
    case "W+W":
      return "白胜";
    case "0":
      return "平局";
    default:
      return "未结束";
  }
}

/** SGF coordinate: letters a–o, x first then y. (7,7) → "hh". */
function sgfCoord(x: number, y: number): string {
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

export function toSGF(moves: ReplayMove[], meta: ExportMeta): string {
  const head =
    `(;GM[${SGF_GM}]FF[4]CA[UTF-8]SZ[${meta.boardSize}]AP[Gomoku3D:1.0]` +
    `DT[${meta.date}]PB[${meta.blackName}]PW[${meta.whiteName}]RE[${meta.result}]`;
  const body = moves
    .map((m) => `;${m.player === BLACK ? "B" : "W"}[${sgfCoord(m.x, m.y)}]`)
    .join("");
  return head + body + ")";
}

export function toJSON(moves: ReplayMove[], meta: ExportMeta): string {
  return JSON.stringify(
    {
      meta: {
        app: "Gomoku3D",
        boardSize: meta.boardSize,
        blackName: meta.blackName,
        whiteName: meta.whiteName,
        result: meta.result,
        date: meta.date,
        moveCount: meta.moveCount,
      },
      moves: moves.map((m) => ({
        index: m.index,
        x: m.x,
        y: m.y,
        player: m.player,
        label: m.label,
      })),
    },
    null,
    2
  );
}

export function toTXT(moves: ReplayMove[], meta: ExportMeta): string {
  const lines = [
    `五子棋棋谱 ${meta.date}  黑：${meta.blackName}  白：${meta.whiteName}  结果：${resultToChinese(meta.result)}`,
  ];
  for (const m of moves) lines.push(`${m.index}. ${m.label} (${m.x},${m.y})`);
  return lines.join("\n") + "\n";
}

export function buildExportText(
  moves: ReplayMove[],
  meta: ExportMeta,
  format: ExportFormat
): string {
  switch (format) {
    case "sgf":
      return toSGF(moves, meta);
    case "json":
      return toJSON(moves, meta);
    case "txt":
      return toTXT(moves, meta);
  }
}

/** Replace characters illegal in file names with "-". Empty stays empty. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-");
}

/** `gomoku-YYYYMMDD-HHMMSS` in local time. */
export function defaultFileName(): string {
  const d = new Date();
  return (
    `gomoku-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

/** Native download: Blob + a[download]. No runtime dependency. */
export function downloadTextFile(
  filename: string,
  text: string,
  mime: string
): void {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Build text + filename for `format`, trigger the browser download and
 * return what was written (useful for the success toast).
 */
export async function exportGame(
  moves: ReplayMove[],
  meta: ExportMeta,
  format: ExportFormat,
  baseName?: string
): Promise<{ cancelled: boolean; filename: string; text: string; path?: string }> {
  const base = sanitizeFileName(baseName ?? "") || defaultFileName();
  const text = buildExportText(moves, meta, format);
  const filename = base + EXT[format];

  if (window.gomokuBridge?.saveTextFile) {
    const result = await window.gomokuBridge.saveTextFile({
      format,
      suggestedName: filename,
      text,
    });
    return { cancelled: result.cancelled, filename, text, path: result.path };
  }

  downloadTextFile(filename, text, MIME[format]);
  return { cancelled: false, filename, text };
}
