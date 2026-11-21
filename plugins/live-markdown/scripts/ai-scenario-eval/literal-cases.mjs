// Curated natural-language literal-edit scenarios for a later model evaluation.
// Patch offsets and payloads are authored here from the source fixtures; this
// module deliberately does not import the production planner, binder, or patcher.

function makePatch(source, from, to, insertText) {
  return { from, to, expectedText: source.slice(from, to), insertText };
}

function textRange(source, needle, occurrence = 1) {
  let cursor = 0;
  for (let index = 1; index <= occurrence; index += 1) {
    const from = source.indexOf(needle, cursor);
    if (from < 0) throw new Error(`Fixture text not found (${occurrence}): ${needle}`);
    if (index === occurrence) return { from, to: from + needle.length };
    cursor = from + needle.length;
  }
  throw new Error(`Invalid occurrence: ${occurrence}`);
}

function headingExpectation(source, markdownPrefix, text, matchingOrdinal) {
  const marker = `${markdownPrefix} ${text}`;
  return { text, matchingOrdinal, lineFrom: textRange(source, marker, matchingOrdinal).from };
}

function findMatches(source, find, from, to) {
  const matches = [];
  let cursor = from;
  while (cursor <= to - find.length) {
    const start = source.indexOf(find, cursor);
    if (start < 0 || start + find.length > to) break;
    matches.push({ from: start, to: start + find.length });
    cursor = start + find.length;
  }
  return matches;
}

function replacementPatch(source, find, replacement, occurrence, scope) {
  const matches = findMatches(source, find, scope.from, scope.to);
  let selected;
  if (occurrence === "all") selected = matches;
  else if (occurrence === "last") selected = matches.slice(-1);
  else if (occurrence === "single") selected = matches;
  else selected = matches.slice(occurrence - 1, occurrence);
  if (!selected.length || (occurrence === "single" && selected.length !== 1)) {
    throw new Error(`Fixture occurrence is not unique/available: ${find} (${occurrence})`);
  }
  const from = selected[0].from;
  const to = selected[selected.length - 1].to;
  let insertText = "";
  let cursor = from;
  for (const match of selected) {
    insertText += source.slice(cursor, match.from) + replacement;
    cursor = match.to;
  }
  insertText += source.slice(cursor, to);
  return makePatch(source, from, to, insertText);
}

function baseCase({ id, family, title, instruction, source, operation, target, text, patch, selection = null, cursor = null, find, occurrence, layout, expectedHeading, requiresLiteralId = false }) {
  const intent = { kind: "edit", operation, target, mode: "literal", text };
  if (find !== undefined) intent.find = find;
  if (occurrence !== undefined) intent.occurrence = occurrence;
  if (layout !== undefined) intent.layout = layout;
  if (expectedHeading !== undefined) intent.expectedHeading = expectedHeading;
  const expected = {
    intent,
    effect: "patch",
    patch,
    calls: { planning: 1, contentMin: 0, contentMax: 0 }
  };
  if (requiresLiteralId) expected.requiresLiteralId = true;
  return {
    id, family, title, instruction, source,
    selection,
    ...(selection ? { selectionValid: true } : {}),
    cursor,
    expected
  };
}

function insertCase({ id, family = "insert-position", title, instruction, source, target, text, from, insertText, selection = null, cursor = null, layout = "block", expectedHeading, requiresLiteralId = false }) {
  return baseCase({
    id, family, title, instruction, source, operation: "insert", target, text,
    patch: makePatch(source, from, from, insertText), selection, cursor, layout, expectedHeading, requiresLiteralId
  });
}

function replaceCase({ id, family = "replacement-occurrence", title, instruction, source, target = "document", find, text, occurrence = "single", selection = null, requiresLiteralId = false }) {
  const scope = target === "selection" ? selection : { from: 0, to: source.length };
  if (!scope) throw new Error(`${id}: selection target requires a range`);
  return baseCase({
    id, family, title, instruction, source, operation: "replace_exact", target, text,
    find, occurrence,
    patch: replacementPatch(source, find, text, occurrence, scope),
    selection, requiresLiteralId
  });
}

