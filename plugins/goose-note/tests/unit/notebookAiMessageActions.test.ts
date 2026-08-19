import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";

const messageSource = readFileSync(
  "src/pages/workspace/components/notebook-ai/ChatMessages.tsx",
  "utf8",
);
const notebookAiCss = readFileSync(
  "src/pages/workspace/styles/notebook-ai.css",
  "utf8",
);

test("消息操作栏固定占位并只切换可见性", () => {
  expect(messageSource).toContain(
    "notebook-ai-message-actions mt-1 flex h-6 min-h-6",
  );
  expect(messageSource).toContain('autohide="never"');
  expect(messageSource).not.toContain('empty:hidden');

  expect(notebookAiCss).toContain(".notebook-ai-message-actions {");
  expect(notebookAiCss).toContain("opacity: 0;");
  expect(notebookAiCss).toContain(
    ".notebook-ai-message:hover > .notebook-ai-message-actions",
  );
  expect(notebookAiCss).toContain(
    ".notebook-ai-message:focus-within > .notebook-ai-message-actions",
  );
});
