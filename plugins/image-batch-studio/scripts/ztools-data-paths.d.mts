export interface ZToolsRootOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: Record<string, string | undefined>;
}

export interface ZToolsRoots {
  modernRoot: string;
  legacyRoot: string;
}

export function getZToolsRoots(options?: ZToolsRootOptions): ZToolsRoots;
