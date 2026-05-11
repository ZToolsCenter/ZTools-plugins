<script setup lang="ts">
import ColorCard from "@/components/ColorCard.vue";
import EditingTag from "@/components/EditingTag.vue";
import TagFilterPanel from "@/components/TagFilterPanel.vue";
import { useAllTags, useFavorites, useTagFilter, useTagsEditing } from "@/utils/favorites";
import { useMessage } from "@/utils/message";

const favorites = useFavorites();
const tagFilter = useTagFilter();
const allTags = useAllTags();
const editing = useTagsEditing();
const message = useMessage();

// 添加颜色到收藏
const addToFavorites = (color: string) => {
  try {
    favorites.addFavorite(color);
    message.success("已添加到收藏");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "添加失败");
  }
};

// 移除收藏
const removeFromFavorites = (id: string) => {
  favorites.removeFavorite(id);
  message.success("已取消收藏");
};

// 切换标签选择（筛选）
const toggleTag = (tag: string) => {
  const index = tagFilter.selectedTags.indexOf(tag);
  if (index > -1) {
    tagFilter.selectedTags.splice(index, 1);
  } else {
    tagFilter.selectedTags.push(tag);
  }
};
</script>

<template>
  <div class="rounded-2xl bg-white p-6 shadow-lg">
    <div class="flex gap-6">
      <!-- 左侧 -->
      <div class="w-64 shrink-0">
        <EditingTag v-if="editing.isEditing"></EditingTag>
        <TagFilterPanel
          v-else
          :all-tags="allTags.value"
          :selected-tags="tagFilter.selectedTags"
          :favorites="favorites.value"
          @toggle-tag="toggleTag"
          @clear-tags="tagFilter.clear"
        />
      </div>

      <!-- 右侧收藏列表 -->
      <div class="flex-1 space-y-6">
        <!-- 标题和统计 -->
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-gray-800">我的收藏</h2>
          <span class="text-sm text-gray-500"
            >{{ tagFilter.filteredFavorites.length }} / {{ favorites.value.length }} 个颜色</span
          >
        </div>

        <!-- 收藏列表 -->
        <div v-if="tagFilter.filteredFavorites.length > 0" class="grid grid-cols-3 gap-4">
          <ColorCard
            v-for="favorite in tagFilter.filteredFavorites"
            :key="favorite.id"
            :favorite="favorite"
            @remove="removeFromFavorites"
          />
        </div>

        <!-- 空状态 -->
        <div v-else class="py-12 text-center">
          <div class="mb-4 text-gray-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="mx-auto h-16 w-16"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </div>
          <p class="text-lg text-gray-500">
            {{ tagFilter.selectedTags.length > 0 ? "没有符合筛选条件的颜色" : "暂无收藏的颜色" }}
          </p>
          <p class="mt-2 text-sm text-gray-400">
            {{
              tagFilter.selectedTags.length > 0
                ? "尝试清除筛选条件或添加更多颜色"
                : "在颜色选择器中点击收藏按钮添加"
            }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
