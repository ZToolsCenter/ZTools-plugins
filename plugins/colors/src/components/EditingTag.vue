<script lang="ts" setup>
import { colord } from "colord";
import { computed, ref, watch } from "vue";
import { useTagsEditing, useAllTags, useFavorites } from "../utils/favorites";

const editing = useTagsEditing();
const allTag = useAllTags();

const newTag = ref("");
const isAddEditing = ref(false);
const toggleTag = (tag: string) => {
  editing.toggleTag(tag);
};
const addTag = () => {
  editing.addTag(newTag.value);
  isAddEditing.value = false;
  newTag.value = "";
};
const isLight = computed(() => (editing.color && colord(editing.color).isLight()) ?? false);
</script>

<template>
  <div
    v-if="editing.editingTags && editing.color"
    class="sticky top-6 rounded-xl border border-gray-100 bg-white p-6 shadow-lg"
  >
    <!-- Header Section -->
    <div
      @click="editing.back()"
      :style="{ backgroundColor: editing.color }"
      class="mb-6 flex items-center justify-between rounded-lg px-4 py-3"
    >
      <div>
        <h3
          :class="['text-lg font-semibold  drop-shadow-md', isLight ? 'text-black' : 'text-white']"
        >
          编辑标签
        </h3>
        <p :class="['text-sm', isLight ? 'text-black' : 'text-white']">
          {{ editing.color }}
        </p>
      </div>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M19 12H5M5 12L9 8M5 12L9 16"
          :stroke="isLight ? 'black' : 'white'"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <!-- Tags List -->
    <div v-if="allTag.value.length > 0" class="mb-6 space-y-3">
      <button
        v-for="tag in allTag.value"
        :key="tag"
        @click="toggleTag(tag)"
        :class="[
          'flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm transition-all duration-200',
          editing.editingTags.includes(tag)
            ? 'scale-[1.02] transform bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
            : 'text-gray-700 outline-1 outline-gray-200 hover:bg-gray-50 hover:shadow-sm',
        ]"
      >
        <span class="font-medium">{{ tag }}</span>

        <svg
          v-if="editing.editingTags.includes(tag)"
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          />
        </svg>
      </button>
    </div>

    <!-- Empty State -->
    <div v-else class="py-10 text-center text-gray-500">
      <div class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
      </div>
      <p class="text-base font-medium">暂无标签</p>
      <p class="mt-2 text-sm text-gray-400">为颜色添加标签后将显示在这里</p>
    </div>

    <!-- Add Tag Section -->
    <div class="border-t border-gray-100 pt-4">
      <div v-if="!isAddEditing" class="flex justify-center">
        <button
          @click="isAddEditing = true"
          class="centered inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-white shadow-sm transition-colors duration-200 hover:bg-blue-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          添加新标签
        </button>
      </div>
      <div v-else class="flex flex-col gap-3">
        <input
          v-model="newTag"
          type="text"
          placeholder="输入标签名称..."
          @keyup.enter="addTag"
          @keyup.escape="isAddEditing = false"
          class="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
          autofocus
        />
        <div class="flex justify-around">
          <button
            @click="addTag"
            class="tshrink growion-colors rounded-lg bg-green-500 px-4 py-2 text-white shadow-sm duration-200 hover:bg-green-600"
            :disabled="!newTag.trim()"
            :class="{ 'cursor-not-allowed opacity-50': !newTag.trim() }"
          >
            确认
          </button>
          <button
            @click="isAddEditing = false"
            class="rounded-lg bg-gray-200 px-4 py-2 text-gray-700 transition-colors duration-200 hover:bg-gray-300"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
