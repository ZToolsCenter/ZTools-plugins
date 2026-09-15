import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GameState } from "@/lib/gomoku/engine";
import type { Player } from "@/lib/gomoku/types";
import { deriveMoves } from "@/lib/gomoku/replay";
import {
  buildMeta,
  defaultFileName,
  exportGame,
  sanitizeFileName,
  type ExportFormat,
} from "@/lib/gomoku/export";
import type { ToastItem } from "@/components/ui/toast";

const FORMATS: { id: ExportFormat; name: string }[] = [
  { id: "sgf", name: "SGF" },
  { id: "json", name: "JSON" },
  { id: "txt", name: "TXT" },
];

const EXT: Record<ExportFormat, string> = {
  sgf: ".sgf",
  json: ".json",
  txt: ".txt",
};

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  game: GameState;
  humanColor: Player;
  pushToast: (t: Omit<ToastItem, "id">) => void;
}

export default function ExportDialog({
  open,
  onClose,
  game,
  humanColor,
  pushToast,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("sgf");
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  // reset + focus on every open
  useEffect(() => {
    if (!open) return;
    setFormat("sgf");
    setName(defaultFileName());
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Esc closes the dialog only (capture + stopPropagation so the replay
  // Esc handler does not also exit replay underneath)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const canExport = game.moveCount > 0 && name.trim().length > 0;

  const doExport = async () => {
    if (!canExport) return;
    try {
      const moves = deriveMoves(game);
      const meta = buildMeta(game, humanColor);
      const { cancelled, filename, path } = await exportGame(moves, meta, format, name);
      if (cancelled) return;
      pushToast({
        title: t("export.exported", { filename: path ?? filename }),
        desc: t("export.exportedDesc", {
          count: game.moveCount,
          format: FORMATS.find((f) => f.id === format)!.name,
        }),
        icon: <Download className="h-5 w-5" />,
        toneClass: "bg-emerald-50 text-emerald-700",
      });
      onClose();
    } catch {
      pushToast({
        title: t("export.exportFailed"),
        toneClass: "bg-rose-50 text-rose-600",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("export.title")}
        className="relative w-full max-w-sm rounded-2xl border border-white/60 bg-white/95 p-5 shadow-[var(--shadow-float)] backdrop-blur-md"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-800">
            {t("export.title")}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-stone-400"
            aria-label={t("export.close")}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* format */}
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium text-stone-600">
            {t("export.format")}
          </legend>
          <div className="flex flex-col gap-2">
            {FORMATS.map((f) => (
              <label
                key={f.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors",
                  format === f.id
                    ? "border-orange-400 bg-orange-50"
                    : "border-stone-200 bg-white/70 hover:bg-stone-50"
                )}
              >
                <input
                  type="radio"
                  name="export-format"
                  className="mt-1 accent-orange-500"
                  checked={format === f.id}
                  onChange={() => setFormat(f.id)}
                />
                <span className="text-sm">
                  <b className="text-stone-800">{f.name}</b>
                  <span className="ml-1.5 text-xs text-stone-500">
                    {t(`export.${f.id}.desc`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* filename */}
        <div className="mb-5">
          <label
            htmlFor="export-filename"
            className="mb-2 block text-sm font-medium text-stone-600"
          >
            {t("export.filename")}
          </label>
          <div className="flex items-center gap-1 rounded-xl border border-stone-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-orange-300">
            <input
              id="export-filename"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(sanitizeFileName(e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-sm text-stone-800 outline-none"
              aria-label={t("export.filenameLabel")}
            />
            <span className="shrink-0 text-sm text-stone-400">
              {EXT[format]}
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("export.cancel")}
          </Button>
          <Button
            className="gap-1.5"
            disabled={!canExport}
            title={game.moveCount === 0 ? t("export.emptyTip") : undefined}
            onClick={doExport}
          >
            <Download className="h-4 w-4" /> {t("export.export")}
          </Button>
        </div>
      </div>
    </div>
  );
}
