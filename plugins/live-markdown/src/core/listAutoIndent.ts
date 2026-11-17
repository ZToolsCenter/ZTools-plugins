/**
 * List Auto-increment & Smart Indent Engine
 * Handles Enter key behavior in Typora / Markdown lists:
 * 1. Ordered list item (e.g. "1. hello") -> Enter -> "1. hello\n2. "
 * 2. Unordered list item (e.g. "- hello") -> Enter -> "- hello\n- "
 * 3. Task list item (e.g. "- [ ] hello") -> Enter -> "- [ ] hello\n- [ ] "
 * 4. Empty list item (e.g. "2. " or "- ") -> Enter -> Clears the marker and exits list
 * 5. Indentation preservation (e.g. "  1. item" -> "  2. ")
 * 6. Mid-line split (e.g. "1. foo|bar" -> "1. foo\n2. bar")
 */

export interface ListEnterResult {
  handled: boolean;
  newText: string;
  newCursorPos: number;
  isListExit?: boolean;
}

export interface ListBackspaceResult {
  handled: boolean;
  newText: string;
  newCursorPos: number;
}

export interface ListTabResult {
  handled: boolean;
  newText: string;
  newCursorPos: number;
}

// Regex patterns for various list item types
// NOTE: Must have at least one whitespace (\s+) after marker to be recognized as a list!
// "1." without a space is pure plain text paragraph (e.g. version 1.0 or section 1.).
const TASK_LIST_REGEX = /^(\s*)([-*+]|\d+[\.)])\s+\[([ xX])\]\s*(.*)$/;
const ORDERED_LIST_REGEX = /^(\s*)(\d+)([\.)])\s+(.*)$/;
const UNORDERED_LIST_REGEX = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_ITEM_STRICT = /^(\s*)(\d+)([\.)])\s+(.*)$/;

/**
 * Renumbers subsequent ordered list items starting from startIndex to maintain continuous numbering.
 * Honors indentation level: skips nested child lists, and terminates when unindented or blank block ends.
 */
export function renumberSubsequentOrderedItems(
  lines: string[],
  startIndex: number,
  targetIndent: string,
  baseNumber: number
): void {
  let nextNum = baseNumber;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // Loose list check: if followed immediately by another item at matching indent, continue
      if (i + 1 < lines.length && lines[i + 1].trim()) {
        const nextMatch = lines[i + 1].match(ORDERED_ITEM_STRICT);
        if (nextMatch && nextMatch[1] === targetIndent) {
          continue;
        }
      }
      break;
    }

    const match = line.match(ORDERED_ITEM_STRICT);
    if (!match) {
      // Non-ordered line: if it is a child indent, keep searching; else stop
      const indentMatch = line.match(/^(\s*)/);
      const lineIndent = indentMatch ? indentMatch[1] : "";
      if (lineIndent.length > targetIndent.length) {
        continue;
      }
      break;
    }

    const currentIndent = match[1];
    if (currentIndent === targetIndent) {
      const delim = match[3];
      const rest = match[4] || "";
      const contentPart = rest.replace(/^\s*/, " ");
      lines[i] = `${currentIndent}${nextNum}${delim}${contentPart}`;
      nextNum++;
    } else if (currentIndent.length < targetIndent.length) {
      // Outdented to parent level -> end of this sublist
      break;
    }
  }
}

/**
 * Normalizes all ordered list items in a text block, resetting each consecutive sequence to 1, 2, 3...
 */
