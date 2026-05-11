import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Icon } from "@iconify/react";
import { motion } from "framer-motion";

import { useSettingsStore } from "@/store/useSettingsStore";
import { FontSize } from "@/store/useSettingsStore";

// 字体大小选项配置
const FONT_SIZE_OPTIONS = [
  {
    value: "small" as FontSize,
    label: "小号",
    description: "紧凑显示，节省空间",
    icon: "solar:text-bold",
    scale: 0.85,
    color: "from-blue-500 to-cyan-500",
  },
  {
    value: "medium" as FontSize,
    label: "标准",
    description: "平衡阅读体验",
    icon: "solar:text-bold",
    scale: 1,
    color: "from-emerald-500 to-teal-500",
  },
  {
    value: "large" as FontSize,
    label: "大号",
    description: "舒适阅读，清晰易见",
    icon: "solar:text-bold",
    scale: 1.15,
    color: "from-purple-500 to-pink-500",
  },
];

export function FontSizeSettings() {
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setFontSize = useSettingsStore((state) => state.setFontSize);

  const cycleFontSize = () => {
    const sizes: Array<"small" | "medium" | "large"> = [
      "small",
      "medium",
      "large",
    ];
    const currentIndex = sizes.indexOf(fontSize);
    const nextIndex = (currentIndex + 1) % sizes.length;

    setFontSize(sizes[nextIndex]);
  };

  return (
    <Card className="w-full bg-gradient-to-br from-background to-default-50/50 border-default-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-primary-10 to-primary-20 dark:from-primary-20 dark:to-primary-30">
              <Icon
                className="text-xl text-primary"
                icon="solar:text-square-bold-duotone"
              />
            </div>
            <div>
              <h3 className="text-lg font-bold bg-gradient-to-r from-primary-600 to-primary-400 bg-clip-text text-transparent">
                字体大小
              </h3>
              <p className="text-xs text-default-500 mt-0.5">
                自定义您的专属阅读体验
              </p>
            </div>
          </div>
          <Button
            className="text-primary"
            size="sm"
            startContent={
              <Icon
                className="text-base"
                icon="solar:refresh-circle-bold-duotone"
              />
            }
            variant="light"
            onPress={cycleFontSize}
          >
            快速切换
          </Button>
        </div>
      </CardHeader>

      <CardBody className="pt-0">
        {/* 主要选择区域 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {FONT_SIZE_OPTIONS.map((option, index) => (
            <motion.div
              key={option.value}
              animate={{ opacity: 1, y: 0 }}
              className="relative group"
              initial={{ opacity: 0, y: 20 }}
              transition={{ delay: index * 0.1 }}
            >
              <button
                className={`w-full p-4 rounded-xl border-2 transition-all duration-300 group-hover:shadow-md ${
                  fontSize === option.value
                    ? `border-transparent bg-gradient-to-br ${option.color} shadow-md scale-102`
                    : "border-default-200 bg-background hover:border-default-300 hover:bg-default-50"
                }`}
                onClick={() => setFontSize(option.value)}
              >
                {/* 选中指示器 */}
                {fontSize === option.value && (
                  <div className="absolute top-2 right-2">
                    <motion.div
                      animate={{ scale: 1 }}
                      className="w-5 h-5 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
                      initial={{ scale: 0 }}
                    >
                      <Icon
                        className="text-white text-sm"
                        icon="solar:check-circle-bold"
                      />
                    </motion.div>
                  </div>
                )}

                {/* 图标 */}
                <div
                  className={`flex justify-center mb-3 ${
                    fontSize === option.value
                      ? "text-white"
                      : "text-default-600"
                  }`}
                >
                  <Icon
                    className={`text-2xl transition-transform duration-300 group-hover:scale-105 ${
                      fontSize === option.value ? "scale-105" : ""
                    }`}
                    icon={option.icon}
                  />
                </div>

                {/* 标签 */}
                <div className="text-center">
                  <h4
                    className={`font-bold text-base mb-1 ${
                      fontSize === option.value
                        ? "text-white"
                        : "text-default-900"
                    }`}
                  >
                    {option.label}
                  </h4>
                  <p
                    className={`text-xs leading-relaxed ${
                      fontSize === option.value
                        ? "text-white/80"
                        : "text-default-500"
                    }`}
                  >
                    {option.description}
                  </p>
                </div>

                {/* 预览文字 */}
                <div
                  className={`mt-3 text-center font-medium ${
                    fontSize === option.value
                      ? "text-white/90"
                      : "text-default-400"
                  }`}
                >
                  <span style={{ fontSize: `${12 * option.scale}px` }}>
                    Aa 示例
                  </span>
                </div>
              </button>
            </motion.div>
          ))}
        </div>

        {/* 使用提示 */}
        <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
          <div className="flex items-start gap-2">
            <div className="p-1 rounded-lg bg-blue-100">
              <Icon
                className="text-blue-600 text-sm"
                icon="solar:lightbulb-bolt-bold-duotone"
              />
            </div>
            <div className="flex-1">
              <h5 className="font-semibold text-blue-900 mb-1 text-sm">
                贴心提示
              </h5>
              <div className="text-xs text-blue-700 space-y-1">
                <p>• 字体大小设置会立即应用到整个应用界面</p>
                <p>• 您的偏好设置会自动保存，下次打开时保持不变</p>
                <p>• 建议根据使用环境和视力状况选择合适的字体大小</p>
              </div>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
