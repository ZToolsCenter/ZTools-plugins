/**
 * 判断文件应沿用的换行格式，优先采用正文中首次出现的换行。
 * @param {string} content 文件正文。
 * @returns {'\r\n'|'\n'} 文件换行格式。
 */
function detectLineEnding(content) {
  const crlfIndex = content.indexOf('\r\n');
  const lfIndex = content.indexOf('\n');
  if (lfIndex === -1 || crlfIndex === -1) return '\n';
  return crlfIndex < lfIndex ? '\r\n' : '\n';
}

/**
 * 将文本中的所有换行形式统一为 LF。
 * @param {unknown} value 待规范化文本。
 * @returns {string} 使用 LF 换行的文本。
 */
function normalizeToLF(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 将 LF 文本恢复为目标文件原本使用的换行形式。
 * @param {string} value 已使用 LF 的文本。
 * @param {'\r\n'|'\n'} lineEnding 目标文件的换行形式。
 * @returns {string} 恢复换行后的文本。
 */
function restoreLineEndings(value, lineEnding) {
  return lineEnding === '\r\n' ? value.replace(/\n/g, '\r\n') : value;
}

/**
 * 对文本执行 Pi 风格的有限模糊匹配规范化。
 * @param {unknown} value 待规范化文本。
 * @returns {string} 可用于回退匹配的规范化文本。
 */
function normalizeForFuzzyMatch(value) {
  return normalizeToLF(value)
    .normalize('NFKC')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}

/**
 * 统计文本中所有非重叠的字面量匹配位置。
 * @param {string} content 待搜索正文。
 * @param {string} search 搜索文本。
 * @returns {number[]} 每个匹配的起始字符位置。
 */
function matchOffsets(content, search) {
  const offsets = [];
  if (!search) return offsets;
  let offset = 0;
  while (offset <= content.length - search.length) {
    const match = content.indexOf(search, offset);
    if (match < 0) break;
    offsets.push(match);
    offset = match + Math.max(1, search.length);
  }
  return offsets;
}

/**
 * 在原文中先精确匹配，再使用 Pi 的有限规范化规则回退匹配。
 * @param {string} content 已规范化正文。
 * @param {string} oldText 待替换文本。
 * @returns {{found: boolean, index: number, matchLength: number, usedFuzzyMatch: boolean, contentForReplacement: string}} 匹配结果。
 */
function fuzzyFindText(content, oldText) {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }
  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  };
}

/**
 * 获取规范化正文中每一行的字符范围。
 * @param {string} content 规范化正文。
 * @returns {Array<{start: number, end: number}>} 每一行的起止偏移。
 */
function getLineSpans(content) {
  const lines = content.match(/[^\n]*\n|[^\n]+/g) || [];
  let offset = 0;
  return lines.map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

/**
 * 将字符范围转换为受影响的行范围。
 * @param {Array<{start: number, end: number}>} lines 正文行范围。
 * @param {{matchIndex: number, matchLength: number}} replacement 替换范围。
 * @returns {{startLine: number, endLine: number}} 左闭右开行范围。
 * @throws {Error} 替换范围无法映射到正文行时抛出。
 */
function getReplacementLineRange(lines, replacement) {
  const end = replacement.matchIndex + replacement.matchLength;
  const startLine = lines.findIndex(
    (line) => replacement.matchIndex >= line.start && replacement.matchIndex < line.end,
  );
  if (startLine < 0) throw new Error('编辑范围不在当前文件内容内。');
  let endLine = startLine;
  while (endLine < lines.length && lines[endLine].end < end) endLine += 1;
  if (endLine >= lines.length) throw new Error('编辑范围不在当前文件内容内。');
  return { startLine, endLine: endLine + 1 };
}

/**
 * 从后向前应用已经计算好的替换，保持原始偏移有效。
 * @param {string} content 待修改正文。
 * @param {Array<{matchIndex: number, matchLength: number, newText: string}>} replacements 已排序或未排序的替换。
 * @param {number} offset 替换集合在正文中的起始偏移。
 * @returns {string} 替换后的正文。
 */
function applyReplacements(content, replacements, offset = 0) {
  let result = content;
  for (const replacement of [...replacements].sort((left, right) => left.matchIndex - right.matchIndex).reverse()) {
    const index = replacement.matchIndex - offset;
    result = `${result.slice(0, index)}${replacement.newText}${result.slice(index + replacement.matchLength)}`;
  }
  return result;
}

/**
 * 在模糊匹配时只重写命中的行，保留其他行的原始空格和字符。
 * @param {string} originalContent 原始 LF 正文。
 * @param {string} baseContent 模糊规范化后的正文。
 * @param {Array<{matchIndex: number, matchLength: number, newText: string}>} replacements 匹配结果。
 * @returns {string} 保留未修改行原文的替换结果。
 */
function applyReplacementsPreservingUnchangedLines(originalContent, baseContent, replacements) {
  // 先按统一后的正文建立行映射，保证模糊匹配不会改写未命中的原始行。
  const originalLines = originalContent.match(/[^\n]*\n|[^\n]+/g) || [];
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error('规范化后的编辑范围无法映射回原文件行。');
  }
  const groups = [];
  // 将命中同一行或相邻范围的替换合并，避免重复拼接同一行内容。
  for (const replacement of [...replacements].sort((left, right) => left.matchIndex - right.matchIndex)) {
    const range = getReplacementLineRange(baseLines, replacement);
    const current = groups.at(-1);
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
    } else {
      groups.push({ ...range, replacements: [replacement] });
    }
  }
  let originalLineIndex = 0;
  let result = '';
  // 只替换命中行，其他行直接复用原始文本以保留空格和字符形式。
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join('');
    const groupStart = baseLines[group.startLine].start;
    const groupEnd = baseLines[group.endLine - 1].end;
    result += applyReplacements(
      baseContent.slice(groupStart, groupEnd),
      group.replacements,
      groupStart,
    );
    originalLineIndex = group.endLine;
  }
  return result + originalLines.slice(originalLineIndex).join('');
}

