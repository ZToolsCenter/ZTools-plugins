import { isDeepStrictEqual } from "node:util";

const tick = String.fromCharCode(96);
const fenceLine = new RegExp("^\\s{0,3}(" + tick + "{3,}|~{3,})(.*)$", "u");
const languageAliases = {
  python: ["python", "py", "python3"],
  javascript: ["javascript", "js", "node", "nodejs"],
  typescript: ["typescript", "ts"],
  json: ["json", "jsonc"],
  markdown: ["markdown", "md"]
};

function splitFences(text) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const outside = [];
  const fences = [];
  let active;
  for (const line of lines) {
    const match = fenceLine.exec(line);
    if (!active && match) {
      active = { marker: match[1], info: match[2].trim(), body: [] };
      outside.push("");
      continue;
    }
    if (active) {
      const closer = fenceLine.exec(line);
      if (closer && closer[1][0] === active.marker[0] && closer[1].length >= active.marker.length && !closer[2].trim()) {
        fences.push({ ...active, body: active.body.join("\n") });
        active = undefined;
        outside.push("");
      } else active.body.push(line);
      continue;
    }
    outside.push(line);
  }
  if (active) fences.push({ ...active, body: active.body.join("\n"), closed: false });
  return { outside: outside.join("\n"), fences };
}

function languageOf(fence) {
  return (fence.info.split(/\s+/u)[0] ?? "").toLowerCase();
}

function hasIncompleteFence(text, depth = 0) {
  if (depth > 16) return true;
  const { fences } = splitFences(text);
  for (const fence of fences) {
    if (fence.closed === false) return true;
    if (languageMatches(languageOf(fence), "markdown") && hasIncompleteFence(fence.body, depth + 1)) return true;
  }
  return false;
}

function languageMatches(actual, expected) {
  const requested = expected.toLowerCase();
  const aliases = languageAliases[requested] ?? [requested];
  return aliases.includes(actual.toLowerCase());
}

function headingLines(text) {
  const { outside } = splitFences(text);
  return outside.split("\n").flatMap((line) => {
    const match = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u.exec(line);
    return match ? [{ level: match[1].length, text: match[2].trim() }] : [];
  });
}

function headingRecords(outside) {
  return outside.split("\n").flatMap((line, lineIndex) => {
    const match = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u.exec(line);
    return match ? [{ level: match[1].length, text: match[2].trim(), lineIndex }] : [];
  });
}

function validateHeading(text, heading) {
  if (!heading) return null;
  const actual = headingLines(text);
  const match = actual.find(({ level, text: title }) => level === heading.level && title === heading.text);
  return match ? null : "heading must be H" + heading.level + " with exact text " + JSON.stringify(heading.text);
}

function headingPrecedesFirstFence(text, heading) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const firstFence = lines.findIndex((line) => fenceLine.test(line));
  if (firstFence < 0) return false;
  return lines.slice(0, firstFence).some((line) => {
    const match = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u.exec(line);
    return match && match[1].length === heading.level && match[2].trim() === heading.text;
  });
}