function rewriteSelectionCase({ id, family = "selection-scope", title, instruction, source, selectionText, text }) {
  const selection = textRange(source, selectionText);
  return baseCase({
    id, family, title, instruction, source, operation: "rewrite", target: "selection", text,
    patch: makePatch(source, selection.from, selection.to, text), selection
  });
}

const longLiteral = "保留这段由用户明确提供的长字面内容：版本号 2.4.1，状态为已验证；标点、空格与 Markdown 符号都必须逐字保留。 ".repeat(4);
if (new TextEncoder().encode(longLiteral).length <= 256) throw new Error("Long-literal fixture must exceed 256 UTF-8 bytes");

const deploymentHeading = "# 安装\n准备。\n## 部署步骤\n已有正文。\n## 回滚\n回退。";
const implementationSection = "# 实施计划\n第一步。\n## 细节\n第二步。\n# 风险\n风险说明。";
const repeatedOverviewHeadings = "# 概览\n旧内容。\n# 细节\n描述。\n# 概览\n新内容。";
const repeatedResultHeadings = "## 结果\n初步值。\n# 中间章节\n说明。\n## 结果\n最终值。\n## 附录\n资料。";

const richMarkdown = `# 文档结构 ✨

![品牌图标](assets/brand.svg) :sparkles: **重点** 与 [参考链接](https://example.invalid/docs)。

这段普通正文可按字面替换[^note]。

[^note]: 这是合法的脚注定义。

| 字段 | 值 |
| --- | --- |
| 名称 | alpha |

\`\`\`ts
const answer = 42;
\`\`\`

$$
x^2 + y^2 = z^2
$$

结尾普通文字。
`;

const tableNeighbor = `表格前说明。\n\n| 字段 | 值 |\n| --- | --- |\n| 状态 | 草稿 |\n`;
const codeNeighbor = `代码前说明。\n\n\`\`\`js\nconst ready = true;\n\`\`\`\n\n$$\nx + 1 = 2\n$$`;