export function renumberOrderedList(text: string): string {
  const lines = text.split("\n");
  const indentCounters = new Map<string, number>();
  let prevIndent = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      indentCounters.clear();
      prevIndent = "";
      continue;
    }

    const match = line.match(ORDERED_ITEM_STRICT);
    if (match) {
      const indent = match[1];
      const delim = match[3];
      const rest = match[4] || "";
      const contentPart = rest.replace(/^\s*/, " ");

      if (indent.length < prevIndent.length) {
        // Returned to shallower indent, clear deeper counters
        for (const key of Array.from(indentCounters.keys())) {
          if (key.length > indent.length) indentCounters.delete(key);
        }
      }

      const currentCount = (indentCounters.get(indent) || 0) + 1;
      indentCounters.set(indent, currentCount);
      lines[i] = `${indent}${currentCount}${delim}${contentPart}`;
      prevIndent = indent;
    } else {
      const indentMatch = line.match(/^(\s*)/);
      const lineIndent = indentMatch ? indentMatch[1] : "";
      if (lineIndent.length <= prevIndent.length) {
        indentCounters.clear();
        prevIndent = "";
      }
    }
  }

  return lines.join("\n");
}

/**
 * Handle Enter key in Markdown text containing lists
 */
export function handleListEnter(
  value: string,
  selectionStart: number,
  selectionEnd: number
): ListEnterResult {
  // If text is selected, let default behavior or replace selection
  const beforeCursor = value.slice(0, selectionStart);
  const afterCursor = value.slice(selectionEnd);

  // Find the start of the current line
  const lastNewlineIdx = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewlineIdx === -1 ? 0 : lastNewlineIdx + 1;
  const currentLineBeforeCursor = beforeCursor.slice(lineStart);

  // Find the end of the current line
  const nextNewlineIdx = afterCursor.indexOf("\n");
  const currentLineAfterCursor =
    nextNewlineIdx === -1 ? afterCursor : afterCursor.slice(0, nextNewlineIdx);

  const fullCurrentLine = currentLineBeforeCursor + currentLineAfterCursor;

  // 1. Check Task List first (e.g. "- [ ] item" or "1. [x] item")
  const taskMatch = fullCurrentLine.match(TASK_LIST_REGEX);
  if (taskMatch) {
    const indent = taskMatch[1];
    const marker = taskMatch[2];
    const content = (taskMatch[4] || "").trim();

    // If item is empty (just "- [ ] "), exit the list item by clearing it
    if (!content) {
      const lineEnd = nextNewlineIdx === -1 ? value.length : selectionEnd + nextNewlineIdx;
      const textBeforeLine = value.slice(0, lineStart);
      const textAfterLine = value.slice(lineEnd);
      // Remove the empty list marker, leave an empty line or clean exit
      const newText = `${textBeforeLine}${textAfterLine}`;
      return {
        handled: true,
        newText,
        newCursorPos: lineStart,
        isListExit: true
      };
    }

    // Has content: insert new uncompleted task item on next line
    let nextMarker = marker;
    const numMatch = marker.match(/^(\d+)([\.)])$/);
    if (numMatch) {
      const nextNum = parseInt(numMatch[1], 10) + 1;
      nextMarker = `${nextNum}${numMatch[2]}`;
    } else {
      nextMarker = "-";
    }

    const nextPrefix = `\n${indent}${nextMarker} [ ] `;
    const newText = `${beforeCursor}${nextPrefix}${afterCursor}`;
    const newCursorPos = beforeCursor.length + nextPrefix.length;

    return {
      handled: true,
      newText,
      newCursorPos,
      isListExit: false
    };
  }

  // 2. Check Ordered List (e.g. "1. item" or "  2) item")
  const orderedMatch = fullCurrentLine.match(ORDERED_LIST_REGEX);
  if (orderedMatch) {
    const indent = orderedMatch[1];
    const currentNum = parseInt(orderedMatch[2], 10);
    const delimiter = orderedMatch[3]; // "." or ")"
    const content = (orderedMatch[4] || "").trim();

    // If item is empty (e.g. "1. "), exit list by clearing marker
    if (!content) {
      const lineEnd = nextNewlineIdx === -1 ? value.length : selectionEnd + nextNewlineIdx;
      const textBeforeLine = value.slice(0, lineStart);
      const textAfterLine = value.slice(lineEnd);
      const newText = `${textBeforeLine}${textAfterLine}`;
      return {
        handled: true,
        newText,
        newCursorPos: lineStart,
        isListExit: true
      };
    }

    // Has content: auto-increment number on next line!
    // And smartly renumber all subsequent ordered items at the same indentation level!
    const nextNum = currentNum + 1;
    const nextPrefix = `\n${indent}${nextNum}${delimiter} `;
    const fullInserted = `${beforeCursor}${nextPrefix}${afterCursor}`;
    const allLines = fullInserted.split("\n");

    const linesBefore = beforeCursor.split("\n");
    const insertedLineIdx = linesBefore.length; // Index of the newly inserted line

    renumberSubsequentOrderedItems(allLines, insertedLineIdx + 1, indent, nextNum + 1);

    const newText = allLines.join("\n");
    const newCursorPos = beforeCursor.length + nextPrefix.length;

    return {
      handled: true,
      newText,
      newCursorPos,
      isListExit: false
    };
  }

  // 3. Check Unordered List (e.g. "- item", "* item", "+ item")
  const unorderedMatch = fullCurrentLine.match(UNORDERED_LIST_REGEX);
  if (unorderedMatch) {
    const indent = unorderedMatch[1];
    const bullet = unorderedMatch[2];
    const content = (unorderedMatch[3] || "").trim();

    // If item is empty (e.g. "- "), exit list by clearing marker
    if (!content) {
      const lineEnd = nextNewlineIdx === -1 ? value.length : selectionEnd + nextNewlineIdx;
      const textBeforeLine = value.slice(0, lineStart);
      const textAfterLine = value.slice(lineEnd);
      const newText = `${textBeforeLine}${textAfterLine}`;
      return {
        handled: true,
        newText,
        newCursorPos: lineStart,
        isListExit: true
      };
    }

    // Has content: continue same bullet on next line
    const nextPrefix = `\n${indent}${bullet} `;
    const newText = `${beforeCursor}${nextPrefix}${afterCursor}`;
    const newCursorPos = beforeCursor.length + nextPrefix.length;

    return {
      handled: true,
      newText,
      newCursorPos,
      isListExit: false
    };
  }

  // Not a list item
  return {
    handled: false,
    newText: value,
    newCursorPos: selectionStart
  };
}