function inspectCode(text, spec) {
  const { fences } = splitFences(text);
  if (!fences.length || hasIncompleteFence(text)) {
    return { format: { pass: false, reason: "expected complete fenced code blocks with no unclosed nested fences" }, parameters: { pass: null, reason: "Not checked because code-block structure is invalid." } };
  }
  const fence = spec.language
    ? fences.find((candidate) => languageMatches(languageOf(candidate), spec.language))
    : fences[0];
  if (!fence) {
    return { format: { pass: false, reason: "expected a fenced code block with language " + spec.language }, parameters: { pass: null, reason: "Not checked because the declared language does not match." } };
  }
  const parameterErrors = [];
  if (spec.functionName) {
    if (!/^[A-Za-z_$][\w$]*$/u.test(spec.functionName)) parameterErrors.push("unsupported requested function identifier");
    else {
      const name = spec.functionName;
      const python = new RegExp("^\\s*(?:async\\s+)?def\\s+" + name + "\\s*\\(", "mu");
      const javascript = new RegExp("^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+" + name + "\\s*\\(|^\\s*(?:export\\s+)?(?:const|let|var)\\s+" + name + "\\s*=\\s*(?:(?:async\\s*)?function\\s*)?\\(", "mu");
      const javascriptArrow = new RegExp("^\\s*(?:export\\s+)?(?:const|let|var)\\s+" + name + "\\s*=\\s*(?:async\\s*)?(?:\\([^\\n)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>", "mu");
      if (!python.test(fence.body) && !javascript.test(fence.body) && !javascriptArrow.test(fence.body)) parameterErrors.push("code must define function " + spec.functionName);
    }
  }
  const headingError = validateHeading(text, spec.heading);
  if (headingError) parameterErrors.push(headingError);
  else if (spec.heading && !headingPrecedesFirstFence(text, spec.heading)) parameterErrors.push("required heading must appear before the code block");
  if (spec.bodyHeading) {
    if (!languageMatches(languageOf(fence), "markdown")) parameterErrors.push("a requested body heading requires a markdown fenced block");
    else {
      const bodyHeadingError = validateHeading(fence.body, spec.bodyHeading);
      if (bodyHeadingError) parameterErrors.push("inside the fenced block, " + bodyHeadingError);
    }
  }
  return {
    format: { pass: true, reason: "At least one complete fenced code block has the required language label." },
    parameters: { pass: parameterErrors.length === 0, reason: parameterErrors.join("; ") || "Explicit code name and heading requirements match." }
  };
}

function parseJson(text) {
  const { outside, fences } = splitFences(text);
  let body = text.trim();
  if (fences.length) {
    const jsonFences = fences.filter((fence) => languageMatches(languageOf(fence), "json"));
    if (jsonFences.length !== 1 || outside.trim()) return { error: "expected one JSON body, optionally fenced as json" };
    body = jsonFences[0].body.trim();
  }
  try { return { value: JSON.parse(body) }; }
  catch (error) { return { error: "invalid JSON: " + error.message }; }
}

