import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  Button,
  ButtonGroup,
  cn,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Tooltip,
} from "@heroui/react";
import { Icon } from "@iconify/react";

import StatusButton, { IconStatus } from "@/components/button/StatusButton.tsx";
import toast from "@/utils/toast";
import { stringifyJson } from "@/utils/json";

interface JsonTableOperationBarProps {
  onCopy: (type?: "default" | "node" | "path") => boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onCustomView: (key: "hideEmpty" | "hideNull" | "showAll") => void;
  onClear?: () => boolean;
  ref?: React.Ref<JsonTableOperationBarRef>;
}

export interface JsonTableOperationBarRef {}

// 定义按钮接口
interface BaseButtonConfig {
  key: string;
  icon: string;
  text: string;
  tooltip: string;
  onClick: () => void;
  iconColor?: string;
  className?: string;
  priority?: number; // 按钮显示优先级，数字越小优先级越高
  width?: number; // 按钮的预估宽度，用于自适应计算
}

interface StatusButtonConfig extends BaseButtonConfig {
  isStatusButton: true;
  status: IconStatus;
  successText?: string;
}

interface DropdownButtonConfig extends BaseButtonConfig {
  hasDropdown: true;
  dropdownItems: {
    key: string;
    icon: string;
    text: string;
    onClick: () => void;
  }[];
}

type ButtonConfig =
  | BaseButtonConfig
  | StatusButtonConfig
  | DropdownButtonConfig;

interface ButtonGroup {
  key: string;
  buttons: ButtonConfig[];
}

