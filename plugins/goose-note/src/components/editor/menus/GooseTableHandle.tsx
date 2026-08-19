import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as LucideIcons from "lucide-react";
import {
  EMPTY_CELL_HEIGHT,
  EMPTY_CELL_WIDTH,
  type PartialTableContent,
} from "@blocknote/core";
import { TableHandlesExtension } from "@blocknote/core/extensions";
import { CellSelection, deleteRow, selectedRect } from "prosemirror-tables";
import {
  useBlockNoteEditor,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/editor/ui/dropdown-menu";
import { cn } from "@/components/editor/utils/cn";
import { useEditorSettings } from "@/components/editor/platform/hostContext";

type TableExtendButtonProps = {
  orientation: "addOrRemoveRows" | "addOrRemoveColumns";
  hideOtherElements: (hide: boolean) => void;
};

const roundTableExtendDelta = (value: number, margin = 0.3) => {
  const lowerBound = Math.floor(value) + margin;
  const upperBound = Math.ceil(value) - margin;

  if (value >= lowerBound && value <= upperBound) return Math.round(value);
  return value < lowerBound ? Math.floor(value) : Math.ceil(value);
};

export function GooseTableExtendButton({
  orientation,
  hideOtherElements,
}: TableExtendButtonProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const tableHandles = useExtension(TableHandlesExtension);
  const block = useExtensionState(TableHandlesExtension, {
    selector: (state) => state?.block,
  });
  const movedMouse = useRef(false);
  const [editingState, setEditingState] = useState<
    | {
        originalContent: PartialTableContent<any, any>;
        originalCroppedContent: PartialTableContent<any, any>;
        startPos: number;
      }
    | undefined
  >();
  const isColumnHandle = orientation === "addOrRemoveColumns";

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      tableHandles.freezeHandles();
      hideOtherElements(true);

      if (!block) return;

      setEditingState({
        originalContent: block.content as any,
        originalCroppedContent: {
          rows: tableHandles.cropEmptyRowsOrColumns(
            block,
            isColumnHandle ? "columns" : "rows",
          ),
        } as PartialTableContent<any, any>,
        startPos: isColumnHandle ? event.clientX : event.clientY,
      });
      movedMouse.current = false;
      event.preventDefault();
    },
    [block, hideOtherElements, isColumnHandle, tableHandles],
  );

  const handleClick = useCallback(() => {
    if (!block || movedMouse.current) return;

    editor.updateBlock(block, {
      type: "table",
      content: {
        ...block.content,
        rows: isColumnHandle
          ? tableHandles.addRowsOrColumns(block, "columns", 1)
          : tableHandles.addRowsOrColumns(block, "rows", 1),
      } as any,
    });
  }, [block, editor, isColumnHandle, tableHandles]);

  useEffect(() => {
    if (!editingState || !block) return;

    const handleMouseMove = (event: MouseEvent) => {
      movedMouse.current = true;

      const diff =
        (isColumnHandle ? event.clientX : event.clientY) -
        editingState.startPos;
      const croppedCount = isColumnHandle
        ? (editingState.originalCroppedContent.rows[0]?.cells.length ?? 0)
        : editingState.originalCroppedContent.rows.length;
      const originalCount = isColumnHandle
        ? (editingState.originalContent.rows[0]?.cells.length ?? 0)
        : editingState.originalContent.rows.length;
      const currentCount = isColumnHandle
        ? block.content.rows[0].cells.length
        : block.content.rows.length;
      const nextCount =
        originalCount +
        roundTableExtendDelta(
          diff / (isColumnHandle ? EMPTY_CELL_WIDTH : EMPTY_CELL_HEIGHT),
        );

      if (
        nextCount < croppedCount ||
        nextCount <= 0 ||
        nextCount === currentCount
      ) {
        return;
      }

      editor.updateBlock(block, {
        type: "table",
        content: {
          ...block.content,
          rows: isColumnHandle
            ? tableHandles.addRowsOrColumns(
                {
                  type: "table",
                  content: editingState.originalCroppedContent,
                } as any,
                "columns",
                nextCount - croppedCount,
              )
            : tableHandles.addRowsOrColumns(
                {
                  type: "table",
                  content: editingState.originalCroppedContent,
                } as any,
                "rows",
                nextCount - croppedCount,
              ),
        } as any,
      });

      editor.setTextCursorPosition(block);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [block, editingState, editor, isColumnHandle, tableHandles]);

  useEffect(() => {
    if (!editingState) return;

    const handleMouseUp = () => {
      hideOtherElements(false);
      tableHandles.unfreezeHandles();
      setEditingState(undefined);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [editingState, hideOtherElements, tableHandles]);

  if (!editor.isEditable) return null;

  return (
    <button
      type="button"
      className={cn(
        "goose-editor-inline-context-ui goose-table-extend-button",
        isColumnHandle
          ? "goose-table-extend-button-columns"
          : "goose-table-extend-button-rows",
        editingState && "is-editing",
      )}
      aria-label={isColumnHandle ? "添加列" : "添加行"}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      <LucideIcons.Plus className="h-3.5 w-3.5" />
    </button>
  );
}

type TableHandleProps = {
  orientation: "row" | "column";
  hideOtherElements: (hide: boolean) => void;
};

function cloneTableCell(cell: unknown) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(cell);
  }

  return JSON.parse(JSON.stringify(cell));
}

function getTableColumnCount(content: PartialTableContent<any, any>) {
  return Math.max(0, ...content.rows.map((row) => row.cells.length));
}

function getInsertedColumnRows(
  tableHandles: ReturnType<typeof useExtension<typeof TableHandlesExtension>>,
  block: any,
  insertIndex: number,
) {
  const rowsWithTrailingColumn = tableHandles.addRowsOrColumns(
    block,
    "columns",
    1,
  );

  return block.content.rows.map(
    (row: { cells: unknown[] }, rowIndex: number) => {
      const cells = [...row.cells];
      const blankCell = rowsWithTrailingColumn[rowIndex]?.cells.at(-1) ?? "";
      cells.splice(insertIndex, 0, cloneTableCell(blankCell));
      return {
        ...row,
        cells,
      };
    },
  );
}

function getDeletedColumnRows(
  content: PartialTableContent<any, any>,
  fromIndex: number,
  toIndex = fromIndex + 1,
) {
  return content.rows.map((row) => ({
    ...row,
    cells: row.cells.filter(
      (_, cellIndex) => cellIndex < fromIndex || cellIndex >= toIndex,
    ),
  }));
}

function getUpdatedColumnWidths(
  columnWidths: unknown[] | undefined,
  action:
    | { type: "insert"; index: number }
    | { type: "delete"; fromIndex: number; toIndex: number },
) {
  if (!Array.isArray(columnWidths)) return columnWidths;

  const nextColumnWidths = [...columnWidths];
  if (action.type === "insert") {
    nextColumnWidths.splice(
      action.index,
      0,
      columnWidths[action.index] ?? columnWidths.at(-1),
    );
  } else {
    nextColumnWidths.splice(
      action.fromIndex,
      action.toIndex - action.fromIndex,
    );
  }
  return nextColumnWidths;
}

function getBlockElementWidth(blockId: string | undefined) {
  if (!blockId) return 0;
  const blockElement = document.querySelector<HTMLElement>(
    `.bn-block[data-id="${blockId}"]`,
  );
  return blockElement?.getBoundingClientRect().width ?? 0;
}

function getEvenColumnWidths(columnCount: number, tableWidth: number) {
  if (columnCount <= 0 || tableWidth <= 0) return undefined;
  const baseWidth = Math.floor(tableWidth / columnCount);
  const widths = Array.from({ length: columnCount }, () => baseWidth);
  widths[widths.length - 1] += Math.round(tableWidth - baseWidth * columnCount);
  return widths;
}

export function GooseTableHandle({
  orientation,
  hideOtherElements,
}: TableHandleProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const { features } = useEditorSettings();
  const tableHandles = useExtension(TableHandlesExtension);
  const state = useExtensionState(TableHandlesExtension);
  const [open, setOpen] = useState(false);

  const index = state
    ? orientation === "column"
      ? state.colIndex
      : state.rowIndex
    : undefined;
  const isRow = orientation === "row";
  const isHeaderRow = Boolean(state?.block.content.headerRows);

  const closeMenu = useCallback(() => {
    setOpen(false);
    tableHandles?.unfreezeHandles();
    hideOtherElements(false);
    editor.focus();
  }, [editor, hideOtherElements, tableHandles]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!tableHandles || !state?.block) return;
      hideOtherElements(true);
      if (orientation === "column") {
        tableHandles.colDragStart(e);
      } else {
        tableHandles.rowDragStart(e);
      }
    },
    [tableHandles, state, orientation, hideOtherElements],
  );

  const handleDragEnd = useCallback(() => {
    if (!tableHandles) return;
    tableHandles.dragEnd();
    hideOtherElements(false);
  }, [tableHandles, hideOtherElements]);

  const updateTableColumns = useCallback(
    (action: "add-left" | "add-right" | "delete") => {
      if (!state?.block || !tableHandles || index === undefined || isRow)
        return;

      const block = state.block;
      const content = block.content as PartialTableContent<any, any>;
      const columnCount = getTableColumnCount(content);
      const insertIndex = action === "add-left" ? index : index + 1;
      const rows =
        action === "delete"
          ? getDeletedColumnRows(content, index)
          : getInsertedColumnRows(tableHandles, block, insertIndex);
      const columnWidths = getUpdatedColumnWidths(
        content.columnWidths,
        action === "delete"
          ? { type: "delete", fromIndex: index, toIndex: index + 1 }
          : { type: "insert", index: insertIndex },
      );

      if (action === "delete" && columnCount <= 1) return;

      editor.updateBlock(block, {
        type: "table",
        content: {
          ...content,
          columnWidths,
          rows,
        } as any,
      });
      editor.setTextCursorPosition(block);
    },
    [editor, index, isRow, state?.block, tableHandles],
  );

  const handleDelete = useCallback(() => {
    const selection = editor.prosemirrorState.selection;
    if (selection instanceof CellSelection) {
      const rect = selectedRect(editor.prosemirrorState);
      const selectedRows = rect.bottom - rect.top;
      const selectedColumns = rect.right - rect.left;

      if (isRow && selectedRows > 1) {
        editor.exec((state, dispatch) => deleteRow(state, dispatch));
        return;
      }

      if (!isRow && selectedColumns > 1) {
        if (state?.block) {
          const content = state.block.content as PartialTableContent<any, any>;
          const columnCount = getTableColumnCount(content);
          if (selectedColumns < columnCount) {
            editor.updateBlock(state.block, {
              type: "table",
              content: {
                ...content,
                columnWidths: getUpdatedColumnWidths(content.columnWidths, {
                  type: "delete",
                  fromIndex: rect.left,
                  toIndex: rect.right,
                }),
                rows: getDeletedColumnRows(content, rect.left, rect.right),
              } as any,
            });
            editor.setTextCursorPosition(state.block);
          }
        }
        return;
      }
    }

    if (isRow) {
      tableHandles?.removeRowOrColumn(index!, orientation);
    } else {
      updateTableColumns("delete");
    }
  }, [
    editor,
    index,
    isRow,
    orientation,
    state?.block,
    tableHandles,
    updateTableColumns,
  ]);

  const handleToggleHeaderRow = useCallback(
    (checked: boolean | "indeterminate") => {
      if (!state?.block || !isRow || index !== 0) return;
      editor.updateBlock(state.block, {
        ...state.block,
        content: {
          ...state.block.content,
          headerRows: checked === true ? 1 : undefined,
        } as any,
      });
    },
    [editor, index, isRow, state?.block],
  );

  const handleEvenColumnWidth = useCallback(() => {
    if (!state?.block) return;
    const content = state.block.content as PartialTableContent<any, any>;
    const columnCount = getTableColumnCount(content);
    const columnWidths = getEvenColumnWidths(
      columnCount,
      getBlockElementWidth(state.block.id),
    );
    if (!columnWidths) return;

    editor.updateBlock(state.block, {
      type: "table",
      content: {
        ...content,
        columnWidths,
      } as any,
    });
    editor.setTextCursorPosition(state.block);
  }, [editor, state?.block]);

  const runMenuAction = useCallback(
    (action: () => void) => {
      closeMenu();
      action();
    },
    [closeMenu],
  );

  if (!state || index === undefined) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) {
          tableHandles?.freezeHandles();
          hideOtherElements(true);
        } else {
          tableHandles?.unfreezeHandles();
          hideOtherElements(false);
          editor.focus();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="goose-editor-position-safe-trigger goose-table-handle-btn"
          aria-label={isRow ? "行操作" : "列操作"}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          style={
            {
              "--goose-popup-trigger-rotate": isRow ? "0turn" : "0.25turn",
            } as CSSProperties
          }
        >
          <LucideIcons.GripVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        editorContext
        className="w-40"
        side={isRow ? "right" : "bottom"}
        align="start"
      >
        {isRow ? (
          <>
            <DropdownMenuItem
              onClick={() =>
                tableHandles?.addRowOrColumn(index!, {
                  orientation: "row",
                  side: "above",
                })
              }
            >
              <LucideIcons.ArrowUp className="mr-2 h-4 w-4" /> 上方添加行
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                tableHandles?.addRowOrColumn(index!, {
                  orientation: "row",
                  side: "below",
                })
              }
            >
              <LucideIcons.ArrowDown className="mr-2 h-4 w-4" /> 下方添加行
            </DropdownMenuItem>
            {index === 0 && features.tablePresentationControls && (
              <>
                {isHeaderRow ? (
                  <DropdownMenuItem
                    onClick={() => handleToggleHeaderRow(false)}
                    className="bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                  >
                    <LucideIcons.Heading1 className="mr-2 h-4 w-4" />
                    取消标题行
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => handleToggleHeaderRow(true)}>
                    <LucideIcons.Heading1 className="mr-2 h-4 w-4" />
                    设为标题行
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => runMenuAction(handleEvenColumnWidth)}
                >
                  <LucideIcons.AlignJustify className="mr-2 h-4 w-4" />
                  两端对齐
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={handleDelete}>
              <LucideIcons.Trash2 className="mr-2 h-4 w-4" /> 删除行
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onClick={() =>
                runMenuAction(() => updateTableColumns("add-left"))
              }
            >
              <LucideIcons.ArrowLeft className="mr-2 h-4 w-4" /> 左侧添加列
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                runMenuAction(() => updateTableColumns("add-right"))
              }
            >
              <LucideIcons.ArrowRight className="mr-2 h-4 w-4" /> 右侧添加列
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runMenuAction(handleDelete)}>
              <LucideIcons.Trash2 className="mr-2 h-4 w-4" /> 删除列
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
