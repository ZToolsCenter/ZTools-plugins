/**
 * Start Menu / installers often ship "Uninstall Xxx" shortcuts.
 * These should not appear in the app library.
 */
export function isUninstallEntry(name: string, appPath: string = ''): boolean {
  const text = `${name} ${appPath}`.toLowerCase()
  if (text.includes('uninstall') || text.includes('卸载')) return true
  // Inno Setup / common uninstaller executables
  if (/unins\d{0,3}\.exe$/i.test(appPath)) return true
  if (/(^|[\\/])uninstall\.exe$/i.test(appPath)) return true
  return false
}

export function rejectUninstallApps<T extends { name: string; path: string }>(apps: T[]): T[] {
  return apps.filter((a) => !isUninstallEntry(a.name, a.path))
}
