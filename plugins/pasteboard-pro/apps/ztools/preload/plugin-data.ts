import os from "node:os";
import path from "node:path";

type PluginDataHost = Readonly<{
  getPath?: (name: string) => unknown;
}>;

export type PasteboardProDataPaths = Readonly<{
  dataRoot: string;
  blobRoot: string;
  legacyBlobRoots: readonly string[];
  usesPluginData: boolean;
}>;

export function legacyPasteboardProDataRoot(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, ".pasteboard-pro", "ztools");
}

export function resolvePasteboardProDataPaths(
  host: PluginDataHost,
  legacyDataRoot = legacyPasteboardProDataRoot(),
): PasteboardProDataPaths {
  let pluginDataRoot: string | undefined;
  try {
    const candidate = host.getPath?.("pluginData");
    if (typeof candidate === "string" && path.isAbsolute(candidate)) {
      pluginDataRoot = path.resolve(candidate);
    }
  } catch {
    pluginDataRoot = undefined;
  }
  const resolvedLegacyRoot = path.resolve(legacyDataRoot);
  const dataRoot = pluginDataRoot ?? resolvedLegacyRoot;
  const blobRoot = path.join(dataRoot, ...(pluginDataRoot === undefined ? ["blobs"] : ["sync", "blobs"]));
  const legacyBlobRoot = path.join(resolvedLegacyRoot, "blobs");
  return {
    dataRoot,
    blobRoot,
    legacyBlobRoots:
      path.resolve(blobRoot) === path.resolve(legacyBlobRoot) ? [] : [legacyBlobRoot],
    usesPluginData: pluginDataRoot !== undefined,
  };
}

export function resolvePasteboardBlobRoots(
  host: PluginDataHost,
  homeDirectory = os.homedir(),
): Readonly<{ primary: string; legacy: readonly string[] }> {
  const paths = resolvePasteboardProDataPaths(
    host,
    legacyPasteboardProDataRoot(homeDirectory),
  );
  return { primary: paths.blobRoot, legacy: paths.legacyBlobRoots };
}
