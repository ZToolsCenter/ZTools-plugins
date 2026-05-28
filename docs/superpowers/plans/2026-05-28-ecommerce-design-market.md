# Ecommerce Design Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ecommerce design section to the KeyDock plugin market and scaffold the first ecommerce design plugin wave.

**Architecture:** Keep the market data source in `KeyDock-plugins` and reuse the existing `categories-mapping.json`, `layout.yaml`, plugin `plugin.json`, and release generation scripts. KeyDock should consume the generated market files without required protocol changes.

**Tech Stack:** Node.js scripts, JSON, YAML, ZTools/KeyDock plugin manifest format, Vue/Vite plugins for later implementation.

---

## File Structure

- Modify: `categories-mapping.json` - add the `ecommerce-design` category.
- Modify: `layout.yaml` - add ecommerce design to homepage navigation and define category detail layout.
- Add: `icons/ecommerce-design.png` - category icon.
- Create: `plugins/ecommerce-image-spec/public/plugin.json` - MVP manifest for 商品主图规范检查.
- Create: `plugins/product-image-batch/public/plugin.json` - MVP manifest for 商品图批量处理.
- Create: `plugins/sku-asset-organizer/public/plugin.json` - MVP manifest for SKU 素材整理.
- Create: `plugins/ecommerce-poster-maker/public/plugin.json` - MVP manifest for 电商营销图生成器.
- Create: `plugins/ecommerce-image-spec/package.json`, `plugins/ecommerce-image-spec/index.html`, `plugins/ecommerce-image-spec/src/main.ts`, `plugins/ecommerce-image-spec/src/App.vue`, `plugins/ecommerce-image-spec/vite.config.js`, `plugins/ecommerce-image-spec/tsconfig.json`.
- Create: `plugins/product-image-batch/package.json`, `plugins/product-image-batch/index.html`, `plugins/product-image-batch/src/main.ts`, `plugins/product-image-batch/src/App.vue`, `plugins/product-image-batch/vite.config.js`, `plugins/product-image-batch/tsconfig.json`.
- Create: `plugins/sku-asset-organizer/package.json`, `plugins/sku-asset-organizer/index.html`, `plugins/sku-asset-organizer/src/main.ts`, `plugins/sku-asset-organizer/src/App.vue`, `plugins/sku-asset-organizer/vite.config.js`, `plugins/sku-asset-organizer/tsconfig.json`.
- Create: `plugins/ecommerce-poster-maker/package.json`, `plugins/ecommerce-poster-maker/index.html`, `plugins/ecommerce-poster-maker/src/main.ts`, `plugins/ecommerce-poster-maker/src/App.vue`, `plugins/ecommerce-poster-maker/vite.config.js`, `plugins/ecommerce-poster-maker/tsconfig.json`.
- Verify: `../KeyDock/src/main/api/renderer/pluginMarket.ts` and `../KeyDock/internal-plugins/setting/src/views/PluginMarketSetting/PluginMarketSetting.vue` already consume categories and category layouts; no first-release code change is required in KeyDock.

## Task 1: Add Market Category Metadata

**Files:**
- Modify: `categories-mapping.json`
- Modify: `layout.yaml`
- Add: `icons/ecommerce-design.png`

- [ ] **Step 1: Add ecommerce category to `categories-mapping.json`**

Insert this category after `media`:

```json
{
  "key": "ecommerce-design",
  "title": "电商设计",
  "description": "商品图、详情页、主图规范与营销素材工具",
  "icon": "https://raw.githubusercontent.com/ZToolsCenter/ZTools-plugins/refs/heads/main/icons/ecommerce-design.png",
  "list": [
    "ecommerce-image-spec",
    "product-image-batch",
    "sku-asset-organizer",
    "ecommerce-poster-maker"
  ]
}
```

- [ ] **Step 2: Update `layout.yaml` homepage navigation**

Add `ecommerce-design` after `media`:

```yaml
  - type: navigation
    title: 开始探索
    categories:
      - productivity
      - development
      - media
      - ecommerce-design
      - text
      - game
      - network
      - system
      - other
    showDescription: true
```

- [ ] **Step 3: Add category detail layout to `layout.yaml`**

Append this root-level section:

```yaml
ecommerce-design:
  - type: fixed
    title: 电商设计精选
    plugins:
      - ecommerce-image-spec
      - product-image-batch
      - sku-asset-organizer
      - ecommerce-poster-maker
  - type: list
    title: 全部电商设计工具
```

- [ ] **Step 4: Add `icons/ecommerce-design.png`**

Create a 256x256 PNG icon that reads clearly at small sizes. Recommended visual: a product image frame, crop handles, and a price tag shape using the existing icon style family.

