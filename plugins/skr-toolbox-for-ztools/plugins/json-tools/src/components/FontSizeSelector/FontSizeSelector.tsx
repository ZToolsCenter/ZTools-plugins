import { memo } from "react";
import { RadioGroup, Radio, cn } from "@heroui/react";
import { Icon } from "@iconify/react";
import { motion } from "framer-motion";

import { useSettingsStore } from "@/store/useSettingsStore";
import { FontSize } from "@/store/useSettingsStore";

interface FontSizeOption {
  value: FontSize;
  label: string;
  description: string;
  icon: string;
  previewText: string;
  previewClass: string;
}

const fontSizeOptions: FontSizeOption[] = [
  {
    value: "small",
    label: "小号字体",
    description: "紧凑显示，适合屏幕空间有限的设备",
    icon: "solar:text-minimalistic-bold",
    previewText: "预览文字 Aa",
    previewClass: "text-sm",
  },
  {
    value: "medium",
    label: "中号字体",
    description: "标准显示，平衡阅读体验和空间利用",
    icon: "solar:text-bold",
    previewText: "预览文字 Aa",
    previewClass: "text-base",
  },
  {
    value: "large",
    label: "大号字体",
    description: "舒适显示，提供更好的阅读体验",
    icon: "solar:text-plus-bold",
    previewText: "预览文字 Aa",
    previewClass: "text-lg",
  },
];

interface FontSizeSelectorProps {
  className?: string;
  orientation?: "horizontal" | "vertical";
}

const FontSizeSelector = memo(
  ({ className, orientation = "horizontal" }: FontSizeSelectorProps) => {
    const { fontSize, setFontSize } = useSettingsStore();

    const handleFontSizeChange = (value: string) => {
      setFontSize(value as FontSize);
    };

    return (
      <div className={cn("w-full", className)}>
        <RadioGroup
          classNames={{
            label: "text-sm font-medium text-default-700",
            wrapper:
              orientation === "horizontal"
                ? "flex flex-row gap-3 sm:gap-4"
                : "flex flex-col gap-3",
          }}
          label="选择字体大小"
          orientation={orientation}
          value={fontSize}
          onValueChange={handleFontSizeChange}
        >
          {fontSizeOptions.map((option) => (
            <Radio
              key={option.value}
              classNames={{
                base: cn(
                  "flex-1 max-w-none",
                  "p-4 border-2 rounded-xl cursor-pointer",
                  "transition-all duration-200 hover:shadow-md",
                  "data-[selected=true]:border-primary data-[selected=true]:bg-primary/5",
                  "data-[selected=false]:border-default-200 data-[selected=false]:hover:border-default-300",
                  orientation === "horizontal" ? "min-w-[140px]" : "w-full",
                ),
                labelWrapper: "w-full",
                label: cn(
                  "flex flex-col items-center text-center gap-2",
                  "data-[selected=true]:text-primary",
                ),
              }}
              value={option.value}
            >
              <div className="flex flex-col items-center gap-3 w-full">
                {/* 图标 */}
                <div
                  className={cn(
                    "p-2 rounded-lg",
                    fontSize === option.value
                      ? "bg-primary/15 text-primary"
                      : "bg-default-100 text-default-500",
                  )}
                >
                  <Icon icon={option.icon} width={20} />
                </div>

                {/* 预览文字 */}
                <motion.div
                  animate={{
                    scale: fontSize === option.value ? 1.05 : 1,
                  }}
                  className={cn(
                    "font-medium text-default-900 dark:text-default-100",
                    option.previewClass,
                  )}
                  initial={{ scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  {option.previewText}
                </motion.div>

                {/* 标签 */}
                <span
                  className={cn(
                    "text-sm font-semibold",
                    fontSize === option.value
                      ? "text-primary"
                      : "text-default-700",
                  )}
                >
                  {option.label}
                </span>

                {/* 描述 */}
                <span className="text-xs text-default-500 leading-relaxed">
                  {option.description}
                </span>
              </div>
            </Radio>
          ))}
        </RadioGroup>
      </div>
    );
  },
);

FontSizeSelector.displayName = "FontSizeSelector";

// 导出简化版本
interface SimpleFontSizeSelectorProps {
  className?: string;
}

export const SimpleFontSizeSelector = memo(
  ({ className }: SimpleFontSizeSelectorProps) => {
    const { fontSize, setFontSize } = useSettingsStore();

    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2">
          <Icon className="text-primary" icon="solar:text-bold" width={18} />
          <span className="text-sm font-medium text-default-700">字体大小</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {fontSizeOptions.map((option) => (
            <button
              key={option.value}
              className={cn(
                "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2",
                "transition-all duration-200 hover:shadow-sm",
                fontSize === option.value
                  ? "border-primary bg-primary/5"
                  : "border-default-200 hover:border-default-300",
              )}
              onClick={() => setFontSize(option.value)}
            >
              <span
                className={cn(
                  "font-semibold",
                  fontSize === option.value
                    ? "text-primary"
                    : "text-default-600",
                  option.previewClass,
                )}
              >
                Aa
              </span>
              <span
                className={cn(
                  "text-xs",
                  fontSize === option.value
                    ? "text-primary font-medium"
                    : "text-default-500",
                )}
              >
                {option.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  },
);

SimpleFontSizeSelector.displayName = "SimpleFontSizeSelector";

export default FontSizeSelector;
