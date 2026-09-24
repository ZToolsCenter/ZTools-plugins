import { useEffect, useRef } from "react";

interface MathViewProps {
  value: string;
  displayMode?: boolean;
}

let katexPromise: Promise<any> | null = null;

const getKatex = async () => {
  if (!katexPromise) {
    katexPromise = import("katex").then((m) => m.default);
  }
  return katexPromise;
};

export const MathView: React.FC<MathViewProps> = ({
  value,
  displayMode = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const renderMath = async () => {
      if (!containerRef.current) return;
      try {
        const katex = await getKatex();
        if (!containerRef.current || !active) return;
        katex.render(value || "\\text{empty}", containerRef.current, {
          displayMode,
          throwOnError: false,
        });
      } catch {}
    };
    void renderMath();
    return () => { active = false; };
  }, [value, displayMode]);

  return (
    <span
      ref={containerRef}
      className={displayMode ? "block" : "inline-block"}
      style={
        displayMode
          ? { margin: "calc(16px * var(--editor-scale, 1)) 0" }
          : { padding: "0 calc(4px * var(--editor-scale, 1))" }
      }
    />
  );
};
