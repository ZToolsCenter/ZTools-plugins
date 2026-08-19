/**
 * showTable 工具的输出渲染卡片
 */
interface TableCardProps {
  title?: string;
  columns: string[];
  rows: string[][];
}

export function TableCard({ title, columns, rows }: TableCardProps) {
  return (
    <div className="my-2 min-w-0 max-w-full rounded-[8px] bg-[var(--goose-interactive-hover)]">
      {title && (
        <div className="px-3 py-2 text-xs font-medium text-foreground">
          {title}
        </div>
      )}
      {/* 单层横向滚动：wrapper 直接 overflow-x:auto（无外 hidden + 内 auto） */}
      <div
        className="min-w-0 max-w-full"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          background: "hsl(var(--goose-editor-bg))",
        }}
      >
        <table
          className="text-xs"
          style={{
            width: "auto",
            minWidth: "100%",
            maxWidth: "none",
            tableLayout: "auto",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr className="bg-[var(--goose-interactive-hover)]">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left font-medium text-muted-foreground"
                  style={{ whiteSpace: "normal", wordBreak: "break-word" }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="transition-colors odd:bg-transparent hover:bg-[var(--goose-interactive-hover)]"
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-foreground"
                    style={{ whiteSpace: "normal", wordBreak: "break-word" }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
