export function DiffTable({
  title,
  before,
  after,
}: {
  title?: string;
  before: string;
  after: string;
}) {
  return (
    <div className="bui-diff">
      {title ? (
        <div className="border-b border-border px-2.5 py-1.5 text-[12px] font-medium text-foreground">
          {title}
        </div>
      ) : null}
      {before ? (
        <div className="bui-diff-row bui-diff-row--del">
          <span className="w-3 shrink-0 select-none">−</span>
          <span>{before}</span>
        </div>
      ) : null}
      {after ? (
        <div className="bui-diff-row bui-diff-row--add">
          <span className="w-3 shrink-0 select-none">+</span>
          <span>{after}</span>
        </div>
      ) : null}
    </div>
  );
}
