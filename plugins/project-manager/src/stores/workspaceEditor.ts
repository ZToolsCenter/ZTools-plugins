import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import type { EditorFileSnapshot, EditorWriteResult } from '../api/types';
import type { Project } from '../types';
import { editorLanguageForPath, type EditorLanguage } from '../utils/editorLanguage';
import { fileKind, mimeForFile } from '../utils/fileTypes';
import { editorDocumentKey, normalizeWorkspaceRelativePath, remapWorkspaceRelativePath } from '../utils/workspacePath';

export type WorkspaceDocumentKind = 'text' | 'image';

export interface WorkspaceDocument {
  projectId: string;
  path: string;
  relativePath: string;
  name: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  readOnly: boolean;
  encoding: EditorFileSnapshot['encoding'];
  language: EditorLanguage;
  diskVersion: string;
  eol: 'lf' | 'crlf';
  bom: boolean;
  size: number;
  loading: boolean;
  error: string;
  kind: WorkspaceDocumentKind;
  mime?: string;
  imageData?: string;
  largeFile?: boolean;
  protectedFile?: boolean;
  missing?: boolean;
  externalConflict?: boolean;
  externalVersion?: string;
}

export interface WorkspaceEditorSession {
  projectId: string;
  tabs: string[];
  activePath: string | null;
  documents: Record<string, WorkspaceDocument>;
}

const PROJECT_TAB_LIMIT = 20;
const GLOBAL_DOCUMENT_LIMIT = 50;
const CODEMIRROR_READONLY_BYTES = 2 * 1024 * 1024;
const CODEMIRROR_MAX_BYTES = 5 * 1024 * 1024;

function documentKey(relativePath: string): string {
  return editorDocumentKey(relativePath);
}

function isSameOrDescendantPath(relativePath: string, ancestorPath: string): boolean {
  const relativeKey = documentKey(relativePath);
  const ancestorKey = documentKey(ancestorPath);
  return relativeKey === ancestorKey || relativeKey.startsWith(`${ancestorKey}/`);
}

function displayName(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath;
}

function absolutePath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  const separator = normalizedRoot.includes('\\') ? '\\' : '/';
  return `${normalizedRoot}${separator}${relativePath.replace(/\//g, separator)}`;
}

function emptyDocument(project: Project, relativePath: string, kind: WorkspaceDocumentKind): WorkspaceDocument {
  return {
    projectId: project.id,
    path: absolutePath(project.path, relativePath),
    relativePath,
    name: displayName(relativePath),
    content: '',
    savedContent: '',
    dirty: false,
    readOnly: kind === 'image',
    encoding: 'utf-8',
    language: editorLanguageForPath(relativePath),
    diskVersion: '',
    eol: 'lf',
    bom: false,
    size: 0,
    loading: true,
    error: '',
    kind,
  };
}

function applySnapshot(document: WorkspaceDocument, snapshot: EditorFileSnapshot): void {
  document.content = snapshot.content;
  document.savedContent = snapshot.content;
  document.dirty = false;
  document.encoding = snapshot.encoding;
  document.protectedFile = snapshot.size > CODEMIRROR_READONLY_BYTES;
  document.readOnly = snapshot.readOnly || document.protectedFile;
  document.diskVersion = snapshot.diskVersion;
  document.eol = snapshot.eol;
  document.bom = snapshot.encoding === 'utf-8-bom';
  document.size = snapshot.size;
  document.loading = false;
  document.error = '';
  document.largeFile = false;
  document.missing = false;
  document.externalConflict = false;
  document.externalVersion = undefined;
}

function applyLoadError(document: WorkspaceDocument, error: unknown): void {
  const message = String(error);
  document.loading = false;
  document.readOnly = true;
  document.missing = message.includes('file_missing');
  document.error = message;
}

