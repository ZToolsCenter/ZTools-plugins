import { access } from "node:fs/promises";

export async function journalMarkerExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw new Error("Journal marker observation failed");
  }
}

type AbsentMarkerObservation = Readonly<{
  paths: readonly string[];
  observationMs: number;
  deadlineAtMs: number;
  label: string;
  assertChildRunning(): void;
  markerAppeared(): never;
}>;

/** A completed negative window needs a final file/child sample, not just elapsed time. */
export async function observeAbsentJournalMarkers(request: AbsentMarkerObservation): Promise<number> {
  const { paths, observationMs, deadlineAtMs, label } = request;
  const startedAtMs = Date.now();
  const requiredEnd = startedAtMs + observationMs;
  const budgetFailure = () => new Error(`${label} negative window exceeded scenario budget`);
  if (requiredEnd > deadlineAtMs) throw budgetFailure();

  const sample = async () => {
    request.assertChildRunning();
    const exists = await Promise.all(paths.map(journalMarkerExists));
    if (exists.some(Boolean)) request.markerAppeared();
    request.assertChildRunning();
  };
  while (Date.now() < requiredEnd) {
    await sample();
    const remainingMs = requiredEnd - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(20, remainingMs)));
  }
  if (Date.now() > deadlineAtMs) throw budgetFailure();
  await sample();
  const completedAtMs = Date.now();
  if (completedAtMs > deadlineAtMs || completedAtMs < requiredEnd) throw budgetFailure();
  return completedAtMs - startedAtMs;
}
