import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, Move, createBoard } from "@/lib/gomoku/types";
import type { GameState } from "@/lib/gomoku/engine";
import {
  boardAtStep,
  deriveMoves,
  snapshotGame,
  type ReplayMove,
  type ReplaySnapshot,
} from "@/lib/gomoku/replay";

export type ReplayMode = "idle" | "replaying-paused" | "replaying-playing";

/** Everything GameBoard needs while replaying (mode !== "idle"). */
export interface ReplayDisplay {
  board: Board;
  lastMove: Move | null;
  winLine: Move[] | null;
  interactive: boolean;
  drawn: boolean;
  celebrate: boolean;
  thinking: boolean;
  currentMove: ReplayMove | null;
}

export interface UseReplayReturn {
  mode: ReplayMode;
  currentStep: number;
  speedMs: number;
  N: number;
  moves: ReplayMove[];
  snapshot: ReplaySnapshot | null;
  canEnterReplay: boolean;
  display: ReplayDisplay;
  enterReplay: () => void;
  exitReplay: () => void;
  stepForward: () => void;
  stepBack: () => void;
  goTo: (k: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (ms: number) => void;
}

/**
 * Read-only replay state machine over a frozen snapshot of the live game.
 * The live `game` object is never touched; exiting replay simply renders the
 * real state again.
 */
export function useReplay(game: GameState, thinking: boolean): UseReplayReturn {
  const [mode, setMode] = useState<ReplayMode>("idle");
  const [currentStep, setCurrentStep] = useState(0);
  const [speedMs, setSpeedMs] = useState(800); // 1× = 800ms per move
  const [snapshot, setSnapshot] = useState<ReplaySnapshot | null>(null);
  const [moves, setMoves] = useState<ReplayMove[]>([]);

  const N = snapshot ? snapshot.moveCount : 0;

  // ref mirrors so all actions stay referentially stable
  const gameRef = useRef(game);
  gameRef.current = game;
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const nRef = useRef(N);
  nRef.current = N;

  const canEnterReplay = game.moveCount > 0 && !thinking;

  const enterReplay = useCallback(() => {
    if (gameRef.current.moveCount === 0 || thinkingRef.current) return;
    const snap = snapshotGame(gameRef.current);
    setSnapshot(snap);
    setMoves(deriveMoves(snap));
    setCurrentStep(0);
    setMode("replaying-paused");
  }, []);

  const exitReplay = useCallback(() => {
    setMode("idle");
    setSnapshot(null);
    setMoves([]);
    setCurrentStep(0);
  }, []);

  const pause = useCallback(() => {
    setMode((m) => (m === "replaying-playing" ? "replaying-paused" : m));
  }, []);

  const stepForward = useCallback(() => {
    setCurrentStep((s) => Math.min(nRef.current, s + 1));
  }, []);

  const stepBack = useCallback(() => {
    pause();
    setCurrentStep((s) => Math.max(0, s - 1));
  }, [pause]);

  const goTo = useCallback(
    (k: number) => {
      pause();
      setCurrentStep(Math.max(0, Math.min(nRef.current, Math.round(k))));
    },
    [pause]
  );

  const play = useCallback(() => {
    if (modeRef.current === "idle") return;
    // replay-from-start semantics when already at the last move
    setCurrentStep((s) => (s >= nRef.current ? 0 : s));
    setMode("replaying-playing");
  }, []);

  const togglePlay = useCallback(() => {
    if (modeRef.current === "replaying-playing") pause();
    else play();
  }, [pause, play]);

  const setSpeed = useCallback((ms: number) => setSpeedMs(ms), []);

  // auto-play: rebuilt whenever mode or speed changes
  useEffect(() => {
    if (mode !== "replaying-playing") return;
    const t = window.setInterval(() => stepForward(), speedMs);
    return () => window.clearInterval(t);
  }, [mode, speedMs, stepForward]);

  // reaching the last move while playing → auto pause (clears the interval)
  useEffect(() => {
    if (mode === "replaying-playing" && currentStep >= N) pause();
  }, [mode, currentStep, N, pause]);

  const display: ReplayDisplay = useMemo(() => {
    if (!snapshot) {
      return {
        board: createBoard(),
        lastMove: null,
        winLine: null,
        interactive: false,
        drawn: false,
        celebrate: false,
        thinking: false,
        currentMove: null,
      };
    }
    const currentMove = currentStep === 0 ? null : moves[currentStep - 1] ?? null;
    const atEnd = currentStep === snapshot.moveCount;
    return {
      board: boardAtStep(snapshot, currentStep),
      lastMove: currentMove ? { x: currentMove.x, y: currentMove.y } : null,
      // the win line only exists at the very last step (mid-replay the game
      // "had not been won yet")
      winLine: atEnd && snapshot.winner ? snapshot.winLine : null,
      interactive: false,
      drawn: atEnd && snapshot.status === "draw",
      celebrate: false,
      thinking: false,
      currentMove,
    };
  }, [snapshot, moves, currentStep]);

  return {
    mode,
    currentStep,
    speedMs,
    N,
    moves,
    snapshot,
    canEnterReplay,
    display,
    enterReplay,
    exitReplay,
    stepForward,
    stepBack,
    goTo,
    play,
    pause,
    togglePlay,
    setSpeed,
  };
}
