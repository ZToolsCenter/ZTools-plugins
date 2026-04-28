<script lang="ts" setup>
import { useMessage } from "../utils/message";

const messageStore = useMessage();

// 获取消息类型对应的样式类名和图标
const getMessageConfig = (type: string) => {
  const configs = {
    info: {
      bgClass: "bg-blue-50 border-blue-200",
      iconClass: "text-blue-500",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    },
    success: {
      bgClass: "bg-green-50 border-green-200",
      iconClass: "text-green-500",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    },
    warning: {
      bgClass: "bg-yellow-50 border-yellow-200",
      iconClass: "text-yellow-500",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`,
    },
    error: {
      bgClass: "bg-red-50 border-red-200",
      iconClass: "text-red-500",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    },
  };
  return configs[type as keyof typeof configs] || configs.info;
};
</script>

<template>
  <div
    v-if="messageStore.messages.length > 0"
    class="pointer-events-none fixed top-8 left-1/2 z-50 flex -translate-x-1/2 transform flex-col items-start justify-start space-y-3"
  >
    <transition-group name="message">
      <div
        v-for="msg in messageStore.messages"
        :key="msg.id"
        :class="[
          'pointer-events-auto flex max-w-[500px] min-w-[300px] items-center rounded-lg border px-4 py-3 shadow-lg transition-all',
          getMessageConfig(msg.type).bgClass,
        ]"
      >
        <!-- 图标 -->
        <div :class="['mr-3 flex-shrink-0', getMessageConfig(msg.type).iconClass]">
          <span v-html="getMessageConfig(msg.type).icon"></span>
        </div>

        <!-- 内容 -->
        <div class="flex-1 text-sm font-medium text-gray-800">{{ msg.content }}</div>

        <!-- 关闭按钮 -->
        <button
          @click="messageStore.removeMessage(msg.id)"
          class="ml-3 flex-shrink-0 rounded-full p-1 hover:bg-gray-200 focus:outline-none"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.message-enter-active,
.message-leave-active {
  transition: all 0.3s ease;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.message-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

.message-move {
  transition: transform 0.3s ease;
}
</style>
