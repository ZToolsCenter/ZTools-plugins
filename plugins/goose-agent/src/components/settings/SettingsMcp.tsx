import { useCallback, useEffect, useMemo, useState } from "react";
import type { Selection } from "react-aria-components";
import {
  isAiContextAvailable,
  probeGlobalMcpSource,
  probeProjectMcpSource,
  GLOBAL_MCP_PATH_LABEL,
  PROJECT_MCP_PATH_LABEL,
  type DiscoveredMcpServer,
  type McpSourceProbe,
} from "@/lib/agent/localContext";
import { ToggleButton, ToggleButtonGroup } from "@/lib/heroui";
import { useWorkspaces } from "@/stores/useWorkspaces";
import { SettingsSectionCard } from "./SettingsSectionCard";
import { cn } from "@/lib/utils";

const ROW_CLASS = "rounded-[12px] border border-border-soft bg-bg";

type McpScope = "global" | "project";

function emptyProbe(pathLabel: string): McpSourceProbe {
  return { pathLabel, found: false, servers: [] };
}

/**
 * MCP Tab：只读列表；全局 | 项目作用域（ADR 0019）。
 * 单源：全局 ~/.agents/mcp.json；项目 <ws>/.agents/mcp.json。不在此编辑或启动。
 */
export function SettingsMcp() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);

  const [scope, setScope] = useState<McpScope>("global");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const [apiReady, setApiReady] = useState(false);
  const [globalProbe, setGlobalProbe] = useState<McpSourceProbe>(() =>
    emptyProbe(GLOBAL_MCP_PATH_LABEL),
  );
  const [projectProbe, setProjectProbe] = useState<McpSourceProbe>(() =>
    emptyProbe(PROJECT_MCP_PATH_LABEL),
  );

  // 默认选中 activeId，否则首项；列表变化时校正
  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedWorkspaceId(null);
      return;
    }
    setSelectedWorkspaceId((prev) => {
      if (prev && workspaces.some((w) => w.id === prev)) return prev;
      if (activeId && workspaces.some((w) => w.id === activeId)) return activeId;
      return workspaces[0]!.id;
    });
  }, [workspaces, activeId]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedWorkspaceId) ?? null,
    [workspaces, selectedWorkspaceId],
  );
  const projectRoot = selectedWorkspace?.path?.trim() || null;

  const reloadGlobal = useCallback(() => {
    const ready = isAiContextAvailable();
    setApiReady(ready);
    if (!ready) {
      setGlobalProbe(emptyProbe(GLOBAL_MCP_PATH_LABEL));
      return;
    }
    setGlobalProbe(probeGlobalMcpSource());
  }, []);

  const reloadProject = useCallback(() => {
    const ready = isAiContextAvailable();
    setApiReady(ready);
    if (!ready || !projectRoot) {
      setProjectProbe(emptyProbe(PROJECT_MCP_PATH_LABEL));
      return;
    }
    setProjectProbe(probeProjectMcpSource(projectRoot));
  }, [projectRoot]);

  useEffect(() => {
    if (scope === "global") {
      reloadGlobal();
    } else {
      reloadProject();
    }
  }, [scope, reloadGlobal, reloadProject]);

  const globalDescription = !apiReady
    ? "不可用"
    : globalProbe.found
      ? `${globalProbe.servers.length} 个`
      : "未找到文件";

  const projectDescription = !projectRoot
    ? "未选择工作区"
    : !apiReady
      ? "不可用"
      : projectProbe.found
        ? `${projectProbe.servers.length} 个`
        : "未找到文件";

  return (
    <div className="min-w-0 space-y-3.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-fg">
            MCP
          </h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-fg-faint">
            只读 mcpServers：全局 {GLOBAL_MCP_PATH_LABEL}，项目{" "}
            {PROJECT_MCP_PATH_LABEL}；不在此启动或编辑。
          </p>
          {!apiReady ? (
            <p className="mt-1 text-[11px] leading-snug text-fg-faint">
              需 uTools 真机读取；浏览器预览为空。
            </p>
          ) : null}
        </div>

        <ToggleButtonGroup
          selectionMode="single"
          selectedKeys={new Set([scope])}
          onSelectionChange={(keys: Selection) => {
            if (keys === "all") return;
            const next = Array.from(keys)[0];
            if (next === "global" || next === "project") setScope(next);
          }}
          disallowEmptySelection
          isDetached
          size="sm"
          aria-label="MCP 范围"
          className="shrink-0 gap-0.5"
        >
          <ToggleButton id="global" className="h-7 px-2.5 text-[11.5px]">
            全局
          </ToggleButton>
          <ToggleButton id="project" className="h-7 px-2.5 text-[11.5px]">
            项目
          </ToggleButton>
        </ToggleButtonGroup>
      </div>

      {scope === "global" ? (
        <SettingsSectionCard title="全局 MCP" description={globalDescription}>
          <p className="mb-2 truncate font-mono text-[10.5px] text-fg-faint">
            {globalProbe.pathLabel}
          </p>
          <ProbeBody
            apiReady={apiReady}
            probe={globalProbe}
            missingHint={`未找到配置文件（约定路径：${GLOBAL_MCP_PATH_LABEL}）`}
            scopeLabel="全局"
            keyPrefix="g"
          />
        </SettingsSectionCard>
      ) : (
        <div className="flex min-h-[12rem] min-w-0 gap-0 overflow-hidden rounded-[12px] border border-border-soft">
          <nav
            className="flex w-[9.5rem] shrink-0 flex-col gap-0.5 border-r border-border-soft bg-bg py-1.5 pl-1.5 pr-1"
            aria-label="工作区列表"
          >
            {workspaces.length === 0 ? (
              <p className="px-2 py-2 text-[11.5px] leading-snug text-fg-faint">
                请先在侧栏挂载工作区
              </p>
            ) : (
              workspaces.map((ws) => {
                const selected = ws.id === selectedWorkspaceId;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => setSelectedWorkspaceId(ws.id)}
                    className={cn(
                      "rounded-lg px-2 py-1.5 text-left transition-colors",
                      selected
                        ? "bg-accent-subtle text-fg"
                        : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                    )}
                    aria-current={selected ? "true" : undefined}
                  >
                    <div className="truncate text-[12.5px] font-medium">
                      {ws.name}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-fg-faint">
                      {ws.path}
                    </div>
                  </button>
                );
              })
            )}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-3">
            {!projectRoot ? (
              <p className="text-[12px] text-fg-faint">
                请先在侧栏挂载工作区
              </p>
            ) : (
              <SettingsSectionCard
                title="项目 MCP"
                description={projectDescription}
              >
                <p className="mb-2 truncate font-mono text-[10.5px] text-fg-faint">
                  {projectProbe.pathLabel}
                </p>
                <ProbeBody
                  apiReady={apiReady}
                  probe={projectProbe}
                  missingHint={`未找到配置文件（约定路径：工作区下 ${PROJECT_MCP_PATH_LABEL}）`}
                  scopeLabel="项目"
                  keyPrefix={`p:${selectedWorkspaceId ?? ""}`}
                />
              </SettingsSectionCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProbeBody({
  apiReady,
  probe,
  missingHint,
  scopeLabel,
  keyPrefix,
}: {
  apiReady: boolean;
  probe: McpSourceProbe;
  missingHint: string;
  scopeLabel: string;
  keyPrefix: string;
}) {
  if (!apiReady) {
    return <p className="text-[12px] text-fg-faint">—</p>;
  }
  if (!probe.found) {
    return <p className="text-[12px] text-fg-faint">{missingHint}</p>;
  }
  if (probe.servers.length === 0) {
    return (
      <p className="text-[12px] text-fg-faint">
        已读取配置，mcpServers 中 0 个 server
      </p>
    );
  }
  return (
    <ServerList
      servers={probe.servers}
      scopeLabel={scopeLabel}
      keyPrefix={keyPrefix}
    />
  );
}

function ServerList({
  servers,
  scopeLabel,
  keyPrefix,
}: {
  servers: DiscoveredMcpServer[];
  scopeLabel: string;
  keyPrefix: string;
}) {
  return (
    <ul className="space-y-1.5">
      {servers.map((server) => (
        <li
          key={`${keyPrefix}:${server.sourcePath}:${server.name}`}
          className={cn("px-3 py-2.5", ROW_CLASS)}
        >
          <div className="truncate text-[13px] font-medium text-fg">
            {server.name}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-fg-faint">
            {scopeLabel} · {server.transport}
          </p>
          <p className="mt-1 truncate font-mono text-[10.5px] text-fg-faint">
            {server.sourcePath}
          </p>
        </li>
      ))}
    </ul>
  );
}