const JsonTableOperationBar: React.FC<JsonTableOperationBarProps> = ({
  onCopy,
  onExpand,
  onCollapse,
  onCustomView,
  onClear,
}) => {
  const [isViewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<IconStatus>(IconStatus.Default);
  const [clearStatus, setClearStatus] = useState<IconStatus>(
    IconStatus.Default,
  );

  // 容器参考和宽度状态
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleButtons, setVisibleButtons] = useState<string[]>([]);
  const [hiddenButtons, setHiddenButtons] = useState<ButtonConfig[]>([]);

  // 新增：使用ref来保存当前的visibleButtons和hiddenButtons状态，避免依赖循环
  const visibleButtonsRef = useRef<string[]>([]);
  const hiddenButtonsRef = useRef<ButtonConfig[]>([]);

  // 每次visibleButtons或hiddenButtons更新时，同步到ref
  useEffect(() => {
    visibleButtonsRef.current = visibleButtons;
    hiddenButtonsRef.current = hiddenButtons;
  }, [visibleButtons, hiddenButtons]);

  // 防止下拉菜单打开时，鼠标移开后立即关闭
  var viewDropdownOpenTimeoutRef: NodeJS.Timeout;
  var moreDropdownOpenTimeoutRef: NodeJS.Timeout;

  const dropdownTimeout = 300;

  // 视图选项下拉菜单
  const showViewDropdown = () => {
    if (viewDropdownOpenTimeoutRef) {
      clearTimeout(viewDropdownOpenTimeoutRef);
    }
    setViewDropdownOpen(true);
  };
  const unShowViewDropdown = () => {
    if (viewDropdownOpenTimeoutRef) {
      clearTimeout(viewDropdownOpenTimeoutRef);
    }
    viewDropdownOpenTimeoutRef = setTimeout(() => {
      setViewDropdownOpen(false);
    }, dropdownTimeout);
  };

  // 更多下拉菜单
  const [isMoreDropdownOpen, setMoreDropdownOpen] = useState(false);
  const showMoreDropdown = () => {
    if (moreDropdownOpenTimeoutRef) {
      clearTimeout(moreDropdownOpenTimeoutRef);
    }
    setMoreDropdownOpen(true);
  };
  const unShowMoreDropdown = () => {
    if (moreDropdownOpenTimeoutRef) {
      clearTimeout(moreDropdownOpenTimeoutRef);
    }
    moreDropdownOpenTimeoutRef = setTimeout(() => {
      setMoreDropdownOpen(false);
    }, dropdownTimeout);
  };

  // 使用useMemo记忆按钮组配置，防止每次渲染时重新创建
  const actionGroups = useMemo(() => {
    const groups: ButtonGroup[] = [
      {
        key: "copy",
        buttons: [
          {
            key: "copy",
            isStatusButton: true,
            icon: "si:copy-line",
            text: "复制",
            tooltip: "复制内容到剪贴板",
            status: copyStatus,
            successText: "已复制",
            priority: 10,
            width: 90,
            onClick: () => {
              setTimeout(() => {
                setCopyStatus(IconStatus.Default);
              }, 1000);
              setCopyStatus(onCopy() ? IconStatus.Success : IconStatus.Error);
            },
          },
        ],
      },
      {
        key: "view",
        buttons: [
          {
            key: "view",
            icon: "solar:eye-outline",
            text: "视图",
            tooltip: "设置视图选项",
            hasDropdown: true,
            priority: 20,
            width: 90,
            onClick: showViewDropdown,
            dropdownItems: [
              {
                key: "hideEmpty",
                icon: "solar:eye-closed-outline",
                text: "隐藏空值",
                onClick: () => {
                  onCustomView("hideEmpty");
                  toast.success("已隐藏空值");
                  setViewDropdownOpen(false);
                },
              },
              {
                key: "hideNull",
                icon: "solar:eye-closed-outline",
                text: "隐藏null值",
                onClick: () => {
                  onCustomView("hideNull");
                  toast.success("已隐藏null值");
                  setViewDropdownOpen(false);
                },
              },
              {
                key: "showAll",
                icon: "solar:eye-outline",
                text: "显示所有值",
                onClick: () => {
                  onCustomView("showAll");
                  toast.success("显示所有值");
                  setViewDropdownOpen(false);
                },
              },
            ],
          },
        ],
      },
      {
        key: "expand",
        buttons: [
          {
            key: "expand",
            icon: "tabler:fold-down",
            text: "展开",
            tooltip: "展开所有节点",
            priority: 30,
            width: 90,
            onClick: onExpand,
          },
          {
            key: "collapse",
            icon: "tabler:fold-up",
            text: "折叠",
            tooltip: "折叠所有节点",
            priority: 40,
            width: 90,
            onClick: onCollapse,
          },
        ],
      },
    ];

    // 添加清空按钮（如果提供了）
    if (onClear) {
      groups.push({
        key: "clear",
        buttons: [
          {
            key: "clear",
            isStatusButton: true,
            icon: "mynaui:trash",
            text: "清空",
            tooltip: "清空内容",
            status: clearStatus,
            successText: "已清空",
            priority: 50,
            width: 90,
            onClick: () => {
              setTimeout(() => {
                setClearStatus(IconStatus.Default);
              }, 1000);
              setClearStatus(onClear() ? IconStatus.Success : IconStatus.Error);
            },
          },
        ],
      });
    }

    return groups;
  }, [
    copyStatus,
    clearStatus,
    onCopy,
    onExpand,
    onCollapse,
    onCustomView,
    onClear,
    showViewDropdown,
  ]);

  // 更多按钮本身的宽度
  const MORE_BUTTON_WIDTH = 90;
  // 分隔线宽度
  const SEPARATOR_WIDTH = 25;
  // 最小左右间距
  const MIN_PADDING = 16;

  // 使用useCallback记忆calculateVisibleButtons函数，并移除对visibleButtons和hiddenButtons的依赖
  const calculateVisibleButtons = useCallback(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;

    // 提取所有按钮
    const allButtons = actionGroups.flatMap((group) => group.buttons);
    // 按优先级排序按钮
    const sortedButtons = [...allButtons].sort(
      (a, b) => (a.priority || 999) - (b.priority || 999),
    );

    // 计算可用宽度 (考虑左右边距和分隔线)
    let availableWidth =
      width - 2 * MIN_PADDING - (actionGroups.length - 1) * SEPARATOR_WIDTH;
    const visible: string[] = [];
    const hidden: ButtonConfig[] = [];

    // 第一次遍历，检查是否所有按钮都能显示
    let totalButtonsWidth = 0;

    for (const button of sortedButtons) {
      totalButtonsWidth += button.width || 100; // 默认宽度100
    }

    // 如果所有按钮的总宽度超过可用宽度，则需要"更多"按钮
    if (totalButtonsWidth > availableWidth) {
      availableWidth -= MORE_BUTTON_WIDTH;
    }

    // 第二次遍历，决定哪些按钮可见
    let usedWidth = 0;

    for (const button of sortedButtons) {
      const buttonWidth = button.width || 100; // 默认宽度100

      if (usedWidth + buttonWidth <= availableWidth) {
        visible.push(button.key);
        usedWidth += buttonWidth;
      } else {
        hidden.push(button);
      }
    }

    // 只有在数据真正发生变化时才更新状态 - 使用ref替代直接依赖
    const visibleKeysString = stringifyJson(visible.sort());
    const currentKeysString = stringifyJson(
      [...visibleButtonsRef.current].sort(),
    );

    if (
      visibleKeysString !== currentKeysString ||
      hiddenButtonsRef.current.length !== hidden.length
    ) {
      setVisibleButtons(visible);
      setHiddenButtons(hidden);
    }
  }, [actionGroups]);

  // 监听容器宽度变化，并计算哪些按钮可见
  useEffect(() => {
    if (!containerRef.current) return;

    // 初始计算
    calculateVisibleButtons();

    // 创建ResizeObserver来监听容器大小变化
    const resizeObserver = new ResizeObserver(() => {
      // 使用RAF来减少频繁更新
      requestAnimationFrame(calculateVisibleButtons);
    });

    resizeObserver.observe(containerRef.current);

    // 同时监听窗口大小变化作为后备
    const handleResize = () => {
      requestAnimationFrame(calculateVisibleButtons);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, [calculateVisibleButtons]);

  // 渲染按钮
  const renderButton = (button: ButtonConfig) => {
    // 检查按钮是否应该可见
    if (!visibleButtons.includes(button.key)) return null;

    // 状态按钮
    if ("isStatusButton" in button && button.isStatusButton) {
      return (
        <StatusButton
          icon={button.icon}
          status={button.status}
          successText={button.successText}
          text={button.text}
          onClick={button.onClick}
        />
      );
    }

    // 带下拉菜单的按钮
    if ("hasDropdown" in button && button.hasDropdown) {
      const isDropdownOpen = button.key === "view" ? isViewDropdownOpen : false;
      const setDropdownOpen =
        button.key === "view" ? setViewDropdownOpen : undefined;

      const showDropdown = button.key === "view" ? showViewDropdown : undefined;
      const unShowDropdown =
        button.key === "view" ? unShowViewDropdown : undefined;

      return (
        <Dropdown
          key={button.key}
          classNames={{
            base: "before:bg-default-200",
            content: "min-w-[140px] p-1",
          }}
          isOpen={isDropdownOpen}
          radius="sm"
          onOpenChange={setDropdownOpen}
        >
          <Tooltip content={button.tooltip} delay={300}>
            <DropdownTrigger
              onMouseEnter={showDropdown}
              onMouseLeave={unShowDropdown}
            >
              <Button
                className={cn(
                  "pl-2 pr-2 h-8 gap-1 text-default-600 transition-colors",
                  button.className,
                  "hover:bg-default-200/50",
                )}
                size="sm"
                startContent={
                  <Icon
                    className={button.iconColor || ""}
                    icon={button.icon}
                    width={18}
                  />
                }
                variant="light"
              >
                {button.text}
              </Button>
            </DropdownTrigger>
          </Tooltip>
          <DropdownMenu
            aria-label={`${button.text} options`}
            onMouseEnter={showDropdown}
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
    }

    // 普通按钮
    return (
      <Tooltip key={button.key} content={button.tooltip} delay={300}>
        <Button
          className={cn(
            "pl-2 pr-2 h-8 gap-1 text-default-600 transition-colors",
            button.className,
            "hover:bg-default-200/50",
          )}
          size="sm"
          startContent={
            <Icon
              className={button.iconColor || ""}
              icon={button.icon}
              width={18}
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

  // 更多菜单渲染
  const renderMoreMenu = () => {
    // 如果没有隐藏的按钮，不显示更多菜单
    if (hiddenButtons.length === 0) return null;

    return (
      <Dropdown
        classNames={{
          base: "before:bg-default-200",
          content: "min-w-[140px] p-1",
        }}
        isOpen={isMoreDropdownOpen}
        radius="sm"
      >
        <Tooltip content="更多操作" delay={300}>
          <DropdownTrigger
            onMouseEnter={showMoreDropdown}
            onMouseLeave={unShowMoreDropdown}
          >
            <Button
              className="pl-2 pr-2 h-8 gap-1 text-default-600 !min-w-16 hover:bg-default-200/50 transition-colors"
              startContent={<Icon icon="mingcute:more-2-fill" width={20} />}
              variant="light"
            >
              更多
            </Button>
          </DropdownTrigger>
        </Tooltip>
        <DropdownMenu
          aria-label="更多操作"
          onMouseEnter={showMoreDropdown}
          onMouseLeave={unShowMoreDropdown}
        >
          {hiddenButtons.map((item) => (
            <DropdownItem
              key={item.key}
              className="py-2 px-3 hover:bg-default-100 rounded-md"
              textValue={item.text}
              onPress={item.onClick}
            >
              <div className="flex items-center space-x-2">
                <Icon
                  icon={"isStatusButton" in item ? item.icon : item.icon}
                  width={16}
                />
                <span>{"text" in item ? item.text : ""}</span>
              </div>
            </DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>
    );
  };

  return (
    <div
      ref={containerRef}
      className="h-10 flex items-center gap-1 px-1 bg-default-100 shadow-sm"
    >
      {/* 复制按钮组 */}
      <div className="flex items-center gap-2">
        {actionGroups[0].buttons.map(renderButton)}
      </div>

      {/* 分隔线 */}
      {actionGroups[0].buttons.some((button) =>
        visibleButtons.includes(button.key),
      ) && <div className="h-6 w-px bg-default-200 mx-1" />}

      {/* 视图按钮组 */}
      <div className="flex items-center gap-2">
        {actionGroups[1].buttons.map(renderButton)}
      </div>

      {/* 分隔线 */}
      {actionGroups[1].buttons.some((button) =>
        visibleButtons.includes(button.key),
      ) &&
        actionGroups[2].buttons.some((button) =>
          visibleButtons.includes(button.key),
        ) && <div className="h-6 w-px bg-default-200 mx-1" />}

      {/* 展开/折叠按钮组 */}
      <div className="flex items-center gap-2">
        {actionGroups[2].buttons.map(renderButton)}
      </div>

      {/* 分隔线 - 只在有清空按钮时显示 */}
      {actionGroups[2].buttons.some((button) =>
        visibleButtons.includes(button.key),
      ) &&
        onClear &&
        actionGroups[3]?.buttons.some((button) =>
          visibleButtons.includes(button.key),
        ) && <div className="h-6 w-px bg-default-200 mx-1" />}

      {/* 清空按钮组 */}
      {onClear && (
        <div className="flex items-center gap-2">
          {actionGroups[3].buttons.map(renderButton)}
        </div>
      )}

      {/* 更多菜单 */}
      {renderMoreMenu()}
    </div>
  );
};

export default JsonTableOperationBar;
