import type { Tool } from "@/store/useToolboxStore.ts";

import React from "react";
import { Card, CardBody, CardFooter } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Icon } from "@iconify/react";
import { useNavigate } from "react-router-dom";

interface ToolCardProps {
  tool: Tool;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const navigate = useNavigate();

  const handleCardClick = () => {
    navigate(tool.path);
  };

  return (
    <Card
      isPressable
      className="w-full h-[200px] cursor-pointer transition-transform duration-300 hover:scale-105 hover:shadow-lg flex flex-col"
      onPress={handleCardClick}
    >
      <CardBody className="overflow-hidden p-4 flex-grow bg-default-100/30">
        <div className="flex items-center gap-4 mb-3">
          <div className="p-3 rounded-full bg-default-100 flex-none">
            <Icon
              className="text-primary"
              height={24}
              icon={tool.icon}
              width={24}
            />
          </div>
          <div className="overflow-hidden">
            <h3 className="text-lg font-semibold truncate">{tool.name}</h3>
            <div className="flex flex-wrap gap-1 mt-1">
              {tool.category.length > 0 &&
                tool.category.map((category: string) => (
                  <Chip
                    key={category}
                    className="max-w-[120px]"
                    color="primary"
                    size="sm"
                    variant="flat"
                  >
                    <span className="truncate">{category}</span>
                  </Chip>
                ))}
            </div>
          </div>
        </div>
        <p className="text-default-500 text-sm line-clamp-3">
          {tool.description}
        </p>
      </CardBody>
      <CardFooter className="bg-default-100/30 border-t-1 border-default-100 justify-end gap-2 flex-none">
        <div className="flex items-center text-primary text-sm">
          <span>进入工具</span>
          <Icon className="ml-1" icon="solar:arrow-right-linear" width={16} />
        </div>
      </CardFooter>
    </Card>
  );
};
