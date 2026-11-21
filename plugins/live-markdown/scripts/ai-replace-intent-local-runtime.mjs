/** Read-only checks for the already-installed managed model; never deploy or download. */
import fs from "node:fs";
import path from "node:path";

export async function assertCachedLightProfile({ service, localAiDirectory, profileId, modelId, hash }) {
  const active = JSON.parse(fs.readFileSync(path.join(localAiDirectory, "active-model.json"), "utf8"));
  if (active.profileId !== profileId || active.modelId !== modelId) {
    throw new Error(`Active local model changed; expected ${profileId}/${modelId}, got ${active.profileId}/${active.modelId}`);
  }
  const inspection = await service.inspect();
  const plan = inspection.plans.find((entry) => entry.id === profileId);
  if (!plan?.cached || plan.downloadBytes !== 0 || plan.modelId !== modelId) {
    throw new Error("Cached light model is unavailable; refusing to download or deploy anything");
  }
  return {
    profileId,
    modelId,
    platform: inspection.platform,
    arch: inspection.arch,
    cached: plan.cached,
    downloadBytes: plan.downloadBytes,
    installedBytes: plan.installedBytes,
    activeProfileSha256: hash(fs.readFileSync(path.join(localAiDirectory, "active-model.json")))
  };
}