export const literalCases = [
  insertCase({
    id: "L01", title: "无尾换行时追加文末段落", instruction: "在文末新增一段“发布说明”",
    source: "项目记录", target: "document_end", text: "发布说明", from: 4, insertText: "\n\n发布说明"
  }),
  insertCase({
    id: "L02", title: "已有单个 LF 时只补足段落间距", instruction: "文档最底部加上“Reviewed”",
    source: "第一行\n第二行\n", target: "document_end", text: "Reviewed", from: "第一行\n第二行\n".length, insertText: "\nReviewed"
  }),
  insertCase({
    id: "L03", title: "CRLF 文末保持原行尾", instruction: "Add the literal note “ready” at the end of the document",
    source: "Title\r\nBody", target: "document_end", text: "ready", from: 11, insertText: "\r\n\r\nready"
  }),
  insertCase({
    id: "L04", title: "空文档文末插入", instruction: "在空文档底部添加“起草中”",
    source: "", target: "document_end", text: "起草中", from: 0, insertText: "起草中"
  }),
  insertCase({
    id: "L05", title: "正文开头插入且保留标题", instruction: "在正文开头插入“阅读提示”",
    source: "# 使用指南\n正文内容。", target: "body_start", text: "阅读提示", from: 0, insertText: "阅读提示\n\n"
  }),
  insertCase({
    id: "L06", title: "CRLF YAML frontmatter 后的正文开头", instruction: "在文章正文开头加上“仅供内部阅读”",
    source: "---\r\ntitle: 备忘录\r\n---\r\n# 正文\r\n内容。", target: "body_start", text: "仅供内部阅读",
    from: "---\r\ntitle: 备忘录\r\n---\r\n".length, insertText: "仅供内部阅读\r\n\r\n"
  }),
  insertCase({
    id: "L07", title: "明确全文文末优先于当前选区", instruction: "在全文的最后加上“来源：手册”",
    source: "选中的段落\n中间说明\n文档结尾", target: "document_end", text: "来源：手册",
    from: "选中的段落\n中间说明\n文档结尾".length, insertText: "\n\n来源：手册",
    selection: textRange("选中的段落\n中间说明\n文档结尾", "选中的段落")
  }),
  insertCase({
    id: "L08", family: "selection-scope", title: "选区末尾行内追加", instruction: "在当前选区末尾紧接着加“✅”",
    source: "开头\n目标文本后续\n末尾", target: "selection_end", text: "✅", layout: "inline",
    selection: textRange("开头\n目标文本后续\n末尾", "目标文本"), from: "开头\n目标文本".length, insertText: "✅"
  }),
  insertCase({
    id: "L09", family: "insert-position", title: "中文行内光标插入", instruction: "在光标位置插入“已确认：”",
    source: "状态草稿待复核", target: "cursor", text: "已确认：", layout: "inline",
    from: "状态草稿".length, cursor: "状态草稿".length, insertText: "已确认："
  }),
  insertCase({
    id: "L10", title: "光标位于 emoji 代理对之后", instruction: "Add “!” exactly where the cursor is",
    source: "😀 status", target: "cursor", text: "!", layout: "inline",
    from: "😀".length, cursor: "😀".length, insertText: "!"
  }),
  insertCase({
    id: "L11", title: "CRLF 行尾光标行内插入", instruction: "在当前光标处加上“ — done”",
    source: "状态\r\n下一行", target: "cursor", text: " — done", layout: "inline",
    from: "状态".length, cursor: "状态".length, insertText: " — done"
  }),
  insertCase({
    id: "L12", title: "指定标题后插入", instruction: "在“部署步骤”这个标题后新增“运行前先备份”",
    source: deploymentHeading, target: "heading_end", text: "运行前先备份",
    from: "# 安装\n准备。\n## 部署步骤\n".length, insertText: "\n运行前先备份\n\n",
    expectedHeading: headingExpectation(deploymentHeading, "##", "部署步骤", 1)
  }),
  insertCase({
    id: "L13", title: "指定章节末尾越过子标题", instruction: "在“实施计划”章节结束后增加“计划已评审”",
    source: implementationSection, target: "section_end", text: "计划已评审",
    from: "# 实施计划\n第一步。\n## 细节\n第二步。\n".length, insertText: "\n计划已评审\n\n",
    expectedHeading: headingExpectation(implementationSection, "#", "实施计划", 1)
  }),
  insertCase({
    id: "L14", title: "同名标题明确选第二处", instruction: "在第二个“概览”标题后插入“以下是补充说明”",
    source: repeatedOverviewHeadings, target: "heading_end", text: "以下是补充说明",
    from: "# 概览\n旧内容。\n# 细节\n描述。\n# 概览\n".length, insertText: "\n以下是补充说明\n\n",
    expectedHeading: headingExpectation(repeatedOverviewHeadings, "#", "概览", 2)
  }),
  insertCase({
    id: "L15", title: "同名标题明确选第二处章节末尾", instruction: "在第 2 个“结果”章节末尾添加“该结果已复核”",
    source: repeatedResultHeadings, target: "section_end", text: "该结果已复核",
    from: "## 结果\n初步值。\n# 中间章节\n说明。\n## 结果\n最终值。\n".length, insertText: "\n该结果已复核\n\n",
    expectedHeading: headingExpectation(repeatedResultHeadings, "##", "结果", 2)
  }),
  replaceCase({
    id: "L16", title: "中文指令替换文末最后一处", instruction: "把文末最后一处“hello”改成“helloworld”",
    source: "开头 hello\n中间 hello\n文末 hello", find: "hello", text: "helloworld", occurrence: "last"
  }),
  replaceCase({
    id: "L17", title: "英文指令识别最后一处替换", instruction: "Replace the last draft with final in the document",
    source: "draft one; draft two; draft three", find: "draft", text: "final", occurrence: "last"
  }),
  replaceCase({
    id: "L18", title: "全部替换并保留中间未命中文字", instruction: "将全文所有“待校验”替换成“已校验”",
    source: "待校验 A，保留这段。\n待校验 B，仍然保留。\n待校验 C。", find: "待校验", text: "已校验", occurrence: "all"
  }),
  replaceCase({
    id: "L19", title: "中文序数替换第二处", instruction: "把第二处“待确认”替换为“已确认”",
    source: "待确认甲\n待确认乙\n待确认丙", find: "待确认", text: "已确认", occurrence: 2
  }),
  replaceCase({
    id: "L20", title: "阿拉伯数字序数替换第三处", instruction: "将第 3 处 todo 改为 done",
    source: "todo A\ntodo B\ntodo C\ntodo D", find: "todo", text: "done", occurrence: 3
  }),
  replaceCase({
    id: "L21", title: "唯一匹配精确替换", instruction: "请将“临时目录”精确替换为“归档目录”",
    source: "输出将保存到临时目录中。", find: "临时目录", text: "归档目录"
  }),
  replaceCase({
    id: "L22", family: "selection-scope", title: "仅替换当前选区最后一处", instruction: "把当前选区里最后一个“待替换”改成“已替换”",
    source: "文档外待替换\n选区开始：待替换甲；中间文字；待替换乙\n文档外待替换。",
    target: "selection", selection: textRange("文档外待替换\n选区开始：待替换甲；中间文字；待替换乙\n文档外待替换。", "选区开始：待替换甲；中间文字；待替换乙"),
    find: "待替换", text: "已替换", occurrence: "last"
  }),
  replaceCase({
    id: "L23", family: "selection-scope", title: "明确全文替换优先于选区", instruction: "全文最后一处“旧词”替换为“新词”",
    source: "旧词在首段。\n选中旧词的句子。\n全文末尾旧词。", find: "旧词", text: "新词", occurrence: "last",
    selection: textRange("旧词在首段。\n选中旧词的句子。\n全文末尾旧词。", "选中旧词")
  }),
  replaceCase({
    id: "L24", family: "selection-scope", title: "当前选区隔离同名文档外文本", instruction: "将当前选区中的 tag 改为“标签”",
    source: "tag outside\n选区 tag inside\nend tag outside。", target: "selection",
    selection: textRange("tag outside\n选区 tag inside\nend tag outside。", "选区 tag inside"),
    find: "tag", text: "标签"
  }),
  rewriteSelectionCase({
    id: "L25", title: "整段选区由用户字面内容替换", instruction: "将当前选中的片段原样替换为“**已定稿**”",
    source: "保留前文。\n这是旧段落。\n保留后文。", selectionText: "这是旧段落。", text: "**已定稿**"
  }),
  replaceCase({
    id: "L26", family: "unicode-exactness", title: "精确替换单字符天气 emoji", instruction: "把“☀”替换成“🌞”",
    source: "天气图标：☀，今天晴朗。", find: "☀", text: "🌞"
  }),
  replaceCase({
    id: "L27", family: "unicode-exactness", title: "保留组合字符的原始码点序列", instruction: "将原文中的“café”替换为“café”",
    source: "café 服务已开启。", find: "café", text: "café"
  }),
  replaceCase({
    id: "L28", family: "unicode-exactness", title: "替换 ZWJ emoji 组合字符", instruction: "把“👩‍💻”替换为“🧑‍💻”",
    source: "贡献者图标 👩‍💻 已确认。", find: "👩‍💻", text: "🧑‍💻"
  }),
  insertCase({
    id: "L29", family: "unicode-exactness", title: "光标处插入一个导航 emoji", instruction: "在光标位置添加单个字符“🧭”",
    source: "指南待补", target: "cursor", text: "🧭", layout: "inline",
    from: "指南".length, cursor: "指南".length, insertText: "🧭"
  }),
  insertCase({
    id: "L30", family: "quoted-literal", title: "保留引用内容首尾空格", instruction: "在光标处原样插入“  keep spaces  ”",
    source: "标签：", target: "cursor", text: "  keep spaces  ", layout: "inline",
    from: 3, cursor: 3, insertText: "  keep spaces  "
  }),
  replaceCase({
    id: "L31", family: "quoted-literal", title: "引用内容内部逗号和双空格逐字保留", instruction: "把“alpha,  beta”替换成“alpha，beta”",
    source: "值为 alpha,  beta；其余不变。", find: "alpha,  beta", text: "alpha，beta"
  }),
  insertCase({
    id: "L32", family: "quoted-literal", title: "新增 Markdown 标记按字面插入", instruction: "在文末原样增加“**重点** [说明](https://example.invalid/a)”",
    source: "已有说明。", target: "document_end", text: "**重点** [说明](https://example.invalid/a)",
    from: "已有说明。".length, insertText: "\n\n**重点** [说明](https://example.invalid/a)"
  }),
  replaceCase({
    id: "L33", family: "quoted-literal", title: "保留引用中的尾随空格与半角逗号", instruction: "将“old, next ”精确改成“new, next ”",
    source: "说明 old, next 继续。", find: "old, next ", text: "new, next "
  }),
  insertCase({
    id: "L34", family: "quoted-literal", title: "在光标处插入含代码和行内公式标记", instruction: "光标处原样插入“`x + y` 与 $x+y$”",
    source: "算式：结果", target: "cursor", text: "`x + y` 与 $x+y$", layout: "inline",
    from: "算式：".length, cursor: "算式：".length, insertText: "`x + y` 与 $x+y$"
  }),
  insertCase({
    id: "L35", family: "rich-markdown", title: "富文档结尾新增仍为纯字面操作", instruction: "在文末追加“补充：本页已检查”",
    source: richMarkdown, target: "document_end", text: "补充：本页已检查",
    from: richMarkdown.length, insertText: "\n补充：本页已检查"
  }),
  replaceCase({
    id: "L36", family: "rich-markdown", title: "富文档中的普通正文替换且保留所有结构", instruction: "把普通段落中的“按字面替换”改成“逐字更新”",
    source: richMarkdown, find: "按字面替换", text: "逐字更新"
  }),
  insertCase({
    id: "L37", family: "rich-markdown", title: "脚注引用前的选区行内追加", instruction: "在当前选区末尾行内紧接着原样加上“（已补充）”",
    source: "正文说明[^ref]。\n\n[^ref]: 这里是合法脚注定义。\n",
    target: "selection_end", text: "（已补充）", layout: "inline",
    selection: textRange("正文说明[^ref]。\n\n[^ref]: 这里是合法脚注定义。\n", "正文说明"),
    from: "正文说明".length, insertText: "（已补充）"
  }),
  insertCase({
    id: "L38", family: "rich-markdown", title: "普通说明段落插在表格前", instruction: "在选区末尾加一个新段落“表格说明”",
    source: tableNeighbor, target: "selection_end", text: "表格说明",
    selection: textRange(tableNeighbor, "表格前说明。\n"),
    from: "表格前说明。\n".length, insertText: "\n表格说明\n"
  }),
  insertCase({
    id: "L39", family: "rich-markdown", title: "代码块前新增普通正文且保留公式代码", instruction: "在光标处插入段落“计算前提已确认”",
    source: codeNeighbor, target: "cursor", text: "计算前提已确认",
    from: "代码前说明。".length, cursor: "代码前说明。".length,
    insertText: "\n\n计算前提已确认"
  }),
  insertCase({
    id: "L40", family: "quoted-literal", title: "超过 256 字节的长引用按候选 ID 回源", instruction: `文末原样追加“${longLiteral}”`,
    source: "# 长引用\n\n保持原文。", target: "document_end", text: longLiteral,
    from: "# 长引用\n\n保持原文。".length, insertText: `\n\n${longLiteral}`, requiresLiteralId: true
  })
];
