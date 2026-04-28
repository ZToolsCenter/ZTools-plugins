<script setup lang="ts">
import { Colord, colord } from "colord";
import { computed, ref, watch } from "vue";
import { colordToHsvString } from "@/utils/color";
import { useCounterStore } from "@/utils/config";
import { copyColor } from "@/utils/copy";
let { flag } = defineProps<{ flag: "hsl" | "hsv/hsb" | "hex" | "rgb" }>();
let config = useCounterStore();
let inputting = ref(false);
let color = defineModel<Colord>({ required: true });
let colorInputValues = ref<(string | number)[]>([]);
function toInputValue(color: Colord) {
  switch (flag) {
    case "hsl":
      let hsl = color.toHsl();
      return [hsl.h.toString(), hsl.s.toString(), hsl.l.toString()];
    case "hsv/hsb":
      let hsv = color.toHsv();
      return [hsv.h.toString(), hsv.s.toString(), hsv.v.toString()];
    case "hex":
      return [color.toHex()];
    case "rgb":
      let rgb = color.toRgb();
      return [rgb.r.toString(), rgb.g.toString(), rgb.b.toString()];
  }
}
function inputValuesToColor(v: (string | number)[]): Colord | null {
  try {
    switch (flag) {
      case "hsl":
        let c = colord({
          h: parseInt(v[0] as any),
          s: parseInt(v[1] as any),
          l: parseInt(v[2] as any),
        });
        if (c.isValid()) return c;
        break;
      case "hsv/hsb":
        let c1 = colord({ h: parseInt(v[0] as any), s: parseInt(v[1] as any), v: Number(v[2]) });
        if (c1.isValid()) return c1;
        break;
      case "hex":
        let c2 = colord(`${v[0]}`.startsWith("#") ? (v[0] as any).toString() : `#${v[0]}`);
        if (c2.isValid()) return c2;
        break;
      case "rgb":
        let c3 = colord({
          r: parseInt(v[0] as any),
          g: parseInt(v[1] as any),
          b: parseInt(v[2] as any),
        });
        if (c3.isValid()) return c3;
        break;
    }
  } catch (e) {
    console.error(e);
  }

  return null;
}
watch(
  color,
  (newColor) => {
    if (inputting.value) return;
    colorInputValues.value = toInputValue(newColor);
  },
  { immediate: true },
);
watch(colorInputValues, (newValues) => {
  let c = inputValuesToColor(newValues);
  if (c) color.value = c;
});

function change(index: number, v: string) {
  let _colorInputValues = [...colorInputValues.value];
  _colorInputValues[index] = v;
  colorInputValues.value = _colorInputValues;
}
function toString(color: Colord) {
  switch (flag) {
    case "hsl":
      return color.toHslString();
    case "hsv/hsb":
      return colordToHsvString(color);
    case "hex":
      if (config.removeHash) return currentColorNotHash.value;
      return color.toHex();
    case "rgb":
      return color.toRgbString();
  }
}
const currentColorNotHash = computed(() => {
  let hex = color.value?.toHex() || "#000000";
  return hex.startsWith("#") ? hex.substring(1) : hex;
});
</script>
<template>
  <div class="flex items-center space-x-2">
    <label class="w-16 text-sm font-medium text-gray-700">{{ flag.toUpperCase() }}</label>
    <input
      v-for="(item, index) in colorInputValues"
      :value="item"
      @focus="inputting = true"
      @change="inputting = false"
      @blur="inputting = false"
      @input="
        (e: any) => {
          change(index, e.target.value);
          inputting = true;
        }
      "
      class="min-w-[0px] flex-1 rounded border border-gray-300 px-3 py-1 text-center text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
    />
    <button
      @click="copyColor(toString(color))"
      class="grow-0 p-1 text-gray-500 hover:text-gray-700"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
    </button>
  </div>
</template>
