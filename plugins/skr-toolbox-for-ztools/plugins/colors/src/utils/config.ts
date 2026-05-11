import { defineStore } from "pinia";

export const useCounterStore = defineStore("config", {
  state: () => {
    return { removeHash: false };
  },
});

export interface Config {
  removeHash: boolean;
}
