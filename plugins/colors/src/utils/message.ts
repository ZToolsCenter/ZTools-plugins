import { defineStore } from "pinia";
import { ref } from "vue";

export type MessageType = "info" | "error" | "warning" | "success";

export interface MessageItem {
  id: string;
  type: MessageType;
  content: string;
  duration?: number; // 显示时长（毫秒），默认 3000
}

export const useMessage = defineStore("message", () => {
  const messages = ref<MessageItem[]>([]);
  let messageId = 0;

  // 添加消息
  const addMessage = (type: MessageType, content: string, duration = 3000) => {
    const id = `msg_${++messageId}_${Date.now()}`;
    const message: MessageItem = { id, type, content, duration };
    messages.value.push(message);

    // 自动移除消息
    if (duration > 0) {
      setTimeout(() => {
        removeMessage(id);
      }, duration);
    }

    return id;
  };

  // 移除消息
  const removeMessage = (id: string) => {
    const index = messages.value.findIndex((msg) => msg.id === id);
    if (index > -1) {
      messages.value.splice(index, 1);
    }
  };

  // 清除所有消息
  const clearMessages = () => {
    messages.value = [];
  };

  // 便捷方法
  const info = (content: string, duration?: number) => addMessage("info", content, duration);
  const error = (content: string, duration?: number) => addMessage("error", content, duration);
  const warning = (content: string, duration?: number) => addMessage("warning", content, duration);
  const success = (content: string, duration?: number) => addMessage("success", content, duration);

  return {
    messages,
    info,
    error,
    warning,
    success,
    removeMessage,
    clearMessages,
  };
});
