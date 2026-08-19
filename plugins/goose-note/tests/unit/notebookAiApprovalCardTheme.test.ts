import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";

const buiCss = readFileSync(
  new URL("../../src/pages/workspace/styles/beautiful-ui.css", import.meta.url),
  "utf8",
);
const notebookAiCss = readFileSync(
  new URL("../../src/pages/workspace/styles/notebook-ai.css", import.meta.url),
  "utf8",
);
const approvalCard = readFileSync(
  new URL(
    "../../src/pages/workspace/components/notebook-ai/beautiful-ui/ApprovalCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const approvalPlanCard = readFileSync(
  new URL(
    "../../src/pages/workspace/components/notebook-ai/ApprovalPlanCard.tsx",
    import.meta.url,
  ),
  "utf8",
);

function getRule(css: string, selector: string): string {
  const selectorIndex = css.indexOf(`${selector} {`);
  if (selectorIndex < 0) return "";
  const bodyStart = css.indexOf("{", selectorIndex) + 1;
  const bodyEnd = css.indexOf("}", bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

test("审批卡用 goose 面板色，不回退纯白底", () => {
  const approval = getRule(buiCss, ".bui-approval");
  expect(approval).toContain("hsl(var(--goose-editor-bg))");
  expect(approval).toContain("var(--goose-block-subtle-border");
  expect(approval).toContain("hsl(var(--foreground))");
  expect(approval).not.toMatch(/background:\s*var\(--bui-surface,\s*#ffffff\)/);
  expect(approval).not.toMatch(/background:\s*#fff(fff)?\b/i);

  const scoped = getRule(notebookAiCss, ".notebook-ai-approval-plan.bui-approval");
  expect(scoped).toContain("hsl(var(--goose-editor-bg))");
  expect(scoped).not.toMatch(/#fff(fff)?\b/i);
});

test("审批卡徽章和次按钮有前景色 token", () => {
  expect(approvalCard).toContain("bui-root");
  expect(approvalCard).toContain("text-foreground");
  expect(approvalCard).toContain("--goose-block-subtle-bg");
  expect(approvalCard).not.toContain("#e4e4e8");
  expect(approvalPlanCard).toContain("text-foreground");
});
