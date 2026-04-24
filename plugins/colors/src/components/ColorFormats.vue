<script setup lang="ts">
import { computed } from "vue";
import { colord } from "colord";
import { showError, showSuccess } from "@/utils/notification";
import { copyColor } from "@/utils/copy";

interface Props {
  color: string;
}

const props = defineProps<Props>();

const colorFormats = computed(() => {
  const color = colord(props.color);
  const hsv = color.toHsv();
  const hsl = color.toHsl();

  return {
    hex: color.toHex().toUpperCase().replace("#", ""),
    rgb: color.toRgb(),
    hsv: {
      h: hsv.h.toFixed(2),
      s: `${hsv.s.toFixed(2)}%`,
      v: `${hsv.v.toFixed(2)}%`,
    },
    hsl: {
      h: hsl.h.toFixed(2),
      s: `${hsl.s.toFixed(2)}%`,
      l: `${hsl.l.toFixed(2)}%`,
    },
  };
});
</script>

<template>
  <div class="space-y-3">
    <!-- HEX -->
    <div class="flex items-center space-x-2">
      <label class="w-16 text-sm font-medium text-gray-700">HEX</label>
      <input
        :value="colorFormats.hex"
        class="min-w-[0px] flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        readonly
      />
      <button
        @click="copyColor(`#${colorFormats.hex}`)"
        class="grow-0 p-1 text-gray-500 hover:text-gray-700"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-5 h-5"
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

    <!-- RGB -->
    <div class="flex items-center space-x-2">
      <label class="w-16 text-sm font-medium text-gray-700">RGB</label>
      <input
        :value="`${colorFormats.rgb.r}, ${colorFormats.rgb.g}, ${colorFormats.rgb.b}`"
        class="min-w-[0px] flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        readonly
      />
      <button
        @click="copyColor(`${colorFormats.rgb.r}, ${colorFormats.rgb.g}, ${colorFormats.rgb.b}`)"
        class="grow-0 p-1 text-gray-500 hover:text-gray-700"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-5 h-5"
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

    <!-- HSV/HSB -->
    <div class="flex items-center space-x-2">
      <label class="w-16 text-sm font-medium text-gray-700">HSV/HSB</label>
      <input
        :value="`${colorFormats.hsv.h}, ${colorFormats.hsv.s}, ${colorFormats.hsv.v}`"
        class="grow min-w-[0px] shrink px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        readonly
      />
      <button
        @click="copyColor(`${colorFormats.hsv.h}, ${colorFormats.hsv.s}, ${colorFormats.hsv.v}`)"
        class="p-1 text-gray-500 hover:text-gray-700"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-5 h-5"
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

    <!-- HSL -->
    <div class="flex items-center space-x-2">
      <label class="w-16 text-sm font-medium text-gray-700">HSL</label>
      <input
        :value="`${colorFormats.hsl.h}, ${colorFormats.hsl.s}, ${colorFormats.hsl.l}`"
        class="min-w-[0px] flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        readonly
      />
      <button
        @click="copyColor(`${colorFormats.hsl.h}, ${colorFormats.hsl.s}, ${colorFormats.hsl.l}`)"
        class="p-1 text-gray-500 hover:text-gray-700"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-5 h-5"
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
  </div>
</template>
