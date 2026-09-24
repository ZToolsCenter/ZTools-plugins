import os from "node:os";
import path from "node:path";

export function getZToolsRoots(options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const modernRoot = pathApi.join(home, ".ztools");

  if (platform === "win32") {
    const appData = env.APPDATA || pathApi.join(home, "AppData", "Roaming");
    return { modernRoot, legacyRoot: pathApi.join(appData, "ZTools") };
  }

  if (platform === "darwin") {
    return {
      modernRoot,
      legacyRoot: pathApi.join(home, "Library", "Application Support", "ZTools")
    };
  }

  const configRoot = env.XDG_CONFIG_HOME || pathApi.join(home, ".config");
  return { modernRoot, legacyRoot: pathApi.join(configRoot, "ZTools") };
}
