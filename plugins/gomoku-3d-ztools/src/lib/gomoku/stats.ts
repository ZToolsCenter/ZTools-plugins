import type { Difficulty } from "./ai";
import { readPersistent, writePersistent } from "@/lib/pluginHost";

export interface GameStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** current consecutive-win streak */
  streak: number;
  /** best consecutive-win streak ever */
  bestStreak: number;
  /** fewest moves in a win, null if never won */
  fastestWinMoves: number | null;
  /** whether the player has ever beaten the hard AI */
  beatHard: boolean;
  /** whether the player has ever beaten the master AI */
  beatMaster?: boolean;
}

export type AchievementId =
  | "first_win"
  | "streak3"
  | "streak5"
  | "speed"
  | "beat_hard"
  | "draw_master"
  | "master_win";

export interface AchievementDef {
  id: AchievementId;
  title: string;
  desc: string;
  /** lucide-react icon name, resolved in the UI layer */
  icon: string;
  tone:
    | "orange"
    | "amber"
    | "rose"
    | "violet"
    | "emerald"
    | "sky";
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first_win",
    title: "初露锋芒",
    desc: "赢下你的第一盘对局",
    icon: "Sparkles",
    tone: "amber",
  },
  {
    id: "streak3",
    title: "小有斩获",
    desc: "连续获胜 3 局",
    icon: "Flame",
    tone: "orange",
  },
  {
    id: "streak5",
    title: "五连胜王",
    desc: "连续获胜 5 局",
    icon: "Crown",
    tone: "rose",
  },
  {
    id: "speed",
    title: "雷霆一击",
    desc: "在 24 手之内取胜",
    icon: "Zap",
    tone: "sky",
  },
  {
    id: "beat_hard",
    title: "屠龙者",
    desc: "在困难难度下击败 AI",
    icon: "Sword",
    tone: "violet",
  },
  {
    id: "draw_master",
    title: "棋逢对手",
    desc: "下成一盘和棋",
    icon: "Handshake",
    tone: "emerald",
  },
  {
    id: "master_win",
    title: "无冕之王",
    desc: "在大师难度下击败 AI",
    icon: "Crown",
    tone: "rose",
  },
];

const STORAGE_KEY = "game-stats";

export function emptyStats(): GameStats {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    bestStreak: 0,
    fastestWinMoves: null,
    beatHard: false,
    beatMaster: false,
  };
}

export function loadStats(): GameStats {
  const value = readPersistent<unknown>(STORAGE_KEY, null);
  if (!value || typeof value !== "object") return emptyStats();
  const stats = { ...emptyStats(), ...(value as Partial<GameStats>) };
  return {
    games: Math.max(0, Math.floor(Number(stats.games) || 0)),
    wins: Math.max(0, Math.floor(Number(stats.wins) || 0)),
    losses: Math.max(0, Math.floor(Number(stats.losses) || 0)),
    draws: Math.max(0, Math.floor(Number(stats.draws) || 0)),
    streak: Math.max(0, Math.floor(Number(stats.streak) || 0)),
    bestStreak: Math.max(0, Math.floor(Number(stats.bestStreak) || 0)),
    fastestWinMoves:
      stats.fastestWinMoves === null
        ? null
        : Math.max(1, Math.floor(Number(stats.fastestWinMoves) || 1)),
    beatHard: stats.beatHard === true,
    beatMaster: stats.beatMaster === true,
  };
}

export function saveStats(stats: GameStats): void {
  writePersistent(STORAGE_KEY, stats);
}

export interface GameResult {
  outcome: "win" | "loss" | "draw";
  moves: number;
  difficulty: Difficulty;
}

function earned(id: AchievementId, s: GameStats): boolean {
  switch (id) {
    case "first_win":
      return s.wins >= 1;
    case "streak3":
      return s.bestStreak >= 3;
    case "streak5":
      return s.bestStreak >= 5;
    case "speed":
      return s.fastestWinMoves !== null && s.fastestWinMoves <= 24;
    case "beat_hard":
      return s.beatHard;
    case "draw_master":
      return s.draws >= 1;
    case "master_win":
      return s.beatMaster === true;
  }
}

/** A 0..1 fill used to render a subtle progress ring on locked badges. */
export function achievementProgress(id: AchievementId, s: GameStats): number {
  switch (id) {
    case "first_win":
      return Math.min(1, s.wins);
    case "streak3":
      return Math.min(1, s.bestStreak / 3);
    case "streak5":
      return Math.min(1, s.bestStreak / 5);
    case "speed":
      return s.fastestWinMoves !== null && s.fastestWinMoves <= 24 ? 1 : 0;
    case "beat_hard":
      return s.beatHard ? 1 : 0;
    case "draw_master":
      return Math.min(1, s.draws);
    case "master_win":
      return s.beatMaster ? 1 : 0;
  }
}

export function isEarned(id: AchievementId, s: GameStats): boolean {
  return earned(id, s);
}

/** Apply a finished game to the stats, returning the new stats plus any
 *  achievements unlocked *by this game* (for celebration toasts). */
export function recordResult(
  prev: GameStats,
  r: GameResult
): { stats: GameStats; unlocked: AchievementDef[] } {
  const next: GameStats = { ...prev, games: prev.games + 1 };
  if (r.outcome === "win") {
    next.wins += 1;
    next.streak = prev.streak + 1;
    next.bestStreak = Math.max(prev.bestStreak, next.streak);
    next.fastestWinMoves =
      prev.fastestWinMoves === null
        ? r.moves
        : Math.min(prev.fastestWinMoves, r.moves);
    if (r.difficulty === "hard") next.beatHard = true;
    if (r.difficulty === "master") next.beatMaster = true;
  } else if (r.outcome === "loss") {
    next.losses += 1;
    next.streak = 0;
  } else {
    next.draws += 1;
    next.streak = 0;
  }

  const unlocked: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!earned(a.id, prev) && earned(a.id, next)) unlocked.push(a);
  }
  return { stats: next, unlocked };
}

export const TONE_CLASSES: Record<
  AchievementDef["tone"],
  { ring: string; bg: string; text: string; glow: string }
> = {
  orange: {
    ring: "ring-orange-300",
    bg: "bg-orange-100",
    text: "text-orange-600",
    glow: "shadow-[0_8px_24px_-8px_rgba(234,88,12,0.6)]",
  },
  amber: {
    ring: "ring-amber-300",
    bg: "bg-amber-100",
    text: "text-amber-600",
    glow: "shadow-[0_8px_24px_-8px_rgba(217,119,6,0.55)]",
  },
  rose: {
    ring: "ring-rose-300",
    bg: "bg-rose-100",
    text: "text-rose-600",
    glow: "shadow-[0_8px_24px_-8px_rgba(225,29,72,0.55)]",
  },
  violet: {
    ring: "ring-violet-300",
    bg: "bg-violet-100",
    text: "text-violet-600",
    glow: "shadow-[0_8px_24px_-8px_rgba(139,92,246,0.55)]",
  },
  emerald: {
    ring: "ring-emerald-300",
    bg: "bg-emerald-100",
    text: "text-emerald-600",
    glow: "shadow-[0_8px_24px_-8px_rgba(16,185,129,0.55)]",
  },
  sky: {
    ring: "ring-sky-300",
    bg: "bg-sky-100",
    text: "text-sky-600",
    glow: "shadow-[0_8px_24px_-8px_rgba(14,165,233,0.55)]",
  },
};
