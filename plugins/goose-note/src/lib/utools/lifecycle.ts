import { getUToolsApi } from "./env";
import { EVENTS } from "./events";

type PluginEnterPayload = {
  code: string;
  type: string;
  payload?: unknown;
};

export const lifecycle = {
  onPluginEnter: (callback: (payload: PluginEnterPayload) => void): void => {
    const utools = getUToolsApi();
    utools?.onPluginEnter?.(callback);
  },

  onPluginOut: (callback: () => void): void => {
    const utools = getUToolsApi();
    utools?.onPluginOut?.(callback);
  },

  onSublistEnter: (callback: (selection: { word: string }) => void): void => {
    const utools = getUToolsApi();
    utools?.onSublistEnter?.(callback);
  },

  emitPluginEnter: (payload: PluginEnterPayload): void => {
    window.dispatchEvent(
      new CustomEvent(EVENTS.PLUGIN_ENTER, { detail: payload }),
    );
  },

  emitPluginOut: (): void => {
    window.dispatchEvent(new CustomEvent(EVENTS.PLUGIN_OUT));
  },
};
