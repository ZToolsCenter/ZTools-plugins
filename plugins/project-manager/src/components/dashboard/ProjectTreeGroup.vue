<script setup lang="ts">
/***********************项目树分组*********************/
import type { Project, ProjectHealthSnapshot } from '../../types';
import type { ProjectGitOverview } from '../../utils/projectGitOverview';
import ProjectTreeNode from './ProjectTreeNode.vue';

defineProps<{
  rootProject: Project;
  visibleIds: ReadonlySet<string>;
  expandedIds: ReadonlySet<string>;
  gitOverviewById: Readonly<Record<string, ProjectGitOverview | undefined>>;
  healthById: Readonly<Record<string, ProjectHealthSnapshot | undefined>>;
  healthLevelById: Readonly<Record<string, 'healthy' | 'warn' | 'error' | 'unknown'>>;
  selectedIds?: ReadonlySet<string>;
  draggable?: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle-expand', project: Project): void;
  (event: 'open-management', project: Project): void;
  (event: 'open-workspace', project: Project): void;
  (event: 'open-git', project: Project): void;
  (event: 'open-running', project: Project): void;
  (event: 'edit', project: Project): void;
  (event: 'toggle-select', projectId: string): void;
  (eventName: 'drag-start', mouseEvent: MouseEvent, project: Project): void;
}>();

function handleDragStart(event: MouseEvent, project: Project): void {
  emit('drag-start', event, project);
}
</script>

<template>
  <div class="project-tree-group">
    <ProjectTreeNode
      :project="rootProject"
      :depth="1"
      :visible-ids="visibleIds"
      :expanded-ids="expandedIds"
      :git-overview-by-id="gitOverviewById"
      :health-by-id="healthById"
      :health-level-by-id="healthLevelById"
      :selected-ids="selectedIds"
      :is-root="true"
      :draggable="draggable"
      @toggle-expand="emit('toggle-expand', $event)"
      @open-management="emit('open-management', $event)"
      @open-workspace="emit('open-workspace', $event)"
      @open-git="emit('open-git', $event)"
      @open-running="emit('open-running', $event)"
      @edit="emit('edit', $event)"
      @toggle-select="emit('toggle-select', $event)"
      @drag-start="handleDragStart"
    />
  </div>
</template>

<style scoped>
.project-tree-group {
  min-width: 0;
}
</style>