- [ ] **Step 5: Validate JSON and YAML**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('categories-mapping.json','utf8')); console.log('categories ok')"
node -e "import('yaml').then(({default: yaml}) => { yaml.parse(require('fs').readFileSync('layout.yaml','utf8')); console.log('layout ok') })"
```

Expected:

```text
categories ok
layout ok
```

- [ ] **Step 6: Commit**

```bash
git add categories-mapping.json layout.yaml icons/ecommerce-design.png
git commit -m "feat: add ecommerce design market category"
```

## Task 2: Scaffold `ecommerce-image-spec`

**Files:**
- Create: `plugins/ecommerce-image-spec/package.json`
- Create: `plugins/ecommerce-image-spec/index.html`
- Create: `plugins/ecommerce-image-spec/public/plugin.json`
- Create: `plugins/ecommerce-image-spec/public/logo.png`
- Create: `plugins/ecommerce-image-spec/src/main.ts`
- Create: `plugins/ecommerce-image-spec/src/App.vue`
- Create: `plugins/ecommerce-image-spec/README.md`
- Create: `plugins/ecommerce-image-spec/vite.config.js`
- Create: `plugins/ecommerce-image-spec/tsconfig.json`

- [ ] **Step 1: Create manifest**

Use this `plugins/ecommerce-image-spec/public/plugin.json`:

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "ecommerce-image-spec",
  "title": "商品主图规范检查",
  "description": "检查并处理商品主图尺寸、格式、主体留白、文件大小和平台规范。",
  "author": "KeyDock",
  "version": "0.1.0",
  "main": "index.html",
  "logo": "logo.png",
  "categories": ["ecommerce-design", "media"],
  "development": {
    "main": "http://localhost:5173"
  },
  "pluginSetting": {
    "single": true,
    "height": 680
  },
  "features": [
    {
      "code": "ecommerce-image-spec",
      "explain": "检查商品主图是否符合电商平台规范",
      "icon": "logo.png",
      "cmds": [
        "商品主图检查",
        "主图规范",
        "电商图片检查",
        {
          "type": "img",
          "label": "检查商品主图"
        },
        {
          "type": "files",
          "fileType": "file",
          "label": "检查商品主图",
          "extensions": ["jpg", "jpeg", "png", "webp"]
        },
        {
          "type": "files",
          "fileType": "directory",
          "label": "检查文件夹中的商品图"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create first UI behavior**

`src/App.vue` should show:

```vue
<template>
  <main class="app">
    <section class="toolbar">
      <h1>商品主图规范检查</h1>
      <select v-model="platform">
        <option value="general-square">通用方图</option>
        <option value="taobao">淘宝/天猫</option>
        <option value="jd">京东</option>
        <option value="pdd">拼多多</option>
        <option value="douyin">抖音电商</option>
        <option value="xiaohongshu">小红书</option>
      </select>
    </section>
    <section class="dropzone">拖入商品图或文件夹开始检查</section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const platform = ref('general-square')
</script>
```

- [ ] **Step 3: Add README scope**

`README.md` must state:

```markdown
# 商品主图规范检查

检查商品主图尺寸、格式、文件大小、透明通道和主体留白。首版支持通用方图、淘宝/天猫、京东、拼多多、抖音电商、小红书预设。
```

- [ ] **Step 4: Run local build**

Run:

```bash
cd plugins/ecommerce-image-spec
npm install
npm run build
```

Expected: Vite build succeeds and outputs `dist/`.

- [ ] **Step 5: Commit**

```bash
git add plugins/ecommerce-image-spec
git commit -m "feat: scaffold ecommerce image spec plugin"
```

## Task 3: Scaffold `product-image-batch`

**Files:**
- Create the same Vue/Vite file set under `plugins/product-image-batch/`.

- [ ] **Step 1: Create manifest**

Use this `plugins/product-image-batch/public/plugin.json`:

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "product-image-batch",
  "title": "商品图批量处理",
  "description": "批量压缩、改尺寸、转格式、加水印，并导出多平台商品图尺寸包。",
  "author": "KeyDock",
  "version": "0.1.0",
  "main": "index.html",
  "logo": "logo.png",
  "categories": ["ecommerce-design", "media"],
  "development": {
    "main": "http://localhost:5174"
  },
  "pluginSetting": {
    "single": true,
    "height": 700
  },
  "features": [
    {
      "code": "product-image-batch",
      "explain": "批量处理电商商品图并导出平台尺寸包",
      "icon": "logo.png",
      "cmds": [
        "商品图批处理",
        "电商批量改图",
        "商品图尺寸包",
        {
          "type": "files",
          "fileType": "file",
          "label": "批量处理商品图",
          "extensions": ["jpg", "jpeg", "png", "webp", "gif", "bmp"]
        },
        {
          "type": "files",
          "fileType": "directory",
          "label": "批量处理商品图文件夹"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create first UI behavior**

Use this first `src/App.vue` behavior:

```vue
<template>
  <main class="app">
    <section class="toolbar">
      <h1>商品图批量处理</h1>
      <label><input v-model="operations.compress" type="checkbox" /> 压缩</label>
      <label><input v-model="operations.resize" type="checkbox" /> 改尺寸</label>
      <label><input v-model="operations.convert" type="checkbox" /> 转格式</label>
      <label><input v-model="operations.watermark" type="checkbox" /> 加水印</label>
      <label><input v-model="operations.platformPack" type="checkbox" /> 平台尺寸包</label>
    </section>
    <section class="dropzone">拖入商品图片或文件夹</section>
  </main>
