import React from "react";
import { Button, cn } from "@heroui/react";
import { Icon } from "@iconify/react";

interface JsonQueryHelpProps {
  className?: string;
}

const JsonQueryHelp: React.FC<JsonQueryHelpProps> = ({ className }) => {
  const [isHovered, setIsHovered] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 100); // 延迟100ms关闭，避免鼠标移动时的闪烁
  };

  // 清理函数
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const helpContent = (
    <div className="p-0 max-w-lg">
      {/* 头部 */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3 rounded-t-lg">
        <div className="flex items-center">
          <Icon
            className="text-white mr-2"
            icon="mingcute:question-line"
            width={20}
          />
          <h3 className="font-semibold text-white text-sm">
            JSONQuery 语法帮助
          </h3>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-h-80 overflow-y-auto">
        {/* 基础操作 */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20">
            <div className="flex items-center mb-2">
              <Icon
                className="text-blue-500 mr-2"
                icon="mdi:code-braces"
                width={16}
              />
              <h4 className="font-medium text-blue-700 dark:text-blue-300 text-sm">
                基础操作
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-blue-600 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 font-mono">
                  .property
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  访问属性
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-blue-600 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 font-mono">
                  query1 | query2 | …
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  管道操作
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 过滤和映射 */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-4 py-3 bg-green-50 dark:bg-green-900/20">
            <div className="flex items-center mb-2">
              <Icon
                className="text-green-500 mr-2"
                icon="mdi:filter"
                width={16}
              />
              <h4 className="font-medium text-green-700 dark:text-green-300 text-sm">
                过滤和映射
              </h4>
            </div>
            <div className="space-y-2">
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-green-600 px-2 py-1 rounded border border-green-200 dark:border-green-800 font-mono">
                  filter(.age {">"} 18)
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  过滤数据
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-green-600 px-2 py-1 rounded border border-green-200 dark:border-green-800 font-mono">
                  filter(.city in [&#34;shenzhen&#34;, &#34;beijing&#34;])
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  过滤数据
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-green-600 px-2 py-1 rounded border border-green-200 dark:border-green-800 font-mono">
                  map(.name)
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  提取字段
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-green-600 px-2 py-1 rounded border border-green-200 dark:border-green-800 font-mono">
                  map({"{"}name: .name, age: .age{"}"})
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  重构对象
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-green-600 px-2 py-1 rounded border border-green-200 dark:border-green-800 font-mono">
                  pick(&#34;name&#34;, &#34;age&#34;)
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  选择属性
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 排序和分组 */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-4 py-3 bg-purple-50 dark:bg-purple-900/20">
            <div className="flex items-center mb-2">
              <Icon
                className="text-purple-500 mr-2"
                icon="mdi:sort"
                width={16}
              />
              <h4 className="font-medium text-purple-700 dark:text-purple-300 text-sm">
                排序和分组
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-purple-600 px-2 py-1 rounded border border-purple-200 dark:border-purple-800 font-mono">
                  sort(.age)
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  升序
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-purple-600 px-2 py-1 rounded border border-purple-200 dark:border-purple-800 font-mono">
                  sort(.age, &#34;desc&#34;)
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  降序
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-purple-600 px-2 py-1 rounded border border-purple-200 dark:border-purple-800 font-mono">
                  groupBy(.department)
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  分组
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-purple-600 px-2 py-1 rounded border border-purple-200 dark:border-purple-800 font-mono">
                  reverse()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  反转
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 聚合函数 */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-4 py-3 bg-orange-50 dark:bg-orange-900/20">
            <div className="flex items-center mb-2">
              <Icon
                className="text-orange-500 mr-2"
                icon="mdi:calculator"
                width={16}
              />
              <h4 className="font-medium text-orange-700 dark:text-orange-300 text-sm">
                聚合函数
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-orange-600 px-2 py-1 rounded border border-orange-200 dark:border-orange-800 font-mono">
                  size()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  计数
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-orange-600 px-2 py-1 rounded border border-orange-200 dark:border-orange-800 font-mono">
                  sum()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  求和
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-orange-600 px-2 py-1 rounded border border-orange-200 dark:border-orange-800 font-mono">
                  average()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  平均值
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-orange-600 px-2 py-1 rounded border border-orange-200 dark:border-orange-800 font-mono">
                  min()/max()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  最值
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 比较操作符 */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20">
            <div className="flex items-center mb-2">
              <Icon
                className="text-red-500 mr-2"
                icon="mdi:scale-balance"
                width={16}
              />
              <h4 className="font-medium text-red-700 dark:text-red-300 text-sm">
                比较操作符
              </h4>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-red-600 px-2 py-1 rounded border border-red-200 dark:border-red-800 font-mono">
                  == / eq()
                </code>
                <span className="ml-1 text-gray-600 dark:text-gray-400">
                  等于
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-red-600 px-2 py-1 rounded border border-red-200 dark:border-red-800 font-mono">
                  != / ne()
                </code>
                <span className="ml-1 text-gray-600 dark:text-gray-400">
                  不等于
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-red-600 px-2 py-1 rounded border border-red-200 dark:border-red-800 font-mono">
                  {">"} / gt()
                </code>
                <span className="ml-1 text-gray-600 dark:text-gray-400">
                  大于
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-red-600 px-2 py-1 rounded border border-red-200 dark:border-red-800 font-mono">
                  {"<"} / lt()
                </code>
                <span className="ml-1 text-gray-600 dark:text-gray-400">
                  小于
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-red-600 px-2 py-1 rounded border border-red-200 dark:border-red-800 font-mono">
                  and / or
                </code>
                <span className="ml-1 text-gray-600 dark:text-gray-400">
                  逻辑
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 数组操作 */}
        <div className="border-b border-gray-100 dark:border-gray-800">
          <div className="px-4 py-3 bg-teal-50 dark:bg-teal-900/20">
            <div className="flex items-center mb-2">
              <Icon
                className="text-teal-500 mr-2"
                icon="mdi:array"
                width={16}
              />
              <h4 className="font-medium text-teal-700 dark:text-teal-300 text-sm">
                数组操作
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-teal-600 px-2 py-1 rounded border border-teal-200 dark:border-teal-800 font-mono">
                  flatten()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  扁平化
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-teal-600 px-2 py-1 rounded border border-teal-200 dark:border-teal-800 font-mono">
                  uniq()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  去重
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-teal-600 px-2 py-1 rounded border border-teal-200 dark:border-teal-800 font-mono">
                  keys()/values()
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  键值
                </span>
              </div>
              <div className="flex items-center text-xs">
                <code className="bg-white dark:bg-gray-800 text-teal-600 px-2 py-1 rounded border border-teal-200 dark:border-teal-800 font-mono">
                  join(&#34;,&#34;)
                </code>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  连接
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 实用示例 */}
        <div>
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center mb-2">
              <Icon
                className="text-gray-500 mr-2"
                icon="mdi:lightbulb"
                width={16}
              />
              <h4 className="font-medium text-gray-700 dark:text-gray-300 text-sm">
                实用示例
              </h4>
            </div>
            <div className="space-y-2">
              <div className="text-xs">
                <code className="bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 font-mono block">
                  .users | filter(.age {">"} 18) | sort(.age)
                </code>
                <p className="mt-1 text-gray-600 dark:text-gray-400">
                  过滤成人用户并按年龄排序
                </p>
              </div>
              <div className="text-xs">
                <code className="bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 font-mono block">
                  .departments.golang.manager
                </code>
                <p className="mt-1 text-gray-600 dark:text-gray-400">
                  访问嵌套属性
                </p>
              </div>
              <div className="text-xs">
                <code className="bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 font-mono block">
                  .users | map({"{"}id: .id, name: .name{"}"})
                </code>
                <p className="mt-1 text-gray-600 dark:text-gray-400">
                  重构用户对象
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 底部链接 */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 rounded-b-lg border-t border-gray-200 dark:border-gray-700">
        <a
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center"
          href="https://jsonquerylang.org/reference/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Icon className="mr-1" icon="mdi:book-open-page-variant" width={14} />
          完整文档参考 (jsonquerylang.org) →
        </a>
      </div>
    </div>
  );

  return (
    <div className={cn("relative", className)}>
      <Button
        isIconOnly
        className="min-w-6 w-6 h-6 text-gray-500 hover:text-indigo-500"
        size="sm"
        variant="light"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Icon icon="mingcute:question-line" width={16} />
      </Button>

      {isHovered && (
        <div
          className="absolute bottom-full right-0 mb-2 w-[32rem] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="absolute bottom-0 right-6 transform translate-y-1 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-200 dark:border-t-gray-700" />
          <div className="absolute bottom-0 right-6 transform translate-y-px w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-white dark:border-t-gray-800" />
          {helpContent}
        </div>
      )}
    </div>
  );
};

export default JsonQueryHelp;
