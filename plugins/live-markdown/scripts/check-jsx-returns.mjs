import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ReactNode permits undefined, so tsc alone accepts accidentally discarded JSX.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const errors = [];
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { check(file); continue; }
    if (!entry.isFile() || !file.endsWith(".tsx")) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      if (ts.isExpressionStatement(node)) {
        let expression = node.expression;
        while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
        if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          errors.push(`${path.relative(root, file)}:${line}: JSX is discarded; return it or assign it.`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
check(root);
if (errors.length) throw new Error(errors.join("\n"));
console.log("[jsx] No discarded JSX expressions.");
