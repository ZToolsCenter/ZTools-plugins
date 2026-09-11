import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Player,
  Move,
  GameStatus,
  opponent,
  validateMove,
} from "@/lib/gomoku/types";
import { getAIMove, type Difficulty } from "@/lib/gomoku/ai";
import * as engine from "@/lib/gomoku/engine";
import {
  GameStats,
  loadStats,
  saveStats,
  recordResult,
  TONE_CLASSES,
  type AchievementDef,
} from "@/lib/gomoku/stats";
import { play, unlockAudio, setMuted, isMuted } from "@/lib/audio/sfx";
import { ACH_ICON } from "@/lib/achievementIcons";
import { Sparkles, type LucideIcon } from "lucide-react";
import { type ToastItem } from "@/components/ui/toast";
import { usePluginActivity } from "@/hooks/usePluginActivity";
import {
  loadDifficulty,
  loadElapsedMs,
  loadGame,
  loadHumanColor,
  saveDifficulty,
  saveElapsedMs,
  saveGame,
  saveHumanColor,
} from "@/lib/gomoku/persistence";
import { setAudioActive } from "@/lib/audio/sfx";

export interface UseGomoku {
  game: engine.GameState;
  board: engine.GameState["board"];
  currentPlayer: Player;
  status: GameStatus;
  lastMove: Move | null;
  winLine: Move[] | null;
  winner: Player | null;
  moveCount: number;
  difficulty: Difficulty;
  humanColor: Player;
  aiColor: Player;
  thinking: boolean;
  hover: Move | null;
  stats: GameStats;
  muted: boolean;
  elapsedMs: number;
  mmss: string;
  toasts: ToastItem[];
  interactive: boolean;
  canUndo: boolean;
  setDifficulty: (d: Difficulty) => void;
  setHumanColor: (p: Player) => void;
  setHover: (m: Move | null) => void;
  handlePlace: (m: Move) => void;
  restart: () => void;
  undo: () => void;
  toggleMute: () => void;
  pushToast: (t: Omit<ToastItem, "id">) => void;
  dismissToast: (id: number) => void;
}

