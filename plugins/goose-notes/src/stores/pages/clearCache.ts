import { localPageMetadataCache } from "./persistence";

export const clearLocalPageMetadataCache = () => {
  localPageMetadataCache.clear();
};
