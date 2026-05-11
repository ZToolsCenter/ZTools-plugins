import { QuickPrompt } from "@/components/ai/AIPromptOverlay.tsx";

export const jsonQuickPrompts: QuickPrompt[] = [
  {
    id: "fix_json",
    label: "修复JSON",
    icon: "mdi:wrench",
    prompt: "这个JSON有错误，请帮我修复",
    color: "success",
  },
  {
    id: "convert_to_go",
    label: "生成 Go 结构体",
    icon: "simple-icons:go",
    prompt: "请根据这个JSON生成 Go 结构体定义",
    color: "primary",
  },
  {
    id: "convert_to_typescript",
    label: "生成 TS 类型",
    icon: "simple-icons:typescript",
    prompt: "请根据这个JSON 生成 TypeScript 接口定义",
    color: "default",
  },
  {
    id: "generate_sample",
    label: "生成示例数据",
    icon: "mdi:database-outline",
    prompt: "根据这个JSON结构生成10条示例数据",
    color: "warning",
  },
  {
    id: "validate_json",
    label: "校验数据",
    icon: "mdi:check-circle-outline",
    prompt: "请检查这个JSON是否有逻辑错误或格式问题",
    color: "danger",
  },
];

// 定义适合JSON差异比较的快捷指令
export const diffJsonQuickPrompts: QuickPrompt[] = [
  {
    id: "analyze_diff",
    label: "分析差异",
    icon: "mdi:file-compare",
    prompt: "请帮我分析这两个 JSON 之间的主要差异",
    color: "primary",
  },
  {
    id: "suggest_merge",
    label: "合并建议",
    icon: "fluent:arrow-merge-20-filled",
    prompt: "请帮我智能合并这两个 JSON 文本，保留双方的有效内容并解决所有冲突",
    color: "success",
  },
  {
    id: "generate_patch",
    label: "生成补丁",
    icon: "material-symbols:add-notes",
    prompt: "根据这两个 JSON 之间的差异，生成一个补丁文件",
    color: "secondary",
  },
  {
    id: "find_conflicts",
    label: "查找冲突",
    icon: "ooui:error",
    prompt:
      "请详细检查这两个 JSON 文本之间是否存在冲突或不兼容的部分，指出具体的冲突点和解决建议",
    color: "danger",
  },
  {
    id: "convert_to_ts_diff",
    label: "生成 TS 类型差异",
    icon: "simple-icons:typescript",
    prompt: "请根据这两个版本的 JSON 生成 TypeScript 接口定义的差异",
    color: "default",
  },
  {
    id: "explain_changes",
    label: "解释变更",
    icon: "solar:document-text-linear",
    prompt:
      "请用详细的表格形式解释右侧 JSON 相比左侧发生了哪些变更，包括新增、修改和删除的字段，以及这些变更可能的目的",
    color: "warning",
  },
];
