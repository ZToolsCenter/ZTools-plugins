import { defineStore } from "pinia";
import { ColorFormat } from "./color";

export const useConfigStore = defineStore("config", {
  state: () => {
    return { removeHash: false, format: "hex" } as Config;
  },
});

export interface Config {
  removeHash: boolean;
  format: ColorFormat;
}
