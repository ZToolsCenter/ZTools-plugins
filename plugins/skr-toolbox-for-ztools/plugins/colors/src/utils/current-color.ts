import { AnyColor, Colord, colord } from "colord";
import { defineStore } from "pinia";
import { shallowRef } from "vue";

export const useCurrentColor = defineStore("currentColor", () => {
  const currentColor = shallowRef(colord("#FFFFFF"));
  function setCurrentColor(color: AnyColor | Colord) {
    currentColor.value = colord(color);
  }
  return {
    currentColor,
    setCurrentColor,
  };
});
