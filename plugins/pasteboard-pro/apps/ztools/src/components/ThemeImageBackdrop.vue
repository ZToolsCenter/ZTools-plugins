<script setup lang="ts">
import { computed } from "vue";
import {
  isThemeImageDataUrl,
  type ThemeBackground,
  type ThemeImageLayout,
} from "../../preload/window-theme-preferences";

const props = defineProps<{ background: ThemeBackground }>();
const imageBackground = computed(() => {
  const background = props.background;
  if (background.type !== "image" || !isThemeImageDataUrl(background.imageDataUrl)) {
    return undefined;
  }
  return background;
});
const imageLayout = computed<ThemeImageLayout>(() => {
  const layout = imageBackground.value?.layout;
  return layout === "contain" || layout === "tile" || layout === "repeat-x"
    ? layout
    : "cover";
});
const tilesPerRow = computed(() => {
  const value = imageBackground.value?.tilesPerRow;
  if (typeof value !== "number" || !Number.isInteger(value)) return 3;
  return Math.max(1, Math.min(12, value));
});
const repeatCells = computed(() =>
  imageLayout.value === "repeat-x"
    ? Array.from({ length: tilesPerRow.value }, (_, index) => index)
    : [],
);
const isFrosted = computed(() => imageBackground.value?.frosted === true);
const backdropClass = computed(() => ({
  "shelf__image-backdrop--frosted": isFrosted.value,
}));
const imageClass = computed(() => ({
  "shelf__image-backdrop--cover": imageLayout.value === "cover",
  "shelf__image-backdrop--contain": imageLayout.value === "contain",
  "shelf__image-backdrop--tile": imageLayout.value === "tile",
  "shelf__image-backdrop--repeat-x": imageLayout.value === "repeat-x",
  "shelf__image-backdrop-photo--frosted": isFrosted.value,
}));
const imageStyle = computed(() => {
  const background = imageBackground.value;
  if (background === undefined) return undefined;
  const style = {
    backgroundImage: `url("${background.imageDataUrl}")`,
    backgroundPosition: imageLayout.value === "tile" ? "top left" : "center",
    backgroundRepeat: imageLayout.value === "tile" ? "repeat" : "no-repeat",
    backgroundSize: "cover",
  };
  if (imageLayout.value === "contain") style.backgroundSize = "contain";
  if (imageLayout.value === "tile") {
    style.backgroundSize = `${100 / tilesPerRow.value}% auto`;
  }
  return style;
});
const repeatContainerStyle = computed(() => ({
  "--pb-image-repeat-count": String(tilesPerRow.value),
}));
</script>

<template>
  <div
    v-if="imageBackground !== undefined"
    class="shelf__image-backdrop"
    :class="backdropClass"
    aria-hidden="true"
    role="presentation"
  >
    <div
      v-if="imageLayout === 'repeat-x'"
      class="shelf__image-backdrop-photo shelf__image-backdrop--repeat-x"
      :class="imageClass"
      :data-pb-image-layout="imageLayout"
      data-pb-image-backdrop
      :style="repeatContainerStyle"
    >
      <div
        v-for="cell in repeatCells"
        :key="cell"
        class="shelf__image-backdrop-photo shelf__image-backdrop-photo--repeat-cell"
        data-pb-image-repeat-cell
        :style="imageStyle"
        aria-hidden="true"
        role="presentation"
      />
    </div>
    <div
      v-else
      class="shelf__image-backdrop-photo"
      :class="imageClass"
      :data-pb-image-layout="imageLayout"
      data-pb-image-backdrop
      :style="imageStyle"
    />
  </div>
</template>

<style scoped>
.shelf__image-backdrop {
  position: absolute;
  z-index: -1;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background-color: var(--pb-theme-background-color, #24212d);
}

.shelf__image-backdrop::after {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
  content: "";
}

.shelf__image-backdrop-photo {
  position: absolute;
  z-index: 0;
  inset: 0;
  pointer-events: none;
}

.shelf__image-backdrop--repeat-x {
  display: grid;
  grid-template-columns: repeat(var(--pb-image-repeat-count), minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
}

.shelf__image-backdrop-photo--repeat-cell {
  position: relative;
  min-width: 0;
  height: 100%;
}

.shelf__image-backdrop-photo--frosted {
  filter: blur(22px) saturate(0.82);
}

.shelf__image-backdrop--frosted::after {
  background: color-mix(in srgb, var(--pb-theme-background-color, #24212d) 64%, transparent);
}
</style>
