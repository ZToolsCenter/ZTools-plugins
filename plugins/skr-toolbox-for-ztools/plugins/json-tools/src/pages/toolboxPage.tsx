// src/pages/ToolboxPage.tsx
import React, { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { motion } from "framer-motion";
import { Chip } from "@heroui/chip";
import { Button } from "@heroui/button";

import { SearchBox } from "@/components/toolbox/SearchBox.tsx";
import { ToolCard } from "@/components/toolbox/ToolCard.tsx";
import { useToolboxStore } from "@/store/useToolboxStore";

const ToolboxPage: React.FC = () => {
  const { filteredTools } = useToolboxStore();
  const [mounted, setMounted] = useState(false);
  const tools = filteredTools();

  const toolboxStore = useToolboxStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  // 获取所有唯一分类
  const categories = Array.from(
    new Set(tools.flatMap((tool) => tool.category || []).filter(Boolean)),
  );

  // 容器动画变体
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  // 卡片动画变体
  const cardVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: "spring",
        stiffness: 260,
        damping: 20,
      },
    },
  };

  // 空结果状态
  const NoResults = () => (
    <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
      <Icon
        className="text-default-300 mb-4"
        icon="solar:empty-file-outline"
        width={64}
      />
      <h3 className="text-xl font-semibold">没有找到匹配的工具</h3>
      <p className="text-default-500 mt-2 max-w-md">
        尝试使用不同的关键词或浏览下方的所有工具分类
      </p>
    </div>
  );

  return (
    <div className="bg-default-50 w-full h-full">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center">
              <Icon
                className="mr-3 text-primary"
                icon="solar:toolbox-bold"
                width={32}
              />
              工具箱
            </h1>
            <p className="text-default-500">
              发现并使用我们精心设计的各种实用工具
            </p>
          </div>
          <SearchBox />
        </div>

        {/* 分类筛选器 */}
        {categories.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <span className="text-default-500 flex items-center mr-2">
              <Icon className="mr-1" icon="solar:tag-outline" width={16} />
              分类:
            </span>
            {categories.map((category) => (
              <Chip
                key={category}
                className="cursor-pointer"
                color="primary"
                variant="flat"
                onClick={() => toolboxStore.setSearchQuery(category as string)}
              >
                {category}
              </Chip>
            ))}
            {toolboxStore.searchQuery && (
              <Button
                size="sm"
                variant="light"
                onPress={() => toolboxStore.setSearchQuery("")}
              >
                清除筛选
              </Button>
            )}
          </div>
        )}

        {/* 工具卡片网格 */}
        {tools.length > 0 ? (
          <motion.div
            animate={mounted ? "visible" : "hidden"}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            initial="hidden"
            variants={containerVariants}
          >
            {tools.map((tool) => (
              <motion.div key={tool.id} variants={cardVariants}>
                <div>
                  <ToolCard tool={tool} />
                </div>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <NoResults />
        )}
      </div>
    </div>
  );
};

export default ToolboxPage;
