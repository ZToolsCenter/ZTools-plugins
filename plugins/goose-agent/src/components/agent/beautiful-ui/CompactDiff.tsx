/**
 * Compact proposed-edit chips for tool cards.
 * Does not replace ChangesPage / @pierre/diffs.
 */
export type CompactDiffFile = {
  path: string;
  add?: number;
  del?: number;
};

export function CompactDiff({
  files,
  onOpen,
}: {
  files: CompactDiffFile[];
  onOpen?: (path: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="bui bui-diff-list">
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          className="bui-diff-chip"
          onClick={() => onOpen?.(file.path)}
          aria-label={`查看差异 ${file.path}`}
        >
          <span className="min-w-0 truncate">{file.path}</span>
          {file.add !== undefined ? (
            <span className="bui-diff-chip__add">+{file.add}</span>
          ) : null}
          {file.del !== undefined && file.del > 0 ? (
            <span className="bui-diff-chip__del">−{file.del}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
