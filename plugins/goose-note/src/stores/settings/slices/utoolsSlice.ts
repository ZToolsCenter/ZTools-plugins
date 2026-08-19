import type { UToolsSettings } from "../types";
import {
  UTOOLS_WINDOW_HEIGHT_MIN,
  UTOOLS_WINDOW_HEIGHT_MAX,
  UTOOLS_WINDOW_HEIGHT_DEFAULT,
} from "../types";

export interface UToolsSliceState {
  utools: UToolsSettings;
}

export interface UToolsSliceActions {
  setUToolsGlobalSearchEnabled: (enabled: boolean) => void;
  setOpenSearchInUtools: (enabled: boolean) => void;
  setUseInternalImageViewer: (enabled: boolean) => void;
  setUToolsWindowHeight: (height: number) => void;
}

export type UToolsSlice = UToolsSliceState & UToolsSliceActions;

export const UTOOLS_INITIAL_STATE: UToolsSliceState = {
  utools: {
    globalSearchEnabled: false,
    openSearchInUtools: true,
    useInternalImageViewer: false,
    windowHeight: UTOOLS_WINDOW_HEIGHT_DEFAULT,
  },
};

type SetFn = (
  updater:
    | Partial<UToolsSlice>
    | ((state: UToolsSlice) => Partial<UToolsSlice>),
) => void;

export function createUToolsSlice(set: SetFn): UToolsSlice {
  return {
    ...UTOOLS_INITIAL_STATE,
    setUToolsGlobalSearchEnabled: (enabled) =>
      set((state) => ({
        utools: { ...state.utools, globalSearchEnabled: enabled },
      })),
    setOpenSearchInUtools: (enabled) =>
      set((state) => ({
        utools: { ...state.utools, openSearchInUtools: enabled },
      })),
    setUseInternalImageViewer: (enabled) =>
      set((state) => ({
        utools: { ...state.utools, useInternalImageViewer: enabled },
      })),
    setUToolsWindowHeight: (height) =>
      set((state) => ({
        utools: {
          ...state.utools,
          windowHeight: Math.min(
            UTOOLS_WINDOW_HEIGHT_MAX,
            Math.max(UTOOLS_WINDOW_HEIGHT_MIN, height),
          ),
        },
      })),
  };
}