export const useWorkspaceEditorStore = defineStore('workspaceEditor', () => {
  const sessions = ref<Record<string, WorkspaceEditorSession>>({});

  function getSession(projectId: string): WorkspaceEditorSession {
    if (!sessions.value[projectId]) {
      sessions.value[projectId] = {
        projectId,
        tabs: [],
        activePath: null,
        documents: {},
      };
    }
    return sessions.value[projectId];
  }

  function getDocument(projectId: string, relativePath: string): WorkspaceDocument | null {
    return getSession(projectId).documents[documentKey(relativePath)] || null;
  }

  function allDocuments(): WorkspaceDocument[] {
    return Object.values(sessions.value).flatMap(session => Object.values(session.documents));
  }

  function evictSavedDocument(session: WorkspaceEditorSession, keepKey: string): boolean {
    const candidateKey = session.tabs.find(key => {
      const document = session.documents[key];
      return key !== keepKey
        && key !== session.activePath
        && document
        && !document.dirty;
    });
    if (!candidateKey) return false;
    delete session.documents[candidateKey];
    session.tabs = session.tabs.filter(key => key !== candidateKey);
    return true;
  }

  function ensureCapacity(session: WorkspaceEditorSession, key: string): void {
    while (session.tabs.length >= PROJECT_TAB_LIMIT && !evictSavedDocument(session, key)) {
      throw new Error('editor_tab_limit');
    }
    while (allDocuments().length >= GLOBAL_DOCUMENT_LIMIT) {
      let evicted = false;
      for (const candidate of Object.values(sessions.value)) {
        if (evictSavedDocument(candidate, key)) {
          evicted = true;
          break;
        }
      }
      if (!evicted) throw new Error('editor_document_limit');
    }
  }

  function activate(session: WorkspaceEditorSession, key: string): void {
    if (!session.tabs.includes(key)) session.tabs.push(key);
    session.activePath = key;
  }

  async function openText(project: Project, rawRelativePath: string): Promise<WorkspaceDocument> {
    const relativePath = normalizeWorkspaceRelativePath(rawRelativePath, false);
    const session = getSession(project.id);
    const key = documentKey(relativePath);
    const existing = session.documents[key];
    if (existing) {
      activate(session, key);
      return existing;
    }
    ensureCapacity(session, key);

    session.documents[key] = emptyDocument(project, relativePath, 'text');
    // Ref 深层代理会在赋值时包装文档；异步写回必须使用包装后的对象。
    const document = session.documents[key]!;
    activate(session, key);

    try {
      const stat = await api.workspaceStat(project.path, relativePath);
      if (!stat.exists || stat.isDirectory) throw new Error('file_missing');
      document.size = stat.size;
      if (stat.size > CODEMIRROR_MAX_BYTES) {
        document.loading = false;
        document.readOnly = true;
        document.largeFile = true;
        document.protectedFile = false;
        document.error = 'file_too_large';
        return document;
      }
      const snapshot = await api.workspaceReadEditorFile(project.path, relativePath);
      applySnapshot(document, snapshot);
    } catch (error) {
      applyLoadError(document, error);
    }
    return document;
  }

  async function openImage(project: Project, rawRelativePath: string): Promise<WorkspaceDocument> {
    const relativePath = normalizeWorkspaceRelativePath(rawRelativePath, false);
    const session = getSession(project.id);
    const key = documentKey(relativePath);
    const existing = session.documents[key];
    if (existing) {
      activate(session, key);
      return existing;
    }
    ensureCapacity(session, key);

    session.documents[key] = emptyDocument(project, relativePath, 'image');
    const document = session.documents[key]!;
    document.mime = mimeForFile(relativePath);
    activate(session, key);
    try {
      const [stat, base64] = await Promise.all([
        api.workspaceStat(project.path, relativePath),
        api.workspaceReadBinaryFileBase64(project.path, relativePath),
      ]);
      if (!stat.exists || stat.isDirectory) throw new Error('file_missing');
      document.size = stat.size;
      document.diskVersion = stat.diskVersion;
      document.imageData = `data:${document.mime};base64,${base64}`;
      document.loading = false;
      document.error = '';
      document.missing = false;
    } catch (error) {
      applyLoadError(document, error);
    }
    return document;
  }

  async function openFile(project: Project, relativePath: string): Promise<WorkspaceDocument> {
    return fileKind(relativePath) === 'image'
      ? openImage(project, relativePath)
      : openText(project, relativePath);
  }

  function updateContent(projectId: string, relativePath: string, content: string): void {
    const document = getDocument(projectId, relativePath);
    if (!document || document.readOnly || document.kind !== 'text') return;
    document.content = content;
    document.dirty = content !== document.savedContent;
  }

  async function saveDocument(
    project: Project,
    relativePath: string,
    force = false,
  ): Promise<EditorWriteResult> {
    const document = getDocument(project.id, relativePath);
    if (!document) throw new Error('editor_document_missing');
    if (document.readOnly || document.kind !== 'text') throw new Error('editor_read_only');
    const result = await api.workspaceWriteEditorFile(
      project.path,
      document.relativePath,
      document.content,
      document.diskVersion,
      document.eol,
      document.bom,
      force,
    );
    document.savedContent = document.content;
    document.dirty = false;
    document.diskVersion = result.diskVersion;
    document.size = result.size;
    document.externalConflict = false;
    document.externalVersion = undefined;
    document.error = '';
    return result;
  }

  async function saveAll(project: Project): Promise<void> {
    const session = getSession(project.id);
    for (const key of session.tabs) {
      const document = session.documents[key];
      if (document?.dirty && !document.readOnly && document.kind === 'text') {
        await saveDocument(project, document.relativePath);
      }
    }
  }

  async function reloadImageDocument(project: Project, relativePath: string): Promise<WorkspaceDocument> {
    const normalized = normalizeWorkspaceRelativePath(relativePath, false);
    const session = getSession(project.id);
    const key = documentKey(normalized);
    const document = session.documents[key];
    if (!document || document.kind !== 'image') return openImage(project, normalized);
    document.loading = true;
    document.error = '';
    document.missing = false;
    try {
      const [stat, base64] = await Promise.all([
        api.workspaceStat(project.path, document.relativePath),
        api.workspaceReadBinaryFileBase64(project.path, document.relativePath),
      ]);
      if (!stat.exists || stat.isDirectory) throw new Error('file_missing');
      document.size = stat.size;
      document.diskVersion = stat.diskVersion;
      document.mime = document.mime || mimeForFile(document.relativePath);
      document.imageData = `data:${document.mime};base64,${base64}`;
      document.loading = false;
      document.error = '';
      document.missing = false;
    } catch (error) {
      document.loading = false;
      const message = String(error);
      if (message.includes('file_missing')) {
        document.missing = true;
        document.readOnly = true;
        document.error = 'file_missing';
      } else {
        document.error = message;
      }
    }
    return document;
  }

  async function reloadDocument(project: Project, relativePath: string): Promise<WorkspaceDocument> {
    const document = getDocument(project.id, relativePath);
    if (!document) return openFile(project, relativePath);
    if (document.kind === 'image') return reloadImageDocument(project, relativePath);
    document.loading = true;
    document.error = '';
    document.missing = false;
    try {
      const stat = await api.workspaceStat(project.path, document.relativePath);
      if (!stat.exists || stat.isDirectory) throw new Error('file_missing');
      document.size = stat.size;
      if (stat.size > CODEMIRROR_MAX_BYTES) {
        document.loading = false;
        document.readOnly = true;
        document.largeFile = true;
        document.protectedFile = false;
        document.error = 'file_too_large';
        return document;
      }
      const snapshot = await api.workspaceReadEditorFile(project.path, document.relativePath);
      applySnapshot(document, snapshot);
    } catch (error) {
      applyLoadError(document, error);
    }
    return document;
  }

  async function checkExternalChanges(project: Project): Promise<{
    reloaded: WorkspaceDocument[];
    conflicts: WorkspaceDocument[];
  }> {
    const session = getSession(project.id);
    const reloaded: WorkspaceDocument[] = [];
    const conflicts: WorkspaceDocument[] = [];
    for (const document of Object.values(session.documents)) {
      if (document.largeFile || document.loading) continue;
      if (document.kind !== 'text' && document.kind !== 'image') continue;
      try {
        const stat = await api.workspaceStat(project.path, document.relativePath);
        const nextVersion = stat.diskVersion;
        if (nextVersion === document.diskVersion) continue;
        if (document.kind === 'text' && document.dirty) {
          document.externalConflict = true;
          document.externalVersion = nextVersion;
          conflicts.push(document);
          continue;
        }
        if (!stat.exists) {
          document.missing = true;
          document.readOnly = true;
          document.error = 'file_missing';
          document.diskVersion = nextVersion;
          reloaded.push(document);
          continue;
        }
        if (document.kind === 'image') await reloadImageDocument(project, document.relativePath);
        else await reloadDocument(project, document.relativePath);
        reloaded.push(document);
      } catch (error) {
        document.error = String(error);
      }
    }
    return { reloaded, conflicts };
  }

  function setExternalConflictHandled(projectId: string, relativePath: string): void {
    const document = getDocument(projectId, relativePath);
    if (document) document.externalConflict = false;
  }

  function closeDocument(projectId: string, relativePath: string): void {
    const session = getSession(projectId);
    const key = documentKey(relativePath);
    delete session.documents[key];
    session.tabs = session.tabs.filter(tab => tab !== key);
    if (session.activePath === key) session.activePath = session.tabs[session.tabs.length - 1] || null;
  }

  function activateDocument(projectId: string, relativePath: string): void {
    const session = getSession(projectId);
    const key = documentKey(relativePath);
    if (session.documents[key]) session.activePath = key;
  }

  function closeSavedDocuments(projectId: string, except?: string): void {
    const session = getSession(projectId);
    for (const key of [...session.tabs]) {
      const document = session.documents[key];
      if (key !== except && document && !document.dirty) closeDocument(projectId, document.relativePath);
    }
  }

  async function refreshDocumentDiskVersion(projectRoot: string, document: WorkspaceDocument): Promise<void> {
    try {
      const stat = await api.workspaceStat(projectRoot, document.relativePath);
      document.diskVersion = stat.diskVersion;
      document.size = stat.size;
      if (!stat.exists) {
        document.missing = true;
        document.readOnly = document.kind === 'text' ? true : document.readOnly;
        document.error = 'file_missing';
      } else if (document.error === 'file_missing') {
        document.missing = false;
        document.error = '';
      }
    } catch (error) {
      document.error = String(error);
    }
  }

  async function renamePath(projectId: string, fromRaw: string, toRaw: string, projectRoot?: string): Promise<void> {
    const from = normalizeWorkspaceRelativePath(fromRaw, false);
    const to = normalizeWorkspaceRelativePath(toRaw, false);
    const session = getSession(projectId);
    const changes = Object.values(session.documents).filter(document =>
      isSameOrDescendantPath(document.relativePath, from),
    );
    for (const document of changes) {
      const oldKey = documentKey(document.relativePath);
      const nextRelativePath = remapWorkspaceRelativePath(from, to, document.relativePath);
      if (!nextRelativePath) continue;
      const nextKey = documentKey(nextRelativePath);
      delete session.documents[oldKey];
      document.relativePath = nextRelativePath;
      document.name = displayName(nextRelativePath);
      if (projectRoot) document.path = absolutePath(projectRoot, nextRelativePath);
      session.documents[nextKey] = document;
      session.tabs = session.tabs.map(key => key === oldKey ? nextKey : key);
      if (session.activePath === oldKey) session.activePath = nextKey;
    }
    if (projectRoot) {
      await Promise.all(changes.map(document => refreshDocumentDiskVersion(projectRoot, document)));
    }
  }

  function markMissing(projectId: string, rawPath: string): void {
    const relativePath = normalizeWorkspaceRelativePath(rawPath, false);
    const session = getSession(projectId);
    for (const document of Object.values(session.documents)) {
      if (isSameOrDescendantPath(document.relativePath, relativePath)) {
        document.missing = true;
        document.readOnly = true;
        document.error = 'file_missing';
        document.externalConflict = false;
      }
    }
  }

  function cleanupRemovedProjects(projectIds: string[]): void {
    const alive = new Set(projectIds);
    for (const id of Object.keys(sessions.value)) {
      if (!alive.has(id)) delete sessions.value[id];
    }
  }

  function hasDirtyDocuments(projectIds: string[]): boolean {
    const ids = new Set(projectIds);
    return allDocuments().some(document => ids.has(document.projectId) && document.dirty);
  }

  return {
    sessions,
    getSession,
    getDocument,
    openText,
    openImage,
    openFile,
    updateContent,
    saveDocument,
    saveAll,
    reloadDocument,
    reloadImageDocument,
    checkExternalChanges,
    setExternalConflictHandled,
    closeDocument,
    activateDocument,
    closeSavedDocuments,
    renamePath,
    markMissing,
    hasDirtyDocuments,
    cleanupRemovedProjects,
  };
});