export function useGomoku(): UseGomoku {
  const { t } = useTranslation();
  const pluginActive = usePluginActivity();
  const [game, setGame] = useState<engine.GameState>(loadGame);
  const [difficulty, setDifficultyState] = useState<Difficulty>(loadDifficulty);
  const [humanColor, setHumanColorState] = useState<Player>(loadHumanColor);
  const [thinking, setThinking] = useState(false);
  const [hover, setHoverState] = useState<Move | null>(null);
  const [stats, setStats] = useState<GameStats>(() => loadStats());
  const [muted, setMutedState] = useState<boolean>(() => isMuted());
  const [elapsedMs, setElapsedMs] = useState(loadElapsedMs);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const aiColor = opponent(humanColor);

  // ---- ref mirrors to avoid stale closures ----
  const gameRef = useRef(game);
  gameRef.current = game;
  const statusRef = useRef(game.status);
  statusRef.current = game.status;
  const aiColorRef = useRef(aiColor);
  aiColorRef.current = aiColor;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const humanColorRef = useRef(humanColor);
  humanColorRef.current = humanColor;
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;
  const aiPendingRef = useRef(false);
  const recordedRef = useRef(game.status !== "playing");
  const timerRef = useRef<number | null>(null);
  const toastId = useRef(0);
  const prevHoverRef = useRef<Move | null>(null);
  const lastHoverPlayRef = useRef(0);
  const thinkingWasTrueRef = useRef(false);

  // ---- toast helpers ----
  const pushToast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      4200
    );
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const pushAchievementToast = useCallback(
    (a: AchievementDef) => {
      const Icon: LucideIcon = ACH_ICON[a.icon] ?? Sparkles;
      const tone = TONE_CLASSES[a.tone];
      pushToast({
        title: `${t("toast.achievementUnlocked")} · ${t(`achievements.${a.id}.title`)}`,
        desc: t(`achievements.${a.id}.desc`),
        icon: createElement(Icon, { className: "h-5 w-5" }),
        toneClass: `${tone.bg} ${tone.text}`,
      });
    },
    [pushToast, t]
  );

  // ---- apply a move (shared by human + AI) ----
  const applyMove = useCallback((m: Move, player: Player) => {
    setGame((prev) => engine.placeStone(prev, m, player));
  }, []);

  const handlePlace = useCallback(
    (m: Move) => {
      if (statusRef.current !== "playing") return;
      if (gameRef.current.currentPlayer !== humanColorRef.current) return;
      if (thinkingRef.current) return;
      if (!validateMove(gameRef.current.board, m)) return;
      try {
        unlockAudio();
        play("place_player");
      } catch {
        /* ignore */
      }
      applyMove(m, humanColorRef.current);
    },
    [applyMove]
  );

  // ---- persist the resumable match and elapsed time in the host store ----
  useEffect(() => saveGame(game), [game]);
  useEffect(() => saveElapsedMs(elapsedMs), [elapsedMs]);

  // ---- suspend sound when the plugin leaves the foreground ----
  useEffect(() => {
    setAudioActive(pluginActive);
    if (!pluginActive) setHoverState(null);
    return () => setAudioActive(false);
  }, [pluginActive]);

  // ---- AI turn: schedule exactly once per turn (no self-cancel bug) ----
  // NOTE: `thinking` is intentionally NOT in the dependency array — including it
  // would cancel the in-flight timeout and deadlock the AI.
  useEffect(() => {
    const isAITurn =
      pluginActive && game.status === "playing" && game.currentPlayer === aiColor;
    if (!isAITurn) {
      aiPendingRef.current = false;
      // BUG-QA-01 fix: switching 先手 mid-thinking cancels the AI timer (cleanup)
      // and re-enters this branch; without resetting thinking the UI soft-locks.
      setThinking(false);
      return;
    }
    if (aiPendingRef.current) return;
    aiPendingRef.current = true;
    setThinking(true);
    const delay = 320 + (difficulty === "master" ? 400 : 0);
    const t = window.setTimeout(() => {
      const m = getAIMove(gameRef.current.board, aiColor, difficultyRef.current);
      aiPendingRef.current = false;
      setThinking(false);
      if (m) {
        try {
          play("place_ai");
        } catch {
          /* ignore */
        }
        applyMove(m, aiColor);
      } else {
        setGame((prev) => ({ ...prev, status: "draw", winner: null }));
      }
    }, delay);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginActive, game.status, game.currentPlayer, aiColor, applyMove]);

  // ---- record finished game into stats + fire result / achievement sounds ----
  useEffect(() => {
    if (game.status === "playing") {
      recordedRef.current = false;
      return;
    }
    if (recordedRef.current) return;
    recordedRef.current = true;

    const outcome: "win" | "loss" | "draw" =
      game.status === "draw"
        ? "draw"
        : game.winner === humanColorRef.current
        ? "win"
        : "loss";
    const res = recordResult(statsRef.current, {
      outcome,
      moves: game.moveCount,
      difficulty: difficultyRef.current,
    });
    setStats(res.stats);
    saveStats(res.stats);

    window.setTimeout(() => {
      try {
        if (outcome === "win") play("victory");
        else if (outcome === "loss") play("defeat");
        else play("draw");
      } catch {
        /* ignore */
      }
    }, 150);

    res.unlocked.forEach((a, i) =>
      window.setTimeout(
        () => {
          try {
            play("achievement");
          } catch {
            /* ignore */
          }
          pushAchievementToast(a);
        },
        250 + i * 350
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status, pushAchievementToast]);

  // ---- per-game timer ----
  useEffect(() => {
    if (!pluginActive || game.status !== "playing" || game.moveCount === 0) {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current !== null) return; // already running
    timerRef.current = window.setInterval(() => {
      setElapsedMs((e) => e + 1000);
    }, 1000);
  }, [pluginActive, game.status, game.moveCount]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    []
  );

  // ---- thinking sound ----
  useEffect(() => {
    try {
      if (thinking) {
        play("thinking_start");
        thinkingWasTrueRef.current = true;
      } else if (thinkingWasTrueRef.current) {
        play("thinking_end");
        thinkingWasTrueRef.current = false;
      }
    } catch {
      /* ignore */
    }
  }, [thinking]);

  // ---- hover sound (throttled) ----
  useEffect(() => {
    const prev = prevHoverRef.current;
    prevHoverRef.current = hover;
    if (!hover) return;
    if (prev && prev.x === hover.x && prev.y === hover.y) return;
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (t - lastHoverPlayRef.current < 40) return;
    lastHoverPlayRef.current = t;
    try {
      play("hover");
    } catch {
      /* ignore */
    }
  }, [hover]);

  // ---- actions ----
  const setDifficulty = useCallback((d: Difficulty) => {
    try {
      unlockAudio();
    } catch {
      /* ignore */
    }
    setDifficultyState(d);
    saveDifficulty(d);
  }, []);

  const setHumanColor = useCallback((p: Player) => {
    try {
      unlockAudio();
      play("ui_click");
    } catch {
      /* ignore */
    }
    setHumanColorState(p);
    saveHumanColor(p);
  }, []);

  const setHover = useCallback((m: Move | null) => setHoverState(m), []);

  const restart = useCallback(() => {
    try {
      unlockAudio();
      play("ui_click");
    } catch {
      /* ignore */
    }
    setGame(engine.createGame());
    setThinking(false);
    aiPendingRef.current = false;
    setHoverState(null);
    recordedRef.current = false;
    setElapsedMs(0);
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const undo = useCallback(() => {
    if (thinkingRef.current) return;
    if (gameRef.current.status !== "playing") return;
    if (gameRef.current.history.length < 2) return; // need a full round
    try {
      unlockAudio();
      play("undo");
    } catch {
      /* ignore */
    }
    setGame((prev) => engine.undo(prev));
    recordedRef.current = false;
  }, []);

  const toggleMute = useCallback(() => {
    try {
      unlockAudio();
    } catch {
      /* ignore */
    }
    setMutedState((prev) => {
      const next = !prev;
      if (prev === false && next === true) {
        // muting: click is still audible, so play it before silencing.
        try {
          play("ui_click");
        } catch {
          /* ignore */
        }
        try {
          setMuted(next);
        } catch {
          /* ignore */
        }
      } else {
        // unmuting (muted→unmuted): re-enable sound first, then confirm tick.
        try {
          setMuted(next);
        } catch {
          /* ignore */
        }
        try {
          play("unmute_tick");
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  // ---- keyboard: Ctrl/Cmd+Z to undo ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // ---- derived ----
  const interactive =
    pluginActive &&
    game.status === "playing" &&
    game.currentPlayer === humanColor &&
    !thinking;
  const canUndo =
    pluginActive &&
    game.history.length >= 2 &&
    game.status === "playing" &&
    !thinking;
  const mmss = useMemo(() => {
    const total = Math.floor(elapsedMs / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [elapsedMs]);

  return {
    game,
    board: game.board,
    currentPlayer: game.currentPlayer,
    status: game.status,
    lastMove: game.lastMove,
    winLine: game.winLine,
    winner: game.winner,
    moveCount: game.moveCount,
    difficulty,
    humanColor,
    aiColor,
    thinking,
    hover,
    stats,
    muted,
    elapsedMs,
    mmss,
    toasts,
    interactive,
    canUndo,
    setDifficulty,
    setHumanColor,
    setHover,
    handlePlace,
    restart,
    undo,
    toggleMute,
    pushToast,
    dismissToast,
  };
}