/**
 * Handle Backspace key in Markdown text containing lists.
 * When deleting an empty list item or backspacing at the beginning of an ordered list item,
 * cleanly removes or merges the item and smartly decrements all subsequent item numbers.
 */
export function handleListBackspace(
  value: string,
  selectionStart: number,
  selectionEnd: number
): ListBackspaceResult | null {
  if (selectionStart !== selectionEnd) return null;

  const beforeCursor = value.slice(0, selectionStart);
  const afterCursor = value.slice(selectionEnd);

  const lastNewlineIdx = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewlineIdx === -1 ? 0 : lastNewlineIdx + 1;
  const currentLineBeforeCursor = beforeCursor.slice(lineStart);

  const nextNewlineIdx = afterCursor.indexOf("\n");
  const currentLineAfterCursor =
    nextNewlineIdx === -1 ? afterCursor : afterCursor.slice(0, nextNewlineIdx);

  const fullCurrentLine = currentLineBeforeCursor + currentLineAfterCursor;

  // Case 1: Empty ordered list item (e.g. "2. " or "  3) ")
  const emptyOrderedMatch = fullCurrentLine.match(/^(\s*)(\d+)([\.)])\s+$/);
  if (emptyOrderedMatch) {
    const indent = emptyOrderedMatch[1];
    const currentNum = parseInt(emptyOrderedMatch[2], 10);

    const allLines = value.split("\n");
    const linesBefore = beforeCursor.split("\n");
    const currentLineIdx = linesBefore.length - 1;

    // Delete current line from document
    allLines.splice(currentLineIdx, 1);

    // Smartly decrement subsequent items starting from currentNum
    renumberSubsequentOrderedItems(allLines, currentLineIdx, indent, currentNum);

    // Calculate new cursor position at end of previous line
    let newCursorPos = 0;
    for (let i = 0; i < currentLineIdx && i < allLines.length; i++) {
      newCursorPos += allLines[i].length + 1;
    }
    if (currentLineIdx > 0 && allLines.length > 0) {
      newCursorPos = Math.max(0, newCursorPos - 1);
    }

    return {
      handled: true,
      newText: allLines.join("\n"),
      newCursorPos
    };
  }

  // Case 2: Cursor is right after the prefix "2. |Content" and user hits Backspace
  const prefixMatch = fullCurrentLine.match(/^(\s*)(\d+)([\.)])\s+/);
  if (prefixMatch && currentLineBeforeCursor === prefixMatch[0]) {
    const indent = prefixMatch[1];
    const currentNum = parseInt(prefixMatch[2], 10);
    const content = fullCurrentLine.slice(prefixMatch[0].length);

    const allLines = value.split("\n");
    const linesBefore = beforeCursor.split("\n");
    const currentLineIdx = linesBefore.length - 1;

    if (currentLineIdx > 0) {
      // Merge with previous line
      const prevLine = allLines[currentLineIdx - 1];
      const mergedLine =
        prevLine +
        (content ? (prevLine.endsWith(" ") ? content : ` ${content}`) : "");
      const newCursorPos = prevLine.length;

      allLines[currentLineIdx - 1] = mergedLine;
      allLines.splice(currentLineIdx, 1);

      // Decrement subsequent items
      renumberSubsequentOrderedItems(allLines, currentLineIdx, indent, currentNum);

      let calcPos = 0;
      for (let i = 0; i < currentLineIdx - 1; i++) {
        calcPos += allLines[i].length + 1;
      }
      calcPos += newCursorPos;

      return {
        handled: true,
        newText: allLines.join("\n"),
        newCursorPos: calcPos
      };
    } else {
      // Line 0: Strip list marker, turn into plain text paragraph
      allLines[0] = `${indent}${content}`;
      renumberSubsequentOrderedItems(allLines, 1, indent, 1);
      return {
        handled: true,
        newText: allLines.join("\n"),
        newCursorPos: indent.length
      };
    }
  }

  // Case 3: Empty unordered list item (e.g. "* " or "- " or "+ ")
  const emptyUnorderedMatch = fullCurrentLine.match(/^(\s*)([-*+])\s+$/);
  if (emptyUnorderedMatch) {
    const indent = emptyUnorderedMatch[1];
    const allLines = value.split("\n");
    const linesBefore = beforeCursor.split("\n");
    const currentLineIdx = linesBefore.length - 1;

    if (allLines.length <= 1) {
      // Single line -> strip list marker, turn into empty paragraph
      return {
        handled: true,
        newText: indent,
        newCursorPos: indent.length
      };
    }

    // Delete current line from document
    allLines.splice(currentLineIdx, 1);

    // Calculate cursor position at end of previous line
    let newCursorPos = 0;
    for (let i = 0; i < currentLineIdx && i < allLines.length; i++) {
      newCursorPos += allLines[i].length + 1;
    }
    if (currentLineIdx > 0 && allLines.length > 0) {
      newCursorPos = Math.max(0, newCursorPos - 1);
    }

    return {
      handled: true,
      newText: allLines.join("\n"),
      newCursorPos
    };
  }

  // Case 4: Cursor is right after unordered list prefix (e.g. "* |Content" or "- |Content")
  const unorderedPrefixMatch = fullCurrentLine.match(/^(\s*)([-*+])\s+/);
  if (
    unorderedPrefixMatch &&
    currentLineBeforeCursor === unorderedPrefixMatch[0]
  ) {
    const indent = unorderedPrefixMatch[1];
    const content = fullCurrentLine.slice(unorderedPrefixMatch[0].length);

    const allLines = value.split("\n");
    const linesBefore = beforeCursor.split("\n");
    const currentLineIdx = linesBefore.length - 1;

    if (currentLineIdx > 0) {
      // Merge with previous line
      const prevLine = allLines[currentLineIdx - 1];
      const mergedLine =
        prevLine +
        (content ? (prevLine.endsWith(" ") ? content : ` ${content}`) : "");
      const newCursorPos = prevLine.length;

      allLines[currentLineIdx - 1] = mergedLine;
      allLines.splice(currentLineIdx, 1);

      let calcPos = 0;
      for (let i = 0; i < currentLineIdx - 1; i++) {
        calcPos += allLines[i].length + 1;
      }
      calcPos += newCursorPos;

      return {
        handled: true,
        newText: allLines.join("\n"),
        newCursorPos: calcPos
      };
    } else {
      // Line 0: Strip bullet marker, turn into plain text paragraph
      allLines[0] = `${indent}${content}`;
      return {
        handled: true,
        newText: allLines.join("\n"),
        newCursorPos: indent.length
      };
    }
  }

  return null;
}

