/**
 * Fine-Grained Transactional Edit History Engine (Typora-like Smooth Undo/Redo)
 *
 * Manages fine-grained typing checkpoints with cursor awareness, word/token
 * boundary coalescing, and structural edit transactions (lists, indents, enters).
 */

export interface EditSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  timestamp: number;
  actionTag?: string;
}

export interface PushOptions {
  force?: boolean;
  actionTag?: string;
}

export class EditHistoryManager {
  private undoStack: EditSnapshot[] = [];
  private redoStack: EditSnapshot[] = [];
  private current: EditSnapshot;
  private maxStackSize: number;

  constructor(
    initialValue = "",
    initialCursor = initialValue.length,
    maxStackSize = 100
  ) {
    this.maxStackSize = maxStackSize;
    this.current = {
      value: initialValue,
      selectionStart: initialCursor,
      selectionEnd: initialCursor,
      timestamp: Date.now(),
      actionTag: "init"
    };
  }

  /**
   * Get current state snapshot
   */
  public getCurrent(): EditSnapshot {
    return this.current;
  }

  /**
   * Reset the history stack with a fresh value
   */
  public reset(value: string, cursor = value.length): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = {
      value,
      selectionStart: cursor,
      selectionEnd: cursor,
      timestamp: Date.now(),
      actionTag: "reset"
    };
  }

  /**
   * Record a new user edit
   */
  public push(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    options: PushOptions = {}
  ): void {
    if (value === this.current.value) {
      // Just a cursor move, update current cursor position
      this.current.selectionStart = selectionStart;
      this.current.selectionEnd = selectionEnd;
      return;
    }

    const now = Date.now();
    const prev = this.current;
    const force = options.force ?? false;
    const tag = options.actionTag;

    // Detect operation type: insertion, deletion, replacement
    const isInsertion = value.length > prev.value.length;
    const isDeletion = value.length < prev.value.length;

    // Boundary detection: spaces, newlines, markdown list delimiters (e.g. "1. ", "- ")
    const justTypedChar = isInsertion
      ? value.slice(prev.selectionStart, selectionStart)
      : "";

    const hasBoundaryChar =
      justTypedChar.includes(" ") ||
      justTypedChar.includes("\n") ||
      justTypedChar.includes("\t") ||
      justTypedChar.includes(".") ||
      justTypedChar.includes("、") ||
      justTypedChar.includes("，") ||
      justTypedChar.includes("。");

    const timeDiff = now - prev.timestamp;
    const isTypingPause = timeDiff > 450; // User paused typing (>450ms)

    // Check if previous snapshot was already pushed or should be saved as a checkpoint
    const shouldCreateNewCheckpoint =
      force ||
      isTypingPause ||
      hasBoundaryChar ||
      (prev.actionTag && prev.actionTag !== tag);

    if (shouldCreateNewCheckpoint || this.undoStack.length === 0) {
      this.undoStack.push({ ...prev });
      if (this.undoStack.length > this.maxStackSize) {
        this.undoStack.shift();
      }
    }

    // Set new current state and clear redo stack on new input
    this.current = {
      value,
      selectionStart,
      selectionEnd,
      timestamp: now,
      actionTag: tag || (isInsertion ? "insert" : isDeletion ? "delete" : "replace")
    };
    this.redoStack = [];
  }

  /**
   * Undo to the previous snapshot
   */
  public undo(): EditSnapshot | null {
    if (this.undoStack.length === 0) {
      return null;
    }

    // Move current state to redo stack
    this.redoStack.push({ ...this.current });

    // Pop the previous state
    const previous = this.undoStack.pop()!;
    this.current = previous;

    return previous;
  }

  /**
   * Redo to the next snapshot
   */
  public redo(): EditSnapshot | null {
    if (this.redoStack.length === 0) {
      return null;
    }

    // Move current state to undo stack
    this.undoStack.push({ ...this.current });

    // Pop from redo stack
    const next = this.redoStack.pop()!;
    this.current = next;

    return next;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
