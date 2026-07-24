export type ReleaseAssetInfo = {
  name: string;
  browser_download_url: string;
};

export type ReleasePlatformInfo = {
  os: string;
  arch: string;
};

/***********************平台与架构归一化*********************/

function normalizeOs(value: string): 'windows' | 'macos' | 'linux' | 'unknown' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'windows') return 'windows';
  if (normalized === 'macos') return 'macos';
  if (normalized === 'linux') return 'linux';
  return 'unknown';
}

function getArchAliases(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'x86_64' || normalized === 'x64' || normalized === 'amd64') {
    return ['x86_64', 'x64', 'amd64'];
  }
  if (normalized === 'aarch64' || normalized === 'arm64') {
    return ['aarch64', 'arm64'];
  }
  return [normalized];
}

/***********************发布资产筛选*********************/

function containsArch(name: string, aliases: string[]): boolean {
  const normalizedName = name.toLowerCase();
  return aliases.some(alias => normalizedName.includes(alias));
}

function findFirstMatchingAsset(
  assets: ReleaseAssetInfo[],
  archAliases: string[],
  candidates: string[],
): ReleaseAssetInfo | null {
  const normalizedCandidates = candidates.map(item => item.toLowerCase());

  for (const candidate of normalizedCandidates) {
    const matchedAsset = assets.find(asset => {
      const normalizedName = asset.name.toLowerCase();
      return normalizedName.endsWith(candidate) && containsArch(normalizedName, archAliases);
    });

    if (matchedAsset) {
      return matchedAsset;
    }
  }

  return null;
}

export function selectReleaseAsset(
  platform: ReleasePlatformInfo,
  assets: ReleaseAssetInfo[],
): ReleaseAssetInfo | null {
  const normalizedOs = normalizeOs(platform.os);
  const archAliases = getArchAliases(platform.arch);

  if (normalizedOs === 'windows') {
    return findFirstMatchingAsset(assets, archAliases, ['-setup.exe', '.msi']);
  }

  if (normalizedOs === 'macos') {
    return findFirstMatchingAsset(assets, archAliases, ['.dmg', '.app.tar.gz']);
  }

  if (normalizedOs === 'linux') {
    return findFirstMatchingAsset(assets, archAliases, ['.appimage', '.deb', '.rpm']);
  }

  return null;
}