/**
 * Handle Tab and Shift+Tab key in Markdown lists and editor text (Typora Alignment):
 * - In lists: Tab indents current item by 2 spaces (creates nested child item);
 * - In lists: Shift+Tab outdents current item by 2 spaces (moves up one hierarchy level);
 * - In plain text: Tab inserts 2 spaces at cursor position instead of blurring the textarea.
 */
export function handleListTab(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  shiftKey: boolean
): ListTabResult {
  const INDENT_SPACES = "  "; // 2 spaces standard markdown indent

  const beforeCursor = value.slice(0, selectionStart);
  const afterCursor = value.slice(selectionEnd);

  const lastNewlineIdx = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewlineIdx === -1 ? 0 : lastNewlineIdx + 1;
  const currentLineBeforeCursor = beforeCursor.slice(lineStart);

  const nextNewlineIdx = afterCursor.indexOf("\n");
  const currentLineAfterCursor =
    nextNewlineIdx === -1 ? afterCursor : afterCursor.slice(0, nextNewlineIdx);

  const fullCurrentLine = currentLineBeforeCursor + currentLineAfterCursor;

  // Check if current line is a list item
  const isList = /^(\s*)([-*+]|\d+[\.)])\s+/.test(fullCurrentLine);

  if (isList) {
    if (!shiftKey) {
      // Indent (Tab): prefix current line with 2 spaces
      const textBeforeLine = value.slice(0, lineStart);
      const textFromLine = value.slice(lineStart);
      const newText = `${textBeforeLine}${INDENT_SPACES}${textFromLine}`;
      return {
        handled: true,
        newText,
        newCursorPos: selectionStart + INDENT_SPACES.length
      };
    } else {
      // Outdent (Shift+Tab): strip up to 2 leading spaces
      const leadingSpacesMatch = fullCurrentLine.match(/^ {1,2}/);
      if (leadingSpacesMatch) {
        const removedLen = leadingSpacesMatch[0].length;
        const textBeforeLine = value.slice(0, lineStart);
        const textFromLineAfterLeading = value.slice(lineStart + removedLen);
        const newText = `${textBeforeLine}${textFromLineAfterLeading}`;
        return {
          handled: true,
          newText,
          newCursorPos: Math.max(lineStart, selectionStart - removedLen)
        };
      }
      return {
        handled: true,
        newText: value,
        newCursorPos: selectionStart
      };
    }
  }

  // Plain text tab behavior: insert 2 spaces at cursor position
  if (!shiftKey) {
    const newText = `${beforeCursor}${INDENT_SPACES}${afterCursor}`;
    return {
      handled: true,
      newText,
      newCursorPos: selectionStart + INDENT_SPACES.length
    };
  }

  return {
    handled: false,
    newText: value,
    newCursorPos: selectionStart
  };
}