/**
 * 创建 Pi 风格的编辑失败信息。
 * @param {string} filePath 目标文件路径。
 * @param {number} index 失败编辑下标。
 * @param {number} total 编辑总数。
 * @returns {Error} 面向模型的可恢复错误。
 */
function createNotFoundError(filePath, index, total) {
  const prefix = total === 1 ? '无法在' : `无法在 ${filePath} 中找到 edits[${index}]`;
  const message = total === 1
    ? `${prefix} ${filePath} 中找到要替换的原文。oldText 必须逐字匹配，包括缩进、空格、反斜杠和换行。请重新读取文件后重试。`
    : `${prefix}。oldText 必须逐字匹配，包括缩进、空格、反斜杠和换行。请重新读取文件后重试。`;
  const error = new Error(message);
  error.code = 'EDIT_TEXT_NOT_FOUND';
  return error;
}

/**
 * 创建 Pi 风格的重复匹配错误信息。
 * @param {string} filePath 目标文件路径。
 * @param {number} index 失败编辑下标。
 * @param {number} total 编辑总数。
 * @param {number} occurrences 匹配数量。
 * @returns {Error} 面向模型的可恢复错误。
 */
function createDuplicateError(filePath, index, total, occurrences) {
  const error = new Error(
    total === 1
      ? `${filePath} 中找到 ${occurrences} 处相同文本。请提供更多上下文以确保 oldText 唯一。`
      : `在 ${filePath} 中找到 ${occurrences} 处 edits[${index}]。请提供更多上下文以确保 oldText 唯一。`,
  );
  error.code = 'EDIT_TEXT_AMBIGUOUS';
  return error;
}

/**
 * 应用 Pi 风格的多段文本编辑。
 * @param {string} normalizedContent 已去除 BOM 且统一为 LF 的正文。
 * @param {Array<{oldText: string, newText: string}>} edits 编辑列表。
 * @param {string} filePath 目标文件路径。
 * @returns {{baseContent: string, newContent: string, usedFuzzyMatch: boolean}} 编辑结果。
 * @throws {Error} 文本缺失、重复、重叠或编辑没有产生变化时抛出。
 */
function applyEditsToNormalizedContent(normalizedContent, edits, filePath) {
  // 统一输入换行，保证编辑坐标与文件读取窗口使用同一套偏移。
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));
  // 先拒绝空 oldText，避免空字符串被解释为文件任意位置的匹配。
  for (let index = 0; index < normalizedEdits.length; index += 1) {
    if (!normalizedEdits[index].oldText) {
      const error = new Error(`edits[${index}].oldText 不能为空。`);
      error.code = 'EDIT_EMPTY_OLD_TEXT';
      throw error;
    }
  }
  // 只根据原始正文计算匹配，禁止前一个替换改变后一个替换的坐标。
  const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText));
  const usedFuzzyMatch = initialMatches.some((match) => match.usedFuzzyMatch);
  const replacementBaseContent = usedFuzzyMatch
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent;
  const matched = [];
  // 校验每个编辑恰好命中一次，并记录后续反向应用所需的偏移。
  for (let index = 0; index < normalizedEdits.length; index += 1) {
    const edit = normalizedEdits[index];
    const result = fuzzyFindText(replacementBaseContent, edit.oldText);
    if (!result.found) throw createNotFoundError(filePath, index, normalizedEdits.length);
    // 重复检查必须使用与当前匹配模式一致的文本，避免智能引号等字符导致漏报。
    const occurrenceText = usedFuzzyMatch ? normalizeForFuzzyMatch(edit.oldText) : edit.oldText;
    const occurrences = matchOffsets(replacementBaseContent, occurrenceText).length;
    if (occurrences > 1) throw createDuplicateError(filePath, index, normalizedEdits.length, occurrences);
    matched.push({ editIndex: index, matchIndex: result.index, matchLength: result.matchLength, newText: edit.newText });
  }
  // 排序后检查范围重叠，避免多个编辑互相覆盖结果。
  matched.sort((left, right) => left.matchIndex - right.matchIndex);
  for (let index = 1; index < matched.length; index += 1) {
    const previous = matched[index - 1];
    const current = matched[index];
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(`edits[${previous.editIndex}] 和 edits[${current.editIndex}] 在 ${filePath} 中重叠，请合并为一个编辑。`);
    }
  }
  // 从后向前写入，保持前面匹配结果的字符偏移稳定。
  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(normalizedContent, replacementBaseContent, matched)
    : applyReplacements(replacementBaseContent, matched);
  if (newContent === normalizedContent) {
    // 将“替换后没有变化”明确反馈给模型，避免无意义地重复调用工具。
    const error = new Error(`编辑没有改变 ${filePath} 的内容，请检查 newText 是否与原文相同。`);
    error.code = 'EDIT_NO_CHANGE';
    throw error;
  }
  return { baseContent: normalizedContent, newContent, usedFuzzyMatch };
}

module.exports = {
  applyEditsToNormalizedContent,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
};
