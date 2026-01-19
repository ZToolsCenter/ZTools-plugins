<template>
  <n-flex :class="['menu', { show: statusStore.playerMetaShow }]" justify="center" vertical>
    <div class="menu-icon" @click="openCopyLyrics">
      <SvgIcon name="Copy" />
    </div>
    <div class="divider" />
    <div class="menu-icon" @click="changeOffset(-settingStore.lyricOffsetStep)">
      <SvgIcon name="Replay5" />
    </div>
    <n-popover class="player" trigger="click" placement="left" style="padding: 8px">
      <template #trigger>
        <span class="time">
          {{ currentTimeOffsetValue }}
        </span>
      </template>
      <n-flex class="offset-menu" :size="4" vertical>
        <span class="title"> 歌词偏移 </span>
        <span class="tip"> 正值为歌词提前，单位毫秒 </span>
        <n-input-number
          v-model:value="offsetMilliseconds"
          class="offset-input"
          :precision="0"
          :step="100"
          placeholder="0"
          size="small"
        >
          <template #suffix>ms</template>
        </n-input-number>
        <n-button
          class="player"
          size="small"
          secondary
          strong
          @click="resetOffset"
          :disabled="offsetMilliseconds == 0"
        >
          清零
        </n-button>
      </n-flex>
    </n-popover>
    <div class="menu-icon" @click="changeOffset(settingStore.lyricOffsetStep)">
      <SvgIcon name="Forward5" />
    </div>
    <div class="divider" />
    <div class="menu-icon" @click="openSetting('lyrics')">
      <SvgIcon name="Settings" />
    </div>
  </n-flex>
</template>

<script setup lang="ts">
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { openCopyLyrics, openSetting } from "@/utils/modal";

const musicStore = useMusicStore();
const settingStore = useSettingStore();
const statusStore = useStatusStore();

/**
 * 当前歌曲 id
 */
const currentSongId = computed(() => musicStore.playSong?.id as number | undefined);

/**
 * 当前进度偏移值
 */
const currentTimeOffsetValue = computed(() => {
  const currentTimeOffset = statusStore.getSongOffset(currentSongId.value);
  if (currentTimeOffset === 0) return "0";
  // 将毫秒转换为秒显示
  const offsetSeconds = parseFloat((currentTimeOffset / 1000).toFixed(2));
  return currentTimeOffset > 0 ? `+${offsetSeconds}` : `${offsetSeconds}`;
});

const offsetMilliseconds = computed({
  get: () => {
    return statusStore.getSongOffset(currentSongId.value);
  },
  set: (val: number | null) => {
    statusStore.setSongOffset(currentSongId.value, val || 0);
  },
});

/**
 * 改变进度偏移
 * @param delta 偏移量（单位：毫秒）
 */
const changeOffset = (delta: number) => {
  statusStore.incSongOffset(currentSongId.value, delta);
};

/**
 * 重置进度偏移
 */
const resetOffset = () => {
  statusStore.resetSongOffset(currentSongId.value);
};
</script>

<style lang="scss" scoped>
.menu {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  transform: scale(0.9);
  height: 100%;
  width: 80px;
  padding: 20% 0;
  opacity: 0;
  transform: scale(0.9);
  transition: opacity 0.3s;
  .divider {
    height: 2px;
    width: 40px;
    background-color: rgba(var(--main-cover-color), 0.12);
  }
  .time {
    width: 40px;
    margin: 8px 0;
    padding: 4px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    background-color: rgba(var(--main-cover-color), 0.14);
    backdrop-filter: blur(10px);
    border-radius: 8px;
    border: 1px solid rgba(var(--main-cover-color), 0.12);
    transition: background-color 0.3s;
    cursor: pointer;
    &::after {
      content: "s";
      margin-left: 2px;
    }
    &:hover {
      background-color: rgba(var(--main-cover-color), 0.28);
    }
  }
  .menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 8px;
    transition:
      background-color 0.3s,
      transform 0.3s;
    cursor: pointer;
    .n-icon {
      font-size: 30px;
      color: rgb(var(--main-cover-color));
    }
    &:hover {
      transform: scale(1.1);
      background-color: rgba(var(--main-cover-color), 0.14);
    }
    &:active {
      transform: scale(1);
    }
  }
}

.offset-menu {
  width: 180px;
  .title {
    font-size: 14px;
    line-height: normal;
  }
  .tip {
    font-size: 12px;
    opacity: 0.6;
  }
  :deep(.n-input) {
    --n-caret-color: rgb(var(--main-cover-color));
    --n-color: rgba(var(--main-cover-color), 0.1);
    --n-color-focus: rgba(var(--main-cover-color), 0.1);
    --n-text-color: rgb(var(--main-cover-color));
    --n-border-hover: 1px solid rgba(var(--main-cover-color), 0.28);
    --n-border-focus: 1px solid rgba(var(--main-cover-color), 0.28);
    --n-suffix-text-color: rgb(var(--main-cover-color));
    --n-box-shadow-focus: 0 0 8px 0 rgba(var(--main-cover-color), 0.3);
    // 文本选中颜色
    input {
      &::selection {
        background-color: rgba(var(--main-cover-color));
      }
    }
    .n-button {
      --n-text-color: rgb(var(--main-cover-color));
    }
  }
}
.lyric,
.lyric-am {
  &:hover {
    .menu {
      &.show {
        opacity: 0.6;
      }
    }
  }
}
</style>