function parsePipeRow(line) {
  const value = line.trim();
  if (!value.includes("|")) return null;
  const cells = [];
  let cell = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && value[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  if (value.startsWith("|")) cells.shift();
  if (value.endsWith("|")) cells.pop();
  return cells;
}

function parseTables(text) {
  const { outside } = splitFences(text);
  const lines = outside.split("\n");
  const tables = [];
  const malformed = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = parsePipeRow(lines[index]);
    const separator = parsePipeRow(lines[index + 1]);
    if (!header || !separator || separator.length !== header.length || !separator.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue;
    const rows = [];
    let cursor = index + 2;
    while (cursor < lines.length) {
      const row = parsePipeRow(lines[cursor]);
      if (!row) break;
      if (row.length !== header.length) {
        malformed.push("table row width differs from header");
        break;
      }
      rows.push(row);
      cursor += 1;
    }
    tables.push({ columns: header, rows });
    index = cursor - 1;
  }
  return { tables, malformed };
}

function normalizeNumericUnitSpacing(value) {
  return value.replace(/(\d)[ \t]+(?=[\p{L}%°])/gu, "$1");
}

function sameTableRows(actual, expected) {
  return Array.isArray(expected) && actual.length === expected.length && actual.every((row, rowIndex) =>
    Array.isArray(expected[rowIndex]) && row.length === expected[rowIndex].length && row.every((cell, columnIndex) =>
      normalizeNumericUnitSpacing(cell) === normalizeNumericUnitSpacing(expected[rowIndex][columnIndex])));
}

function inspectTable(text, spec) {
  const { tables, malformed } = parseTables(text);
  if (tables.length !== 1 || malformed.length) {
    return {
      format: { pass: false, reason: malformed[0] ?? "expected one Markdown table; captions outside the table are allowed" },
      parameters: { pass: null, reason: "Not checked because table structure is invalid." }
    };
  }
  const table = tables[0];
  const parameterErrors = [];
  if (spec.columns && !isDeepStrictEqual(table.columns, spec.columns)) parameterErrors.push("table columns differ: expected " + JSON.stringify(spec.columns) + ", got " + JSON.stringify(table.columns));
  if (spec.rows && !sameTableRows(table.rows, spec.rows)) parameterErrors.push("table rows differ: expected " + JSON.stringify(spec.rows) + ", got " + JSON.stringify(table.rows));
  for (const requirement of spec.requiredCells ?? []) {
    const column = table.columns.indexOf(requirement.column);
    if (column < 0 || !table.rows.some((row) => normalizeNumericUnitSpacing(row[column]) === normalizeNumericUnitSpacing(requirement.value))) {
      parameterErrors.push("table is missing required value " + JSON.stringify(requirement.value) + " in column " + JSON.stringify(requirement.column));
    }
  }
  return {
    format: { pass: true, reason: "One well-formed Markdown table is present; external captions are allowed." },
    parameters: { pass: parameterErrors.length === 0, reason: parameterErrors.join("; ") || "Explicit table columns, rows, and required cells match." }
  };
}

function parseMath(text, display) {
  const { outside } = splitFences(text);
  if (display === "block") return [...outside.matchAll(/\$\$([\s\S]*?)\$\$/gu)].map((match) => match[1].trim());
  const inline = [...outside.matchAll(/(?<!\$)\$([^$\n]+)\$(?!\$)/gu)].map((match) => match[1].trim());
  if (display === "inline") return inline;
  if (display === "either") return [...inline, ...[...outside.matchAll(/\$\$([\s\S]*?)\$\$/gu)].map((match) => match[1].trim())];
  return [];
}

function inspectMath(text, spec) {
  const formulas = parseMath(text, spec.display);
  if (!formulas.length) {
    return {
      format: { pass: false, reason: "expected a closed " + spec.display + " math delimiter" },
      parameters: { pass: null, reason: "Not checked because math delimiter structure is invalid." }
    };
  }
  const matches = formulas.includes(spec.expression);
  return {
    format: { pass: true, reason: "A closed formula uses the requested inline or display delimiter." },
    parameters: { pass: matches, reason: matches ? "The explicit formula matches." : "The formula differs from " + JSON.stringify(spec.expression) }
  };
}

function parseMermaid(text) {
  const { fences } = splitFences(text);
  const blocks = fences.filter((fence) => languageOf(fence) === "mermaid" && fence.closed !== false);
  if (blocks.length !== 1) return null;
  const lines = blocks[0].body.split("\n").map((line) => line.trim()).filter(Boolean);
  const header = /^(?:graph|flowchart)\s+(TD|TB|BT|LR|RL)\s*$/iu.exec(lines[0] ?? "");
  if (!header) return null;
  const nodes = new Set();
  const edges = [];
  const labelsById = new Map();
  const node = /^([\w-]+)(?:\s*\[([^\]]+)\]|\s*\{([^}]+)\}|\s*\(([^)]+)\))?$/u;
  const connectors = ["-->", "---", "-.->", "==>"];
  const decodeLabel = (raw) => {
    let label = raw.trim().replace(/(?:&quot;|&#quot;|#quot;|&#34;|&#x22;)/giu, '"');
    if (label.length >= 2 && label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
    return label.replace(/\\(["\\])/gu, "$1");
  };
  const labelNode = (match) => {
    const id = match[1];
    const label = decodeLabel(match[2] ?? match[3] ?? match[4] ?? labelsById.get(id) ?? id);
    labelsById.set(id, label);
    nodes.add(label);
    return id;
  };
  for (const line of lines.slice(1)) {
    let pieces = [line];
    for (const connector of connectors) {
      if (line.includes(connector)) {
        pieces = line.split(connector).map((piece) => piece.trim());
        break;
      }
    }
    if (pieces.length === 1) {
      const lone = node.exec(pieces[0]);
      if (lone) labelNode(lone);
      continue;
    }
    const ids = pieces.map((piece) => {
      const match = node.exec(piece);
      return match ? labelNode(match) : null;
    });
    for (let index = 0; index + 1 < pieces.length; index += 1) {
      if (ids[index] && ids[index + 1]) edges.push([ids[index], ids[index + 1]]);
    }
  }
  return {
    direction: header[1].toUpperCase(),
    nodes: [...nodes],
    edges: edges.map(([from, to]) => [labelsById.get(from) ?? from, labelsById.get(to) ?? to])
  };
}

function parseIcons(text) {
  const { outside } = splitFences(text);
  return outside.split("\n").flatMap((line) => {
    const match = /^\s*(?:[-+*]|\d+[.)])\s+(.+?)\s*$/u.exec(line);
    return match ? [match[1]] : [];
  });
}

function inspectArtifact(text, spec) {
  if (spec.type === "code") return inspectCode(text, spec);
  if (spec.type === "json") {
    const result = parseJson(text);
    if (result.error) return { format: { pass: false, reason: result.error }, parameters: { pass: null, reason: "Not checked because JSON structure is invalid." } };
    const matches = isDeepStrictEqual(result.value, spec.value);
    return {
      format: { pass: true, reason: "A complete JSON value is valid." },
      parameters: { pass: matches, reason: matches ? "The JSON value matches the explicit structure." : "JSON value differs from the explicit expected structure." }
    };
  }
  if (spec.type === "table") return inspectTable(text, spec);
  if (spec.type === "math") return inspectMath(text, spec);
  if (spec.type === "mermaid") {
    const diagram = parseMermaid(text);
    if (!diagram) return { format: { pass: false, reason: "expected one complete Mermaid graph or flowchart block with a supported header" }, parameters: { pass: null, reason: "Not checked because Mermaid shape is invalid." } };
    const errors = [];
    if (spec.direction && diagram.direction !== spec.direction.toUpperCase()) errors.push("Mermaid direction expected " + spec.direction + ", got " + diagram.direction);
    if (spec.nodes && !spec.nodes.every((name) => diagram.nodes.includes(name))) errors.push("Mermaid graph is missing an explicitly requested node");
    if (spec.edges && !spec.edges.every((edge) => diagram.edges.some((actual) => actual[0] === edge[0] && actual[1] === edge[1]))) errors.push("Mermaid graph is missing an explicitly requested edge");
    return {
      format: { pass: true, reason: "A complete Mermaid graph/flowchart shape is present; visual rendering is not checked." },
      parameters: { pass: errors.length === 0, reason: errors.join("; ") || "Explicit Mermaid direction, nodes, and relations match." }
    };
  }
  if (spec.type === "icons") {
    const items = parseIcons(text);
    if (!items.length) return { format: { pass: false, reason: "expected a Markdown list of icon items" }, parameters: { pass: null, reason: "Not checked because list structure is missing." } };
    const matches = isDeepStrictEqual(items, spec.items);
    return {
      format: { pass: true, reason: "A Markdown list structure is present." },
      parameters: { pass: matches, reason: matches ? "Icon list values and order match." : "Icon list items differ from the explicit requested list." }
    };
  }
  if (spec.type === "headings") {
    const { outside } = splitFences(text);
    const lines = outside.split("\n");
    const actual = headingRecords(outside);
    if (!actual.length) return { format: { pass: false, reason: "expected Markdown heading structure" }, parameters: { pass: null, reason: "Not checked because headings are missing." } };
    const matches = actual.length === spec.headings.length && spec.headings.every((expected, index) =>
      actual[index].text === expected.text && (expected.level === undefined || actual[index].level === expected.level) &&
      (expected.followingText === undefined || lines.slice(actual[index].lineIndex + 1).find((line) => line.trim())?.includes(expected.followingText)));
    return {
      format: { pass: true, reason: "Markdown headings are structurally present." },
      parameters: { pass: matches, reason: matches ? "Explicit heading text, requested levels, and order match." : "Explicit heading text, requested levels, or order differs." }
    };
  }
  return {
    format: { pass: false, reason: "unsupported artifact contract: " + spec.type },
    parameters: { pass: null, reason: "Not checked for an unsupported artifact type." }
  };
}

export function assessArtifactContract(text, spec) {
  if (!spec) return {
    format: { pass: null, reason: "No deterministic artifact format applies." },
    parameters: { pass: null, reason: "No explicit artifact parameters apply." }
  };
  return inspectArtifact(String(text ?? ""), spec);
}
