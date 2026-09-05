import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  FileArchive,
  FileImage,
  FileOutput,
  FileText,
  FolderOpen,
  Gauge,
  HardDriveDownload,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  ScanLine,
  RotateCcw,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle
} from "lucide-react";
import { bytesLabel, formatDefinition, FORMAT_DEFINITIONS, PROFILE_COPY, TARGET_GROUPS } from "./lib/formats";
import type {
  ApiEnvelope,
  CollisionPolicy,
  ConversionCapabilities,
  ConversionJob,
  ConversionPlan,
  ConversionProfile,
  ConversionRequest,
  FormatId,
  InputGrant,
  OutputGrant,
  RuntimeInfo
} from "./types";

function unwrap<T>(envelope: ApiEnvelope<T>): T {
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.data;
}

function extractLaunchPaths(payload: unknown): string[] {
  if (typeof payload === "string") return [payload];
  if (!Array.isArray(payload)) return [];
  return payload.flatMap(item => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const candidate = record.path ?? record.filePath;
      return typeof candidate === "string" ? [candidate] : [];
    }
    return [];
  });
}

function runtimeTone(runtime: RuntimeInfo) {
  return runtime.available ? "ready" : runtime.bundled ? "error" : "optional";
}

function statusIcon(status: string) {
  if (status === "succeeded") return <CheckCircle2 size={16} />;
  if (status === "failed") return <XCircle size={16} />;
  if (status === "running") return <LoaderCircle size={16} className="spin" />;
  if (status === "cancelled") return <CircleStop size={16} />;
  return <Clock3 size={16} />;
}

function rendererHostIsSupported() {
  if (!window.ztools) return true;
  try {
    return window.formatConverter?.hostCompatibility?.().supported === true;
  } catch {
    return false;
  }
}

export default function App() {
  if (!rendererHostIsSupported()) {
    return <main className="app-shell"><section className="workspace"><div className="error-banner"><AlertTriangle size={18} /><span>当前 ZTools 版本过低或无法识别（最低支持 2.4.0）。为了获得更完整、稳定的体验，请升级后再使用格式转换。</span></div></section></main>;
  }
  return <FormatConverterApp />;
}

