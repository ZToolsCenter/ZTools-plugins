"use strict";

const { downloadResource: downloadOnce } = require("./downloader.cjs");

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [250, 750];
const RETRYABLE_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"
]);

function cancellationError() {
  const error = new Error("Download cancelled");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function isCancellation(error, signal) {
  if (signal?.aborted) return true;
  return Boolean(error && (
    error.name === "AbortError" || error.code === "ABORT_ERR" ||
    /\b(cancelled|canceled|download cancelled|installation cancelled)\b/i.test(String(error.message || ""))
  ));
}

function hasRetryableNetworkError(error) {
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (RETRYABLE_CODES.has(current.code)) return true;
    if (current.code === "ERR_STREAM_PREMATURE_CLOSE") return true;
    if (/^(?:response\s+)?aborted(?:\b|$)/i.test(String(current.message || ""))) return true;
    current = current.cause;
  }
  return false;
}

function waitForRetryDelay(delay, milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(cancellationError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, cancellationError());
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => delay(milliseconds, signal)).then(
      () => finish(resolve),
      (error) => finish(reject, error)
    );
    if (signal?.aborted) onAbort();
  });
}

function defaultDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(cancellationError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(cancellationError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function downloadResource(resource, destinationPath, options = {}) {
  const download = typeof options.download === "function" ? options.download : downloadOnce;
  const delay = typeof options.delay === "function"
    ? options.delay
    : (milliseconds, retrySignal) => defaultDelay(milliseconds, retrySignal);
  const signal = options.signal;
  const downloadOptions = { ...options };
  delete downloadOptions.download;
  delete downloadOptions.delay;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw cancellationError();
    try {
      const result = await download(resource, destinationPath, downloadOptions);
      if (signal?.aborted) throw cancellationError();
      return result;
    } catch (error) {
      if (isCancellation(error, signal) || attempt === MAX_ATTEMPTS || !hasRetryableNetworkError(error)) throw error;
      await waitForRetryDelay(delay, RETRY_DELAYS_MS[attempt - 1], signal);
    }
  }
  throw new Error("Download failed after retry limit");
}

module.exports = { downloadResource, isRetryableDownloadError: hasRetryableNetworkError };
