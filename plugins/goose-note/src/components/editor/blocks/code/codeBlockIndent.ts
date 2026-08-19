export type CodeIndentResult = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

const DEFAULT_INDENT = "  ";

function getLineStart(text: string, offset: number) {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function getSelectedLineRange(text: string, selectionStart: number, selectionEnd: number) {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(0, Math.min(selectionEnd, text.length));
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const lineStart = getLineStart(text, from);
  const effectiveEnd = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const lineEnd = text.indexOf("\n", effectiveEnd);

  return {
    from,
    to,
    reversed: start > end,
    lineStart,
    lineEnd: lineEnd === -1 ? text.length : lineEnd,
  };
}

function restoreDirection(result: CodeIndentResult, reversed: boolean): CodeIndentResult {
  if (!reversed) return result;
  return {
    text: result.text,
    selectionStart: result.selectionEnd,
    selectionEnd: result.selectionStart,
  };
}

export function indentCodeSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  options: { outdent?: boolean; indent?: string } = {},
): CodeIndentResult {
  const indent = options.indent ?? DEFAULT_INDENT;
  const { from, to, reversed, lineStart, lineEnd } = getSelectedLineRange(
    text,
    selectionStart,
    selectionEnd,
  );

  if (from === to && !options.outdent) {
    const nextText = text.slice(0, from) + indent + text.slice(to);
    return restoreDirection(
      {
        text: nextText,
        selectionStart: from + indent.length,
        selectionEnd: from + indent.length,
      },
      reversed,
    );
  }

  const before = text.slice(0, lineStart);
  const selectedLines = text.slice(lineStart, lineEnd).split("\n");
  const after = text.slice(lineEnd);
  let selectionStartDelta = 0;
  let selectionEndDelta = 0;
  let runningLineStart = lineStart;

  const nextLines = selectedLines.map((line) => {
    if (!options.outdent) {
      if (runningLineStart < from) selectionStartDelta += indent.length;
      selectionEndDelta += indent.length;
      runningLineStart += line.length + 1;
      return indent + line;
    }

    const removeLength = line.startsWith("\t")
      ? 1
      : Math.min(indent.length, line.match(/^ */)?.[0]?.length ?? 0);

    if (removeLength > 0) {
      if (runningLineStart < from) {
        selectionStartDelta -= Math.min(removeLength, from - runningLineStart);
      }
      selectionEndDelta -= removeLength;
    }

    runningLineStart += line.length + 1;
    return line.slice(removeLength);
  });

  const nextText = before + nextLines.join("\n") + after;

  return restoreDirection(
    {
      text: nextText,
      selectionStart: Math.max(lineStart, from + selectionStartDelta),
      selectionEnd: Math.max(lineStart, to + selectionEndDelta),
    },
    reversed,
  );
}
