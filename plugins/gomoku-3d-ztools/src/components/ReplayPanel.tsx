import {
  Box,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Grid3x3,
  Pause,
  Play,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { BLACK, type Player } from "@/lib/gomoku/types";
import type { UseReplayReturn } from "@/hooks/useReplay";
import type { ViewMode } from "@/hooks/useViewMode";

const SPEEDS: { label: string; ms: number }[] = [
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
  { label: "4×", ms: 200 },
];

export interface ReplayPanelProps {
  replay: UseReplayReturn;
  humanColor: Player;
  muted: boolean;
  onToggleMute: () => void;
  viewMode: ViewMode;
  onSwitchView: (m: ViewMode) => void;
  onExport: () => void;
  exportDisabled: boolean;
  /** Mobile bottom-sheet variant: tighter paddings, same controls. */
  compact?: boolean;
}

export default function ReplayPanel({
  replay,
  humanColor,
  muted,
  onToggleMute,
  viewMode,
  onSwitchView,
  onExport,
  exportDisabled,
  compact = false,
}: ReplayPanelProps) {
  const { t } = useTranslation();
  const { currentStep, N, moves } = replay;
  const playing = replay.mode === "replaying-playing";
  const atStart = currentStep === 0;
  const atEnd = currentStep === N;
  const currentMove = currentStep === 0 ? null : moves[currentStep - 1];

  const info = currentMove
    ? t("replay.moveInfo", {
        step: currentStep,
        label: currentMove.player === BLACK ? t("replay.black") : t("replay.white"),
        player:
          currentMove.player === humanColor
            ? t("replay.player")
            : t("replay.computer"),
      }) + ` · (${currentMove.x}, ${currentMove.y})`
    : t("replay.opening");

  return (
    <Card className={cn("glass", compact && "shadow-[var(--shadow-float)]")}>
      <CardContent
        className={cn(
          "flex flex-col",
          compact ? "gap-2.5 p-3" : "gap-3 p-5"
        )}
      >
        {/* header: badge + exit */}
        <div className="flex items-center justify-between">
          <Badge className="gap-1.5 bg-stone-800 text-white hover:bg-stone-800">
            <Film className="h-3.5 w-3.5" /> {t("replay.mode")}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 gap-1 text-stone-500"
            onClick={replay.exitReplay}
            aria-label={t("replay.exitReplay")}
          >
            <X className="h-4 w-4" /> {t("replay.exit")}
          </Button>
        </div>

        {/* current move info */}
        <div
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm text-stone-700 shadow-[var(--shadow-soft)]"
        >
          {currentMove && (
            <span
              aria-hidden
              className={cn(
                "h-3 w-3 shrink-0 rounded-full border",
                currentMove.player === BLACK
                  ? "border-stone-800 bg-stone-800"
                  : "border-stone-300 bg-white"
              )}
            />
          )}
          <span className="truncate font-medium">{info}</span>
        </div>

        {/* progress */}
        <div className="flex items-center gap-3">
          <Slider
            aria-label={t("replay.progress")}
            min={0}
            max={N}
            step={1}
            value={[currentStep]}
            onValueChange={(v) => replay.goTo(v[0])}
            className="flex-1"
          />
          <span className="shrink-0 text-xs tabular-nums text-stone-500">
            {currentStep} / {N}
          </span>
        </div>

        {/* transport controls */}
        <div className="flex items-center justify-center gap-1.5">
          <Button
            size="icon"
            variant="outline"
            className="h-11 w-11"
            aria-label={t("replay.first")}
            disabled={atStart}
            onClick={() => replay.goTo(0)}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-11 w-11"
            aria-label={t("replay.prev")}
            disabled={atStart}
            onClick={replay.stepBack}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-11 w-11"
            aria-label={
              playing
                ? t("replay.pause")
                : atEnd
                  ? t("replay.replayAgain")
                  : t("replay.play")
            }
            aria-pressed={playing}
            onClick={replay.togglePlay}
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : atEnd ? (
              <RotateCw className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-11 w-11"
            aria-label={t("replay.next")}
            disabled={atEnd}
            onClick={replay.stepForward}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-11 w-11"
            aria-label={t("replay.last")}
            disabled={atEnd}
            onClick={() => replay.goTo(N)}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* speed */}
        <div
          role="group"
          aria-label={t("replay.speed")}
          className="flex items-center justify-center gap-1.5"
        >
          {SPEEDS.map((s) => (
            <Button
              key={s.ms}
              size="sm"
              variant={replay.speedMs === s.ms ? "default" : "outline"}
              aria-pressed={replay.speedMs === s.ms}
              className="h-9 flex-1 px-0 tabular-nums"
              onClick={() => replay.setSpeed(s.ms)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <Separator />

        {/* companions that remain useful during replay */}
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10"
            aria-label={t("replay.soundToggle")}
            onClick={onToggleMute}
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10"
            aria-label={t("replay.view")}
            title={
              viewMode === "3d"
                ? t("match.switchTo2d")
                : t("match.switchTo3d")
            }
            onClick={() => onSwitchView(viewMode === "3d" ? "2d" : "3d")}
          >
            {viewMode === "2d" ? (
              <Box className="h-4 w-4" />
            ) : (
              <Grid3x3 className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto h-10 gap-1.5"
            disabled={exportDisabled}
            onClick={onExport}
          >
            <Download className="h-4 w-4" /> {t("replay.export")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
