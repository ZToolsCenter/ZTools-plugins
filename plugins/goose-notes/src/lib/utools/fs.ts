const getGooseFs = (): GooseFs | null =>
  typeof window !== "undefined" ? (window as any).gooseFs ?? null : null;

export const fs = {
  isAvailable: (): boolean => Boolean(getGooseFs()),

  readFile: (path: string): string | null =>
    getGooseFs()?.readFile(path) ?? null,

  readFileAsync: async (path: string): Promise<string | null> => {
    const gfs = getGooseFs();
    if (!gfs) return null;
    if (gfs.readFileAsync) return gfs.readFileAsync(path);
    return gfs.readFile(path);
  },

  readFileStat: (path: string) =>
    getGooseFs()?.readFileStat?.(path) ?? null,

  readFileStatAsync: async (path: string) => {
    const gfs = getGooseFs();
    if (!gfs) return null;
    if (gfs.readFileStatAsync) return gfs.readFileStatAsync(path);
    return gfs.readFileStat?.(path) ?? null;
  },

  writeFile: (path: string, content: string, encoding?: string): boolean =>
    getGooseFs()?.writeFile(path, content, encoding) ?? false,

  writeFileAsync: async (
    path: string,
    content: string,
    encoding?: string,
  ): Promise<boolean> => {
    const gfs = getGooseFs();
    if (!gfs) return false;
    if (gfs.writeFileAsync) return gfs.writeFileAsync(path, content, encoding);
    return gfs.writeFile(path, content, encoding);
  },

  exists: (path: string): boolean => getGooseFs()?.exists(path) ?? false,

  existsAsync: async (path: string): Promise<boolean> => {
    const gfs = getGooseFs();
    if (!gfs) return false;
    if (gfs.existsAsync) return gfs.existsAsync(path);
    return gfs.exists(path);
  },

  mkdir: async (path: string): Promise<boolean> => {
    const gfs = getGooseFs();
    if (!gfs?.mkdir) return false;
    return Boolean(await Promise.resolve(gfs.mkdir(path)));
  },

  readDir: (path: string): any[] => getGooseFs()?.readDir(path) ?? [],

  readDirAsync: async (path: string): Promise<any[]> => {
    const gfs = getGooseFs();
    if (!gfs) return [];
    if (gfs.readDirAsync) return gfs.readDirAsync(path);
    return gfs.readDir(path);
  },

  deleteFile: async (path: string): Promise<boolean> => {
    const gfs = getGooseFs();
    if (!gfs) return false;
    return Boolean(await Promise.resolve(gfs.deleteFile(path)));
  },

  deleteDir: async (path: string): Promise<boolean> => {
    const gfs = getGooseFs();
    if (!gfs) return false;
    return Boolean(await Promise.resolve(gfs.deleteDir(path)));
  },

  rename: async (oldPath: string, newPath: string): Promise<boolean> => {
    const gfs = getGooseFs();
    if (!gfs) return false;
    return Boolean(await Promise.resolve(gfs.rename(oldPath, newPath)));
  },

  watch: (path: string, cb: (event: any) => void): any =>
    getGooseFs()?.watch(path, cb),

  unwatch: (path: string): void => getGooseFs()?.unwatch(path),

  writeTempFile: async (
    relativePath: string,
    contentBase64: string,
  ): Promise<string | null> => {
    const gfs = getGooseFs();
    if (!gfs?.writeTempFile) return null;
    return gfs.writeTempFile(relativePath, contentBase64);
  },

  cleanupTempFiles: async (prefix: string, maxAgeMs: number): Promise<void> => {
    const gfs = getGooseFs();
    await gfs?.cleanupTempFiles?.(prefix, maxAgeMs);
  },

  revealItemInFolder: async (path: string): Promise<boolean> => {
    const gfs = getGooseFs();
    if (!gfs?.revealItemInFolder) return false;
    return Boolean(await Promise.resolve(gfs.revealItemInFolder(path)));
  },

  selectDirectory: async (): Promise<string | null> => {
    const gfs = getGooseFs();
    if (!gfs?.selectDirectory) return null;
    return gfs.selectDirectory();
  },
};
