const timeoutToken = Symbol("harness-timeout");

function errorValue(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) };
}

function isoNow() {
  return new Date().toISOString();
}

function boundedCancellation(cancellation, waitMs) {
  if (!cancellation) return Promise.resolve({ status: "not_needed" });
  let timer;
  const settledCancellation = Promise.resolve(cancellation)
    .then(() => ({ status: "completed" }), (error) => ({ status: "failed", error: errorValue(error) }));
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: "timed_out" }), waitMs);
  });
  return Promise.race([settledCancellation, deadline]).finally(() => clearTimeout(timer));
}

/** Execute exactly one real planned task and retain every managed inference request. */
export async function evaluateItem({
  request, snapshot, modules, service, transport, plan, record, serviceRunState,
  observeManagedServer, sha256, maxCalls = 64, maxDurationMs = 90_000,
  harnessTimeoutMs = 90_000, cancelWaitMs = 5_500
}) {
  const controller = new AbortController();
  let activeRequestId = null;
  let invocationIndex = 0;
  let harnessTimedOut = false;
  let cancellingRequestId = null;
  let cancellation = null;
  const cancelGeneration = (requestId) => {
    if (!requestId) return Promise.resolve();
    if (cancellingRequestId === requestId && cancellation) return cancellation;
    cancellingRequestId = requestId;
    cancellation = Promise.resolve().then(() => service.cancelGeneration(requestId)).finally(() => {
      if (cancellingRequestId === requestId) {
        cancellingRequestId = null;
        cancellation = null;
      }
    });
    return cancellation;
  };
  const abortCurrent = () => {
    if (activeRequestId) void cancelGeneration(activeRequestId).catch(() => {});
  };
  const invoke = async (prompt, systemPrompt, maxTokens, onChunk, outputSchema) => {
    if (harnessTimedOut || controller.signal.aborted) {
      throw Object.assign(new Error("Independent scenario harness deadline exceeded."), { name: "HarnessTimeoutError", code: "harness_timeout" });
    }
    if (invocationIndex >= maxCalls) throw new Error(`Scenario exceeded the ${maxCalls} call harness limit.`);
    const index = ++invocationIndex;
    const phase = index === 1 ? "planning" : "generation";
    const requestId = `scenario-${record.id}-${index}-${Date.now()}`;
    const call = {
      index, phase, requestId, prompt, systemPrompt, maxTokens,
      schemaHash: outputSchema === undefined ? null : sha256(JSON.stringify(outputSchema)),
      temperature: null,
      outputSchema: outputSchema === undefined ? null : outputSchema,
      chunks: [], startedAt: isoNow(), elapsedMs: null, raw: null, error: null
    };
    const serverBefore = observeManagedServer();
    call.managedServerBefore = serverBefore;
    call.startupClass = !serviceRunState.inferenceSeen && !serverBefore.present
      ? "cold"
      : serverBefore.alive && serverBefore.pid && serverBefore.pid === serviceRunState.lastPid
        ? "hot"
        : serverBefore.alive ? "preexisting-or-restarted" : serviceRunState.inferenceSeen ? "restarted" : "server-unavailable";
    const transportRequest = transport.buildChatRequest({
      source: "managed", model: plan.modelId, prompt, systemPrompt, maxTokens, contextTokens: 4096,
      ...(outputSchema === undefined ? {} : { outputSchema })
    });
    call.transport = {
      temperature: Object.hasOwn(transportRequest.body, "temperature") ? transportRequest.body.temperature : null,
      schemaHash: transportRequest.body.response_format?.schema
        ? sha256(JSON.stringify(transportRequest.body.response_format.schema)) : null,
      responseFormatType: transportRequest.body.response_format?.type ?? null
    };
    call.temperature = call.transport.temperature;
    if ((phase === "planning" && outputSchema === undefined) ||
        (outputSchema === undefined && call.transport.schemaHash !== null) ||
        (outputSchema !== undefined && call.transport.schemaHash !== call.schemaHash)) {
      call.error = { name: "HarnessContractError", code: null, message: "Planning must receive a schema; every supplied schema must match the actual transport payload." };
      call.elapsedMs = 0;
      record.calls.push(call);
      throw new Error(call.error.message);
    }
    record.calls.push(call);
    activeRequestId = requestId;
    record.activeRequestId = requestId;
    const started = Date.now();
    try {
      serviceRunState.inferenceSeen = true;
      const raw = await service.generate({
        requestId, source: "managed", modelId: plan.modelId, prompt, systemPrompt,
        maxTokens, contextTokens: 4096,
        ...(outputSchema === undefined ? {} : { outputSchema })
      }, (chunk) => {
        if (harnessTimedOut) return;
        call.chunks.push({ at: Date.now(), text: chunk });
        onChunk(chunk);
      });
      if (harnessTimedOut) {
        throw Object.assign(new Error("Late inference result ignored after the independent harness deadline."), { name: "HarnessTimeoutError", code: "late_result_ignored" });
      }
      call.raw = raw;
      call.managedServerAfter = observeManagedServer();
      if (call.managedServerAfter.pid) serviceRunState.lastPid = call.managedServerAfter.pid;
      return raw;
    } catch (error) {
      if (!harnessTimedOut) call.error = errorValue(error);
      throw error;
    } finally {
      if (!harnessTimedOut) {
        call.managedServerAfter ??= observeManagedServer();
        if (call.managedServerAfter.pid) serviceRunState.lastPid = call.managedServerAfter.pid;
        call.elapsedMs = Date.now() - started;
        call.finishedAt = isoNow();
        if (activeRequestId === requestId) activeRequestId = null;
        if (record.activeRequestId === requestId) delete record.activeRequestId;
      }
    }
  };

  let runner;
  try {
    runner = Promise.resolve(modules.runPlannedAiTask(request, snapshot, {
      invoke,
      isCurrent: () => !controller.signal.aborted,
      signal: controller.signal,
      abortCurrent,
      maxCalls,
      maxDurationMs,
      onProgress: (message) => { if (!harnessTimedOut) record.progress.push({ at: Date.now(), message }); },
      onChunk: (chunk) => { if (!harnessTimedOut) record.progress.push({ at: Date.now(), chunk }); }
    }));
  } catch (error) {
    runner = Promise.reject(error);
  }
  // A runner may finish after the independent deadline. Keep its rejection observed,
  // but never await it or let its late result mutate the persisted record.
  runner.catch(() => {});
  let timeoutHandle;
  let timeoutCancellation = null;
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      harnessTimedOut = true;
      record.harnessTimedOut = true;
      record.timeoutKind = "independent_harness_wall_cap";
      record.timedOutAt = isoNow();
      controller.abort();
      const timedOutRequestId = activeRequestId;
      if (timedOutRequestId) {
        record.abandonedRequestId = timedOutRequestId;
        delete record.activeRequestId;
        activeRequestId = null;
        timeoutCancellation = boundedCancellation(cancelGeneration(timedOutRequestId), cancelWaitMs).then((result) => {
          record.cancelStatus = result.status;
          if (result.error) record.cancelError = result.error;
        });
      } else {
        timeoutCancellation = Promise.resolve();
      }
      resolve(timeoutToken);
    }, harnessTimeoutMs);
  });
  let outcome;
  try { outcome = await Promise.race([runner, timeout]); }
  catch (error) {
    if (harnessTimedOut) {
      if (timeoutCancellation) await timeoutCancellation;
      return;
    }
    if (error?.name === "AiTaskDeadlineError") {
      record.runnerDeadlineExceeded = true;
      record.timeoutKind = "runner_max_duration_budget";
    }
    if (record.harnessTimedOut && timeoutCancellation) await timeoutCancellation;
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
  if (harnessTimedOut || outcome === timeoutToken) {
    if (timeoutCancellation) await timeoutCancellation;
    return;
  }
  record.result = outcome;
  if (outcome.proposal) {
    try { record.resolvedEdit = modules.resolveAiEdit(outcome.proposal); }
    catch (error) { record.resolveError = errorValue(error); }
  } else {
    record.resolvedEdit = null;
  }
}
