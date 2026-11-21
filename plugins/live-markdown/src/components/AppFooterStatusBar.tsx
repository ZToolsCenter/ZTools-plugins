import React from "react";
import { AlignCenter, BookOpen, Check, ChevronDown, Cloud, Code2, Eye, FolderOpen, PanelLeft, RefreshCw, Save, Sparkles, Target, Trash2 } from "lucide-react";
import { WordCountPopover } from "./FloatingPanels";
import { WordCountStats } from "../types/typora";
import { WorkspaceScanResult } from "../types/typora";

export interface AppFooterStatusBarProps {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  currentViewMode: "live" | "source" | "reading";
  footerModeOpen: boolean;
  setFooterModeOpen: (open: boolean) => void;
  onChangeViewMode: (mode: "live" | "source" | "reading") => void;
  workspaces: WorkspaceScanResult[];
  onOpenFolder: () => void;
  webdavEnabled: boolean;
  webdavHasServer: boolean;
  webdavSyncState: "idle" | "testing" | "syncing" | "success" | "error";
  webdavStatusMessage: string;
  onSyncWebdav: () => void;
  onOpenWebdavSettings: () => void;
  selectedBlockCount: number;
  onDeleteSelectedBlocks: () => void;
  onClearSelectedBlocks: () => void;
  toastMessage: string | null;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  typewriterMode: boolean;
  onToggleTypewriterMode: () => void;
  isDirty: boolean;
  onSave: () => void;
  stats: WordCountStats;
  wordCountPopoverOpen: boolean;
  setWordCountPopoverOpen: (open: boolean) => void;
}

