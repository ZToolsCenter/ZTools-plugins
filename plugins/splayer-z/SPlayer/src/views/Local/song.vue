<template>
  <div class="local-songs">
    <SongList
      :data="data"
      :loading="loading"
      :hidden-cover="!settingStore.showLocalCover"
      :list-version="listVersion"
      @removeSong="handleRemoveSong"
    />
  </div>
</template>

<script setup lang="ts">
import type { SongType } from "@/types/main";
import { useSettingStore, useLocalStore } from "@/stores";

const localStore = useLocalStore();
const settingStore = useSettingStore();

defineProps<{
  data: SongType[];
  loading: boolean;
  listVersion?: number;
}>();

// 处理删除歌曲
const handleRemoveSong = (ids: number[]) => {
  // 从本地歌曲列表中删除指定ID的歌曲
  const updatedSongs = localStore.localSongs.filter((song) => !ids.includes(song.id));
  localStore.updateLocalSong(updatedSongs);
};
</script>
