/**
 * 技能编辑：右侧文本编辑区（CodeMirror 6，ADR 0016）。
 */

import { useEffect } from "react";
import { Copy, Save } from "lucide-react";
import { Button } from "@/lib/heroui";
import { cn } from "@/lib/utils";
import { SkillsCodeMirror } from "./SkillsCodeMirror";

export interface SkillsEditorPaneProps {
  filePath: string | null;
  content: string;
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCopy: () => void;
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function SkillsEditorPane({
  filePath,
  content,
  dirty,
  saving,
  disabled,
  onChange,
  onSave,
  onCopy,
}: SkillsEditorPaneProps) {
  // ⌘/Ctrl+S 保存（技能页聚焦时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (disabled || saving || !dirty || !filePath) return;
      onSave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, dirty, filePath, onSave, saving]);

  if (!filePath) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <p className="text-[13px] font-medium text-fg">选择左侧文件</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-fg-faint">
            点击文本文件可查看与编辑；Markdown 支持语法着色。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-soft px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-fg">
            {basename(filePath)}
            {dirty ? (
              <span className="ml-1.5 text-[11px] font-normal text-fg-faint">
                · 未保存
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-[10.5px] text-fg-faint">
            {filePath}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label="复制内容"
          isDisabled={disabled}
          onPress={onCopy}
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Button>
        <Button
          size="sm"
          isDisabled={disabled || saving || !dirty}
          onPress={onSave}
          className={cn(!dirty && "opacity-70")}
        >
          <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <SkillsCodeMirror
          key={filePath}
          filePath={filePath}
          value={content}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
