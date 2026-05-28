#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REQUIRED_CATEGORY = 'ecommerce-design';
const REQUIRED_PLUGINS = [
  'ecommerce-image-spec',
  'product-image-batch',
  'sku-asset-organizer',
  'ecommerce-poster-maker'
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const categories = readJson('categories-mapping.json');
const category = categories.find(item => item.key === REQUIRED_CATEGORY);
assert(category, `Missing category: ${REQUIRED_CATEGORY}`);
assert(category.title === '电商设计', 'Ecommerce category title must be 电商设计');

for (const pluginName of REQUIRED_PLUGINS) {
  assert(category.list.includes(pluginName), `Category missing plugin: ${pluginName}`);
}

const layoutText = readFileSync('layout.yaml', 'utf-8');
assert(layoutText.includes('type: navigation'), 'Missing homepage navigation section');
assert(
  layoutText.includes(`      - ${REQUIRED_CATEGORY}`),
  `Homepage navigation missing category: ${REQUIRED_CATEGORY}`
);

assert(layoutText.includes(`${REQUIRED_CATEGORY}:`), `Missing ${REQUIRED_CATEGORY} category layout`);
assert(
  layoutText.includes('  - type: fixed'),
  `${REQUIRED_CATEGORY} layout must include a fixed section`
);
assert(
  layoutText.includes('  - type: list'),
  `${REQUIRED_CATEGORY} layout must include a list section`
);

for (const pluginName of REQUIRED_PLUGINS) {
  const pluginDir = join('plugins', pluginName);
  const manifestPath = join(pluginDir, 'public', 'plugin.json');
  const logoPath = join(pluginDir, 'public', 'logo.png');
  const packagePath = join(pluginDir, 'package.json');
  const appPath = join(pluginDir, 'src', 'App.vue');

  assert(existsSync(manifestPath), `Missing manifest: ${manifestPath}`);
  assert(existsSync(logoPath), `Missing logo: ${logoPath}`);
  assert(existsSync(packagePath), `Missing package.json: ${packagePath}`);
  assert(existsSync(appPath), `Missing App.vue: ${appPath}`);

  const manifest = readJson(manifestPath);
  assert(manifest.name === pluginName, `Manifest name mismatch for ${pluginName}`);
  assert(
    Array.isArray(manifest.categories) && manifest.categories.includes(REQUIRED_CATEGORY),
    `Manifest categories missing ${REQUIRED_CATEGORY}: ${pluginName}`
  );
  assert(Array.isArray(manifest.features), `Manifest features missing: ${pluginName}`);
  assert(manifest.features.length > 0, `Manifest features empty: ${pluginName}`);
}

console.log(`Ecommerce design market validation passed (${REQUIRED_PLUGINS.length} plugins).`);
