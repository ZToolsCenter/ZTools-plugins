// src/stores/toolboxStore.ts
import { create } from "zustand";

export interface Tool {
  id: string;
  name: string;
  icon: string;
  description: string;
  path: string;
  category: string[];
}

interface ToolboxState {
  tools: Tool[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredTools: () => Tool[];
}

const demoTools: Tool[] = [
  {
    id: "jsonAIRepair",
    name: "JSON AI 修复",
    icon: "fluent-emoji-flat:magic-wand",
    description: "AI 智能识别并修复JSON格式错误，让您的JSON数据恢复正常",
    path: "/toolbox/jsonAIRepair",
    category: ["AI", "数据处理"],
  },
  {
    id: "jsonTypeConverter",
    name: "对象类型转换器",
    icon: "fluent-color:code-block-24",
    description: "将JSON数据快速转换为TypeScript、GO、Java、Rust等对象",
    path: "/toolbox/jsonTypeConverter",
    category: ["AI", "数据处理", "代码生成"],
  },
  {
    id: "dataFormatConverter",
    name: "数据格式转换",
    icon: "token-branded:swap",
    description: "支持JSON5、YAML、XML、TOML等格式互相转换，支持AI转换",
    path: "/toolbox/dataFormatConverter",
    category: ["数据处理", "AI"],
  },
  {
    id: "jwtParse",
    name: "JWT解析与验证",
    icon: "icon-park-outline:key",
    description: "解析、验证JWT令牌，查看Header和Payload信息，支持签名验证",
    path: "/toolbox/jwtParse",
    category: ["安全工具", "数据处理"],
  },
];

export const useToolboxStore = create<ToolboxState>((set, get) => ({
  tools: demoTools,
  searchQuery: "",
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  filteredTools: () => {
    const { tools, searchQuery } = get();

    if (!searchQuery.trim()) return tools;

    const query = searchQuery.toLowerCase();

    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query) ||
        (tool.category &&
          tool.category.some((cat) => cat.toLowerCase().includes(query))),
    );
  },
}));
