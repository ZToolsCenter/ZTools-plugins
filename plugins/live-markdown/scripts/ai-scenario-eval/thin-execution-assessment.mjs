import { assessArtifactContract } from "./thin-execution-artifact-oracles.mjs";

const strategies = ["direct", "thin", "full"];
const validEffects = new Set(["insert", "replace", "answer", "clarify", "no_op", "error", "cancelled", "stale"]);
const score = (status, reason, extra = {}) => ({
  status,
  pass: status === "pass" ? true : status === "fail" ? false : null,
  reason,
  ...extra
});
const notApplicable = (reason) => score("not_applicable", reason);

function outputText(observation) {
  return observation?.text ?? observation?.patch?.insertText ?? "";
}

function executionStatus(expected, observation) {
  if (!observation || typeof observation !== "object") return "missing";
  if (observation.truncated === true) return "truncated";
  if (observation.cancelled === true) return expected.effect === "no_op" ? "expected_cancel" : "cancelled";
  if (observation.completed === false) return "incomplete";
  return "complete";
}

function taskLayer(expected, observation, execution) {
  if (execution === "missing") return score("blocked", "No normalized observation was recorded.");
  if (execution === "truncated") return score("blocked", "Known truncated output is incomplete; content quality is not scored.");
  if (execution === "cancelled") return score("blocked", "The run was cancelled before the expected user outcome.");
  if (execution === "incomplete") return score("blocked", "The runner did not mark this task complete.");
  const effect = observation.effect;
  if (!validEffects.has(effect)) return score("fail", "Observation must report its effect explicitly; the scorer does not infer it.", { actualEffect: effect ?? null });
  if (effect !== expected.effect) {
    return score("fail", "Expected effect " + expected.effect + ", got " + effect + (["clarify", "no_op", "error", "stale", "cancelled"].includes(effect) ? "; stopping is not completion of the requested result." : "."), { expectedEffect: expected.effect, actualEffect: effect });
  }
  if (["insert", "replace", "answer"].includes(effect) && !outputText(observation).trim()) return score("fail", "The reported result has no non-empty output.");
  if (["clarify", "no_op"].includes(effect) && observation.patch) return score("fail", "A clarification or no-op must not carry a write proposal.");
  return score("pass", effect === "clarify" || effect === "no_op" ? "The requested control outcome was reached safely; this is not an artifact completion." : "The explicitly reported task effect matches the frozen expectation.", { expectedEffect: expected.effect });
}

function scopeLayer(scenario, observation, task) {
  const expected = scenario.expected;
  if (task.status === "blocked") return score("not_scored", "The run did not produce a complete result to scope-check.");
  if (!["insert", "replace"].includes(expected.effect)) {
    return observation.patch ? score("fail", "A non-edit task must not include a patch.") : notApplicable("No edit range is expected for this task.");
  }
  const patch = observation.patch;
  if (!patch) return score("fail", "Expected an explicit edit patch with source offsets.");
  const failures = [];
  if (expected.target && observation.target !== expected.target) failures.push("target expected " + expected.target + ", got " + (observation.target ?? "(missing)"));
  if (expected.patch) {
    for (const key of ["from", "to", "expectedText"]) {
      if (patch[key] !== expected.patch[key]) failures.push("patch." + key + " differs from the authored range");
    }
  }
  if (expected.allowedRange) {
    const { from: allowedFrom, to: allowedTo } = expected.allowedRange;
    const allowedRangeValid = Number.isInteger(allowedFrom) && Number.isInteger(allowedTo) &&
      allowedFrom >= 0 && allowedFrom <= allowedTo && allowedTo <= scenario.source.length;
    if (!allowedRangeValid) failures.push("authored allowedRange is outside the captured source");
    else if (Number.isInteger(patch.from) && Number.isInteger(patch.to) && (patch.from < allowedFrom || patch.to > allowedTo)) {
      failures.push("patch offsets extend outside the authored allowedRange");
    }
  }
  const { from, to, expectedText, insertText, content } = patch;
  const expectedInsertText = expected.patch?.insertText;
  if (expectedInsertText !== undefined && insertText !== expectedInsertText) failures.push("patch insertText differs from the authored inserted text");
  const offsetsValid = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= to && to <= scenario.source.length;
  if (!offsetsValid) failures.push("patch offsets are outside the captured source");
  else {
    if (expectedText !== scenario.source.slice(from, to)) failures.push("patch expectedText does not match the source bytes");
    if (typeof insertText !== "string") failures.push("patch insertText is missing");
    if ((expected.unchangedOutside || expected.allowedRange || expected.exactContent !== undefined) && typeof content !== "string") {
      failures.push("full proposed content is required to prove the authorized edit scope");
    }
    if (typeof content === "string") {
      const recomposed = scenario.source.slice(0, from) + String(insertText ?? "") + scenario.source.slice(to);
      if (content !== recomposed) failures.push("bytes outside the proposed range changed");
    }
  }
  return failures.length
    ? score("fail", failures.join("; "), { failures })
    : score("pass", "The patch is bound to the expected target and preserves bytes outside its range.", { from, to });
}

function formatLayer(scenario, observation, task, artifactContract) {
  if (task.status === "blocked") return score("not_scored", "Incomplete output is not treated as a format failure.");
  if (task.status === "fail") return score("not_scored", "The reported task effect did not match the expected operation.");
  if (scenario.expected.artifact) {
    const result = artifactContract?.format;
    if (result?.pass === true) return score("pass", result.reason);
    if (result?.pass === false) return score("fail", result.reason);
  }
  return notApplicable("This task has no explicit artifact format contract.");
}

