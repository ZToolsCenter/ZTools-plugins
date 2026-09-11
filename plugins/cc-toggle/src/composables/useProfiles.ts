import { ref } from 'vue';
import { getSkillNest } from './shared';
import { useProviders } from './useProviders';
import type { ProjectProfile, AppType } from '../types/ztools-cctoggle';

const profiles = ref<ProjectProfile[]>([]);
const activeProfileId = ref<string | null>(null);

function loadProfiles(): void {
  try {
    profiles.value = getSkillNest().listProfiles?.() || [];
  } catch (e) {
    profiles.value = [];
  }
  try {
    activeProfileId.value = getSkillNest().getActiveProfileId?.() || null;
  } catch (e) {
    activeProfileId.value = null;
  }
}

function getActiveProfileName(): string {
  if (!activeProfileId.value) return '全局默认';
  const p = profiles.value.find(pr => pr.id === activeProfileId.value);
  return p ? p.name : '全局默认';
}

function activateProfile(id: string): boolean {
  try {
    const r = getSkillNest().activateProfile?.(id);
    if (r?.success) {
      activeProfileId.value = id;
      // 刷新供应商列表
      try {
        const { loadProviders } = useProviders();
        loadProviders();
      } catch (e) {
        /* ignore */
      }
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function deactivateProfile(): void {
  try {
    getSkillNest().deactivateProfile?.();
    activeProfileId.value = null;
    try {
      const { loadProviders } = useProviders();
      loadProviders();
    } catch (e) {
      /* ignore */
    }
  } catch (e) {
    /* ignore */
  }
}

function createProfile(name: string, icon?: string): string | null {
  try {
    const ccs = getSkillNest();
    const id = ccs.saveProfile?.({ name, icon, providers: {} });
    if (id) {
      loadProfiles();
      return id;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function renameProfile(id: string, name: string): boolean {
  try {
    const ccs = getSkillNest();
    const profile = ccs.getProfile?.(id);
    if (!profile) return false;
    ccs.saveProfile?.({ id, name, providers: profile.providers, createdAt: profile.createdAt });
    loadProfiles();
    return true;
  } catch (e) {
    return false;
  }
}

function deleteProfile(id: string): boolean {
  try {
    getSkillNest().deleteProfile?.(id);
    loadProfiles();
    // 若删除的是当前激活项目，刷新供应商
    if (activeProfileId.value === id) {
      activeProfileId.value = null;
      try {
        const { loadProviders } = useProviders();
        loadProviders();
      } catch (e) {
        /* ignore */
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function useProfiles() {
  return {
    profiles,
    activeProfileId,
    loadProfiles,
    getActiveProfileName,
    activateProfile,
    deactivateProfile,
    createProfile,
    renameProfile,
    deleteProfile
  };
}
