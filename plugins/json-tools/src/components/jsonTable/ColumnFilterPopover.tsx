import React, { useState, useMemo, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Input,
  Checkbox,
  Button,
} from "@heroui/react";
import { Icon } from "@iconify/react";

interface ColumnFilterPopoverProps {
  /** 列名 */
  columnKey: string;
  /** 该列所有去重后的值（预计算） */
  allValues: string[];
  /** 当前选中的值集合 */
  selectedValues: Set<string>;
  /** 是否有活跃筛选（用于图标高亮） */
  isActive: boolean;
  /** 筛选变化回调 */
  onFilterChange: (
    columnKey: string,
    selectedValues: Set<string>,
  ) => void;
}

/** 去重列表最大显示数量 */
const MAX_VISIBLE_ITEMS = 200;

const ColumnFilterPopover: React.FC<ColumnFilterPopoverProps> = ({
  columnKey,
  allValues,
  selectedValues,
  isActive,
  onFilterChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [tempSelected, setTempSelected] = useState<Set<string>>(
    new Set(selectedValues),
  );

  // 打开 Popover 时同步选中状态
  useEffect(() => {
    if (isOpen) {
      setTempSelected(new Set(selectedValues));
      setSearchText("");
    }
  }, [isOpen, selectedValues]);

  // 搜索过滤后的列表
  const filteredValues = useMemo(() => {
    const values = searchText
      ? allValues.filter((v) =>
          v.toLowerCase().includes(searchText.toLowerCase()),
        )
      : allValues;
    return values.slice(0, MAX_VISIBLE_ITEMS);
  }, [allValues, searchText]);

  const isAllSelected =
    tempSelected.size === allValues.length && allValues.length > 0;
  const isNoneSelected = tempSelected.size === 0;
  const isIndeterminate = !isAllSelected && !isNoneSelected;

  const handleToggleAll = () => {
    if (isAllSelected) {
      setTempSelected(new Set());
    } else {
      setTempSelected(new Set(allValues));
    }
  };

  const handleToggleItem = (value: string) => {
    setTempSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onFilterChange(columnKey, tempSelected);
    setIsOpen(false);
  };

  const handleReset = () => {
    setTempSelected(new Set(allValues));
  };

  const totalValues = allValues.length;
  const hiddenCount = searchText
    ? allValues.filter((v) =>
        v.toLowerCase().includes(searchText.toLowerCase()),
      ).length - filteredValues.length
    : totalValues - filteredValues.length;

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      placement="bottom"
      classNames={{
        content: "p-0",
      }}
    >
      <PopoverTrigger>
        <button
          className={`inline-flex items-center justify-center w-5 h-5 rounded-sm transition-colors ${
            isActive
              ? "text-primary bg-primary/10"
              : "text-default-400 hover:text-primary hover:bg-default-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon
            icon={isActive ? "mdi:filter" : "mdi:filter-outline"}
            width={14}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="w-56 p-2">
          {/* 搜索框 */}
          <Input
            size="sm"
            placeholder="搜索..."
            value={searchText}
            onValueChange={setSearchText}
            className="mb-2"
            startContent={
              <Icon
                icon="mdi:magnify"
                width={16}
                className="text-default-400"
              />
            }
            isClearable
          />

          {/* 全选/取消全选 */}
          <div className="flex items-center gap-2 mb-1 px-1">
            <Checkbox
              size="sm"
              isSelected={isAllSelected}
              isIndeterminate={isIndeterminate}
              onValueChange={handleToggleAll}
            >
              <span className="text-xs text-default-500">
                全选 ({tempSelected.size}/{totalValues})
              </span>
            </Checkbox>
          </div>

          {/* 去重列表 */}
          <div className="max-h-48 overflow-y-auto border-t border-b border-default-200 py-1">
            {filteredValues.map((value) => (
              <div
                key={value}
                className="flex items-center gap-2 px-1 py-0.5 hover:bg-default-50 rounded-sm"
              >
                <Checkbox
                  size="sm"
                  isSelected={tempSelected.has(value)}
                  onValueChange={() => handleToggleItem(value)}
                >
                  <span
                    className="text-xs truncate max-w-[140px]"
                    title={value}
                  >
                    {value || "(空)"}
                  </span>
                </Checkbox>
              </div>
            ))}
            {hiddenCount > 0 && (
              <div className="text-xs text-default-400 px-2 py-1">
                还有 {hiddenCount} 项，请搜索缩小范围
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center justify-between mt-2">
            <Button
              size="sm"
              variant="light"
              className="text-xs h-7"
              onPress={handleReset}
            >
              重置
            </Button>
            <Button
              size="sm"
              color="primary"
              className="text-xs h-7"
              onPress={handleConfirm}
            >
              确定
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ColumnFilterPopover;