function FormatConverterApp() {
  const api = window.formatConverter;
  const [capabilities, setCapabilities] = useState<ConversionCapabilities | null>(null);
  const [inputGrant, setInputGrant] = useState<InputGrant | null>(null);
  const [outputGrant, setOutputGrant] = useState<OutputGrant | null>(null);
  const [target, setTarget] = useState<FormatId>("pdf");
  const [profile, setProfile] = useState<ConversionProfile>("visual");
  const [collision, setCollision] = useState<CollisionPolicy>("rename");
  const [dpi, setDpi] = useState(144);
  const [allowFallback, setAllowFallback] = useState(true);
  const [plan, setPlan] = useState<ConversionPlan | null>(null);
  const [job, setJob] = useState<ConversionJob | null>(null);
  const [busy, setBusy] = useState<"inputs" | "output" | "plan" | "start" | "runtime" | null>(null);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [installingRuntime, setInstallingRuntime] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const request = useMemo<ConversionRequest | null>(() => {
    if (!inputGrant || !outputGrant) return null;
    return {
      inputGrantId: inputGrant.id,
      outputGrantId: outputGrant.id,
      target,
      profile,
      collision,
      options: { dpi, allowFallback, ocrLanguages: ["eng", "chi_sim"] }
    };
  }, [inputGrant, outputGrant, target, profile, collision, dpi, allowFallback]);

  useEffect(() => {
    if (!api) {
      setError("未检测到 ZTools preload。请通过 ZTools 打开插件，或确认构建产物包含 preload/services.cjs。");
      return;
    }
    let active = true;
    void api.getCapabilities().then(result => {
      if (!active) return;
      setCapabilities(unwrap(result));
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));

    window.ztools?.onPluginEnter?.(param => {
      const paths = extractLaunchPaths(param.payload);
      if (!paths.length) return;
      void api.acceptInputs(paths).then(result => setInputGrant(unwrap(result))).catch(reason => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!request || !api) {
      setPlan(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(current => current === "start" ? current : "plan");
      void api.planConversion(request).then(result => {
        if (!active) return;
        setPlan(unwrap(result));
        setError("");
      }).catch(reason => {
        if (!active) return;
        setPlan(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => {
        if (active) setBusy(current => current === "plan" ? null : current);
      });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, request]);

  useEffect(() => {
    if (!api || !job || !["queued", "running"].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void api.getJob(job.id).then(result => setJob(unwrap(result))).catch(() => undefined);
    }, 650);
    return () => window.clearInterval(timer);
  }, [api, job?.id, job?.status]);

  const selectInputs = async () => {
    if (!api) return;
    setBusy("inputs"); setError("");
    try {
      const grant = unwrap(await api.selectInputs());
      if (grant) { setInputGrant(grant); setJob(null); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(null); }
  };

  const captureScreen = async () => {
    if (!api) return;
    setBusy("inputs"); setError("");
    try { setInputGrant(unwrap(await api.captureScreen())); setJob(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  const dragOutput = async (event: React.DragEvent, outputs: string[]) => {
    event.preventDefault();
    if (!api) return;
    try { unwrap(await api.startDrag(outputs)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const selectOutput = async () => {
    if (!api) return;
    setBusy("output"); setError("");
    try {
      const grant = unwrap(await api.selectOutputDirectory());
      if (grant) setOutputGrant(grant);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(null); }
  };

  const acceptFiles = async (files: FileList) => {
    if (!api) return;
    const paths = Array.from(files).map(file => window.ztools?.getPathForFile?.(file) || "").filter(Boolean);
    if (!paths.length) { setError("ZTools 未能解析拖入文件的本地路径。"); return; }
    setBusy("inputs"); setError("");
    try { setInputGrant(unwrap(await api.acceptInputs(paths))); setJob(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  const start = async () => {
    if (!api || !request || !plan?.executable) return;
    setBusy("start"); setError("");
    try { setJob(unwrap(await api.startConversion(request))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  const cancel = async () => {
    if (!api || !job) return;
    try { setJob(unwrap(await api.cancelJob(job.id))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const retry = async () => {
    if (!api || !job) return;
    try { setJob(unwrap(await api.retryFailed(job.id))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const refreshRuntimes = async () => {
    if (!api || !capabilities) return;
    setBusy("runtime");
    try {
      const runtimes = unwrap(await api.refreshRuntimes());
      setCapabilities({ ...capabilities, runtimes });
    } finally { setBusy(null); }
  };

  const installOfficeCli = async () => {
    if (!api || !capabilities) return;
    setBusy("runtime"); setError("");
    try {
      await api.installOfficeCli().then(unwrap);
      const runtimes = unwrap(await api.refreshRuntimes());
      setCapabilities({ ...capabilities, runtimes });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };

  const installRuntime = async (runtime: RuntimeInfo) => {
    if (!api || !capabilities || !runtime.installable) return;
    const estimate = runtime.estimateMb ? `，预计下载约 ${runtime.estimateMb} MB` : "";
    if (!window.confirm(`安装${runtime.label}${estimate}？\n\n将优先从国内镜像下载固定版本依赖，校验完整性后安装到 ZTools 数据目录。`)) return;
    setInstallingRuntime(runtime.id); setError("");
    try {
      const runtimes = unwrap(await api.installRuntime(runtime.id));
      setCapabilities({ ...capabilities, runtimes });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setInstallingRuntime(null); }
  };

  const sourceFormats = useMemo(() => Array.from(new Set(inputGrant?.files.map(file => file.format) || [])), [inputGrant]);
  const progressLabel = job ? `${job.summary.succeeded + job.summary.failed + job.summary.skipped}/${job.summary.total}` : "";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Route size={20} /></div>
          <div><strong>格式转换</strong><span>LOCAL CONVERSION ROUTER</span></div>
        </div>
        <div className="top-actions">
          <span className="privacy-pill"><ShieldCheck size={15} />文件默认仅在本机处理</span>
          <button className="icon-button" aria-label="转换设置" onClick={() => setShowSettings(value => !value)}><Settings2 size={18} /></button>
        </div>
      </header>

      <main className="workspace">
        <section className="intro-band">
          <div>
            <span className="eyebrow">BATCH · OFFICE · PDF · IMAGE · DATA</span>
            <h1>把文件送上正确的转换路径</h1>
            <p>先检查格式和本机引擎，再执行批量转换。保真、可编辑和 OCR 路线会明确标注，不把有损转换藏起来。</p>
          </div>
          <div className="intro-stats">
            <div><strong>{FORMAT_DEFINITIONS.length}</strong><span>目标格式</span></div>
            <div><strong>{capabilities?.runtimes.filter(item => item.available).length ?? "—"}</strong><span>可用引擎</span></div>
            <div><strong>200</strong><span>单批文件</span></div>
          </div>
        </section>

        {error && <div className="error-banner"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => setError("")}>关闭</button></div>}

        <div className="route-grid">
          <section className="panel source-panel">
            <div className="panel-heading"><div><span>01 · INPUT</span><h2>输入批次</h2></div>{inputGrant && <button className="text-button danger" onClick={() => { setInputGrant(null); setPlan(null); setJob(null); }}><Trash2 size={15} />清空</button>}</div>
            <div
              className={`drop-zone ${dragging ? "dragging" : ""}`}
              onDragEnter={event => { event.preventDefault(); dragDepth.current += 1; setDragging(true); }}
              onDragOver={event => event.preventDefault()}
              onDragLeave={event => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }}
              onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void acceptFiles(event.dataTransfer.files); }}
              onClick={() => void selectInputs()}
              role="button"
              tabIndex={0}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") void selectInputs(); }}
            >
              {busy === "inputs" ? <LoaderCircle className="spin" size={30} /> : <Layers3 size={30} />}
              <strong>{inputGrant ? "继续添加或重新选择" : "拖入文件，或点击选择"}</strong>
              <span>Office、PDF、图片、文本与数据文件 · 最多 200 个</span>
            </div>
            {api?.canCaptureScreen() && <button className="text-button" disabled={busy === "inputs"} onClick={() => void captureScreen()}><ScanLine size={15} />截图导入</button>}
            <div className="file-list">
              {inputGrant?.files.map(file => {
                const definition = formatDefinition(file.format);
                return <div className="file-row" key={file.path}>
                  <span className="format-dot" style={{ background: definition.color }}>{definition.label.slice(0, 1)}</span>
                  <div><strong title={file.path}>{file.name}</strong><span>{definition.label} · {bytesLabel(file.size)}</span></div>
                  <Check size={16} />
                </div>;
              })}
              {!inputGrant && <div className="empty-note">选择文件后，这里会显示格式识别和预检结果。</div>}
            </div>
            {inputGrant && <div className="batch-summary"><span>{inputGrant.files.length} 个文件</span><span>{bytesLabel(inputGrant.totalBytes)}</span></div>}
          </section>

          <section className="panel route-panel">
            <div className="panel-heading"><div><span>02 · ROUTE</span><h2>转换路径</h2></div><Route size={20} /></div>
            <div className="route-visual" aria-label="转换路径预览">
              <div className="route-node source">
                {sourceFormats.length ? sourceFormats.slice(0, 3).map(id => <span key={id} style={{ borderColor: formatDefinition(id).color }}>{formatDefinition(id).label}</span>) : <span>输入</span>}
              </div>
              <div className="route-track"><i /><ArrowRight size={20} /></div>
              <div className="route-node target" style={{ borderColor: formatDefinition(target).color }}><strong>{formatDefinition(target).label}</strong><span>{PROFILE_COPY[profile].short}</span></div>
            </div>

            <div className="control-block">
              <label>质量模式</label>
              <div className="profile-switch">
                {(Object.keys(PROFILE_COPY) as ConversionProfile[]).map(id => <button key={id} className={profile === id ? "active" : ""} onClick={() => setProfile(id)}><strong>{PROFILE_COPY[id].label}</strong><span>{PROFILE_COPY[id].short}</span></button>)}
              </div>
              <p className="control-help">{PROFILE_COPY[profile].description}</p>
            </div>

            <div className="control-block">
              <label htmlFor="collision">同名文件</label>
              <div className="select-wrap"><select id="collision" value={collision} onChange={event => setCollision(event.target.value as CollisionPolicy)}><option value="rename">自动重命名（推荐）</option><option value="skip">跳过</option><option value="overwrite">验证后覆盖</option></select><ChevronDown size={16} /></div>
            </div>

            <div className="control-block compact-row">
              <label htmlFor="dpi">图像清晰度</label>
              <input id="dpi" type="range" min="72" max="300" step="24" value={dpi} onChange={event => setDpi(Number(event.target.value))} />
              <output>{dpi} DPI</output>
            </div>
            <label className="check-row"><input type="checkbox" checked={allowFallback} onChange={event => setAllowFallback(event.target.checked)} /><span><strong>允许受控降级</strong><small>首选引擎不可用时使用已列出的备用路线</small></span></label>

            <div className={`plan-card ${plan?.executable ? "ready" : "waiting"}`}>
              <div>{busy === "plan" ? <LoaderCircle className="spin" size={18} /> : plan?.executable ? <CheckCircle2 size={18} /> : <Gauge size={18} />}<strong>{plan?.executable ? "路线已就绪" : inputGrant && outputGrant ? "正在检查路线" : "等待输入和输出目录"}</strong></div>
              {plan && <><p>{plan.items[0]?.route.description}</p><span>{plan.estimatedOutputCount} 个预计输出 · {plan.items[0]?.route.engines.join(" → ")}</span></>}
              {plan?.warnings.slice(0, 2).map(warning => <small key={warning}><AlertTriangle size={13} />{warning}</small>)}
            </div>
          </section>

          <section className="panel target-panel">
            <div className="panel-heading"><div><span>03 · OUTPUT</span><h2>目标与位置</h2></div><FileOutput size={20} /></div>
            <div className="target-groups">
              {TARGET_GROUPS.map(group => <div key={group.label}><label>{group.label}</label><div className="target-options">{group.ids.map(id => { const item = formatDefinition(id); return <button key={id} className={target === id ? "active" : ""} style={{ "--format-color": item.color } as React.CSSProperties} onClick={() => setTarget(id)}><span>{item.label}</span></button>; })}</div></div>)}
            </div>
            <button className={`directory-card ${outputGrant ? "selected" : ""}`} onClick={() => void selectOutput()}>
              <FolderOpen size={21} />
              <span><strong>{outputGrant ? "输出到" : "选择输出目录"}</strong><small>{outputGrant?.directory || "选择后将同时授权 MCP 在此目录写入"}</small></span>
              {busy === "output" ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            </button>
            <button className="primary-action" disabled={!plan?.executable || busy === "start" || job?.status === "running"} onClick={() => void start()}>
              {busy === "start" ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
              开始转换
            </button>
            <p className="action-note"><ShieldCheck size={14} />源文件不会被修改；输出完成校验后才会发布。</p>
          </section>
        </div>

        {job && <section className="job-drawer">
          <div className="job-header">
            <div><span>ACTIVE JOB · {job.id.slice(0, 8)}</span><h2>{job.status === "running" ? "正在转换" : job.status === "succeeded" ? "转换完成" : job.status === "partial" ? "部分完成" : job.status === "failed" ? "转换失败" : "等待执行"}</h2></div>
            <div className="job-actions"><strong>{progressLabel}</strong>{["queued", "running"].includes(job.status) && <button onClick={() => void cancel()}><CircleStop size={16} />取消</button>}{["partial", "failed"].includes(job.status) && <button onClick={() => void retry()}><RotateCcw size={16} />重试失败项</button>}</div>
          </div>
          <div className="progress-track"><i style={{ width: `${job.progress}%` }} /></div>
          <div className="job-items">{job.items.map(item => <div className={`job-item ${item.status}`} key={item.id}><span className="job-status">{statusIcon(item.status)}</span><div><strong>{item.input.name}</strong><small>{item.route.description}</small></div><span>{item.progress}%</span>{item.outputs.length > 0 && <button draggable={api?.canStartDrag()} onDragStart={event => void dragOutput(event, item.outputs)} onClick={() => void api?.revealPath(item.outputs[0])}><FolderOpen size={15} />{item.outputs.length} 个输出</button>}{item.error && <em title={item.error.message}>{item.error.message}</em>}</div>)}</div>
        </section>}

        <section className="runtime-strip">
          <div className="runtime-title"><HardDriveDownload size={19} /><div><strong>转换引擎</strong><span>首次使用时确认并按需安装</span></div><button onClick={() => void refreshRuntimes()} disabled={busy === "runtime"}><RefreshCw size={15} className={busy === "runtime" ? "spin" : ""} />刷新</button></div>
          <div className="runtime-list">{capabilities?.runtimes.map(runtime => <div className={`runtime-pill ${runtimeTone(runtime)}`} key={runtime.id}><i /> <span><strong>{runtime.label}</strong><small>{runtime.available ? runtime.version || "可用" : runtime.note}</small></span>{runtime.id === "officecli" && !runtime.available && <button onClick={() => void installOfficeCli()}>一键安装</button>}{runtime.installable && !runtime.available && <button disabled={installingRuntime !== null} onClick={() => void installRuntime(runtime)}>{installingRuntime === runtime.id ? "安装中…" : "按需安装"}</button>}</div>)}</div>
        </section>

        {showSettings && <div className="settings-popover">
          <div className="settings-heading"><Sparkles size={18} /><div><strong>转换设置</strong><span>安全与兼容策略</span></div><button onClick={() => setShowSettings(false)}>关闭</button></div>
          <label><span><strong>默认仅本机处理</strong><small>OCR 模型和运行时安装是唯一可能访问网络的步骤。</small></span><Check size={18} /></label>
          <label><span><strong>写入授权目录</strong><small>{outputGrant?.directory || "尚未选择；MCP 不能执行写入转换。"}</small></span><FolderOpen size={18} /></label>
          <label><span><strong>引擎兼容</strong><small>Office 导出依次尝试 OfficeCLI、LibreOffice 和浏览器渲染。</small></span><FileArchive size={18} /></label>
        </div>}
      </main>
    </div>
  );
}