export const AppFooterStatusBar: React.FC<AppFooterStatusBarProps> = (props) => (
  <footer className="ty-footer-bar">
    <div className="ty-footer-left">
      <button type="button" className={`ty-footer-btn ${props.sidebarVisible ? "active" : ""}`} title="切换侧栏 (Cmd+Shift+L)" onClick={props.onToggleSidebar}>
        <PanelLeft size={13} />
        <span className="ty-footer-label-md">{props.sidebarVisible ? "收起侧栏" : "展开侧栏"}</span>
      </button>
      <div className="ty-footer-viewmode-wrap">
        <button type="button" className={`ty-footer-btn ty-footer-viewmode-btn ${props.currentViewMode === "reading" ? "is-reading" : props.currentViewMode === "source" ? "active" : ""}`} data-testid="footer-viewmode-btn" title="切换视图模式 (点击展开: 实时预览 / 源码 / 阅读)" onClick={(e) => { e.stopPropagation(); props.setFooterModeOpen(!props.footerModeOpen); }}>
          {props.currentViewMode === "reading" ? <BookOpen size={13} /> : props.currentViewMode === "source" ? <Code2 size={13} /> : <Eye size={13} />}
          <span className="ty-footer-label-md">{props.currentViewMode === "reading" ? "阅读模式" : props.currentViewMode === "source" ? "源代码" : "实时预览"}</span>
          <ChevronDown size={10} style={{ opacity: 0.6 }} />
        </button>
        {props.footerModeOpen && <div className="ty-footer-popover-menu" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`ty-footer-popover-item ${props.currentViewMode === "live" ? "is-active" : ""}`} onClick={() => { props.onChangeViewMode("live"); props.setFooterModeOpen(false); }}><Eye size={13} /><span>实时预览 (所见即所得)</span>{props.currentViewMode === "live" && <Check size={12} className="ty-menu-check" />}</button>
          <button type="button" className={`ty-footer-popover-item ${props.currentViewMode === "source" ? "is-active" : ""}`} onClick={() => { props.onChangeViewMode("source"); props.setFooterModeOpen(false); }}><Code2 size={13} /><span>源代码模式</span><span className="ty-popover-kbd">⌘/</span>{props.currentViewMode === "source" && <Check size={12} className="ty-menu-check" />}</button>
          <button type="button" className={`ty-footer-popover-item ${props.currentViewMode === "reading" ? "is-active" : ""}`} onClick={() => { props.onChangeViewMode("reading"); props.setFooterModeOpen(false); }}><BookOpen size={13} /><span>阅读模式 (只读)</span><span className="ty-popover-kbd">⇧⌘R</span>{props.currentViewMode === "reading" && <Check size={12} className="ty-menu-check" />}</button>
        </div>}
      </div>
      {props.workspaces.length > 0 && (() => {
        const list = props.workspaces;
        const label = list.length > 1 ? `${list[0].rootName} (+${list.length - 1})` : list[0].rootName;
        const title = list.length > 1 ? `当前工作区 (${list.length} 个文件夹):\n${list.map((w) => w.rootDir).join("\n")}` : `当前工作区: ${list[0].rootDir}`;
        return (
          <button type="button" className="ty-footer-btn ty-footer-workspace-btn" title={title} onClick={props.onOpenFolder}>
            <FolderOpen size={12} />
            <span className="ty-footer-workspace-name">{label}</span>
          </button>
        );
      })()}
      <button type="button" className={`ty-footer-btn ty-footer-webdav-pill ${props.webdavEnabled ? "active" : ""} ${props.webdavSyncState === "error" ? "is-error" : ""}`} data-testid="footer-webdav-btn" title={props.webdavEnabled ? props.webdavStatusMessage || "点击立即执行 WebDAV 同步" : "点击配置 WebDAV 云同步"} onClick={() => props.webdavEnabled && props.webdavHasServer ? props.onSyncWebdav() : props.onOpenWebdavSettings()}>
        {props.webdavSyncState === "syncing" || props.webdavSyncState === "testing" ? <RefreshCw size={12} className="ty-spin" /> : <Cloud size={12} />}
        <span className="ty-footer-label-sm">{props.webdavSyncState === "syncing" ? "WebDAV 同步中..." : "WebDAV"}</span>
      </button>
      {props.selectedBlockCount > 1 && <span className="ty-footer-multiselect-pill">已选中 <strong>{props.selectedBlockCount}</strong> 项
        <button type="button" className="ty-footer-multiselect-del-btn" title="删除选中模块 (按 Delete 或 Backspace)" onClick={props.onDeleteSelectedBlocks}><Trash2 size={11} />删除</button>
        <button type="button" className="ty-footer-multiselect-cancel-btn" title="取消选择 (Esc)" onClick={props.onClearSelectedBlocks}>Esc</button>
      </span>}
    </div>
    <div className="ty-footer-right">
      {props.toastMessage && <span className="ty-footer-toast ty-footer-label-sm"><Sparkles size={12} />{props.toastMessage}</span>}
      <button type="button" className={`ty-footer-btn ${props.focusMode ? "active" : ""}`} title="专注模式 (F8)" onClick={props.onToggleFocusMode}><Target size={12} /><span className="ty-footer-label-xs">专注</span></button>
      <button type="button" className={`ty-footer-btn ${props.typewriterMode ? "active" : ""}`} title="打字机滚动模式 (F9)" onClick={props.onToggleTypewriterMode}><AlignCenter size={12} /><span className="ty-footer-label-xs">打字机</span></button>
      {props.isDirty && <button type="button" className="ty-footer-btn ty-unsaved-pill" title="点击立即保存 (Cmd+S)" onClick={props.onSave}><Save size={12} /><span>未保存</span></button>}
      <div className="ty-footer-wordcount-wrap">
        <button type="button" className="ty-footer-btn" title="点击查看详细字数与阅读耗时统计" onClick={(e) => { e.stopPropagation(); props.setWordCountPopoverOpen(!props.wordCountPopoverOpen); }}>
          <span>{props.stats.words.toLocaleString()} 词</span><span className="ty-footer-sep ty-footer-label-xs">·</span><span className="ty-footer-label-xs">{props.stats.charsNoSpaces.toLocaleString()} 字</span>
        </button>
        <WordCountPopover open={props.wordCountPopoverOpen} stats={props.stats} onClose={() => props.setWordCountPopoverOpen(false)} />
      </div>
    </div>
  </footer>
);
