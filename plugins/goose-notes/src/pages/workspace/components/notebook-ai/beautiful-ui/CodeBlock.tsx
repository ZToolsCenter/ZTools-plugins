import type { ReactNode } from "react";

export function CodeBlock({
  filename,
  language,
  children,
}: {
  filename?: string;
  language?: string;
  children: ReactNode;
}) {
  return (
    <div className="bui-code">
      {filename || language ? (
        <div className="bui-code-bar">
          <span className="font-mono text-[12px] font-medium">
            {filename || language}
          </span>
          {filename && language ? (
            <span className="text-[11.5px] text-muted-foreground">{language}</span>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
