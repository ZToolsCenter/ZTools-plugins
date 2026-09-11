/**
 * Shipped Beautiful UI mapper — import the real module, no mocks, no cloned algorithm.
 */
import { describe, expect, it } from "vitest";
import {
  formatLoaderElapsed,
  loaderHoldMs,
  mapStepsToThinkingTrace,
  mapToolPartsToChips,
  mapToolPartsToTaskRows,
  shouldHoldLoader,
} from "../beautifulUiMap";
import { getStepText, type ToolProgressPart } from "../ToolProgressCard";

const ROOT = "/Users/eachann/WorkMark/goose-agent";

const writeDone: ToolProgressPart = {
  type: "tool-writeFile",
  state: "output-available",
  toolCallId: "w1",
  input: { path: `${ROOT}/src/lib/utils.ts`, content: "y" },
  output: { ok: true, path: `${ROOT}/src/lib/utils.ts`, changeKind: "modify" },
};

const writeRunning: ToolProgressPart = {
  type: "tool-writeFile",
  state: "call",
  toolCallId: "w2",
  input: { path: `${ROOT}/src/lib/utils.ts`, content: "y" },
};

const readDone: ToolProgressPart = {
  type: "tool-readFile",
  state: "output-available",
  toolCallId: "r1",
  input: { path: `${ROOT}/src/components/foo.tsx` },
  output: { ok: true, path: `${ROOT}/src/components/foo.tsx`, content: "x" },
};

const writeError: ToolProgressPart = {
  type: "tool-writeFile",
  state: "output-error",
  toolCallId: "w3",
  input: { path: `${ROOT}/x.ts` },
  errorText: "权限不足：无法写入目标文件",
};

const loadSkillDone: ToolProgressPart = {
  type: "tool-loadSkill",
  state: "output-available",
  toolCallId: "s1",
  input: { skill: "ai-dev-test" },
  output: { skill: "ai-dev-test", supported: true },
};

describe("formatLoaderElapsed", () => {
  it("uses tenths of a second under 60s", () => {
    expect(formatLoaderElapsed(0)).toBe("0.0s");
    expect(formatLoaderElapsed(12300)).toBe("12.3s");
    expect(formatLoaderElapsed(59900)).toBe("59.9s");
  });

  it("switches to m+s at 60s", () => {
    expect(formatLoaderElapsed(60000)).toBe("1m 0.0s");
    expect(formatLoaderElapsed(62300)).toBe("1m 2.3s");
  });

  it("treats non-finite as 0.0s", () => {
    expect(formatLoaderElapsed(Number.NaN)).toBe("0.0s");
    expect(formatLoaderElapsed(-12)).toBe("0.0s");
  });
});

describe("loader hold", () => {
  it("holds until the minimum elapsed window", () => {
    expect(shouldHoldLoader(0)).toBe(true);
    expect(shouldHoldLoader(399)).toBe(true);
    expect(shouldHoldLoader(400)).toBe(false);
    expect(loaderHoldMs(100)).toBe(300);
    expect(loaderHoldMs(400)).toBe(0);
  });
});

describe("mapToolPartsToChips", () => {
  it("maps real tool parts onto shipped step labels and chip status", () => {
    const chips = mapToolPartsToChips(
      [writeDone, writeRunning, writeError, loadSkillDone],
      true,
      ROOT,
    );
    expect(chips.map((c) => c.status)).toEqual([
      "done",
      "running",
      "error",
      "done",
    ]);
    const [writeChip, runningChip, errorChip, skillChip] = chips;
    expect(writeChip?.name).toBe(getStepText(writeDone, ROOT).label);
    expect(writeChip?.label).toBe(getStepText(writeDone, ROOT).detail);
    expect(runningChip?.name).toBe(getStepText(writeRunning, ROOT).label);
    expect(errorChip?.label).toBe(getStepText(writeError, ROOT).detail);
    expect(skillChip?.name).toBe(getStepText(loadSkillDone, ROOT).label);
    expect(skillChip?.label).toBe(getStepText(loadSkillDone, ROOT).detail);
  });

  it("treats input-only as pending when the message is not streaming", () => {
    const chips = mapToolPartsToChips([writeRunning], false, ROOT);
    expect(chips[0]?.status).toBe("pending");
  });
});

describe("mapToolPartsToTaskRows", () => {
  it("keeps chip status and step titles in lockstep", () => {
    const parts = [readDone, writeDone, writeError];
    const rows = mapToolPartsToTaskRows(parts, false, ROOT);
    const chips = mapToolPartsToChips(parts, false, ROOT);
    expect(rows.map((r) => r.status)).toEqual(chips.map((c) => c.status));
    expect(rows.map((r) => r.title)).toEqual(chips.map((c) => c.name));
    expect(rows[0]?.detail).toBe(getStepText(readDone, ROOT).detail);
    expect(rows[1]?.id).toBe("w1");
  });
});

describe("mapStepsToThinkingTrace", () => {
  it("expands real steps and uses loader elapsed in the done label", () => {
    const elapsedMs = 4300;
    const trace = mapStepsToThinkingTrace(
      [
        { primary: "读取文件", secondary: "src/lib/utils.ts", mono: true },
        { primary: "写入文件", secondary: "src/lib/utils.ts", mono: true },
      ],
      elapsedMs,
    );
    expect(trace.rows).toHaveLength(2);
    expect(trace.rows[0]?.primary).toBe("读取文件");
    expect(trace.rows[0]?.mono).toBe(true);
    expect(trace.variant).toBe("Coding");
    expect(trace.activeLabel).toBe("正在运行工具");
    expect(trace.doneLabel).toContain(formatLoaderElapsed(elapsedMs));
  });

  it("uses Reasoning + 思考中 when steps are prose-only", () => {
    const trace = mapStepsToThinkingTrace(["先核对工作区路径"], 1200);
    expect(trace.variant).toBe("Reasoning");
    expect(trace.activeLabel).toBe("思考中");
    expect(trace.doneLabel).toBe(`思考了 ${formatLoaderElapsed(1200)}`);
    expect(trace.rows[0]?.primary).toBe("先核对工作区路径");
  });
});
