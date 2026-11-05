import type { HostInvoke } from "../host";
import type { PreparedImport } from "./types";
import type { OperationProgress } from "../../app/OperationContext";

export async function prepareDownload(
  call: HostInvoke,
  catalogId: string,
  skillPath: string,
  report: (value: OperationProgress | null) => void,
): Promise<PreparedImport> {
  const requestId = crypto.randomUUID();
  let active = true;
  let polling = false;
  report(null);
  const timer = window.setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const value = await call<OperationProgress | null>(
        "get_download_progress",
        { requestId },
      );
      if (active && value) report(value.stage === "validate" ? null : value);
    } catch {
      // A progress read must not interrupt the authoritative download result.
    } finally {
      polling = false;
    }
  }, 150);
  try {
    return await call<PreparedImport>("prepare_github", {
      catalogId,
      skillPath,
      requestId,
    });
  } finally {
    active = false;
    window.clearInterval(timer);
    report(null);
  }
}
