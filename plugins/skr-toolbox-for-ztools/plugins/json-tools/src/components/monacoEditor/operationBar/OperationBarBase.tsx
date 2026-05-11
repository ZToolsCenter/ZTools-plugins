import React, { useEffect, useState } from "react";
import {
  Button,
  cn,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Tooltip,
} from "@heroui/react";
import { Icon } from "@iconify/react";

import { DEFAULT_DROPDOWN_TIMEOUT } from "./useDropdownTimeout";

// 定义基础按钮接口
export interface BaseButtonConfig {
  key: string;
  icon: string;
  text: string;
  tooltip: string;
  onClick: () => void;
  iconColor?: string;
  className?: string;
  priority?: number; // 按钮显示优先级，数字越小优先级越高
}

// 定义状态按钮接口
export interface StatusButtonConfig extends BaseButtonConfig {
  isStatusButton: true;
  status: IconStatus;
  successText?: string;
}

// 定义下拉菜单按钮接口
export interface DropdownButtonConfig extends BaseButtonConfig {
  hasDropdown: true;
  dropdownItems: {
    key: string;
    icon: string;
    text: string;
    onClick: () => void;
  }[];
}

// 按钮类型
export type ButtonConfig =
  | BaseButtonConfig
  | StatusButtonConfig
  | DropdownButtonConfig;

// 按钮组接口
export interface ButtonGroup {
  key: string;
  buttons: ButtonConfig[];
}

// 下拉菜单状态枚举
export enum IconStatus {
  Default = "default",
  Success = "success",
  Error = "error",
}

// 常量
export const MORE_BUTTON_WIDTH = 70;
export const SEPARATOR_WIDTH = 20;
export const MIN_PADDING = 12;
export { DEFAULT_DROPDOWN_TIMEOUT };

// 自适应按钮显示计算逻辑
export const useAdaptiveButtons = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  actionGroups: ButtonGroup[],
) => {
  const [visibleButtons, setVisibleButtons] = useState<string[]>([]);
  const [hiddenButtons, setHiddenButtons] = useState<ButtonConfig[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const calculateVisibleButtons = () => {
      if (!containerRef.current) return;

      const width = containerRef.current.clientWidth;

      // 提取所有按钮
      const allButtons = actionGroups.flatMap((group) => group.buttons);
      // 按优先级排序按钮
      const sortedButtons = [...allButtons].sort(
        (a, b) => (a.priority || 999) - (b.priority || 999),
      );

      // 计算可用宽度 (考虑左右边距和两个分隔线)
      let availableWidth = width - 2 * MIN_PADDING - 2 * SEPARATOR_WIDTH;
      const visible: string[] = [];
      const hidden: ButtonConfig[] = [];

      // 第一次遍历，检查是否所有按钮都能显示
      let totalButtonsWidth = 0;

      for (const {} of sortedButtons) {
        totalButtonsWidth += 75; // 默认宽度100
      }

      // 如果所有按钮的总宽度超过可用宽度，则需要"更多"按钮
      if (totalButtonsWidth > availableWidth) {
        availableWidth -= MORE_BUTTON_WIDTH;
      }

      // 第二次遍历，决定哪些按钮可见
      let usedWidth = 0;

      for (const button of sortedButtons) {
        const buttonWidth = 75; // 默认宽度100

        if (usedWidth + buttonWidth <= availableWidth) {
          visible.push(button.key);
          usedWidth += buttonWidth;
        } else {
          hidden.push(button);
        }
      }

      setVisibleButtons(visible);
      setHiddenButtons(hidden);
    };

    // 初始计算
    calculateVisibleButtons();

    // 创建ResizeObserver来监听容器大小变化
    const resizeObserver = new ResizeObserver(calculateVisibleButtons);

    resizeObserver.observe(containerRef.current);

    // 同时监听窗口大小变化作为后备
    window.addEventListener("resize", calculateVisibleButtons);

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
      window.removeEventListener("resize", calculateVisibleButtons);
    };
  }, [actionGroups]);

  return { visibleButtons, hiddenButtons };
};

// 渲染标准按钮
export const renderStandardButton = (button: BaseButtonConfig) => {
  return (
    <Tooltip key={button.key} content={button.tooltip} delay={300}>
      <Button
        className={cn(
          "pl-1.5 pr-1.5 h-7 gap-1 text-default-600 transition-colors text-xs",
          button.className,
          "hover:bg-default-200/50",
        )}
        size="sm"
        startContent={
          <Icon
            className={button.iconColor || ""}
            icon={button.icon}
            width={16}
          />
        }
        variant="light"
        onPress={button.onClick}
      >
        {button.text}
      </Button>
    </Tooltip>
  );
};

