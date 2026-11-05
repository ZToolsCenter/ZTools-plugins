export const CURRENT_APP_VERSION = "1.4.0";
export const WHATS_NEW_STORAGE_KEY = `pasteboard_pro_whats_new_release_${CURRENT_APP_VERSION.replaceAll(".", "_")}`;

export function shouldShowWhatsNew(
  storage: Pick<Storage, "getItem"> = localStorage,
  currentVersion = CURRENT_APP_VERSION,
): boolean {
  try {
    const lastSeen = storage.getItem(WHATS_NEW_STORAGE_KEY);
    return lastSeen !== currentVersion;
  } catch {
    return false;
  }
}

export function markWhatsNewSeen(
  storage: Pick<Storage, "setItem"> = localStorage,
  currentVersion = CURRENT_APP_VERSION,
): void {
  try {
    storage.setItem(WHATS_NEW_STORAGE_KEY, currentVersion);
  } catch {
    // ignore
  }
}
