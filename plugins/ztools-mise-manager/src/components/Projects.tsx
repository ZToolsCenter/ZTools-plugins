import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Save, X } from "lucide-react";
import type { Project } from "../types";

interface Props {
  onChanged: (silent?: boolean) => void;
}

export default function Projects({ onChanged }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [configText, setConfigText] = useState("");
  const [configFile, setConfigFile] = useState<string | null>(null);
  const [configFiles, setConfigFiles] = useState<{ path: string; tools: string[] }[]>([]);
  const [globalConfig, setGlobalConfig] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newTool, setNewTool] = useState("");
  const [newVer, setNewVer] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    setProjects(window.miseManager.projects.load());
  }, []);

  useEffect(() => {
    reload();
    window.miseManager.getConfigFiles().then((res) => {
      if (res.ok) setConfigFiles(res.files);
    });
    window.miseManager.getSystemInfo().then((info) => {
      setGlobalConfig(info.settingsText || "（无）");
    });
  }, [reload]);

  const loadConfig = useCallback(async (projPath: string) => {
    setSelected(projPath);
    setSaved(false);
    setError("");
    const candidates = ["mise.toml", ".mise.toml", ".tool-versions"];
    for (const c of candidates) {
      const file = `${projPath.replace(/[\\/]+$/, "")}/${c}`;
      const res = window.miseManager.readConfigFile(file);
      if (res.ok) {
        setConfigFile(file);
        setConfigText(res.content || "");
        return;
      }
    }
    setConfigFile(`${projPath.replace(/[\\/]+$/, "")}/.mise.toml`);
    setConfigText("# 该目录还没有 mise 配置文件\n# 在此定义项目工具版本，例如:\n# [tools]\n# node = \"22\"\n");
  }, []);

  const addProject = async () => {
    const p = await window.miseManager.selectFolder();
    if (!p) return;
    const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
    window.miseManager.projects.add({ path: p, name });
    reload();
  };

  const removeProject = (p: string) => {
    if (!window.confirm(`移除项目 ${p}？`)) return;
    window.miseManager.projects.remove(p);
    if (selected === p) {
      setSelected(null);
      setConfigFile(null);
    }
    reload();
  };

  const saveConfig = () => {
    if (!configFile) return;
    setError("");
    const res = window.miseManager.saveConfigFile(configFile, configText);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onChanged();
    } else {
      setError(`保存失败: ${res.error}`);
    }
  };

  const addToolToProject = async () => {
    if (!selected || !newTool.trim()) return;
    setBusy(true);
    setError("");
    try {
      const ver = newVer.trim() ? `@${newVer.trim()}` : "";
      await window.miseManager.setProject(newTool.trim(), ver ? ver.slice(1) : "latest", selected);
      window.miseManager.notify("mise", `已写入 ${selected} 的配置: ${newTool}${ver}`);
      setNewTool("");
      setNewVer("");
      await loadConfig(selected);
      onChanged();
    } catch (e) {
      setError(`写入失败: ${String(e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 全局配置 */}
      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="text-[15px] font-semibold">🌐 全局配置（mise settings）</h3>
          {configFiles.length > 0 && (
            <span className="mono min-w-0 max-w-full truncate rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground" title={configFiles[0].path}>
              {configFiles[0].path}
            </span>
          )}
        </div>
        <pre className="detail-pre max-h-48 overflow-auto">{globalConfig}</pre>
      </Card>

      <div className="flex items-start gap-4">
        {/* 项目列表 */}
        <Card className="flex w-60 shrink-0 flex-col overflow-hidden">
          <div className="p-3">
            <Button className="w-full" onClick={addProject}>
              <Plus className="h-4 w-4" /> 添加项目目录
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {projects.map((p) => (
              <div
                key={p.path}
                onClick={() => loadConfig(p.path)}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 border-b px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/60 ${
                  selected === p.path ? "border-l-2 border-l-primary bg-accent text-accent-foreground" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="mono truncate text-[11px] text-muted-foreground">{p.path}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeProject(p.path);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {projects.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">尚无收藏项目</div>
            )}
          </div>
        </Card>

        {/* 配置编辑器 */}
        <Card className="min-w-0 flex-1 p-4">
          {!selected ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              ← 选择或添加一个项目，管理其 .mise.toml 配置
            </div>
          ) : (
            <div className="fade-in">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h3 className="mono min-w-0 truncate text-sm font-semibold">{configFile}</h3>
                <div className="ml-auto flex items-center gap-2">
                  {saved && <span className="text-xs font-medium text-primary">✓ 已保存</span>}
                  <Button size="sm" onClick={saveConfig}>
                    <Save className="h-3.5 w-3.5" /> 保存
                  </Button>
                </div>
              </div>

              {error && (
                <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input
                  className="w-36"
                  placeholder="工具名 (node)"
                  value={newTool}
                  onChange={(e) => setNewTool(e.target.value)}
                />
                <Input
                  className="w-32"
                  placeholder="版本 (22 / 留空=latest)"
                  value={newVer}
                  onChange={(e) => setNewVer(e.target.value)}
                />
                <Button variant="outline" disabled={busy || !newTool.trim()} onClick={addToolToProject}>
                  <Plus className="h-3.5 w-3.5" /> 为项目添加工具
                </Button>
              </div>

              <Textarea
                className="min-h-[220px] font-mono text-[13px]"
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
