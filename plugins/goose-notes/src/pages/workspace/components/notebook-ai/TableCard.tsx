/**
 * showTable 工具的输出渲染卡片
 */
import type { RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { ArtifactActions } from "./ArtifactActions";
import {
  createTableArtifactBlocks,
  insertArtifactBlocks,
  tableToMarkdown,
} from "./insertArtifact";

interface TableCardProps {
  title?: string;
  columns: string[];
  rows: string[][];
  editorRef?: RefObject<EditorRef | null>;
}

function tableFilename(title?: string) {
  const base =
    title
      ?.trim()
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 40) || "表格";
  return `${base}.md`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tableToHtml(columns: string[], rows: string[][]): string {
  const head = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function TableCard({ title, columns, rows, editorRef }: TableCardProps) {
  const markdown = tableToMarkdown(columns, rows);

  return (
    <div className="notebook-ai-canvas-card notebook-ai-canvas-card--scroll my-2 min-w-0 max-w-full">
      <div className="notebook-ai-canvas-card-header">
        <div className="notebook-ai-canvas-card-title">{title?.trim() || "表格"}</div>
        {markdown ? (
          <ArtifactActions
            copySource={markdown}
            downloadSource={markdown}
            filename={tableFilename(title)}
            mimeType="text/markdown;charset=utf-8"
            onPreview={async () => ({
              kind: "html",
              html: tableToHtml(columns, rows),
              fileName: `${tableFilename(title).replace(/\.md$/i, "")}.html`,
            })}
            onInsert={() =>
              insertArtifactBlocks(
                editorRef,
                createTableArtifactBlocks(title, columns, rows),
              )
            }
          />
        ) : null}
      </div>
      {/* 单层横向滚动：wrapper 直接 overflow-x:auto（无外 hidden + 内 auto） */}
      <div className="notebook-ai-canvas-card-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
