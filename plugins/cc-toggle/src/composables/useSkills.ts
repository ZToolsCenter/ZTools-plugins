import { ref } from 'vue';
import { getSkillNest } from './shared';
import type {
  NestSkill,
  SkillInDir,
  SkillRepo,
  ProjectTarget,
  DeployEntry,
  DeployResult,
  SyncResult,
  SkillListResult,
  SkillInstallResult,
  SkillDirs,
  ConfigPaths,
  SuccessResult,
  IdResult
} from '../types/ztools-cctoggle';

const ALL_APPS = ['codex', 'claude', 'gemini', 'opencode', 'openclaw'] as const;
const APP_LABELS: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw'
};

const storagePaths = ref<SkillDirs>({});
const allSkills = ref<SkillListResult>({} as SkillListResult);
const nestSkills = ref<NestSkill[]>([]);
const deployments = ref<Record<string, DeployEntry[]>>({});
const projectTargets = ref<ProjectTarget[]>([]);
const repos = ref<SkillRepo[]>([]);
const configPaths = ref<ConfigPaths>({});

function loadStoragePaths(): void {
  storagePaths.value = getSkillNest().getSkillStoragePaths();
}

function saveStoragePaths(paths: SkillDirs): void {
  getSkillNest().setSkillStoragePaths(paths);
  storagePaths.value = { ...paths };
}

function loadAllSkills(): void {
  allSkills.value = getSkillNest().listAllSkills();
}

function loadNestSkills(): void {
  nestSkills.value = getSkillNest().listNestSkills();
}

function loadDeployments(): void {
  deployments.value = getSkillNest().getDeployRegistry();
}

function loadProjectTargets(): void {
  projectTargets.value = getSkillNest().listProjectTargets();
}

function addProjectTarget(pathStr: string, label?: string): IdResult | SuccessResult {
  const r = getSkillNest().addProjectTarget(pathStr, label);
  loadProjectTargets();
  return r;
}

function removeProjectTarget(id: string): void {
  getSkillNest().removeProjectTarget(id);
  loadProjectTargets();
}

function deploy(skillName: string, target: string): DeployResult {
  const r = getSkillNest().deploySkill(skillName, target);
  loadDeployments();
  loadAllSkills();
  return r;
}

function undeploy(skillName: string, target: string): DeployResult {
  const r = getSkillNest().undeploySkill(skillName, target);
  loadDeployments();
  loadAllSkills();
  return r;
}

const syncMode = ref('symlink');

function loadSyncMode(): void {
  syncMode.value = getSkillNest().getSyncMode();
}

function saveSyncMode(mode: string): void {
  syncMode.value = mode;
  getSkillNest().setSyncMode(mode);
}

function loadRepos(): void {
  repos.value = getSkillNest().getSkillRepos();
}

function addRepo(url: string, branch?: string): SuccessResult {
  const r = getSkillNest().addSkillRepo(url, branch);
  loadRepos();
  return r;
}

function removeRepo(url: string): void {
  getSkillNest().removeSkillRepo(url);
  loadRepos();
}

function syncSkillsTo(sourceApp: string, targetApps: string[]): SyncResult {
  const r = getSkillNest().syncSkills(sourceApp, targetApps);
  loadAllSkills();
  return r;
}

// Config paths
function loadConfigPaths(): void {
  configPaths.value = getSkillNest().getConfigPaths();
}

function saveConfigPaths(paths: ConfigPaths): void {
  getSkillNest().setConfigPaths(paths);
  configPaths.value = { ...paths };
}

export function useSkills() {
  return {
    ALL_APPS,
    APP_LABELS,
    storagePaths,
    allSkills,
    nestSkills,
    deployments,
    projectTargets,
    repos,
    configPaths,
    loadStoragePaths,
    saveStoragePaths,
    loadAllSkills,
    loadNestSkills,
    loadDeployments,
    loadProjectTargets,
    addProjectTarget,
    removeProjectTarget,
    deploy,
    undeploy,
    loadRepos,
    addRepo,
    removeRepo,
    syncSkillsTo,
    syncMode,
    loadSyncMode,
    saveSyncMode,
    loadConfigPaths,
    saveConfigPaths
  };
}
