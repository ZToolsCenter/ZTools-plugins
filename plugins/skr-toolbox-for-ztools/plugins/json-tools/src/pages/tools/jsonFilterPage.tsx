import React, { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";

import { stringifyJson } from "@/utils/json";
import MonacoJsonEditor from "@/components/monacoEditor/MonacoJsonEditor";

const JsonQueryFilterDemo: React.FC = () => {
  const [editorValue, setEditorValue] = useState<string>(
    stringifyJson(
      {
        users: [
          {
            id: 1,
            name: "张三",
            age: 25,
            email: "zhangsan@example.com",
            department: "技术部",
          },
          {
            id: 2,
            name: "李四",
            age: 30,
            email: "lisi@example.com",
            department: "市场部",
          },
          {
            id: 3,
            name: "王五",
            age: 28,
            email: "wangwu@example.com",
            department: "技术部",
          },
          {
            id: 4,
            name: "赵六",
            age: 35,
            email: "zhaoliu@example.com",
            department: "人事部",
          },
        ],
        departments: {
          技术部: { manager: "张经理", count: 15 },
          市场部: { manager: "李经理", count: 8 },
          人事部: { manager: "王经理", count: 5 },
        },
        metadata: {
          totalUsers: 4,
          version: "1.0.0",
          lastUpdated: "2024-01-15T10:30:00Z",
        },
      },
      2,
    ),
  );

  const handleEditorUpdate = (value: string) => {
    setEditorValue(value);
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* 标题区域 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            jsonQuery 过滤功能演示
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            在下方输入框中输入 jsonQuery 表达式来过滤 JSON 数据。支持 JSONPath
            语法的强大查询功能。
          </p>
        </div>

        {/* 示例查询区域 */}
        <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-300 mb-3 flex items-center">
            <Icon className="mr-2" icon="mdi:lightbulb" width={20} />
            示例查询表达式
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <Button
              className="justify-start h-auto p-3"
              size="sm"
              variant="light"
              onPress={() => {
                // 这里需要通过ref调用设置filter值
                const input = document.querySelector(
                  'input[placeholder*="jsonQuery"]',
                ) as HTMLInputElement;

                if (input) {
                  input.value = "$.users[*].name";
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }}
            >
              <div className="text-left">
                <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                  $.users[*].name
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  获取所有用户姓名
                </div>
              </div>
            </Button>

            <Button
              className="justify-start h-auto p-3"
              size="sm"
              variant="light"
              onPress={() => {
                const input = document.querySelector(
                  'input[placeholder*="jsonQuery"]',
                ) as HTMLInputElement;

                if (input) {
                  input.value = "$.users[?(@.age > 28)]";
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }}
            >
              <div className="text-left">
                <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                  {"$.users[?(@.age > 28)]"}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  年龄大于28的用户
                </div>
              </div>
            </Button>

            <Button
              className="justify-start h-auto p-3"
              size="sm"
              variant="light"
              onPress={() => {
                const input = document.querySelector(
                  'input[placeholder*="jsonQuery"]',
                ) as HTMLInputElement;

                if (input) {
                  input.value = "$.users[?(@.department == '技术部')]";
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }}
            >
              <div className="text-left">
                <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                  $.users[?(@.department == '技术部')]
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  技术部的用户
                </div>
              </div>
            </Button>

            <Button
              className="justify-start h-auto p-3"
              size="sm"
              variant="light"
              onPress={() => {
                const input = document.querySelector(
                  'input[placeholder*="jsonQuery"]',
                ) as HTMLInputElement;

                if (input) {
                  input.value = "$.departments['技术部']";
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }}
            >
              <div className="text-left">
                <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                  $.departments['技术部']
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  技术部信息
                </div>
              </div>
            </Button>

            <Button
              className="justify-start h-auto p-3"
              size="sm"
              variant="light"
              onPress={() => {
                const input = document.querySelector(
                  'input[placeholder*="jsonQuery"]',
                ) as HTMLInputElement;

                if (input) {
                  input.value = "$.users[*].{name: name, age: age}";
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }}
            >
              <div className="text-left">
                <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                  {"$.users[*].{name: name, age: age}"}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  仅获取姓名和年龄
                </div>
              </div>
            </Button>

            <Button
              className="justify-start h-auto p-3"
              size="sm"
              variant="light"
              onPress={() => {
                const input = document.querySelector(
                  'input[placeholder*="jsonQuery"]',
                ) as HTMLInputElement;

                if (input) {
                  input.value = "$.metadata";
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }}
            >
              <div className="text-left">
                <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                  $.metadata
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  元数据信息
                </div>
              </div>
            </Button>
          </div>
        </div>

        {/* 编辑器区域 */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg overflow-hidden">
          <MonacoJsonEditor
            key="json-query-demo"
            height="600px"
            isMenu={true}
            language="json"
            showJsonQueryFilter={true}
            tabKey="json-query-demo"
            tabTitle="jsonQuery 过滤演示"
            value={editorValue}
            onUpdateValue={handleEditorUpdate}
          />
        </div>

        {/* 使用说明 */}
        <div className="mt-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center">
            <Icon className="mr-2" icon="mdi:information" width={20} />
            使用说明
          </h3>
          <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span>
              <span>
                在底部输入框中输入 jsonQuery 表达式，支持 JSONPath 语法
              </span>
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span>
              <span>
                输入内容后会自动显示双编辑器布局，左侧为原始数据，右侧为过滤结果
              </span>
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span>
              <span>拖拽中间的绿色分隔条可以调整两个编辑器的宽度比例</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span>
              <span>清空输入框或点击关闭按钮可返回单编辑器模式</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">•</span>
              <span>右侧编辑器为只读模式，显示格式化后的过滤结果</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default JsonQueryFilterDemo;
