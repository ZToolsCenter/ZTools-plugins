import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CodeBlockToolbar } from "./CodeBlockToolbar";
import { useEditorSettings } from "@/components/editor/platform/hostContext";
import { EDITOR_UI_SCALE_CHANGE_EVENT } from "@/lib/appearance";
import { getScaledEditorUiPx } from "@/components/editor/utils/editorContextUi";

type CodeBlockEntry = {
  id: string;
  block: any;
  element: HTMLElement;
};

function collectCodeBlocks(blocks: any[]): any[] {
  return blocks.flatMap((block) => [
    ...(block.type === "codeBlock" ? [block] : []),
    ...(Array.isArray(block.children) ? collectCodeBlocks(block.children) : []),
  ]);
}

type FloatingCodeToolbarProps = {
  entry: CodeBlockEntry;
  editor: any;
};

function FloatingCodeToolbar({ entry, editor }: FloatingCodeToolbarProps) {
  const { defaultCodeBlockWrap, onDefaultCodeBlockWrapChange } =
    useEditorSettings();
  const [wrap, setWrap] = useState(
    entry.block.props?.wrap ?? defaultCodeBlockWrap,
  );

  const rect = entry.element.getBoundingClientRect();
  const codeEl = entry.element.querySelector("code") as HTMLElement | null;
  const language = entry.block.props?.language || "text";

  const getCodeContent = useCallback(() => {
    return codeEl?.textContent || "";
  }, [codeEl]);

  const handleLanguageChange = useCallback(
    (lang: string) => {
      editor.updateBlock(entry.block.id, { props: { language: lang } });
    },
    [editor, entry.block.id],
  );

  const handleWrapChange = useCallback(
    (nextWrap: boolean) => {
      onDefaultCodeBlockWrapChange(nextWrap);
      setWrap(nextWrap);
      if (!codeEl) return;
      codeEl.style.whiteSpace = nextWrap ? "break-spaces" : "pre";
      codeEl.style.wordBreak = nextWrap ? "break-word" : "normal";
      codeEl.style.overflowWrap = nextWrap ? "anywhere" : "normal";
    },
    [codeEl, onDefaultCodeBlockWrapChange],
  );

  const handleFormat = useCallback(
    (formatted: string) => {
      const current = getCodeContent();
      if (!formatted || formatted === current) return;
      editor.updateBlock(entry.block.id, {
        content: [{ type: "text", text: formatted, styles: {} }],
      });
    },
    [editor, entry.block.id, getCodeContent],
  );

  useLayoutEffect(() => {
    if (!codeEl) return;
    codeEl.style.whiteSpace = wrap ? "break-spaces" : "pre";
    codeEl.style.wordBreak = wrap ? "break-word" : "normal";
    codeEl.style.overflowWrap = wrap ? "anywhere" : "normal";
  }, [codeEl, wrap]);

  return createPortal(
    <div
      className="goose-code-floating-toolbar fixed z-[45] transition-[opacity,transform] duration-150 ease-out"
      contentEditable={false}
      style={{
        top: Math.max(8, rect.top + getScaledEditorUiPx(6)),
        left: Math.max(8, rect.right - getScaledEditorUiPx(8)),
        transform: "translateX(-100%)",
        animation: "fade-scale-in 150ms ease-out",
      }}
    >
      <div className="goose-editor-context-ui">
        <CodeBlockToolbar
          language={language}
          onLanguageChange={handleLanguageChange}
          getCodeContent={getCodeContent}
          onFormat={handleFormat}
          wrap={wrap}
          onWrapChange={handleWrapChange}
          editable={editor.isEditable}
        />
      </div>
    </div>,
    document.body,
  );
}

export function CodeBlockEnhancer({ editor }: { editor: any }) {
  const [entries, setEntries] = useState<CodeBlockEntry[]>([]);
  const rafRef = useRef<number | null>(null);
  const retryRef = useRef<number | null>(null);
  const signatureRef = useRef("");
  const didInitRef = useRef(false);

  const collectEntries = useCallback(() => {
    const container = document.querySelector(
      ".goose-blocknote-editor, .bn-editor",
    );
    if (!container) {
      return [];
    }

    const elements = Array.from(
      container.querySelectorAll<HTMLElement>(
        '.bn-block-content[data-content-type="codeBlock"]',
      ),
    );
    const codeBlocks = collectCodeBlocks(editor.document as any[]);
    return elements.flatMap((element, index) => {
      const block = codeBlocks[index];
      if (!block) return [];
      return [{ id: block.id, block, element }];
    });
  }, [editor]);

  const applyEntries = useCallback((nextEntries: CodeBlockEntry[]) => {
    const nextSignature = nextEntries
      .map((entry) => {
        const rect = entry.element.getBoundingClientRect();
        return `${entry.id}:${entry.block.props?.language ?? ""}:${Math.round(rect.top)}:${Math.round(rect.right)}`;
      })
      .join("|");

    if (signatureRef.current === nextSignature) return;
    signatureRef.current = nextSignature;
    setEntries(nextEntries);
  }, []);

  const refreshNow = useCallback(() => {
    applyEntries(collectEntries());
  }, [applyEntries, collectEntries]);

  const refresh = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      refreshNow();
    });
  }, [refreshNow]);

  useEffect(() => {
    let attempts = 0;
    let stopped = false;
    const retryInitialRefresh = () => {
      if (stopped) return;
      refresh();
      attempts += 1;
      if (attempts >= 40) return;
      retryRef.current = window.setTimeout(retryInitialRefresh, 250);
    };
    retryInitialRefresh();

    const unsubscribe = editor.onChange?.(() => refresh());
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    window.addEventListener(EDITOR_UI_SCALE_CHANGE_EVENT, refresh);

    return () => {
      stopped = true;
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      if (retryRef.current != null) {
        window.clearTimeout(retryRef.current);
      }
      if (typeof unsubscribe === "function") unsubscribe();
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      window.removeEventListener(EDITOR_UI_SCALE_CHANGE_EVENT, refresh);
    };
  }, [editor, refresh]);

  const liveEntries = useMemo(
    () => entries.filter((entry) => entry.element.isConnected),
    [entries],
  );

  return (
    <>
      <span
        data-goose-code-enhancer=""
        hidden
        aria-hidden="true"
        ref={(node) => {
          if (!node || didInitRef.current) return;
          didInitRef.current = true;
          window.setTimeout(refreshNow, 0);
        }}
      />
      {liveEntries.map((entry) => (
        <FloatingCodeToolbar key={entry.id} entry={entry} editor={editor} />
      ))}
    </>
  );
}
