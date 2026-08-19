import {
  getDbStorageItem,
  removeDbStorageItem,
  setDbStorageItem,
} from "@/lib/storage";

const DISMISS_STATE_PREFIX = "goose-note:dismiss:";
const DISMISSED_VALUE = "1";

const getDismissStateStorageKey = (id: string) => `${DISMISS_STATE_PREFIX}${id}`;

export const readPersistentDismissState = (id: string): boolean => {
  return getDbStorageItem(getDismissStateStorageKey(id)) === DISMISSED_VALUE;
};

export const writePersistentDismissState = (
  id: string,
  dismissed: boolean,
): void => {
  const key = getDismissStateStorageKey(id);

  if (dismissed) {
    setDbStorageItem(key, DISMISSED_VALUE);
    return;
  }

  removeDbStorageItem(key);
};