function parametersLayer(scenario, observation, task, artifactContract) {
  if (task.status === "blocked") return score("not_scored", "Incomplete output is not checked against explicit parameters.");
  const expected = scenario.expected;
  if (observation?.effect !== expected.effect) return score("not_scored", "The reported task effect did not match the expected operation.");
  if (task.status === "fail" && expected.exactText === undefined) return score("not_scored", "The task did not produce a complete artifact for parameter checking.");
  if (expected.artifact) {
    const result = artifactContract?.parameters;
    if (result?.pass === true) return score("pass", result.reason);
    if (result?.pass === false) return score("fail", result.reason);
    return notApplicable(result?.reason ?? "No explicit artifact parameters apply.");
  }
  if (expected.exactContent !== undefined) {
    const content = observation.patch?.content;
    return content === expected.exactContent
      ? score("pass", "The exact full proposed document matches.")
      : score("fail", "The exact full proposed document differs.", { expected: expected.exactContent, actual: content ?? null });
  }
  if (expected.exactText !== undefined) {
    const text = outputText(observation);
    return text === expected.exactText
      ? score("pass", "Exact requested text matches.")
      : score("fail", "Exact requested text differs.", { expected: expected.exactText, actual: text });
  }
  return notApplicable("No fully deterministic output parameters apply.");
}

function qualityLayer(scenario, observation, task, execution) {
  if (execution === "truncated" || execution === "incomplete" || execution === "missing" || execution === "cancelled") {
    return score("not_scored", "Incomplete or cancelled output is not a content-quality failure.");
  }
  if (task.status === "fail" || task.status === "blocked") return score("not_scored", "The expected task outcome was not completed.");
  const expected = scenario.expected;
  if (expected.effect === "answer") {
    return score("needs_manual_review", "Answer correctness requires semantic review; keyword presence cannot establish factual accuracy.", { factsForHumanReview: expected.facts ?? [] });
  }
  if (expected.semanticReview || expected.facts) {
    return score("needs_manual_review", "The content contains open semantic or source-grounding requirements.", { factsForHumanReview: expected.facts ?? [] });
  }
  if (expected.exactText !== undefined || expected.exactContent !== undefined || expected.artifact) return notApplicable("Only frozen literal or artifact constraints are scored automatically.");
  if (["insert", "replace"].includes(expected.effect)) {
    return score("needs_manual_review", "Open writing or polishing quality requires a human reviewer.");
  }
  return notApplicable("This control task has no generated-content quality requirement.");
}

function writeSafetyLayer(observation) {
  if (observation?.autoApplied === true) return score("fail", "Candidate was automatically written without user confirmation.");
  return score("pass", "Observation reports no automatic writeback.", {
    reviewable: observation?.reviewable === true,
    warnings: Array.isArray(observation?.warnings) ? observation.warnings : []
  });
}

function assessLane(scenario, strategy, observation) {
  const execution = executionStatus(scenario.expected, observation);
  const task = taskLayer(scenario.expected, observation, execution);
  const scope = scopeLayer(scenario, observation, task);
  const artifactContract = scenario.expected.artifact && task.status === "pass"
    ? assessArtifactContract(outputText(observation), scenario.expected.artifact)
    : null;
  const format = formatLayer(scenario, observation, task, artifactContract);
  const parameters = parametersLayer(scenario, observation, task, artifactContract);
  const quality = qualityLayer(scenario, observation, task, execution);
  const writeSafety = writeSafetyLayer(observation);
  const layers = { task, scope, format, parameters, quality, writeSafety };
  const failedLayers = Object.entries(layers).filter(([, result]) => result.status === "fail").map(([name]) => name);
  let disposition;
  if (execution === "truncated") disposition = "blocked_truncated";
  else if (execution === "cancelled" || execution === "expected_cancel") disposition = execution === "expected_cancel" && task.status === "pass" && writeSafety.status === "pass" ? "safe_stop" : "blocked_cancelled";
  else if (execution === "incomplete" || execution === "missing") disposition = "blocked_incomplete";
  else if (failedLayers.length) disposition = "failed";
  else if (scenario.expected.effect === "clarify" || scenario.expected.effect === "no_op") disposition = "safe_stop";
  else if (quality.status === "needs_manual_review") disposition = "needs_manual_review";
  else disposition = "completed";
  return {
    strategy, disposition, execution,
    observation: {
      effect: observation?.effect ?? null,
      completed: observation?.completed ?? null,
      truncated: observation?.truncated === true,
      cancelled: observation?.cancelled === true,
      calls: Number.isFinite(observation?.calls) ? observation.calls : null,
      program: typeof observation?.program === "boolean" ? observation.program : null,
      reviewable: observation?.reviewable === true,
      warnings: Array.isArray(observation?.warnings) ? observation.warnings : []
    },
    layers, failedLayers
  };
}

/** Keeps each route's independent disposition and failure layers for comparison. */
export function assessThinExecutionCase(scenario, lanes = {}) {
  const results = Object.fromEntries(strategies.map((strategy) => [
    strategy, assessLane(scenario, strategy, lanes[strategy])
  ]));
  return {
    caseId: scenario.id,
    family: scenario.family,
    lanes: results,
    comparison: {
      strategies: strategies.map((name) => ({
        name,
        disposition: results[name].disposition,
        failedLayers: [...results[name].failedLayers],
        calls: results[name].observation.calls,
        program: results[name].observation.program
      }))
    }
  };
}
