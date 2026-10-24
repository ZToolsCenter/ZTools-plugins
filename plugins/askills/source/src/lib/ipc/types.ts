export type Appearance = {
  mode: "system" | "light" | "dark";
  accentColor: string;
  fontFamily: string;
};
export type Source = {
  kind: string;
  url: string | null;
  reference: string | null;
  commit: string | null;
  subpath: string | null;
  localPath: string | null;
};
export type Skill = {
  id: string;
  name: string;
  displayName: string | null;
  description: string;
  license: string | null;
  latestRevisionId: string;
  source: Source;
  revisionCount: number;
  createdAt: string;
};
export type Revision = {
  id: string;
  skillId: string;
  hash: string;
  path: string;
  source: Source;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
};
export type SkillDocument = {
  skill: Skill;
  revision: Revision;
  markdown: string;
  warnings: string[];
};
export type Project = {
  id: string;
  name: string;
  displayName?: string | null;
  path: string;
};
export type DetectedSkill = {
  path: string;
  resolvedPath: string | null;
  name: string;
  description: string;
  scopePath: string;
  consumers: string[];
  status: string;
  diagnostics: string[];
};
export type Deployment = {
  id: string;
  projectId: string;
  skillId: string;
  revisionId: string;
  name: string;
  agent: string;
  mode: string;
  targetPath: string;
  previousRevisionId: string | null;
  status: string;
};
export type DeploymentPlan = {
  id: string;
  projectId: string;
  revisionId: string;
  skillId: string;
  name: string;
  agent: string;
  mode: string;
  targetPath: string;
  previousRevisionId: string | null;
  conflict: string | null;
  warnings: string[];
};
export type Snapshot = {
  skills: Skill[];
  projects: Project[];
  deployments: Deployment[];
  libraryRoot: string;
  recovery: string[];
  repositoryHistory: string[];
  appearance: Appearance;
  locale: Locale;
};
export type ImportPreview = {
  name: string;
  description: string;
  license: string | null;
  hash: string;
  fileCount: number;
  totalBytes: number;
  markdown: string;
  warnings: string[];
};
export type PreparedImport = {
  id: string;
  preview: ImportPreview;
  source: Source | null;
};
export type DirectorySelection = { id: string; path: string };
export type LibraryMigrationPlan = {
  sourcePath: string;
  targetPath: string;
  skillCount: number;
  revisionCount: number;
  deploymentCount: number;
  totalBytes: number;
};
export type LibraryMigrationResult = {
  libraryRoot: string;
  previousRoot: string;
};
export type DiscoveredProject = {
  selectionId: string;
  name: string;
  path: string;
  reason: string;
};
export type Catalog = {
  id: string;
  repository: string;
  reference: string;
  commit: string;
  candidates: { path: string; name: string }[];
};
export type RevisionDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  before: string;
  after: string;
};
export type RunOperation = <T>(
  label: string,
  work: () => Promise<T>,
) => Promise<T | undefined>;
export type Locale = "zh-CN" | "en";
