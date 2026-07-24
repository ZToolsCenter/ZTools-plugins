const pathSeparatorPattern = /[/\\]/;

export function basename(filePath: string) {
  return filePath.split(pathSeparatorPattern).pop() ?? filePath;
}

export function shortPath(filePath: string) {
  if (!filePath) return "未选择";
  const isWindowsPath = filePath.includes("\\");
  const separator = isWindowsPath ? "\\" : "/";
  const parts = filePath.split(pathSeparatorPattern).filter(Boolean);
  if (parts.length <= 2) return filePath;
  return `...${separator}${parts.slice(-2).join(separator)}`;
}
