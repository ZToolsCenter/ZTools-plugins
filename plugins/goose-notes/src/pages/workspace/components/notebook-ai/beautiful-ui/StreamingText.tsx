import type { ReactNode } from "react";

/** 包一层现有 Streamdown 输出，只加 caret/tail，不拆 Markdown。 */
export function StreamingText({
  streaming,
  children,
}: {
  streaming: boolean;
  children: ReactNode;
}) {
  return (
    <div className="bui-streaming" data-streaming={streaming ? "true" : "false"}>
      <span className="bui-stream-tail">{children}</span>
      {streaming ? <span className="bui-stream-caret" aria-hidden /> : null}
    </div>
  );
}