// 渲染下拉菜单
export const renderDropdownButton = (
  button: DropdownButtonConfig,
  isDropdownOpen: boolean,
  setDropdownOpen: React.Dispatch<React.SetStateAction<boolean>> | undefined,
  showDropdown?: () => void,
  unShowDropdown?: () => void,
  clearDropdownTimeout?: (key: string) => void,
) => {
  return (
    <Dropdown
      key={button.key}
      classNames={{
        content: "min-w-[140px] p-1",
      }}
      isOpen={isDropdownOpen}
      placement="bottom"
      radius="sm"
      onOpenChange={setDropdownOpen}
    >
      <DropdownTrigger
        onMouseEnter={showDropdown}
        onMouseLeave={unShowDropdown}
      >
        <Button
          className={cn(
            "pl-1.5 pr-1.5 h-7 gap-1 text-default-600 transition-colors text-xs",
            button.className,
            "hover:bg-default-200/50",
          )}
          size="sm"
          startContent={
            <Icon
              className={button.iconColor || ""}
              icon={button.icon}
              width={16}
            />
          }
          variant="light"
        >
          {button.text}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={`${button.text} options`}
        onMouseEnter={() =>
          clearDropdownTimeout && clearDropdownTimeout(button.key)
        }
        onMouseLeave={unShowDropdown}
      >
        {button.dropdownItems.map((item) => (
          <DropdownItem
            key={item.key}
            className="py-2 px-3 hover:bg-default-100 rounded-md"
            textValue={item.text}
            onPress={item.onClick}
          >
            <div className="flex items-center space-x-2">
              <Icon icon={item.icon} width={16} />
              <span>{item.text}</span>
            </div>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
};

// 渲染更多菜单
export const renderMoreMenu = (
  hiddenButtons: ButtonConfig[],
  isMoreDropdownOpen: boolean,
  setMoreDropdownOpen:
    | React.Dispatch<React.SetStateAction<boolean>>
    | undefined,
  showMoreDropdown?: () => void,
  unShowMoreDropdown?: () => void,
  clearMoreDropdownTimeout?: () => void,
) => {
  // 如果没有隐藏的按钮，不显示更多菜单
  if (hiddenButtons.length === 0) return null;

  return (
    <Dropdown
      classNames={{
        base: "before:bg-default-200",
        content: "min-w-[140px] p-1",
      }}
      isOpen={isMoreDropdownOpen}
      placement="bottom"
      radius="sm"
      onOpenChange={setMoreDropdownOpen}
    >
      <DropdownTrigger
        onMouseEnter={showMoreDropdown}
        onMouseLeave={unShowMoreDropdown}
      >
        <Button
          className="pl-1.5 pr-1.5 h-7 gap-1 text-default-600 !min-w-14 hover:bg-default-200/50 transition-colors text-xs"
          startContent={<Icon icon="mingcute:more-2-fill" width={16} />}
          variant="light"
        >
          更多
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="更多操作"
        onMouseEnter={() =>
          clearMoreDropdownTimeout && clearMoreDropdownTimeout()
        }
        onMouseLeave={unShowMoreDropdown}
      >
        {hiddenButtons.flatMap((button) => {
          if ("hasDropdown" in button && button.hasDropdown) {
            // 处理带下拉的按钮，返回所有下拉项目的数组
            return button.dropdownItems.map((item) => (
              <DropdownItem
                key={`${button.key}-${item.key}`}
                className="py-2 px-3 hover:bg-default-100 rounded-md"
                textValue={`${button.text} - ${item.text}`}
                onPress={item.onClick}
              >
                <div className="flex items-center space-x-2">
                  <Icon icon={item.icon} width={16} />
                  <span>{`${button.text} - ${item.text}`}</span>
                </div>
              </DropdownItem>
            ));
          } else {
            // 处理普通按钮，返回单个按钮的数组
            return [
              <DropdownItem
                key={button.key}
                className="py-2 px-3 hover:bg-default-100 rounded-md"
                textValue={"text" in button ? button.text : ""}
                onPress={button.onClick}
              >
                <div className="flex items-center space-x-2">
                  <Icon icon={"icon" in button ? button.icon : ""} width={16} />
                  <span>{"text" in button ? button.text : ""}</span>
                </div>
              </DropdownItem>,
            ];
          }
        })}
      </DropdownMenu>
    </Dropdown>
  );
};
