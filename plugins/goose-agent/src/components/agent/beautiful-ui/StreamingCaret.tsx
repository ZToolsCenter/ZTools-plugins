/** Streaming-text caret. Markdown stays in MarkdownContent. */
export function StreamingCaret({ visible = true }: { visible?: boolean }) {
  if (!visible) return null;
  return <span className="bui-stream-caret" aria-hidden />;
}
