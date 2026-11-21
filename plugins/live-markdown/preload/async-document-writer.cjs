"use strict";

const crypto = require("node:crypto");

function createAsyncDocumentWriter(fs, path) {
  const queues = new Map();

  function failure(code, message, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
  }

  async function performWrite(inputPath, content, options = {}) {
    if (typeof inputPath !== "string" || !inputPath.trim() || inputPath.includes("\0")) {
      throw failure("INVALID_PATH", "A valid document path is required.");
    }
    if (typeof options.expectedContent !== "string") {
      throw failure("WRITE_FAILED", "expectedContent is required for a safe write.");
    }
    const target = path.resolve(inputPath.trim());
    const nextContent = typeof content === "string" ? content : String(content ?? "");
    const dir = path.dirname(target);
    let existing;
    try {
      existing = await fs.promises.readFile(target, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT" && options.expectedContent === "") existing = "";
      else throw failure("WRITE_FAILED", "Could not read the current document before saving.", { cause: error });
    }
    if (existing !== options.expectedContent) {
      throw failure("DOCUMENT_CONFLICT", "The file changed outside the editor; save was stopped.", {
        expectedContent: options.expectedContent,
        actualContent: existing
      });
    }

    const tempPath = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    let handle;
    try {
      handle = await fs.promises.open(tempPath, "wx", 0o600);
      await handle.writeFile(nextContent, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;

      // Recheck immediately before replacement to catch ordinary external edits
      // during the temp-file write window.
      const latest = await fs.promises.readFile(target, "utf8").catch((error) => {
        if (error && error.code === "ENOENT" && options.expectedContent === "") return "";
        throw error;
      });
      if (latest !== options.expectedContent) {
        throw failure("DOCUMENT_CONFLICT", "The file changed while saving; the external version was preserved.", {
          expectedContent: options.expectedContent,
          actualContent: latest
        });
      }
      await fs.promises.rename(tempPath, target);
      const stat = await fs.promises.stat(target);
      return {
        path: target,
        name: path.basename(target),
        dir,
        content: nextContent,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      };
    } catch (error) {
      throw error && error.code === "DOCUMENT_CONFLICT"
        ? error
        : failure("WRITE_FAILED", "Could not safely save the document.", { cause: error });
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  function writeDocumentAsync(inputPath, content, options) {
    let target;
    try { target = path.resolve(inputPath.trim()); } catch { target = String(inputPath); }
    const previous = queues.get(target) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => performWrite(inputPath, content, options));
    queues.set(target, current);
    current.finally(() => { if (queues.get(target) === current) queues.delete(target); }).catch(() => {});
    return current;
  }

  return { writeDocumentAsync };
}

module.exports = { createAsyncDocumentWriter };
