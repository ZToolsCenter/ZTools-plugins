import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { Facet } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { renderInlineMarkdown } from "../inlineRenderer";
import { decodeTableCellPipes, parseMarkdownTableAlignments, splitMarkdownTableRow } from "../markdownTable";

export const cm6TableLinkHandler = Facet.define<(url: string) => void, ((url: string) => void) | undefined>({
  combine: (handlers) => handlers.at(-1)
});

function parseRows(rawTable: string): { headers: string[]; alignments: Array<"left" | "center" | "right" | null>; rows: string[][] } {
  const lines = rawTable.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { headers: [], alignments: [], rows: [] };
  const headers = splitMarkdownTableRow(lines[0]);
  const alignments = parseMarkdownTableAlignments(lines[1], headers.length);
  const rows = lines.slice(2).map((line) => {
    const cells = splitMarkdownTableRow(line).slice(0, headers.length);
    return Array.from({ length: headers.length }, (_, index) => cells[index] ?? "");
  });
  return { headers, alignments, rows };
}

function TableCellContent({ value, onOpenLink }: { value: string; onOpenLink?: (url: string) => void }): React.ReactNode {
  return <>{renderInlineMarkdown(decodeTableCellPipes(value), { enableInlineMath: true, onOpenLink })}</>;
}

export function MarkdownTablePreview({ rawTable, onOpenLink }: { rawTable: string; onOpenLink?: (url: string) => void }): React.ReactElement {
  const { headers, alignments, rows } = parseRows(rawTable);
  const alignmentStyle = (column: number): React.CSSProperties => ({
    textAlign: alignments[column] || "left"
  });

  return (
    <table>
      <thead>
        <tr>
          {headers.map((cell, column) => (
            <th key={`head-${column}`} style={alignmentStyle(column)}>
              <TableCellContent value={cell} onOpenLink={onOpenLink} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {row.map((cell, column) => (
              <td key={`cell-${rowIndex}-${column}`} style={alignmentStyle(column)}>
                <TableCellContent value={cell} onOpenLink={onOpenLink} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** GFM table widget with escaped/code-span-aware columns and inline Markdown rendering. */
export class TableBlockWidget extends WidgetType {
  private readonly roots = new WeakMap<HTMLElement, Root>();

  constructor(public readonly rawTable: string, public readonly from: number, public readonly to: number) {
    super();
  }

  eq(other: TableBlockWidget): boolean {
    return this.rawTable === other.rawTable && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement("div");
    figure.className = "ty-table-figure ty-cm6-table-widget";
    figure.style.cursor = "pointer";
    // CM6 cannot measure widget margins, so vertical rhythm must use padding.
    figure.style.margin = "0";

    const root = createRoot(figure);
    this.roots.set(figure, root);
    const onOpenLink = view.state.facet(cm6TableLinkHandler);
    flushSync(() => root.render(<MarkdownTablePreview rawTable={this.rawTable} onOpenLink={onOpenLink} />));

    figure.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: this.from + 2 } });
      view.focus();
    });
    return figure;
  }

  destroy(dom: HTMLElement): void {
    const root = this.roots.get(dom);
    if (root) {
      root.unmount();
      this.roots.delete(dom);
    }
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}
