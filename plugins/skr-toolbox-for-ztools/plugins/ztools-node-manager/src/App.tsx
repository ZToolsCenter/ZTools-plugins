import React, { useState, useEffect, useRef } from 'react';
import './types'; // 引用全局声明

interface NodeVersion {
  version: string;
  isCurrent: boolean;
}

interface LogLine {
  id: number;
  projName: string;
  text: string;
}

const stripAnsi = (str: string) => {
  return str.replace(/\u001b\[[0-9;]*[mGKHJKfA-D]/g, '').replace(/\r/g, '');
};

const Console: React.FC<{ logs: string[]; onClear: () => void; isVisible: boolean; toggle: () => void }> = ({ logs, onClear, isVisible, toggle }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const renderLineWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return <a key={i} className="terminal-link" href="#" onClick={(e) => { e.preventDefault(); window.nodeManager.openExternal(part); }}>{part}</a>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  useEffect(() => {
    if (isVisible && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isVisible]);

  if (!isVisible) return (
      <div style={{ marginTop: '12px', textAlign: 'right' }}>
          <button className="btn-small btn-outline" style={{ border: 'none', color: '#64748b' }} onClick={toggle}>
              显示运行日志 {logs.length > 0 && `(${logs.length})`}
          </button>
      </div>
  );

  return (
    <div className="project-console">
      <div className="console-header">
        <div className="console-title">终端输出 ({logs.length})</div>
        <div className="card-actions">
          <button className="btn-small btn-outline" style={{ border: 'none', color: '#94a3b8' }} onClick={onClear}>清空</button>
          <button className="btn-small btn-outline" style={{ border: 'none', color: '#94a3b8' }} onClick={toggle}>折叠</button>
        </div>
      </div>
      <div className="console-body" ref={scrollRef}>
        {logs.length === 0 && <div style={{ color: '#444', textAlign: 'center', marginTop: '20px' }}>等待输出...</div>}
        {logs.map((text, i) => (
          <div key={i} className="terminal-line">{renderLineWithLinks(text)}</div>
        ))}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<'node' | 'npm' | 'projects'>('node');
  const [installedVersions, setInstalledVersions] = useState<NodeVersion[]>([]);
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [registries, setRegistries] = useState<Record<string, string>>({});
  const [currentRegistry, setCurrentRegistry] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRegName, setNewRegName] = useState('');
  const [newRegUrl, setNewRegUrl] = useState('');
  const [installProgress, setInstallProgress] = useState<Record<string, number>>({});
  
  // 安装弹窗相关状态
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [fullVersions, setFullVersions] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoadingFullList, setIsLoadingFullList] = useState(false);

  // 项目管理相关状态
  const [projects, setProjects] = useState<any[]>([]);
  const [runningScripts, setRunningScripts] = useState<Record<string, boolean>>({});
  const [projectLogs, setProjectLogs] = useState<Record<string, string[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const nm = window.nodeManager;

  useEffect(() => {
    loadData();
    window.ztools?.onPluginEnter((action) => {
        if (action.code === 'node-manager') {
            loadData();
        }
    });
  }, [activePage]);

  const loadData = async () => {
    if (activePage === 'node') {
      loadNodeVersions();
    } else if (activePage === 'npm') {
      loadRegistries();
    } else {
      loadProjects();
    }
  };

  const loadProjects = () => {
    const list = nm.projects.load();
    setProjects(list);
  };

  const toggleTerminal = (projId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projId)) next.delete(projId);
      else next.add(projId);
      return next;
    });
  };

  const handleAddProject = async () => {
    const path = await nm.projects.selectFolder();
    if (!path) return;
    
    const pkg = nm.projects.getPackageJson(path);
    if (!pkg) return nm.notify("提示", "该目录下未找到 package.json，请确认是否为前端项目");
    
    const newProj = {
      id: Date.now().toString(),
      name: pkg.name || path.split(/[\\/]/).pop() || '未命名项目',
      path: path,
      nodeVersion: '',
      scripts: pkg.scripts || {},
      status: 'idle'
    };
    
    const newList = [...projects, newProj];
    nm.projects.save(newList);
    setProjects(newList);
    nm.notify("成功", `项目 ${newProj.name} 已添加`);
  };

  const handleRemoveProject = (id: string) => {
    if (!confirm("确定移除该项目吗？")) return;
    const newList = projects.filter(p => p.id !== id);
    nm.projects.save(newList);
    setProjects(newList);
  };

  const handleUpdateProjectNode = (id: string, version: string) => {
    const newList = projects.map(p => p.id === id ? { ...p, nodeVersion: version } : p);
    nm.projects.save(newList);
    setProjects(newList);
  };

  const handleRunScript = async (projId: string, path: string, script: string, nodeVersion: string) => {
    const key = `${projId}-${script}`;
    if (runningScripts[key]) return;

    setRunningScripts(prev => ({ ...prev, [key]: true }));
    setExpandedProjects(prev => new Set(prev).add(projId));

    try {
      nm.notify("启动", `正在运行 ${script}...`);
      await nm.projects.runScript(projId, path, script, nodeVersion, (data) => {
          setProjectLogs(prev => {
              const current = prev[projId] || [];
              const cleanedData = stripAnsi(data);
              if (!cleanedData.trim() && data.includes('[')) return prev;
              const updated = [...current, cleanedData];
              return { ...prev, [projId]: updated.slice(-300) };
          });
      });
      nm.notify("完成", `${script} 执行成功`);
    } catch (e: any) {
      if (e.message !== 'Exit null' && e.message !== 'Exit SIGTERM') {
        nm.notify("失败", e.message);
      }
    } finally {
      setRunningScripts(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleStopScript = (projId: string, script: string) => {
      nm.projects.stopScript(projId, script);
  };

  const clearProjectLogs = (projId: string) => {
      setProjectLogs(prev => ({ ...prev, [projId]: [] }));
  };

  const handleStartStatic = async (proj: any) => {
    try {
      const port = await nm.projects.startStaticServer(proj.path);
      nm.notify("静态服务已启动", `端口: ${port}`);
    } catch (e: any) {
      nm.notify("启动失败", e.message);
    }
  };

  const loadNodeVersions = async () => {
    setIsRefreshing(true);
    try {
      const [installed, available] = await Promise.all([
        nm.getInstalledVersions(),
        nm.getAvailableVersions()
      ]);
      setInstalledVersions(installed);
      setAvailableVersions(available);
    } catch (e) {
      nm.notify("错误", "获取列表失败: " + e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadFullVersions = async () => {
    setIsLoadingFullList(true);
    try {
      const list = await nm.getFullVersionList();
      setFullVersions(list);
    } catch (e) {
      nm.notify("错误", "获取完整版本列表失败");
    } finally {
      setIsLoadingFullList(false);
    }
  };

  const loadRegistries = async () => {
    try {
      const [current, map] = await Promise.all([
        nm.getCurrentRegistry(),
        nm.getRegistryMap()
      ]);
      setRegistries(map as Record<string, string>);
      setCurrentRegistry(current);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUseVersion = async (v: string) => {
    try {
      await nm.useVersion(v);
      nm.notify("完成", `已切换至 Node v${v}`);
      loadNodeVersions();
    } catch (e: any) {
      nm.notify("失败", e.toString());
    }
  };

  const handleInstallVersion = async (v: string) => {
    setInstallProgress(prev => ({ ...prev, [v]: 1 }));
    try {
      await nm.installVersion(v, (p) => {
        setInstallProgress(prev => ({ ...prev, [v]: p }));
      });
      nm.notify("完成", `已安装 Node v${v}`);
      setInstallProgress(prev => {
        const next = { ...prev };
        delete next[v];
        return next;
      });
      loadNodeVersions();
    } catch (e: any) {
      console.error("Installation error:", e);
      const errorMsg = e.message || e.toString();
      let suggestion = "";
      if (errorMsg.includes("not yet released") || errorMsg.includes("not available")) {
        suggestion = "\n\n💡 提示：该版本可能尚未在当前镜像源上线。请尝试切换镜像源重试。";
      }
      nm.notify("安装失败", `Node v${v} 安装出错：\n${errorMsg}${suggestion}`);
      setInstallProgress(prev => {
        const next = { ...prev };
        delete next[v];
        return next;
      });
      loadNodeVersions();
    }
  };

  const handleUninstallVersion = async (v: string) => {
    if (!confirm(`确认删除版本 v${v}？`)) return;
    try {
      await nm.uninstallVersion(v);
      nm.notify("完成", `已删除 Node v${v}`);
      loadNodeVersions();
    } catch (e: any) {
      nm.notify("删除失败", e.toString());
    }
  };

  const handleOpenDir = async (v: string) => {
    try {
      await nm.openVersionDir(v);
    } catch (e: any) {
      nm.notify("错误", e.toString());
    }
  };

  const handleSetRegistry = async (name: string) => {
    try {
      await nm.setRegistry(name);
      nm.notify("完成", `npm 源已切换至 ${name}`);
      loadRegistries();
    } catch (e: any) {
      nm.notify("失败", e.toString());
    }
  };

  const handleAddRegistry = () => {
    if (!newRegName || !newRegUrl) return nm.notify("提示", "名称和 URL 不能为空");
    if (!newRegUrl.startsWith('http')) return nm.notify("提示", "请输入合法的 URL (http/https)");
    try {
      nm.addRegistry(newRegName, newRegUrl);
      nm.notify("成功", `镜像源 ${newRegName} 已添加`);
      setIsModalOpen(false);
      setNewRegName('');
      setNewRegUrl('');
      loadRegistries();
    } catch (e: any) {
      nm.notify("错误", e.message);
    }
  };

  const handleRemoveRegistry = (name: string) => {
    if (!confirm(`确定删除自定义镜像源 "${name}" 吗？`)) return;
    try {
      nm.removeRegistry(name);
      nm.notify("完成", `镜像源 ${name} 已删除`);
      loadRegistries();
    } catch (e: any) {
      nm.notify("错误", e.message);
    }
  };

  const renderProgressRing = () => {
    return (
      <div className="card-actions">
        <div className="progress-ring">
          <svg width="24" height="24" className="spinning">
            <circle className="bg" cx="12" cy="12" r="9"></circle>
            <circle className="fg" cx="12" cy="12" r="9" 
              style={{ strokeDasharray: 56.5, strokeDashoffset: 40 }}></circle>
          </svg>
        </div>
      </div>
    );
  };

  const filteredVersions = fullVersions.filter((v: any) => 
    v.version.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredVersions.length / pageSize);
  const currentTableData = filteredVersions.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <>
      <div className="sidebar">
        <div className="logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          NodeDash
        </div>
        <div className={`nav-item ${activePage === 'node' ? 'active' : ''}`} onClick={() => setActivePage('node')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
          Node 版本
        </div>
        <div className={`nav-item ${activePage === 'npm' ? 'active' : ''}`} onClick={() => setActivePage('npm')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          npm 源管理
        </div>
        <div className={`nav-item ${activePage === 'projects' ? 'active' : ''}`} onClick={() => setActivePage('projects')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          项目管理
        </div>
      </div>

      <div className="content">
        {activePage === 'node' && (
          <div id="page-node">
            <div className="section-title">
              <span>Node 版本管理</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-primary" onClick={() => { setIsInstallModalOpen(true); loadFullVersions(); }}>
                  安装 Node 版本
                </button>
                <button className="btn btn-outline" onClick={loadNodeVersions}>
                  <svg className={isRefreshing ? 'spinning' : ''} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                  刷新列表
                </button>
              </div>
            </div>
            <div className="banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              <span>Node 版本切换功能依赖 <strong>nvm-windows</strong>。请确保已安装并具有管理员权限。</span>
            </div>

            <div className="sub-heading">已安装版本</div>
            <div className="card-list">
              {Object.keys(installProgress).map(v => (
                <div key={`installing-${v}`} className="card" style={{ borderColor: 'var(--primary)', animation: 'pulse 2s infinite' }}>
                  <div className="card-info">
                    <div className="card-name">正在安装 v{v}</div>
                    <div className="card-meta">正在通过 nvm 下载并安装...</div>
                  </div>
                  {renderProgressRing()}
                </div>
              ))}
              {installedVersions.map(v => (
                <div key={v.version} className={`card ${v.isCurrent ? 'active' : ''}`}>
                  <div className="card-info">
                    <div className="card-name">v{v.version} {v.isCurrent && <span className="tag">Current</span>}</div>
                    <div className="card-meta">Local Installed</div>
                  </div>
                  <div className="card-actions">
                    <button className="btn btn-outline btn-small" style={{ padding: '6px' }} onClick={() => handleOpenDir(v.version)} title="打开安装目录">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    </button>
                    {!v.isCurrent && <button className="btn btn-primary" onClick={() => handleUseVersion(v.version)}>切换使用</button>}
                    <button className="btn btn-danger" onClick={() => handleUninstallVersion(v.version)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activePage === 'npm' && (
          <div id="page-npm">
            <div className="section-title">
              <span>npm 源管理</span>
              <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                新增自定义源
              </button>
            </div>
            <div className="card-list">
              {Object.entries(registries).map(([name, url]) => {
                const isActive = currentRegistry.includes(url.replace('https:', '').replace('http:', ''));
                const isBuiltIn = nm.getBuiltInRegistryKeys().includes(name);
                return (
                  <div key={name} className={`card ${isActive ? 'active' : ''}`}>
                    <div className="card-info">
                      <div className="card-name">{name} {isActive && <span className="tag">Active</span>}</div>
                      <div className="card-meta">{url}</div>
                    </div>
                    <div className="card-actions">
                      {!isActive && <button className="btn btn-primary" onClick={() => handleSetRegistry(name)}>切换</button>}
                      {!isBuiltIn && <button className="btn btn-danger" style={{ padding: '8px' }} onClick={() => handleRemoveRegistry(name)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {activePage === 'projects' && (
          <div id="page-projects">
            <div className="section-title">
              <span>前端项目管理</span>
              <div className="card-actions">
                <button className="btn btn-primary" onClick={handleAddProject}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  添加项目
                </button>
              </div>
            </div>
            
            <div className="card-list">
              {projects.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>还未添加任何项目，快去点击“添加项目”吧！</div>}
              {projects.map(proj => (
                <div key={proj.id} className="project-item-group" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="card project-card" style={{ marginBottom: 0, borderRadius: '6px 6px 0 0' }}>
                    <div style={{ flex: 1 }}>
                      <div className="card-name">
                        <span className={`status-indicator ${Object.keys(runningScripts).some(k => k.startsWith(proj.id) && runningScripts[k]) ? 'status-running' : 'status-idle'}`}></span>
                        {proj.name}
                      </div>
                      <div className="card-path">{proj.path}</div>
                      
                      <div className="scripts-group">
                        {Object.keys(proj.scripts).map(scriptName => {
                          const isRunning = runningScripts[`${proj.id}-${scriptName}`];
                          return (
                            <button 
                              key={scriptName} 
                              className={`btn btn-outline btn-small ${isRunning ? 'active' : ''}`}
                              onClick={() => isRunning ? handleStopScript(proj.id, scriptName) : handleRunScript(proj.id, proj.path, scriptName, proj.nodeVersion)}
                              title={isRunning ? "点击停止" : "运行脚本"}
                            >
                              {isRunning && <svg className="spinning" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>}
                              {isRunning ? `停止 ${scriptName}` : scriptName}
                            </button>
                          );
                        })}
                        <button className="btn btn-outline btn-small" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} onClick={() => handleStartStatic(proj)}>
                          静态预览
                        </button>
                      </div>
                    </div>
                    
                    <div className="card-actions" style={{ flexDirection: 'column', alignItems: 'flex-end', minWidth: '120px' }}>
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ fontSize: '0.75rem', marginRight: '6px', color: '#94a3b8' }}>运行版本:</label>
                        <select 
                          className="version-select" 
                          value={proj.nodeVersion} 
                          onChange={(e) => handleUpdateProjectNode(proj.id, e.target.value)}
                        >
                          <option value="">默认版本</option>
                          {installedVersions.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}
                        </select>
                      </div>
                      <button className="btn btn-danger btn-small" onClick={() => handleRemoveProject(proj.id)}>移除项目</button>
                    </div>
                  </div>
                  <Console 
                    logs={projectLogs[proj.id] || []} 
                    isVisible={expandedProjects.has(proj.id)}
                    toggle={() => toggleTerminal(proj.id)}
                    onClear={() => clearProjectLogs(proj.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isInstallModalOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '800px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid #333' }}>
              <div className="modal-title" style={{ margin: 0 }}>安装 Node 版本</div>
              <button className="btn-close" onClick={() => setIsInstallModalOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            
            <div style={{ padding: '16px 0' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="搜索版本号 (例如: 18.16.0)" 
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
              {isLoadingFullList ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>正在加载版本数据...</div>
              ) : (
                <table className="version-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left' }}>
                      <th style={{ padding: '12px' }}>Version</th>
                      <th style={{ padding: '12px' }}>LTS</th>
                      <th style={{ padding: '12px' }}>Date</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTableData.map((v: any) => {
                       const isInstalled = installedVersions.some(i => i.version === v.version.replace('v', ''));
                       return (
                        <tr key={v.version} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '12px' }}><strong>{v.version}</strong></td>
                          <td style={{ padding: '12px' }}><span style={{ color: v.lts ? '#4ade80' : '#64748b' }}>{v.lts || '-'}</span></td>
                          <td style={{ padding: '12px', color: '#94a3b8' }}>{v.date}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            {isInstalled ? <span style={{ color: '#4ade80' }}>已安装</span> : (
                              <button 
                                className="btn-tiny btn-link" 
                                style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer' }}
                                onClick={() => {
                                  handleInstallVersion(v.version.replace('v', ''));
                                  setIsInstallModalOpen(false);
                                }}
                              >
                                Install
                              </button>
                            )}
                          </td>
                        </tr>
                       );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #333' }}>
              <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Total {filteredVersions.length}</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select 
                  className="version-select" 
                  value={pageSize} 
                  onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                >
                  <option value={10}>10/page</option>
                  <option value={20}>20/page</option>
                  <option value={50}>50/page</option>
                  <option value={100}>100/page</option>
                </select>
                <div className="pagination" style={{ display: 'flex', gap: '4px' }}>
                  <button className="btn-tiny" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>{"<"}</button>
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    let pageNum = currentPage;
                    if (totalPages <= 5) pageNum = i + 1;
                    else {
                      if (currentPage <= 3) pageNum = i + 1;
                      else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button 
                        key={i} 
                        className={`btn-tiny ${currentPage === pageNum ? 'active' : ''}`}
                        onClick={() => setCurrentPage(pageNum)}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button className="btn-tiny" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>{">"}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">添加自定义镜像源</div>
            <div className="form-group">
              <label className="form-label">名称 (如: my-npm)</label>
              <input type="text" className="form-input" value={newRegName} onChange={e => setNewRegName(e.target.value)} placeholder="请输入唯一名称" />
            </div>
            <div className="form-group">
              <label className="form-label">镜像 URL</label>
              <input type="text" className="form-input" value={newRegUrl} onChange={e => setNewRegUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setIsModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddRegistry}>立即保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default App;
