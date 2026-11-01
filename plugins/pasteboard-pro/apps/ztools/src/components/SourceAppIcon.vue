<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

type SourceApp = Readonly<{ name?: string | undefined; bundleId?: string | undefined }>;
type FallbackKind = "initial" | "application";

const props = withDefaults(defineProps<{
  sourceApp?: SourceApp | undefined;
  fallback: string;
  lazy?: boolean;
  fallbackKind?: FallbackKind;
}>(), { lazy: false, fallbackKind: "initial" });

const iconDataUrl = ref<string>();
const iconElement = ref<HTMLElement | null>(null);
let requestVersion = 0;
let requestedVersion: number | undefined;
let observedVersion: number | undefined;
let visibilityObserver: IntersectionObserver | undefined;

function isBoundedPngDataUrl(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 350_000 &&
    /^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}

function stopObserving(): void {
  visibilityObserver?.disconnect();
  visibilityObserver = undefined;
  observedVersion = undefined;
}

async function loadIcon(version: number, bundleId: string | undefined, name: string | undefined): Promise<void> {
  if (version !== requestVersion || requestedVersion === version) return;
  requestedVersion = version;
  stopObserving();
  const getSourceAppIcon = window.pasteboardPro?.getSourceAppIcon;
  if (getSourceAppIcon === undefined || (bundleId === undefined && name === undefined)) return;

  try {
    const icon = await getSourceAppIcon({
      ...(bundleId === undefined ? {} : { bundleId }),
      ...(name === undefined ? {} : { name }),
    });
    if (version === requestVersion && isBoundedPngDataUrl(icon)) iconDataUrl.value = icon;
  } catch {
    // Older hosts and unavailable apps keep the selected fallback.
  }
}

function scheduleIconLoad(version: number, bundleId: string | undefined, name: string | undefined): void {
  if (version !== requestVersion || requestedVersion === version) return;
  if (!props.lazy || typeof IntersectionObserver === "undefined") {
    void loadIcon(version, bundleId, name);
    return;
  }

  void nextTick(() => {
    if (version !== requestVersion || requestedVersion === version || observedVersion === version) return;
    const target = iconElement.value;
    if (target === null) return;

    observedVersion = version;
    const scrollRoot = target.closest(".blocked-app-select__chips, .blocked-app-select__options");
    visibilityObserver = new IntersectionObserver((entries) => {
      if (version !== requestVersion) return;
      if (entries.some((entry) => entry.isIntersecting)) void loadIcon(version, bundleId, name);
    }, { root: scrollRoot, rootMargin: "32px", threshold: 0 });
    visibilityObserver.observe(target);
  });
}

watch(
  [() => props.sourceApp?.bundleId, () => props.sourceApp?.name, () => props.lazy],
  ([bundleId, name]) => {
    const version = ++requestVersion;
    requestedVersion = undefined;
    iconDataUrl.value = undefined;
    stopObserving();
    if (bundleId === undefined && name === undefined) return;
    scheduleIconLoad(version, bundleId, name);
  },
  { immediate: true },
);

onMounted(() => {
  if (props.lazy) scheduleIconLoad(requestVersion, props.sourceApp?.bundleId, props.sourceApp?.name);
});

onBeforeUnmount(() => {
  requestVersion += 1;
  stopObserving();
});

function onIconError(event: Event): void {
  const failedImage = event.currentTarget;
  if (failedImage instanceof HTMLImageElement && failedImage.getAttribute("src") === iconDataUrl.value) {
    iconDataUrl.value = undefined;
  }
}
</script>

<template>
  <img
    v-if="iconDataUrl"
    ref="iconElement"
    class="modern-card-source__icon"
    :src="iconDataUrl"
    alt=""
    aria-hidden="true"
    draggable="false"
    @error="onIconError"
  />
  <span v-else ref="iconElement" class="modern-card-source__icon" aria-hidden="true">
    <svg
      v-if="fallbackKind === 'application'"
      class="source-app-icon__application-glyph"
      data-icon-fallback="application"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="4.25" y="5.25" width="15.5" height="13.5" rx="2.75" />
      <path d="M4.75 9.5h14.5M8 7.5h.01M10.75 7.5h.01" />
    </svg>
    <template v-else>{{ fallback }}</template>
  </span>
</template>
