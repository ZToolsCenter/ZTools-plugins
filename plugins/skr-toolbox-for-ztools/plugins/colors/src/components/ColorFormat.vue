<script setup lang="ts">
import { Colord, colord, extend } from "colord";
import cmykPlugin from "colord/plugins/cmyk";
import hwbPlugin from "colord/plugins/hwb";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import xyzPlugin from "colord/plugins/xyz";
extend([hwbPlugin, cmykPlugin, labPlugin, lchPlugin, xyzPlugin]);
import { computed, ref, watch } from "vue";
import { colordToHsvString } from "@/utils/color";
import { useCounterStore } from "@/utils/config";
import { copyColor } from "@/utils/copy";

interface Props {
  flag: "hsl" | "hsv/hsb" | "hex" | "rgb" | "hwb" | "cmyk" | "lab" | "lch" | "xyz";
}

const { flag } = defineProps<Props>();
const config = useCounterStore();
const color = defineModel<Colord>({ required: true });

// 用户正在输入的标志
const inputting = ref(false);

/**
 * 将 Colord 对象转换为输入框显示的值数组
 */
function toInputValue(colorObj: Colord): (string | number)[] {
  switch (flag) {
    case "hsl": {
      const hsl = colorObj.toHsl();
      return [Math.round(hsl.h), Math.round(hsl.s), Math.round(hsl.l)];
    }
    case "hsv/hsb": {
      const hsv = colorObj.toHsv();
      return [Math.round(hsv.h), Math.round(hsv.s), Math.round(hsv.v)];
    }
    case "hex":
      return [colorObj.toHex()];
    case "rgb": {
      const rgb = colorObj.toRgb();
      return [rgb.r, rgb.g, rgb.b];
    }
    case "hwb": {
      const hwb = colorObj.toHwb();
      return [Math.round(hwb.h), Math.round(hwb.w), Math.round(hwb.b)];
    }
    case "cmyk": {
      const cmyk = colorObj.toCmyk();
      return [Math.round(cmyk.c), Math.round(cmyk.m), Math.round(cmyk.y), Math.round(cmyk.k)];
    }
    case "lab": {
      const lab = colorObj.toLab();
      return [Math.round(lab.l), Math.round(lab.a), Math.round(lab.b)];
    }
    case "lch": {
      const lch = colorObj.toLch();
      return [Math.round(lch.l), Math.round(lch.c), Math.round(lch.h)];
    }
    case "xyz": {
      const xyz = colorObj.toXyz();
      return [
        Math.round(xyz.x * 100) / 100,
        Math.round(xyz.y * 100) / 100,
        Math.round(xyz.z * 100) / 100,
      ];
    }
  }
}

/**
 * 将输入框的值数组转换回 Colord 对象
 */
function inputValuesToColor(values: (string | number)[]): Colord | null {
  try {
    switch (flag) {
      case "hsl": {
        const c = colord({
          h: Number(values[0]),
          s: Number(values[1]),
          l: Number(values[2]),
        });
        return c.isValid() ? c : null;
      }
      case "hsv/hsb": {
        const c = colord({
          h: Number(values[0]),
          s: Number(values[1]),
          v: Number(values[2]),
        });
        return c.isValid() ? c : null;
      }
      case "hex": {
        const hexStr = String(values[0]);
        const c = colord(hexStr.startsWith("#") ? hexStr : `#${hexStr}`);
        return c.isValid() ? c : null;
      }
      case "rgb": {
        const c = colord({
          r: Number(values[0]),
          g: Number(values[1]),
          b: Number(values[2]),
        });
        return c.isValid() ? c : null;
      }
      case "hwb": {
        const c = colord({
          h: Number(values[0]),
          w: Number(values[1]),
          b: Number(values[2]),
        });
        return c.isValid() ? c : null;
      }
      case "cmyk": {
        const c = colord({
          c: Number(values[0]),
          m: Number(values[1]),
          y: Number(values[2]),
          k: Number(values[3]),
        });
        return c.isValid() ? c : null;
      }
      case "lab": {
        const c = colord({
          l: Number(values[0]),
          a: Number(values[1]),
          b: Number(values[2]),
        });
        return c.isValid() ? c : null;
      }
      case "lch": {
        const c = colord({
          l: Number(values[0]),
          c: Number(values[1]),
          h: Number(values[2]),
        });
        return c.isValid() ? c : null;
      }
      case "xyz": {
        const c = colord({
          x: Number(values[0]),
          y: Number(values[1]),
          z: Number(values[2]),
        });
        return c.isValid() ? c : null;
      }
    }
  } catch (e) {
    console.error("颜色转换失败:", e);
    return null;
  }
}

// 计算当前应该显示的输入值（基于 color model）
const displayValues = computed(() => toInputValue(color.value));

// 本地编辑状态：用户输入时的临时值
const localValues = ref<(string | number)[]>([...displayValues.value]);

// 当 color 变化且不在输入状态时，同步到本地值
watch(displayValues, updateLocalValues, { deep: true });

function updateLocalValues(newDisplayValues: Array<string | number>) {
  if (!inputting.value) {
    localValues.value = [...newDisplayValues];
  }
}

/**
 * 处理输入框变化
 */
function handleInputChange(index: number, value: string) {
  const newValues = [...localValues.value];
  newValues[index] = value;
  localValues.value = newValues;

  // 尝试转换并更新 color
  const newColor = inputValuesToColor(newValues);
  if (newColor) {
    color.value = newColor;
  }
}

/**
 * 获取用于复制的字符串表示
 */
function getCopyString(): string {
  switch (flag) {
    case "hsl":
      return color.value.toHslString();
    case "hsv/hsb":
      return colordToHsvString(color.value);
    case "hex":
      let hex = color.value.toHex();
      return config.removeHash ? hex.substring(1) : hex;
    case "rgb":
      return color.value.toRgbString();
    case "hwb":
      return color.value.toHwbString();
    case "cmyk":
      return color.value.toCmykString();
    case "lab":
      const lab = color.value.toLab();
      return `lab(${lab.l.toFixed(0)} ${lab.a.toFixed(0)} ${lab.b.toFixed(0)})`;
    case "lch":
      const lch = color.value.toLch();
      return `lch(${lch.l.toFixed(0)} ${lch.c.toFixed(0)} ${lch.h.toFixed(0)})`;
    case "xyz":
      const xyz = color.value.toXyz();
      return `xyz(${xyz.x.toFixed(2)} ${xyz.y.toFixed(2)} ${xyz.z.toFixed(2)})`;
  }
}
function handleBlur() {
  inputting.value = false;
  // 当停止输入后，将本地值更新到合法值
  updateLocalValues(displayValues.value);
}
</script>
<template>
  <div class="flex items-center space-x-2">
    <label class="w-16 text-sm font-medium">{{ flag.toUpperCase() }}</label>
    <input
      v-for="(item, index) in localValues"
      :key="index"
      :value="item"
      @focus="inputting = true"
      @blur="handleBlur"
      @input="(e: any) => handleInputChange(index, e.target.value)"
      class="min-w-[0px] flex-1 rounded border border-gray-300 px-3 py-1 text-center text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
    />
    <button
      @click="copyColor(getCopyString())"
      class="grow-0 p-1 transition-transform duration-200 hover:scale-105"
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
