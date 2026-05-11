// src/components/SearchBox.tsx
import React from "react";
import { Input } from "@heroui/input";
import { Icon } from "@iconify/react";

import { useToolboxStore } from "@/store/useToolboxStore";

export const SearchBox: React.FC = () => {
  const { searchQuery, setSearchQuery } = useToolboxStore();

  return (
    <Input
      isClearable
      aria-label="搜索工具"
      classNames={{
        base: "max-w-lg",
        inputWrapper: "shadow-sm",
      }}
      placeholder="搜索工具名称、描述或分类..."
      size="lg"
      startContent={
        <Icon
          className="text-gray-400 dark:text-gray-500 flex-shrink-0 ml-1 transition-transform group-hover:scale-110"
          icon="mingcute:search-line"
          width={22}
        />
      }
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      onClear={() => setSearchQuery("")}
    />
  );
};
