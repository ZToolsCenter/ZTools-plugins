import React from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";

// AI结果标题组件
interface AIResultHeaderProps {
  onClose?: () => void;
}

export const AIResultHeader: React.FC<AIResultHeaderProps> = ({ onClose }) => {
  return (
    <div className="flex justify-between items-center px-3 py-1 bg-gradient-to-r from-blue-50/80 via-indigo-50/80 to-blue-50/80 dark:from-neutral-900/80 dark:via-neutral-800/80 dark:to-neutral-900/80 border-b border-blue-100 dark:border-neutral-800 backdrop-blur-sm">
      <div className="flex items-center space-x-2.5">
        <div className="relative">
          <Icon
            className="text-indigo-600 dark:text-indigo-400"
            icon="hugeicons:ai-chat-02"
            width={20}
          />
        </div>
        <span className="text-sm font-semibold bg-gradient-to-r from-blue-700 to-indigo-700 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
          AI 助手
        </span>
      </div>
      <div className="flex space-x-1">
        {onClose && (
          <Button
            isIconOnly
            className="bg-gray-50 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50 rounded-full"
            size="sm"
            title="关闭AI助手"
            variant="flat"
            onPress={onClose}
          >
            <Icon icon="mdi:close" width={16} />
          </Button>
        )}
      </div>
    </div>
  );
};

export default AIResultHeader;