</template>

<script setup lang="ts">
import { reactive } from 'vue'

const operations = reactive({
  compress: true,
  resize: true,
  convert: false,
  watermark: false,
  platformPack: true
})
</script>
```

- [ ] **Step 3: Run local build**

Run:

```bash
cd plugins/product-image-batch
npm install
npm run build
```

Expected: Vite build succeeds and outputs `dist/`.

- [ ] **Step 4: Commit**

```bash
git add plugins/product-image-batch
git commit -m "feat: scaffold product image batch plugin"
```

## Task 4: Scaffold `sku-asset-organizer`

**Files:**
- Create the same Vue/Vite file set under `plugins/sku-asset-organizer/`.

- [ ] **Step 1: Create manifest**

Use this `plugins/sku-asset-organizer/public/plugin.json`:

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "sku-asset-organizer",
  "title": "SKU 素材整理",
  "description": "按 SKU、颜色和尺码整理商品素材，检查缺图、重复图和命名冲突。",
  "author": "KeyDock",
  "version": "0.1.0",
  "main": "index.html",
  "logo": "logo.png",
  "categories": ["ecommerce-design", "productivity"],
  "development": {
    "main": "http://localhost:5175"
  },
  "pluginSetting": {
    "single": true,
    "height": 680
  },
  "features": [
    {
      "code": "sku-asset-organizer",
      "explain": "整理 SKU 商品素材并生成交付包",
      "icon": "logo.png",
      "cmds": [
        "SKU素材整理",
        "商品素材整理",
        "商品图片命名",
        {
          "type": "files",
          "fileType": "directory",
          "label": "整理商品素材文件夹"
        },
        {
          "type": "files",
          "fileType": "file",
          "label": "导入 SKU 表",
          "extensions": ["csv", "tsv"]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create first UI behavior**

Use this first `src/App.vue` behavior:

```vue
<template>
  <main class="app">
    <h1>SKU 素材整理</h1>
    <section class="panel">
      <h2>素材文件夹</h2>
      <div class="dropzone">拖入商品素材文件夹</div>
    </section>
    <section class="panel">
      <h2>SKU 表</h2>
      <div class="dropzone">拖入 CSV/TSV 文件</div>
    </section>
    <section class="panel">
      <h2>命名预览</h2>
      <p>{{ namingPattern }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
const namingPattern = 'SKU_颜色_尺码_序号.jpg'
</script>
```

- [ ] **Step 3: Run local build**

Run:

```bash
cd plugins/sku-asset-organizer
npm install
npm run build
```

Expected: Vite build succeeds and outputs `dist/`.

- [ ] **Step 4: Commit**

```bash
git add plugins/sku-asset-organizer
git commit -m "feat: scaffold sku asset organizer plugin"
```

## Task 5: Scaffold `ecommerce-poster-maker`

**Files:**
- Create the same Vue/Vite file set under `plugins/ecommerce-poster-maker/`.

- [ ] **Step 1: Create manifest**

Use this `plugins/ecommerce-poster-maker/public/plugin.json`:

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "ecommerce-poster-maker",
  "title": "电商营销图生成器",
  "description": "用模板生成主图卖点贴、促销角标、优惠券图、横幅和商品卡片。",
  "author": "KeyDock",
  "version": "0.1.0",
  "main": "index.html",
  "logo": "logo.png",
  "categories": ["ecommerce-design", "media"],
  "development": {
    "main": "http://localhost:5176"
  },
  "pluginSetting": {
    "single": true,
    "height": 720
  },
  "features": [
    {
      "code": "ecommerce-poster-maker",
      "explain": "生成电商营销图和商品卖点图",
      "icon": "logo.png",
      "cmds": [
        "电商营销图",
        "活动图生成",
        "主图卖点贴",
        {
          "type": "img",
          "label": "基于商品图生成营销图"
        },
        {
          "type": "files",
          "fileType": "file",
          "label": "基于商品图生成营销图",
          "extensions": ["jpg", "jpeg", "png", "webp"]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create first UI behavior**

Use this first `src/App.vue` behavior:

```vue
<template>
  <main class="app">
    <h1>电商营销图生成器</h1>
    <section class="template-grid">
      <button
        v-for="template in templates"
        :key="template.value"
        :class="{ active: selectedTemplate === template.value }"
        @click="selectedTemplate = template.value"
      >
        {{ template.label }}
      </button>
    </section>
    <section class="dropzone">拖入商品图开始套模板</section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const selectedTemplate = ref('main-badge')
const templates = [
  { value: 'main-badge', label: '主图卖点贴' },
  { value: 'promotion-corner', label: '促销角标' },
  { value: 'coupon', label: '优惠券图' },
  { value: 'banner', label: '横幅' },
  { value: 'product-card', label: '商品卡片' }
]
</script>
```

- [ ] **Step 3: Run local build**

Run:

```bash
cd plugins/ecommerce-poster-maker
npm install
npm run build
```

Expected: Vite build succeeds and outputs `dist/`.

- [ ] **Step 4: Commit**

```bash
git add plugins/ecommerce-poster-maker
git commit -m "feat: scaffold ecommerce poster maker plugin"
```

## Task 6: Generate and Verify Market Output

**Files:**
- Generated: `release/plugins.json`
- Generated: `release/categories.json`
- Generated: `release/latest`
- Generated: plugin zip packages in `release/`

- [ ] **Step 1: Run full detection**

Run:

```bash
npm run detect:all
```

Expected: build info includes the four ecommerce plugins.

- [ ] **Step 2: Build changed plugins**

Run:

```bash
npm run build
```

Expected: zip packages are generated under `release/`.

- [ ] **Step 3: Generate market metadata**

Run:

```bash
npm run generate
```

Expected: `release/plugins.json` and `release/categories.json` are generated.

- [ ] **Step 4: Verify ecommerce category output**

Run:

```bash
node -e "const c=require('./release/categories.json'); const e=c.find(x=>x.key==='ecommerce-design'); if(!e) throw new Error('missing ecommerce-design'); console.log(e.title, e.list.length)"
```

Expected:

```text
电商设计 4
```

- [ ] **Step 5: Commit generated metadata if release assets are tracked**

If this repository tracks `release/` outputs, run:

```bash
git add release
git commit -m "chore: generate ecommerce design market release"
```

If release outputs are CI artifacts only, do not commit `release/`.

## Task 7: Verify KeyDock Compatibility

**Files:**
- Read: `../KeyDock/src/main/api/renderer/pluginMarket.ts`
- Read: `../KeyDock/internal-plugins/setting/src/views/PluginMarketSetting/PluginMarketSetting.vue`
- Read: `../KeyDock/internal-plugins/setting/src/views/PluginMarketSetting/components/types.ts`

- [ ] **Step 1: Confirm market API consumes generated category data**

Run:

```bash
rg -n "categoriesUrl|layoutUrl|buildPluginMarketStorefront|categoryLayouts" ../KeyDock/src/main/api/renderer/pluginMarket.ts
```

Expected: output includes references to `categoriesUrl`, `layoutUrl`, `buildPluginMarketStorefront`, and `categoryLayouts`.

- [ ] **Step 2: Confirm setting UI renders categories and category layouts**

Run:

```bash
rg -n "storefrontCategories|categoryLayouts|openCategoryDetail|getCategoryLayout" ../KeyDock/internal-plugins/setting/src/views/PluginMarketSetting/PluginMarketSetting.vue
```

Expected: output includes references to `storefrontCategories`, `categoryLayouts`, `openCategoryDetail`, and `getCategoryLayout`.

- [ ] **Step 3: Run KeyDock type checks only if KeyDock code changes**

For the first release, KeyDock source should not change. If a later task changes KeyDock files, run:

```bash
pnpm typecheck
```

Expected: type checking passes.

- [ ] **Step 4: Commit only if KeyDock files changed**

For the first release, no KeyDock commit is expected. If a later task changes KeyDock files, run in `../KeyDock`:

```bash
git status --short
git add src/main/api/renderer/pluginMarket.ts internal-plugins/setting/src/views/PluginMarketSetting/PluginMarketSetting.vue internal-plugins/setting/src/views/PluginMarketSetting/components/types.ts
git commit -m "feat: enhance plugin market ecommerce category display"
```

## Self-Review

- Spec coverage: The plan covers category metadata, homepage navigation, category detail layout, four MVP plugins, release generation, and optional KeyDock UX enhancement.
- Placeholder scan: No task depends on an undefined placeholder; plugin names, manifest fields, commands, and files are specified.
- Type consistency: Category key is consistently `ecommerce-design`; plugin names match the category list and manifest `name` fields.
