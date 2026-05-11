import React from "react";
import { Button, ButtonGroup } from "@heroui/react";
import { Icon } from "@iconify/react";

interface JsonPathBarProps {
  currentPath: string;
  onExpand: () => void;
  onCollapse: () => void;
}

const JsonPathBar: React.FC<JsonPathBarProps> = ({
  currentPath,
  onExpand,
  onCollapse,
}) => {
  return (
    <div className="h-8 flex items-center justify-between px-2 bg-default-50 border-b border-default-200">
      {/* 当前JSON路径 */}
      <div className="flex items-center space-x-1 text-sm text-default-600">
        <Icon icon="solar:folder-path-duotone" width={16} />
        <span>{currentPath}</span>
      </div>

      {/* 展开/折叠按钮组 */}
      <ButtonGroup size="sm" variant="light">
        <Button
          className="text-sm text-default-600"
          startContent={<Icon icon="tabler:fold-down" width={16} />}
          onPress={onExpand}
        >
          展开所有
        </Button>
        <Button
          className="text-sm text-default-600"
          startContent={<Icon icon="tabler:fold-up" width={16} />}
          onPress={onCollapse}
        >
          折叠所有
        </Button>
      </ButtonGroup>
    </div>
  );
};

export default JsonPathBar;
