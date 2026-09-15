import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/shell/resizable";
import { WorkspaceSidebar } from "@/components/shell/WorkspaceSidebar";
import { MainArea } from "@/components/shell/MainArea";
import { cn } from "@/lib/utils";

/** 布局键走 ga: 前缀，与 ADR 0004 存储隔离一致 */
const layoutStorage = {
  getItem(name: string) {
    try {
      return localStorage.getItem(
        name.startsWith("ga:") ? name : `ga:layout:${name}`,
      );
    } catch {
      return null;
    }
  },
  setItem(name: string, value: string) {
    try {
      localStorage.setItem(
        name.startsWith("ga:") ? name : `ga:layout:${name}`,
        value,
      );
    } catch {
      /* quota / private mode */
    }
  },
};

interface WorkbenchShellProps {
  onOpenSettings: () => void;
  onOpenChanges: (path?: string) => void;
}

/**
 * 工作台壳：可拖宽左栏 + 主区（ADR 0014）。
 * 左默认 200px / min 160 / max 360；布局持久化。
 * 定时任务入口走 window 事件 goose-agent:open-automations（无 prop 下钻）。
 */
export function WorkbenchShell({
  onOpenSettings,
  onOpenChanges,
}: WorkbenchShellProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "workbench-shell",
    storage: layoutStorage,
    panelIds: ["sidebar", "main"],
  });

  return (
    <ResizablePanelGroup
      id="workbench-shell"
      orientation="horizontal"
      className="h-full min-h-0 w-full"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="sidebar"
        defaultSize={200}
        minSize={160}
        maxSize={360}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        <div className="flex h-full min-h-0 w-full flex-col">
          <WorkspaceSidebar />
        </div>
      </ResizablePanel>
      <ResizableHandle
        className={cn(
          "w-px bg-transparent transition-colors duration-150",
          "hover:bg-border active:bg-border",
          "after:w-1.5 after:bg-transparent",
        )}
        aria-label="调整侧栏宽度"
      />
      <ResizablePanel
        id="main"
        minSize={360}
        className="min-h-0 min-w-0 overflow-hidden"
        groupResizeBehavior="preserve-relative-size"
      >
        {/* Panel 本身不保证子树吃满高度；包一层 h-full 避免主区塌缩悬空 */}
        <div className="flex h-full min-h-0 w-full flex-col">
          <MainArea
            onOpenSettings={onOpenSettings}
            onOpenChanges={onOpenChanges}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
