import { pinyin } from 'pinyin-pro';
import type { Project } from '../types';

/***********************项目搜索索引*********************/

export interface ProjectSearchEntry {
  projectId: string;
  normalizedName: string;
  normalizedPath: string;
  compactName: string;
  compactPath: string;
  namePinyin: string;
  pathPinyin: string;
  normalizedDescription: string;
  normalizedTags: string;
  normalizedScripts: string;
  normalizedCustomCommands: string;
}

const pinyinCache = new Map<string, string>();

export function buildPinyinSearchText(text: string): string {
  if (!text) return '';
  const cached = pinyinCache.get(text);
  if (cached) return cached;

  const syllables = pinyin(text, { toneType: 'none', type: 'array' }) as string[];
  const full = syllables.join('');
  const initials = syllables.map(syllable => syllable[0] || '').join('');
  const result = `${full} ${initials}`.toLowerCase();
  pinyinCache.set(text, result);
  return result;
}

export function buildProjectSearchEntry(project: Pick<
  Project,
  'id' | 'name' | 'path' | 'description' | 'tags' | 'scripts' | 'customCommands'
>): ProjectSearchEntry {
  return {
    projectId: project.id,
    normalizedName: project.name.toLowerCase(),
    normalizedPath: project.path.toLowerCase(),
    compactName: project.name.toLowerCase().replace(/\s+/g, ''),
    compactPath: project.path.toLowerCase().replace(/\s+/g, ''),
    namePinyin: buildPinyinSearchText(project.name),
    pathPinyin: buildPinyinSearchText(project.path),
    normalizedDescription: (project.description || '').toLowerCase(),
    normalizedTags: (project.tags || []).join(' ').toLowerCase(),
    normalizedScripts: (project.scripts || []).join(' ').toLowerCase(),
    normalizedCustomCommands: (project.customCommands || []).map(command => command.name).join(' ').toLowerCase(),
  };
}

export function projectSearchEntryMatches(entry: ProjectSearchEntry, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const compactQuery = query.replace(/\s+/g, '');
  return entry.normalizedName.includes(query)
    || entry.normalizedPath.includes(query)
    || entry.compactName.includes(compactQuery)
    || entry.compactPath.includes(compactQuery)
    || entry.namePinyin.includes(compactQuery)
    || entry.pathPinyin.includes(compactQuery)
    || entry.normalizedDescription.includes(query)
    || entry.normalizedTags.includes(query)
    || entry.normalizedScripts.includes(compactQuery)
    || entry.normalizedCustomCommands.includes(compactQuery);
}

