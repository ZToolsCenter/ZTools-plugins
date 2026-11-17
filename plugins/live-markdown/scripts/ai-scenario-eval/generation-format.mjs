import { spawnSync } from "node:child_process";

const clean = (value) => value.replace(/[*_`]/gu, "").trim();

function tableFailures(table) {
  if (!table) return ["not-a-gfm-table"];
  const rows = table.split(/\r?\n/u).map((line) => line.trim().replace(/^\||\|$/gu, "").split("|").map(clean));
  const fruitColumn = rows[0].findIndex((cell) => cell === "水果");
  const priceColumn = rows[0].findIndex((cell) => cell.includes("价格"));
  if (fruitColumn < 0 || priceColumn < 0) return ["table-header-mismatch"];
  const data = rows.slice(2);
  if (data.length !== 2) return ["table-needs-exactly-two-fruit-rows"];
  for (const [fruit, price] of [["苹果", "3"], ["香蕉", "5"]]) {
    const row = data.find((cells) => cells[fruitColumn] === fruit);
    if (!row || !new RegExp(`^${price}(?:\\.0+)?(?:\\s*元(?:[/／每]斤)?)?$`, "u").test(row[priceColumn] ?? "")) return [`table-price-mismatch:${fruit}`];
  }
  return [];
}

function mermaidFailures(block) {
  const body = block.replace(/^\x60{3,}mermaid[^\n]*\n/iu, "").replace(/\n\x60{3,}\s*$/u, "").replace(/%%[^\n]*/gu, "");
  if (!/^(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b/u.test(body.trim())) return ["missing-flowchart-declaration"];
  const labels = new Map();
  const declaration = /\b([A-Za-z_][\w-]*)\s*(?:\[\[?([^\]\n]+)\]\]?|\(\(?([^\)\n]+)\)\)?|\{([^}\n]+)\})/gu;
  for (const match of body.matchAll(declaration)) labels.set(match[1], (match[2] ?? match[3] ?? match[4]).replace(/^["']|["']$/gu, "").trim());
  if (labels.size !== 3 || ["开始", "审核", "结束"].some((label) => [...labels.values()].filter((value) => value === label).length !== 1)) return ["flow-needs-exact-three-labels"];
  const simplified = body.replace(declaration, "$1");
  const edges = [...simplified.matchAll(/(?=\b([A-Za-z_][\w-]*)\s*-->\s*([A-Za-z_][\w-]*)\b)/gu)].map((match) => `${labels.get(match[1])}→${labels.get(match[2])}`);
  return edges.length === 2 && edges.includes("开始→审核") && edges.includes("审核→结束") ? [] : ["incorrect-flow-order-or-edges"];
}

// Parsing an AST does not execute any generated code. Reject ambiguous/complex implementations.
const pythonCheck = `import ast, json, sys
try:
 tree = ast.parse(sys.stdin.read())
 funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'add']
 ok = len(funcs) == 1 and len(tree.body) == 1
 if ok:
  f = funcs[0]
  body = f.body
  if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str): body = body[1:]
  ok = [a.arg for a in f.args.posonlyargs + f.args.args] == ['a','b'] and not f.decorator_list and not f.args.vararg and not f.args.kwarg and not f.args.kwonlyargs and not f.args.defaults and len(body) == 1 and isinstance(body[0], ast.Return)
  if ok:
   value = body[0].value
   ok = isinstance(value, ast.BinOp) and isinstance(value.op, ast.Add) and isinstance(value.left, ast.Name) and value.left.id == 'a' and isinstance(value.right, ast.Name) and value.right.id == 'b'
 print(json.dumps({'ok': bool(ok)}))
except (SyntaxError, ValueError, RecursionError): print(json.dumps({'ok':False}))`;

export function evaluateMarkdownFormat(text, kind, nodes) {
  if (!kind) return [];
  if (kind === "table") return tableFailures(nodes.find((node) => node.name === "Table")?.raw);
  if (kind === "headings") {
    const titles = nodes.filter((node) => /^ATXHeading/u.test(node.name)).map((node) => clean(node.raw.replace(/^\s*#+\s*/u, "").replace(/\s+#+\s*$/u, "")));
    return ["目标", "方案", "风险"].filter((title) => !titles.some((actual) => actual.replace(/^[一二三四五六七八九十\d]+[、.．)）]\s*/u, "") === title)).map((title) => `missing-heading:${title}`);
  }
  if (["python", "mermaid"].includes(kind)) {
    const raw = nodes.filter((node) => node.name === "FencedCode").map((node) => node.raw).find((block) => new RegExp(`^\x60{3,}${kind}[^\\n]*\\n[\\s\\S]+\\n\x60{3,}\\s*$`, "iu").test(block));
    if (!raw) return [`missing-closed-${kind}-fence`];
    if (kind === "mermaid") return mermaidFailures(raw);
    const code = raw.replace(/^\x60{3,}python[^\n]*\n/iu, "").replace(/\n\x60{3,}\s*$/u, "");
    const checked = spawnSync("python3", ["-c", pythonCheck], { input: code, encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
    if (checked.error || checked.status !== 0) return ["python-static-check-unavailable"];
    try { return JSON.parse(checked.stdout).ok ? [] : ["python-add-ast-mismatch"]; }
    catch { return ["python-static-check-invalid-result"]; }
  }
  if (kind === "math") {
    const math = [...text.matchAll(/\$\$?([\s\S]+?)\$\$?|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/gu)].map((match) => match[1] ?? match[2] ?? match[3]);
    const valid = math.some((formula) => {
      let depth = 0;
      for (const char of formula) { if (char === "{") depth++; if (char === "}") depth--; if (depth < 0) return false; }
      const canonical = formula.replace(/\s|\\left|\\right/gu, "").replace(/\{2\}/gu, "2");
      return depth === 0 && ["a^2+b^2=c^2", "c^2=a^2+b^2", "c=\\sqrt{a^2+b^2}"].includes(canonical);
    });
    return valid ? [] : ["missing-valid-pythagorean-formula"];
  }
  return ["unknown-markdown-format"];
}
