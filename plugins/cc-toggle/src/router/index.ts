import { createRouter, createMemoryHistory } from 'vue-router';
import ProviderListPage from '../views/ProviderListPage.vue';
import SkillsPage from '../views/SkillsPage.vue';

const routes = [
  { path: '/', component: ProviderListPage },
  { path: '/skills', component: SkillsPage },
  { path: '/prompts', component: () => import('../views/PromptsPage.vue') },
  { path: '/stats', component: () => import('../views/StatsPage.vue') },
  { path: '/mcp', component: () => import('../views/McpPage.vue') },
  { path: '/sessions', component: () => import('../views/SessionPage.vue') },
  {
    path: '/settings',
    component: () => import('../views/SettingsPage.vue'),
    children: [
      { path: '', redirect: '/settings/claude' },
      { path: 'routes', component: () => import('../views/settings/RoutesSettings.vue') },
      { path: 'storage', component: () => import('../views/settings/StorageSettings.vue') },
      { path: 'claude', component: () => import('../views/settings/ClaudeSettings.vue') },
      { path: 'about', component: () => import('../views/settings/AboutPage.vue') }
    ]
  }
];

export default createRouter({
  history: createMemoryHistory(),
  routes
});
