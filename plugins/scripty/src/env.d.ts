/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type { ScriptyApi } from './types/api'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  interface Window {
    scripty?: ScriptyApi
  }
}

export {}
