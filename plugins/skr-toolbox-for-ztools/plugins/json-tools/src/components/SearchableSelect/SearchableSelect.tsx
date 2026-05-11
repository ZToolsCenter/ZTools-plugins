import { Input } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

export interface SearchableSelectProps {
  items: { value: string; label: string }[];
  selectedValue?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  items,
  selectedValue,
  placeholder = "请选择",
  onChange,
  className = "",
  id,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

  // 当前选中的项
  const selectedItem = items.find((item) => item.value === selectedValue);

  // 过滤后的项目
  const filteredItems = items.filter(
    (item) =>
      item.label.toLowerCase().includes(searchValue.toLowerCase()) ||
      item.value.toLowerCase().includes(searchValue.toLowerCase()),
  );

  // 更新下拉框位置
  const updatePosition = useCallback(() => {
    if (containerRef.current && isOpen) {
      const rect = containerRef.current.getBoundingClientRect();

      setPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // 点击外部关闭下拉框
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(event.target as Node) &&
      dropdownRef.current &&
      !dropdownRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      updatePosition();
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, handleClickOutside, updatePosition]);

  // 选项点击处理函数
  const handleItemClick = (value: string) => {
    onChange(value);
    setIsOpen(false);
    setSearchValue("");
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} id={id}>
      {/* 当前选择框 */}
      <button
        aria-controls={`listbox-${id || ""}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between border border-default-200 rounded-lg px-3 py-0.5 cursor-pointer bg-white dark:bg-default-100 min-h-[38px] transition-colors hover:border-primary/50 text-left"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex-1 truncate">
          {selectedItem ? selectedItem.label : placeholder}
        </div>
        <Icon
          className={`ml-2 transition-transform ${isOpen ? "text-primary" : "text-default-400"}`}
          icon={isOpen ? "heroicons:chevron-up" : "heroicons:chevron-down"}
          width={18}
        />
      </button>

      {/* 下拉内容 - 使用Portal渲染到body */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] shadow-lg bg-white dark:bg-default-100 rounded-lg border border-default-200"
            role="listbox"
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
            }}
            tabIndex={0}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 搜索框 */}
            <div className="p-2">
              <Input
                className="w-full"
                placeholder="搜索..."
                size="sm"
                startContent={
                  <Icon icon="heroicons:magnifying-glass" width={16} />
                }
                value={searchValue}
                variant="bordered"
                onChange={(e) => setSearchValue(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>

            {/* 选项列表 */}
            <ul
              aria-label={placeholder}
              className="max-h-64 overflow-y-auto py-1 z-[9999] m-0 p-0 list-none"
              id={`listbox-${id || ""}`}
              role="listbox"
            >
              {filteredItems.length > 0 ? (
                filteredItems.map((item) => (
                  <li key={item.value} role="presentation">
                    <button
                      aria-selected={selectedValue === item.value}
                      className={`w-full text-left px-3 py-2.5 z-[9999] cursor-pointer hover:bg-default-100 dark:hover:bg-default-200 transition-colors ${
                        selectedValue === item.value
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-default-700"
                      }`}
                      role="option"
                      type="button"
                      onClick={() => handleItemClick(item.value)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-default-400 text-center">
                  无匹配结果
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default SearchableSelect;
