<script setup lang="ts">
import { Maximize2, Minimize2 } from "@lucide/vue";
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";

const props = withDefaults(
  defineProps<{
    expandLabel?: string;
    collapseLabel?: string;
    floatingLabel?: string;
    placeholder?: string;
  }>(),
  {
    expandLabel: "放大",
    collapseLabel: "还原",
    floatingLabel: "悬浮预览",
    placeholder: "已放大显示",
  },
);

const hostRef = shallowRef<HTMLElement | null>(null);
const surfaceRef = shallowRef<HTMLElement | null>(null);

const isTeleported = ref(false);
const isFloating = ref(false);
const isAnimating = ref(false);
const backdropVisible = ref(false);

const surfaceStyle = ref<Record<string, string>>({});

function getTargetFloatingRect() {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const padY = Math.max(12, Math.min(32, Math.round(vh * 0.03)));
  const padX = Math.max(12, Math.min(40, Math.round(vw * 0.03)));

  return {
    top: padY,
    left: padX,
    width: vw - padX * 2,
    height: vh - padY * 2,
  };
}

function expand() {
  if (isTeleported.value || isAnimating.value || !hostRef.value) return;

  const startRect = hostRef.value.getBoundingClientRect();
  const targetRect = getTargetFloatingRect();

  surfaceStyle.value = {
    position: "fixed",
    top: `${startRect.top}px`,
    left: `${startRect.left}px`,
    width: `${startRect.width}px`,
    height: `${startRect.height}px`,
    zIndex: "900",
    transition: "none",
  };

  isTeleported.value = true;
  isAnimating.value = true;
  backdropVisible.value = false;

  void nextTick(() => {
    if (surfaceRef.value) {
      void surfaceRef.value.offsetHeight;
    }

    backdropVisible.value = true;
    isFloating.value = true;

    surfaceStyle.value = {
      position: "fixed",
      top: `${targetRect.top}px`,
      left: `${targetRect.left}px`,
      width: `${targetRect.width}px`,
      height: `${targetRect.height}px`,
      zIndex: "900",
      transition:
        "top 0.28s cubic-bezier(0.16, 1, 0.3, 1), left 0.28s cubic-bezier(0.16, 1, 0.3, 1), width 0.28s cubic-bezier(0.16, 1, 0.3, 1), height 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
    };

    setTimeout(() => {
      if (isFloating.value) {
        surfaceStyle.value = {};
        isAnimating.value = false;
      }
    }, 290);
  });
}

function collapse() {
  if (!isTeleported.value || isAnimating.value || !hostRef.value || !surfaceRef.value) {
    isTeleported.value = false;
    isFloating.value = false;
    surfaceStyle.value = {};
    return;
  }

  const currentRect = surfaceRef.value.getBoundingClientRect();
  const returnRect = hostRef.value.getBoundingClientRect();

  surfaceStyle.value = {
    position: "fixed",
    top: `${currentRect.top}px`,
    left: `${currentRect.left}px`,
    width: `${currentRect.width}px`,
    height: `${currentRect.height}px`,
    zIndex: "900",
    transition: "none",
  };

  isAnimating.value = true;
  isFloating.value = false;

  void nextTick(() => {
    if (surfaceRef.value) {
      void surfaceRef.value.offsetHeight;
    }

    backdropVisible.value = false;

    surfaceStyle.value = {
      position: "fixed",
      top: `${returnRect.top}px`,
      left: `${returnRect.left}px`,
      width: `${returnRect.width}px`,
      height: `${returnRect.height}px`,
      zIndex: "900",
      transition:
        "top 0.28s cubic-bezier(0.16, 1, 0.3, 1), left 0.28s cubic-bezier(0.16, 1, 0.3, 1), width 0.28s cubic-bezier(0.16, 1, 0.3, 1), height 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
    };

    setTimeout(() => {
      isTeleported.value = false;
      isAnimating.value = false;
      surfaceStyle.value = {};
    }, 290);
  });
}

