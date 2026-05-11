# AGENTS.md - Developer Guide for ztools-timestamp

This document provides coding guidelines and reference information for AI agents operating in this repository.

## Project Overview

- **Type**: ZTools Plugin (Vue 3 + Vite + TypeScript)
- **Purpose**: Timestamp conversion tool
- **Framework**: Vue 3 (Composition API), Vite 6, TypeScript 5.3
- **Styling**: Tailwind CSS v4

## Build Commands

```bash
# Install dependencies
npm install

# Development server (http://localhost:5173)
npm run dev

# Production build
npm run build

# Note: No test framework configured (no tests exist)
```

## Code Style Guidelines

### TypeScript

- **Strict Mode**: Disabled (`strict: false`, `noImplicitAny: false` in tsconfig.json)
- **Module System**: ESNext with bundler module resolution
- **Target**: ES2020
- **Types**: Use `any` sparingly; prefer explicit types when possible

### Vue Components

- Use `<script setup lang="ts">` syntax
- Component file naming: `index.vue` for directory exports, descriptive names for feature components
- Props: Use `defineProps()` with explicit type definitions

```vue
<script lang="ts" setup>
defineProps<{
  launchParam: {
    type: Object
    required: true
  }
}>()
</script>
```

### Imports

- Vue core: `import { ref, onMounted } from 'vue'`
- Local components: `import Timestamp from './components/timestamp/timestamp.vue'`
- CSS: `import './assets/css/main.css'`

### Styling (Tailwind CSS v4)

- Import: `@import 'tailwindcss';` (in main.css)
- Use utility classes directly in templates
- Custom base styles:

```css
@layer base {
  * {
    border-color: var(--color-gray-200);
  }
}
```

### ZTools API Usage

Access ZTools APIs via `window.ztools`:

```typescript
// Listen for plugin entry
window.ztools.onPluginEnter((param) => {
  route.value = param.code
  launchParam.value = param
})

// Listen for plugin exit
window.ztools.onPluginOut(() => {
  route.value = ''
})

// Clipboard
await window.ztools.getClipboardContent()

// UI
window.ztools.hideMainWindow()
window.ztools.showTip('message')
```

### Preload Services

Node.js capabilities accessed via `window.services`:

```javascript
// Defined in public/preload/services.js
const result = await window.services.someService(params)
```

## Error Handling

- Use try-catch for async operations
- Always log errors with meaningful context

```typescript
try {
  const content = await window.services.readFile('/path')
} catch (error) {
  console.error('读取失败:', error)
}
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `Timestamp`, `HelloWorld` |
| Files | kebab-case | `timestamp.vue`, `main.ts` |
| Props | camelCase | `launchParam` |
| Variables | camelCase | `route`, `inputValue` |

## Project Structure

```
src/
├── main.ts              # Vue app entry
├── main.css             # Global styles (Tailwind)
├── App.vue              # Root component (router)
├── env.d.ts             # Type declarations
├── assets/css/          # CSS assets
│   └── main.css
└── components/
    └── timestamp/
        └── timestamp.vue

public/
├── plugin.json          # Plugin configuration
├── logo.png             # Plugin icon
└── preload/
    └── services.js      # Node.js service extensions
```

## Common Patterns

### Conditional Rendering

```vue
<Timestamp v-if="route === 'timestamp'" :launch-param="launchParam" />
```

### Event Handling

```vue
<script setup lang="ts">
const handleClick = () => {
  // implementation
}
</script>

<template>
  <button @click="handleClick">Click</button>
</template>
```

### State with refs

```typescript
import { ref } from 'vue'

const route = ref('')
const launchParam = ref<any>({})
```

## ZTools Plugin Configuration

Edit `public/plugin.json` to configure features:

```json
{
  "code": "timestamp",
  "explain": "时间戳转换",
  "cmds": ["timestamp", "时间戳转换"]
}
```

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| vue | ^3.5.13 | Framework |
| vite | ^6.0.11 | Build tool |
| typescript | ^5.3.0 | TypeScript |
| tailwindcss | ^4.2.2 | Styling |
| @ztools-center/ztools-api-types | ^1.0.1 | ZTools API types |
| @vitejs/plugin-vue | ^5.2.1 | Vue plugin for Vite |

## Lint/Type Checking

- Run `vue-tsc` as part of build: `npm run build` (runs `vue-tsc && vite build`)
- No separate lint script configured

## Important Notes

1. **No tests exist** - This project has no test suite configured
2. **Strict mode off** - TypeScript is lenient; avoid using `as any` when possible
3. **Tailwind v4** - Uses `@import 'tailwindcss'` syntax (not `@tailwind` directives)
4. **ZTools-specific** - This is a plugin for ZTools app; requires ZTools runtime for full functionality
