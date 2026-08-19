import { getUToolsApi } from "./env";

export interface UserInfo {
  avatar?: string;
  nickname: string;
  type: string;
}

export const user = {
  getUser: (): UserInfo | null => {
    const utools = getUToolsApi();
    if (!utools) return null;
    try {
      return utools.getUser?.() ?? null;
    } catch {
      return null;
    }
  },

  getNativeId: (): string | null => {
    const utools = getUToolsApi();
    if (!utools) return null;
    try {
      return utools.getNativeId?.() ?? null;
    } catch {
      return null;
    }
  },

  getUserNickname: (): string | null => {
    const u = user.getUser();
    return u?.nickname ?? null;
  },
};