function toggleExpanded() {
  if (isFloating.value) {
    collapse();
  } else {
    expand();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && isTeleported.value) {
    collapse();
  }
}

watch(isTeleported, (teleported) => {
  if (teleported) {
    window.addEventListener("keydown", handleKeydown);
  } else {
    window.removeEventListener("keydown", handleKeydown);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div ref="hostRef" class="floating-zoom" :class="{ 'is-expanded': isTeleported }">
    <div v-if="isTeleported" class="floating-zoom-placeholder">{{ props.placeholder }}</div>

    <Teleport to="body" :disabled="!isTeleported">
      <section
        ref="surfaceRef"
        class="floating-zoom-surface"
        :class="{ 'is-floating': isFloating && !isAnimating, 'is-animating': isAnimating }"
        :style="surfaceStyle"
        :role="isTeleported ? 'dialog' : undefined"
        :aria-modal="isTeleported ? 'true' : undefined"
        :aria-label="isTeleported ? props.floatingLabel : undefined"
      >
        <button
          type="button"
          class="floating-zoom-toggle"
          :title="isFloating ? props.collapseLabel : props.expandLabel"
          :aria-label="isFloating ? props.collapseLabel : props.expandLabel"
          :aria-pressed="isFloating"
          @click.stop="toggleExpanded"
        >
          <Minimize2 v-if="isFloating" aria-hidden="true" :size="14" :stroke-width="1.8" />
          <Maximize2 v-else aria-hidden="true" :size="14" :stroke-width="1.8" />
        </button>

        <slot :expanded="isTeleported" :collapse="collapse" :toggle="toggleExpanded"></slot>
      </section>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="isTeleported"
        class="floating-zoom-backdrop"
        :class="{ 'is-visible': backdropVisible }"
        @click="collapse"
      ></div>
    </Teleport>
  </div>
</template>

<style scoped>
.floating-zoom {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.floating-zoom-placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  place-items: center;
  color: #9ba1a8;
  background: #17191c;
  font-size: 12px;
}

.floating-zoom-surface {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.floating-zoom-surface.is-animating {
  box-sizing: border-box;
  overflow: hidden;
  background: #121315;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 4px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 48%);
}

.floating-zoom-surface.is-floating {
  position: fixed;
  inset: clamp(12px, 3vh, 32px) clamp(12px, 3vw, 40px);
  z-index: 900;
  width: auto;
  height: auto;
  box-sizing: border-box;
  overflow: hidden;
  background: #121315;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 4px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 48%);
}

.floating-zoom-toggle {
  position: absolute;
  top: 4px;
  right: 6px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  padding: 0;
  color: #c3c8cf;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.floating-zoom-toggle:hover {
  color: #ffffff;
  background: #2b2e33;
  border-color: #454950;
}

.floating-zoom-backdrop {
  position: fixed;
  inset: 0;
  z-index: 880;
  background: rgb(0 0 0 / 34%);
  opacity: 0;
  transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: opacity;
}

.floating-zoom-backdrop.is-visible {
  opacity: 1;
}

@media (prefers-color-scheme: light) {
  .floating-zoom-placeholder {
    color: #667085;
    background: #edf1f6;
  }

  .floating-zoom-surface.is-floating,
  .floating-zoom-surface.is-animating {
    background: #ffffff;
    border-color: rgb(15 23 42 / 14%);
    box-shadow: 0 24px 80px rgb(15 23 42 / 22%);
  }

  .floating-zoom-toggle {
    color: #4f5b6a;
    background: transparent;
    border-color: transparent;
  }

  .floating-zoom-toggle:hover {
    color: #111827;
    background: #eef2f7;
    border-color: #cbd5e1;
  }

  .floating-zoom-backdrop {
    background: rgb(15 23 42 / 22%);
  }
}

@media (max-width: 560px) {
  .floating-zoom-surface.is-floating {
    inset: 12px;
    border-radius: 4px;
  }
}
</style>
