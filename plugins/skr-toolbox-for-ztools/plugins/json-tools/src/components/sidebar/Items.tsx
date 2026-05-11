import { type SidebarItem } from "./Sidebar.tsx";

/**
 * Please check the https://nextui.org/docs/guide/routing to have a seamless router integration
 */

export enum SidebarKeys {
  textView = "textView",
  treeView = "treeView",
  diffView = "diffView",
  tableView = "tableView",
  toolbox = "toolbox",
  history = "history",
}

export const items: SidebarItem[] = [
  {
    key: SidebarKeys.textView,
    icon: "solar:home-2-linear",
    title: "文本视图",
  },
  {
    key: SidebarKeys.treeView,
    icon: "solar:widget-2-outline",
    title: "树形视图",
  },
  {
    key: SidebarKeys.diffView,
    icon: "solar:checklist-minimalistic-outline",
    title: "DIFF视图",
  },
  {
    key: SidebarKeys.tableView,
    icon: "mynaui:table",
    title: "表格视图",
  },
  {
    key: SidebarKeys.toolbox,
    icon: "solar:box-outline",
    route: "./toolbox",
    title: "工具箱",
  },
  {
    key: SidebarKeys.history,
    icon: "solar:history-linear",
    route: "./history",
    title: "查看历史",
  },
];
